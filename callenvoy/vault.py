"""Protected details: secrets such as a Social Security number that a call may have to say or key in.

The rule that shapes everything here: the AI model never sees a secret. The model only knows the labels
("SSN"). When the other side asks for one, the model calls the give_secret tool, and the server says the
value (its own text-to-speech request, straight into the call's audio) or keys it in (Twilio). The value is
not put into the model's context, the transcript, the log or anything an agent can read; a read-back by the
other side is masked before the model or the transcript gets it; the recording pauses while it is said.

Two sources: the vault (saved once, encrypted with CALLENVOY_SECRET_KEY, usable on a call only after the user
allowed that label for that call), and a live answer (typed in the console during the call, kept in memory for
that call only, never stored).
"""

import re

import httpx

from . import config, keys, store

LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._/#-]{0,39}")
_WORDS = {"zero": "0", "oh": "0", "o": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
          "seven": "7", "eight": "8", "nine": "9"}


class VaultError(Exception):
    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


def clean_label(label) -> str:
    label = " ".join(str(label or "").split())
    if not LABEL.fullmatch(label):
        raise VaultError("a label is 1 to 40 letters, digits and spaces, like \"SSN\" or \"Account PIN\"", "label")
    return label


def acceptable(value: str) -> bool:
    """Long enough to be told from ordinary words when it is read back, and not absurdly long."""
    return len(re.sub(r"[^0-9A-Za-z]", "", value)) >= config.SECRET_MIN and len(value) <= config.SECRET_MAX


def find(user_id: str, label: str) -> dict | None:
    """The saved secret with this label (labels match without regard to case)."""
    want = " ".join(str(label or "").split()).lower()
    return next((r for r in store.saved_secrets(user_id) if r["label"].lower() == want), None)


def labels(user_id: str) -> list[str]:
    return [r["label"] for r in store.saved_secrets(user_id)]


def view(user_id: str) -> list[dict]:
    return [{"label": r["label"], "hint": r["hint"], "created_at": r["created_at"]} for r in store.saved_secrets(user_id)]


def save(user_id: str, label, value) -> None:
    label = clean_label(label)
    value = str(value or "").strip()
    if not acceptable(value):
        raise VaultError(f"a value has {config.SECRET_MIN} to {config.SECRET_MAX} letters or digits", "value")
    if not keys.can_save():
        raise VaultError("saving is off on this server (CALLENVOY_SECRET_KEY is not set)")
    old = find(user_id, label)
    if not old and len(store.saved_secrets(user_id)) >= config.MAX_SECRETS:
        raise VaultError(f"at most {config.MAX_SECRETS} protected details; remove one first")
    hint = "ends in " + value[-2:] if len(value) >= 6 else "saved"
    store.save_secret(user_id, old["label"] if old else label, keys._box().encrypt(value.encode()).decode(), hint)


def value(user_id: str, label: str) -> str | None:
    row = find(user_id, label)
    if not row or not keys.can_save():
        return None
    try:
        return keys._box().decrypt(row["secret"].encode()).decode()
    except Exception:  # noqa: BLE001 - the secret key changed: the value cannot be read any more
        return None


# --- saying, keying, masking ---

def digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def spoken(value: str) -> str:
    """The text a voice reads so that it can be written down: each character on its own, groups kept apart
    ("123-45-6789" -> "1 2 3, 4 5, 6 7 8 9"). Words of letters only are left as words."""
    groups = [g for g in re.split(r"[\s\-./]+", value.strip()) if g]
    return ", ".join(g if g.isalpha() and len(g) > 3 else " ".join(g) for g in groups) + "."


def mask(text: str, secrets: dict[str, str]) -> str:
    """Replaces a secret that appears in `text` with "[label]", however it is grouped or spelled out:
    "123 45 6789", "one two three, four five...", "A B 1 2", "tulip garden 9". What counts is the same run of
    letters and digits, starting and ending at word borders."""
    for label, secret in secrets.items():
        want = re.sub(r"[^0-9a-z]", "", secret.lower())
        if want:
            text = _mask_run(text, want, f"[{label}]")
    return text


def _mask_run(text: str, want: str, token: str) -> str:
    """Finds `want` as a run of whole words (letters, digits, or a number word standing for its digit when
    the secret has that digit there) with only spaces and punctuation between them."""
    parts = re.findall(r"\d+|[A-Za-z]+|[^\dA-Za-z]+", text)
    out, i = [], 0
    while i < len(parts):
        end = _run_end(parts, i, want) if parts[i][0].isalnum() else None
        if end is None:
            out.append(parts[i])
            i += 1
        else:
            out.append(token)
            i = end
    return "".join(out)


def _run_end(parts: list[str], i: int, want: str) -> int | None:
    """The index after the last part of a run that starts at part `i` and spells `want`, or None."""
    got, j = "", i
    while j < len(parts) and len(got) < len(want):
        p = parts[j]
        if p[0].isalnum():
            word, rest = p.lower(), want[len(got):]
            if rest.startswith(word):
                got += word
            elif word in _WORDS and rest.startswith(_WORDS[word]):  # "seven" where the secret has 7
                got += _WORDS[word]
            else:
                return None
        j += 1
    return j if got == want else None


async def speech(creds, voice_name: str | None, text: str) -> tuple[bytes, int]:
    """16-bit mono audio of `text` in the call's voice, and its sample rate. A plain request to the voice
    provider: it does not pass through the bot's pipeline, so nothing of it reaches the AI model."""
    async with httpx.AsyncClient(timeout=30) as c:
        if creds.fish:
            r = await c.post("https://api.fish.audio/v1/tts",
                             headers={"Authorization": f"Bearer {creds.fish}", "model": config.TTS_MODEL},
                             json={"text": text, "reference_id": config.voice(voice_name, "fish")["reference_id"],
                                   "format": "pcm", "sample_rate": config.SECRET_FISH_RATE})
            rate = config.SECRET_FISH_RATE
        else:
            r = await c.post("https://api.openai.com/v1/audio/speech", headers={"Authorization": f"Bearer {creds.openai}"},
                             json={"model": config.OPENAI_TTS_MODEL, "voice": config.voice(voice_name, "openai")["reference_id"],
                                   "input": text, "instructions": "Read slowly and clearly, one character at a time.",
                                   "response_format": "pcm"})
            rate = config.OPENAI_TTS_RATE
    r.raise_for_status()
    return r.content, rate
