"""Agent sign-in in the browser: register, authorize, consent in the console, token, use, revoke."""

import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from callenvoy import config, main, oauth, store

from .conftest import owner_cookie, uid

BASE = "/callenvoy"
ORIGIN = {"Origin": config.PUBLIC_ORIGIN}
REDIRECT = "http://127.0.0.1:53211/callback"


@pytest.fixture
def client():
    oauth._requests.clear()
    oauth._codes.clear()
    return TestClient(main.app, base_url="http://localhost:3020", follow_redirects=False)


def start(client, name="Claude Code") -> tuple[dict, str, str]:
    """Registers a client and opens /authorize. Returns (client info, the console request id, the PKCE verifier)."""
    reg = client.post(f"{BASE}/register", json={"client_name": name, "redirect_uris": [REDIRECT],
                                                "token_endpoint_auth_method": "none"})
    assert reg.status_code == 201, reg.text
    info = reg.json()
    return (info, *authorize(client, info))


def authorize(client, info) -> tuple[str, str]:
    """Opens /authorize for a registered client. Returns (the console request id, the PKCE verifier)."""
    verifier = "v" * 64
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    r = client.get(f"{BASE}/authorize", params={
        "client_id": info["client_id"], "response_type": "code", "redirect_uri": REDIRECT, "state": "s1",
        "code_challenge": challenge, "code_challenge_method": "S256"})
    assert r.status_code == 302 and "/connect?request=" in r.headers["location"]
    return parse_qs(urlparse(r.headers["location"]).query)["request"][0], verifier


def finish(client, info, rid, verifier, me) -> str:
    """The user approves and the client fetches its token. Returns the key."""
    to = client.post(f"{BASE}/api/oauth/request/{rid}", json={"approve": True}, headers=me).json()["redirect_to"]
    return client.post(f"{BASE}/token", data={
        "grant_type": "authorization_code", "code": parse_qs(urlparse(to).query)["code"][0], "redirect_uri": REDIRECT,
        "client_id": info["client_id"], "code_verifier": verifier}).json()["access_token"]


def test_an_agent_without_a_key_is_told_where_to_sign_in(client):
    r = client.post(f"{BASE}/mcp", json={})
    assert r.status_code == 401 and "resource_metadata=" in r.headers["www-authenticate"]
    assert "www-authenticate" not in client.get(f"{BASE}/api/profile").headers  # the console API is not OAuth
    meta = client.get(f"{BASE}/.well-known/oauth-protected-resource").json()
    assert meta["resource"].endswith("/mcp") and meta["authorization_servers"]
    server = client.get(f"{BASE}/.well-known/oauth-authorization-server").json()
    assert server["registration_endpoint"].endswith("/register") and "S256" in server["code_challenge_methods_supported"]


def test_sign_in_gives_the_agent_a_key_of_the_user_who_approved(client):
    info, rid, verifier = start(client)
    me = {**owner_cookie(), **ORIGIN}
    assert client.get(f"{BASE}/api/oauth/request/{rid}").status_code == 401  # the consent page needs a session
    assert client.get(f"{BASE}/api/oauth/request/{rid}", headers=me).json() == {
        "client_name": "Claude Code", "redirect_host": "127.0.0.1:53211"}
    to = client.post(f"{BASE}/api/oauth/request/{rid}", json={"approve": True}, headers=me).json()["redirect_to"]
    q = parse_qs(urlparse(to).query)
    assert to.startswith(REDIRECT) and q["state"] == ["s1"]
    assert client.post(f"{BASE}/api/oauth/request/{rid}", json={"approve": True}, headers=me).status_code == 404  # one use
    form = {"grant_type": "authorization_code", "code": q["code"][0], "redirect_uri": REDIRECT,
            "client_id": info["client_id"], "code_verifier": "wrong" * 13}
    assert client.post(f"{BASE}/token", data=form).status_code == 400  # PKCE: the verifier must match
    token = client.post(f"{BASE}/token", data={**form, "code_verifier": verifier}).json()
    key = token["access_token"]
    assert key.startswith(config.KEY_PREFIX) and "refresh_token" not in token and "expires_in" not in token
    assert client.post(f"{BASE}/token", data={**form, "code_verifier": verifier}).status_code == 400  # one use
    # the token is an agent key of that user, visible in their key list
    assert client.get(f"{BASE}/api/profile", headers={"Authorization": f"Bearer {key}"}).json()["name"] == "Alex"
    assert "Claude Code (signed in)" in [k["name"] for k in store.keys(uid())]
    # the same agent on a second computer registers as another client: its sign-in leaves the first key alone
    info2, rid2, verifier2 = start(client)
    key2 = finish(client, info2, rid2, verifier2, me)
    assert [k["name"] for k in store.keys(uid())].count("Claude Code (signed in)") == 2
    assert client.get(f"{BASE}/api/profile", headers={"Authorization": f"Bearer {key}"}).status_code == 200
    # the same registered client signing in again replaces its own key instead of piling keys up
    rid3, verifier3 = authorize(client, info2)
    key3 = finish(client, info2, rid3, verifier3, me)
    assert [k["name"] for k in store.keys(uid())].count("Claude Code (signed in)") == 2
    assert client.get(f"{BASE}/api/profile", headers={"Authorization": f"Bearer {key2}"}).status_code == 401
    assert client.get(f"{BASE}/api/profile", headers={"Authorization": f"Bearer {key3}"}).status_code == 200


def test_deny_gives_nothing(client):
    _info, rid, _ = start(client, name="Evil\x00\x1b[31m agent " + "x" * 100)
    me = {**owner_cookie(), **ORIGIN}
    shown = client.get(f"{BASE}/api/oauth/request/{rid}", headers=me).json()["client_name"]
    assert shown.isprintable() and len(shown) <= config.KEY_NAME_MAX
    before = len(store.keys(uid()))
    to = client.post(f"{BASE}/api/oauth/request/{rid}", json={"approve": False}, headers=me).json()["redirect_to"]
    assert "error=access_denied" in to and "code=" not in to and len(store.keys(uid())) == before
    assert client.get(f"{BASE}/api/oauth/request/nope", headers=me).status_code == 404
