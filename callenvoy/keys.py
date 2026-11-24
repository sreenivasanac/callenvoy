"""Provider keys: whose Twilio / OpenAI / Deepgram / Fish account a call runs on.

The server has its own keys in .env. They serve the admin, and everyone's calls to the demo line. Any other
call needs the user's own keys (Twilio + OpenAI; Deepgram and Fish are optional extras), saved here encrypted
with CALLENVOY_SECRET_KEY (Fernet). A saved key is never sent back to anyone: the console gets a short hint.

Make the secret once with: uv run python -m callenvoy.keys --make-key
"""

import json
import logging
import re
import sys
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from cryptography.fernet import Fernet, InvalidToken

from . import auth, config, guard, store

log = logging.getLogger("callenvoy.keys")
TIMEOUT = 15


class KeyError_(Exception):
    """A key that was not saved, with a plain reason and the form field it belongs to."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


@dataclass(frozen=True)
class Creds:
    """The accounts one call runs on. `own`: the user's keys (False: the server's)."""

    twilio_sid: str
    twilio_token: str
    from_number: str
    openai: str
    deepgram: str = ""  # empty: OpenAI transcribes
    fish: str = ""  # empty: OpenAI speaks
    llm: tuple[str, str, str] | None = None  # (base address, key, model) of another AI service, when saved
    own: bool = False

    @property
    def hearing(self) -> str:
        return "deepgram" if self.deepgram else "openai"

    @property
    def voice_provider(self) -> str:
        return "fish" if self.fish else "openai"


def server() -> Creds:
    e = config.env
    # Optional: another AI service for the admin's calls (a local model on a self-hosted server, for example).
    other = (e("LLM_BASE_URL").rstrip("/"), e("LLM_API_KEY"), e("LLM_MODEL"))
    return Creds(e("TWILIO_ACCOUNT_SID"), e("TWILIO_AUTH_TOKEN"), e("TWILIO_FROM_NUMBER"), e("OPENAI_API_KEY"),
                 e("DEEPGRAM_API_KEY"), e("FISH_API_KEY"), llm=other if all(other) else None)


# --- storage (encrypted JSON per user and provider) ---

def can_save() -> bool:
    return bool(config.env("CALLENVOY_SECRET_KEY"))


def _box() -> Fernet:
    return Fernet(config.env("CALLENVOY_SECRET_KEY").encode())


def _saved(user_id: str) -> dict[str, dict]:
    """provider -> its fields, decrypted. A row that cannot be read (the secret changed) counts as not saved."""
    out = {}
    if not can_save():
        return out
    for row in store.provider_keys(user_id):
        try:
            out[row["provider"]] = json.loads(_box().decrypt(row["secret"].encode()))
        except (InvalidToken, ValueError):
            log.warning("a saved %s key of a user cannot be decrypted (was CALLENVOY_SECRET_KEY changed?)", row["provider"])
    return out


def own(user_id: str) -> Creds | None:
    """The user's own accounts, once both required providers are saved."""
    k = _saved(user_id)
    if not all(p in k for p in config.REQUIRED_PROVIDERS):
        return None
    t = k["twilio"]
    other = k.get("llm")
    return Creds(t["account_sid"], t["auth_token"], t["from_number"], k["openai"]["api_key"],
                 k.get("deepgram", {}).get("api_key", ""), k.get("fish", {}).get("api_key", ""),
                 llm=(other["base_url"], other["api_key"], other["model"]) if other else None, own=True)


def for_user(user: dict | None) -> Creds | None:
    """What this user's calls to real numbers run on: their own keys, the server's for the admin, else nothing."""
    if not user:
        return None
    return own(user["id"]) or (server() if auth.is_admin(user) else None)


def for_call(row: dict) -> Creds:
    """The accounts a stored call was placed on (webhook checks, hang-ups, the bot, its recording)."""
    return (own(row["user_id"]) if row.get("own_keys") else None) or server()


def may_ring(row: dict) -> bool:
    """Ringing a phone number the user typed is not done on the server's keys for anyone but the admin."""
    return bool(row.get("own_keys")) or auth.is_admin(store.get_user(row["user_id"]))


def hint(secret: str) -> str:
    """A recognisable, harmless part of a secret: "AC…a3a8"."""
    return f"{secret[:2]}…{secret[-4:]}" if len(secret) >= 12 else "saved"


def view(user: dict) -> dict:
    """For the console: what is saved (hints only) and what this user's calls will use."""
    rows = {r["provider"]: r for r in store.provider_keys(user["id"])}
    readable = _saved(user["id"])
    providers = {}
    for name in config.PROVIDERS:
        r = rows.get(name) if name in readable else None
        providers[name] = {"saved": bool(r), "hint": r["hint"] if r else None, "checked_at": r["checked_at"] if r else None}
        if name == "twilio":
            providers[name] |= {"from_number": readable[name]["from_number"] if r else None,
                                "note": readable[name].get("note") if r else None}
        if name == "llm":
            providers[name] |= {"base_url": readable[name]["base_url"] if r else None,
                                "model": readable[name]["model"] if r else None}
    creds = for_user(user)
    return {"can_save": can_save(), "ready": creds is not None, "server_keys": bool(creds and not creds.own),
            "llm_services": config.LLM_SERVICES, "llm_any_host": llm_any_host(),
            "hearing": (creds or server()).hearing, "voice_provider": (creds or server()).voice_provider,
            "inbound_url": f"{config.public_base_url()}/twilio/inbound/{user['id']}", "providers": providers}


# --- checks with the provider, then save ---

async def _get(url: str, **kw) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            return await c.get(url, **kw)
    except httpx.HTTPError as e:
        raise KeyError_("could not reach the provider to check the key; try again in a moment") from e


def _text(body: dict, name: str, pattern: str, what: str) -> str:
    value = body.get(name)
    value = value.strip() if isinstance(value, str) else ""
    if not re.fullmatch(pattern, value):
        raise KeyError_(what, name)
    return value


async def check_twilio(body: dict) -> dict:
    sid = _text(body, "account_sid", r"AC[0-9a-fA-F]{32}", "the Account SID starts with AC and has 34 characters")
    token = _text(body, "auth_token", r"[0-9a-zA-Z]{20,64}", "paste the Auth Token of that account (not an API key)")
    try:
        number = guard.check_number(str(body.get("from_number") or ""))
    except ValueError as e:
        raise KeyError_(f"{e}", "from_number") from e
    api = f"https://api.twilio.com/2010-04-01/Accounts/{sid}"
    r = await _get(f"{api}.json", auth=(sid, token))
    if r.status_code in (401, 403, 404):
        raise KeyError_("Twilio does not accept this Account SID and Auth Token", "auth_token")
    if r.status_code >= 400 or r.json().get("status") != "active":
        raise KeyError_("Twilio says this account is not active", "account_sid")
    trial = r.json().get("type") == "Trial"
    r = await _get(f"{api}/IncomingPhoneNumbers.json", params={"PhoneNumber": number}, auth=(sid, token))
    if r.status_code >= 400 or not r.json().get("incoming_phone_numbers"):
        raise KeyError_(f"{number} is not a phone number of this Twilio account; buy one in the Twilio console "
                        "(Phone Numbers), then enter it here", "from_number")
    note = ("This is a Twilio trial account: Twilio plays a trial message first and calls only numbers you "
            "verified. Upgrade the account for real calls.") if trial else None
    return {"account_sid": sid, "auth_token": token, "from_number": number, "note": note}


async def _check_api_key(body: dict, provider: str, url: str, header: str, scheme: str) -> dict:
    key = _text(body, "api_key", r"[\x21-\x7e]{16,300}", "paste the API key")
    r = await _get(url, headers={header: f"{scheme} {key}", "User-Agent": config.APP_NAME})
    if r.status_code in (401, 403):
        raise KeyError_(f"{provider} does not accept this key", "api_key")
    if r.status_code >= 400:
        raise KeyError_(f"{provider} answered {r.status_code} while checking the key; try again in a moment", "api_key")
    return {"api_key": key}


def llm_any_host() -> bool:
    return config.env("LLM_ANY_HOST") == "1"


async def check_llm(body: dict) -> dict:
    """Another AI service for the talking: an OpenAI-compatible address, a key and a model name. One tiny request
    with a tool proves all three, and that the model can call tools (a call cannot press keys without them)."""
    base = _text(body, "base_url", r"https?://[\x21-\x7e]{4,200}", "enter the service's address, starting with https://").rstrip("/")
    known = {urlparse(u).netloc for u in config.LLM_SERVICES.values()}
    if not llm_any_host() and (not base.startswith("https://") or urlparse(base).netloc not in known):
        raise KeyError_("this server only allows these services: " + ", ".join(config.LLM_SERVICES) +
                        ". On your own server, LLM_ANY_HOST=1 allows any address", "base_url")
    key = _text(body, "api_key", r"[\x21-\x7e]{8,300}", "paste the API key")
    model = _text(body, "model", r"[\x21-\x7e]{1,120}", "enter the model's name as the service lists it")
    probe = {"model": model, "messages": [{"role": "user", "content": "Call the tool ok."}],
             "tools": [{"type": "function", "function": {"name": "ok", "description": "Confirms the connection.",
                                                         "parameters": {"type": "object", "properties": {}}}}]}
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as c:
            r = await c.post(f"{base}/chat/completions", json=probe, headers={"Authorization": f"Bearer {key}"})
    except httpx.HTTPError as e:
        raise KeyError_("could not reach the service to check the key; try again in a moment", "base_url") from e
    if r.status_code in (401, 403):
        raise KeyError_("the service does not accept this key", "api_key")
    if r.status_code >= 400:
        try:
            said = str((r.json().get("error") or {}).get("message") or "")[:200]
        except (ValueError, AttributeError):
            said = ""
        raise KeyError_(f"the service refused the test request ({r.status_code}). {said}".strip(), "model")
    return {"base_url": base, "api_key": key, "model": model}


CHECKS = {
    "llm": check_llm,
    "twilio": check_twilio,
    # One model lookup: proves the key works and that the account can use the model the calls need.
    "openai": lambda b: _check_api_key(b, "OpenAI", f"https://api.openai.com/v1/models/{config.LLM_MODEL}", "Authorization", "Bearer"),
    "deepgram": lambda b: _check_api_key(b, "Deepgram", "https://api.deepgram.com/v1/projects", "Authorization", "Token"),
    "fish": lambda b: _check_api_key(b, "Fish Audio", "https://api.fish.audio/wallet/self/api-credit", "Authorization", "Bearer"),
}


async def save(user_id: str, provider: str, body: dict) -> None:
    """Checks the key with its provider, then stores it encrypted. Raises KeyError_ with the reason."""
    if provider not in CHECKS:
        raise KeyError_(f"unknown provider; one of: {', '.join(CHECKS)}")
    if not can_save():
        raise KeyError_("key saving is off on this server (CALLENVOY_SECRET_KEY is not set)")
    if not isinstance(body, dict):
        raise KeyError_("send a JSON object with the key fields")
    fields = await CHECKS[provider](body)
    secret = fields.get("auth_token") or fields["api_key"]  # (Twilio's hint is its account SID, below)
    shown = hint(fields["account_sid"]) if provider == "twilio" else hint(secret)
    store.save_provider_key(user_id, provider, _box().encrypt(json.dumps(fields).encode()).decode(), shown)


if __name__ == "__main__":
    if "--make-key" in sys.argv:
        print(f"CALLENVOY_SECRET_KEY={Fernet.generate_key().decode()}")
    else:
        print("usage: uv run python -m callenvoy.keys --make-key")
