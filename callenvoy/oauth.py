"""Agent sign-in in the browser (OAuth 2.1 for MCP clients): no key to copy.

An MCP client that gets 401 from /mcp finds this server's OAuth metadata, registers itself, and opens
/authorize in the user's browser. The user signs in to the console (if needed) and approves on the /connect
page; the client then trades its code for a token. The token is an ordinary agent key of that user, named
after the client, so it shows in the console's key list and can be disabled or deleted there. The routes and
the protocol checks (PKCE, redirect URIs, client authentication) are the MCP SDK's; this module only stores.
"""

import json
import secrets
import time
from urllib.parse import urlparse

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    RefreshToken,
    TokenError,
    construct_redirect_uri,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from . import auth, config, store

SCOPE = "calls"  # the one thing a signed-in agent may do: use the calling tools for this user
SIGNED_IN = " (signed in)"  # ends the name of a key made by a browser sign-in

# In memory (one process; a restart only makes a user start the sign-in again):
_requests: dict[str, tuple[OAuthClientInformationFull, AuthorizationParams, float]] = {}  # waiting for the user
_codes: dict[str, AuthorizationCode] = {}  # approved, waiting for the client to fetch its token


def _drop_old() -> None:
    now = time.time()
    for rid in [r for r, (_, _, exp) in _requests.items() if exp < now]:
        del _requests[rid]
    for code in [c for c, a in _codes.items() if a.expires_at < now]:
        del _codes[code]


def client_name(client: OAuthClientInformationFull) -> str:
    """A short, printable name for the consent page and the key list (the client chose it: never trust it as text
    of our own; the console shows it as plain text)."""
    name = "".join(ch for ch in (client.client_name or "") if ch.isprintable()).strip()
    return (name or "An agent")[:config.KEY_NAME_MAX - len(SIGNED_IN)]


def pending(request_id: str) -> dict | None:
    """What the consent page shows for a waiting sign-in, or None when it is unknown or too old."""
    _drop_old()
    entry = _requests.get(request_id)
    if not entry:
        return None
    client, params, _ = entry
    return {"client_name": client_name(client), "redirect_host": urlparse(str(params.redirect_uri)).netloc}


def decide(request_id: str, user_id: str, approve: bool) -> str | None:
    """The signed-in user approved or denied. Returns the client's redirect address (with the code, or with
    error=access_denied), or None when the request is unknown or too old. One use."""
    _drop_old()
    entry = _requests.pop(request_id, None)
    if not entry:
        return None
    client, params, _ = entry
    if not approve:
        return construct_redirect_uri(str(params.redirect_uri), error="access_denied", state=params.state)
    code = secrets.token_urlsafe(32)
    _codes[code] = AuthorizationCode(
        code=code, scopes=params.scopes or [SCOPE], expires_at=time.time() + config.OAUTH_CODE_SECONDS,
        client_id=client.client_id or "", code_challenge=params.code_challenge, redirect_uri=params.redirect_uri,
        redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly, resource=params.resource,
        subject=user_id)
    return construct_redirect_uri(str(params.redirect_uri), code=code, state=params.state)


class Provider:
    """The storage half of the SDK's OAuthAuthorizationServerProvider."""

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        info = store.oauth_client(client_id)
        return OAuthClientInformationFull.model_validate_json(info) if info else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        store.save_oauth_client(client_info.client_id or "", client_info.model_dump_json(exclude_none=True))

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        """The address the user's browser is sent to: the console's consent page."""
        _drop_old()
        if len(_requests) >= config.OAUTH_MAX_PENDING:  # a flood of unfinished sign-ins: the oldest goes
            del _requests[next(iter(_requests))]
        rid = secrets.token_urlsafe(24)
        _requests[rid] = (client, params, time.time() + config.OAUTH_REQUEST_SECONDS)
        return f"{config.public_base_url()}/connect?request={rid}"

    async def load_authorization_code(self, client: OAuthClientInformationFull, authorization_code: str) -> AuthorizationCode | None:
        code = _codes.get(authorization_code)
        return code if code and code.client_id == client.client_id else None

    async def exchange_authorization_code(self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode) -> OAuthToken:
        """The token is a new agent key of the user who approved. It does not expire; the user ends it in the
        console (or the client revokes it), so there is no refresh token."""
        if _codes.pop(authorization_code.code, None) is None:
            raise TokenError("invalid_grant", "this code was already used")
        user = store.get_user(authorization_code.subject or "")
        if not user or user["disabled"]:
            raise TokenError("invalid_grant", "the account is not available")
        mine = store.keys(user["id"])
        # The same registered client signing in again replaces its own key. Another client with the same name
        # (the same agent on a second computer) is a different client and keeps its key.
        for old in [k for k in mine if client.client_id and k["client_id"] == client.client_id]:
            store.delete_key(user["id"], old["id"])
            mine.remove(old)
        if len(mine) >= config.MAX_KEYS:
            raise TokenError("invalid_grant", f"this account already has {config.MAX_KEYS} keys; delete one in the console")
        _row, key = auth.create_key(user["id"], client_name(client) + SIGNED_IN, client_id=client.client_id)
        return OAuthToken(access_token=key, scope=" ".join(authorization_code.scopes))

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str) -> RefreshToken | None:
        return None

    async def exchange_refresh_token(self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]) -> OAuthToken:
        raise TokenError("invalid_grant", "refresh tokens are not used; sign in again")

    async def load_access_token(self, token: str) -> AccessToken | None:
        row = store.key_by_hash(auth.digest(auth.clean_key(token)))
        return AccessToken(token=token, client_id="", scopes=[SCOPE], subject=row["user_id"]) if row else None

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        row = store.key_by_hash(auth.digest(auth.clean_key(token.token)))
        if row:
            store.delete_key(row["user_id"], row["id"])


def resource_metadata_url() -> str:
    """Where a client that got 401 from /mcp reads which server signs it in (RFC 9728)."""
    return f"{config.PUBLIC_ORIGIN}/.well-known/oauth-protected-resource{config.BASE_PATH}/mcp"
