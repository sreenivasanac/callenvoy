"""Every tunable constant of CallEnvoy. User settings (SETTINGS) sit on top of these defaults."""

import os
from pathlib import Path
from urllib.parse import urlparse


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def public_base_url() -> str:
    """Where the service is reached from outside: PUBLIC_BASE_URL, e.g. https://callenvoy.pragnyalabs.com
    (or with a path, https://example.com/callenvoy, when it shares a host)."""
    return env("PUBLIC_BASE_URL", "http://localhost:3020").rstrip("/")


# --- Branding and paths ---
APP_NAME = "CallEnvoy"
# Both come from PUBLIC_BASE_URL, so a new address is one line in .env and no code change.
BASE_PATH = urlparse(public_base_url()).path.rstrip("/")  # "" at the root of a host
PUBLIC_ORIGIN = "{0.scheme}://{0.netloc}".format(urlparse(public_base_url()))  # allowed Origin of console writes
REPO_URL = "https://github.com/sreenivasanac/callenvoy"
TOOL_PREFIX = "callenvoy_"
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "callenvoy.db"
RECORDINGS_DIR = ROOT / "data" / "recordings"  # mp3 copies fetched once from Twilio (dir 700, files 600)
WEB_DIR = ROOT / "client" / "dist"
VOICES_DIR = Path(__file__).resolve().parent / "static" / "voices"
WEB_BUILD_COMMAND = "pnpm --dir client exec expo export --platform web"
DEV_ORIGIN = "http://localhost:8081"  # Expo web dev server, allowed only with CALLENVOY_DEV=1

# --- Providers ---
STT_MODEL = "nova-3-general"
# AI models a user can pick (setting ai_model). Each one was run on the demo line before it was listed here.
# `settings`: what the model needs in a chat-completions request with tools (the gpt-6 family refuses tools
# unless reasoning is off; gpt-4.1 is tuned at temperature 0 and shuts down on 2027-01-14).
LLM_MODELS = {
    "gpt-6-luna": {"settings": {"extra": {"reasoning_effort": "none"}}, "about": "fast and the cheapest"},
    "gpt-6.1-terra": {"settings": {"extra": {"reasoning_effort": "none"}}, "about": "stronger, about 10 times the price"},
    "gpt-4.1": {"settings": {"temperature": 0}, "about": "the earlier default; OpenAI ends it on January 14, 2027"},
}
LLM_MODEL = "gpt-6-luna"  # the default
CUSTOM_LLM = "custom"  # setting ai_model: the user's own OpenAI-compatible service (provider key "llm")
# OpenAI-compatible services a user may point a call's AI at (their chat-completions base address). The server
# sends every turn of a call to that address, so on a shared server only these known hosts are allowed: an
# address a user types could otherwise aim the server at its own network. A self-hosted server can allow any
# address, such as a local model, with LLM_ANY_HOST=1.
LLM_SERVICES = {
    "Google Gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "OpenRouter": "https://openrouter.ai/api/v1",
    "Groq": "https://api.groq.com/openai/v1",
    "Together": "https://api.together.xyz/v1",
    "Fireworks": "https://api.fireworks.ai/inference/v1",
    "Cerebras": "https://api.cerebras.ai/v1",
    "DeepSeek": "https://api.deepseek.com/v1",
    "Mistral": "https://api.mistral.ai/v1",
    "xAI": "https://api.x.ai/v1",
    "OpenAI": "https://api.openai.com/v1",
}
RECAP_MODEL = "gpt-6-luna"  # writes the outcome from the whole transcript after the call (always on the OpenAI key)
TTS_MODEL = "s2.1-pro"
# End of turn: Pipecat's default (LocalSmartTurnAnalyzerV3). TODO: SpeechTimeoutUserTurnStopStrategy if too slow on 2 vCPUs.
CALL_SAMPLE_RATE = 8000

# --- Voices (Fish Audio reference ids, searched 2026-11-10). Indian names are our labels. ---
VOICES = [
    {"provider": "fish", "name": "Hannah", "gender": "female", "accent": "US", "style": "professional, friendly, clear", "reference_id": "9a9cf47702da476aa4629e2506d4a857"},
    {"provider": "fish", "name": "Sarah", "gender": "female", "accent": "US", "style": "young, soft, conversational", "reference_id": "933563129e564b19a115bedd57b7406a"},
    {"provider": "fish", "name": "Laura", "gender": "female", "accent": "US", "style": "warm, calm, deeper", "reference_id": "e3cd384158934cc9a01029cd7d278634"},
    {"provider": "fish", "name": "Sophia", "gender": "female", "accent": "British", "style": "professional", "reference_id": "0efe38923c0b445ab09382e851ae1e30"},
    {"provider": "fish", "name": "Ethan", "gender": "male", "accent": "US", "style": "clear, calm, professional", "reference_id": "536d3a5e000945adb7038665781a4aca"},
    {"provider": "fish", "name": "Adrian", "gender": "male", "accent": "US", "style": "deep, slow, steady", "reference_id": "bf322df2096a46f18c579d0baa36f41d"},
    {"provider": "fish", "name": "Jordan", "gender": "male", "accent": "US", "style": "older, confident, measured", "reference_id": "79d0bd3e4e5444b18f7b6d89b5927bf1"},
    {"provider": "fish", "name": "Rohan", "gender": "male", "accent": "Indian English", "style": "professional, measured", "reference_id": "73770ea2927d46c19e461e7e812b2f95"},
    {"provider": "fish", "name": "Vikram", "gender": "male", "accent": "Indian English", "style": "calm, steady, middle-aged", "reference_id": "ca1c77bf09ee4497ac5cd97c5db1f6d5"},
    {"provider": "fish", "name": "Meera", "gender": "female", "accent": "Indian English", "style": "friendly, professional, middle-aged", "reference_id": "b1a1d760d9604bdb957a56eec3460f1b"},
]
# Fish Official spares if a listed voice sounds wrong on a phone line: Sheila f3a2b90078d54a65af4b95f63bc7798e,
# Kai 0db6e93af420470b9d9b9a886dbaa954, Cody f663fef9788d4ac0a6bfe36f1b3c871f.
# OpenAI voices: what a call uses when the account has no Fish key ("voice follows the saved keys").
OPENAI_VOICES = [
    {"provider": "openai", "name": "Marin", "gender": "female", "accent": "US", "style": "warm, natural", "reference_id": "marin"},
    {"provider": "openai", "name": "Coral", "gender": "female", "accent": "US", "style": "bright, friendly", "reference_id": "coral"},
    {"provider": "openai", "name": "Nova", "gender": "female", "accent": "US", "style": "clear, energetic", "reference_id": "nova"},
    {"provider": "openai", "name": "Cedar", "gender": "male", "accent": "US", "style": "calm, natural", "reference_id": "cedar"},
    {"provider": "openai", "name": "Ash", "gender": "male", "accent": "US", "style": "direct, confident", "reference_id": "ash"},
    {"provider": "openai", "name": "Onyx", "gender": "male", "accent": "US", "style": "deep, steady", "reference_id": "onyx"},
]
VOICES += OPENAI_VOICES
VOICE_NAMES = [v["name"] for v in VOICES]
DEFAULT_VOICE = "Hannah"
DEFAULT_VOICES = {"fish": "Hannah", "openai": "Marin"}  # per voice provider
OPENAI_TTS_MODEL = "gpt-4o-mini-tts"
OPENAI_VAD_STT_MODEL = "gpt-transcribe"  # OpenAI hearing where the pipeline has no VAD of its own (bot.hearing)
OPENAI_TTS_RATE = 24000  # what OpenAI sends; the transport resamples to the call's 8 kHz
OPENAI_TTS_STYLE = "A person on a quick, friendly phone call: natural pace, clear, not theatrical."
DEMO_REP_VOICE_ID = "1f97ab64476c4e468a0888ae22954dab"  # Fish Official "Hugo"
VOICE_SAMPLE_TEXT = "Hi, I'm calling on behalf of Alex about a billing question on the account. Do you have a moment?"
# TODO: own Indian English voices through Fish voice design (API support not verified).

# --- Safety limits (constants only; never changeable through settings or MCP) ---
API_KEY_MIN_LENGTH = 32
DEFAULT_CALL_MINUTES = 30
MAX_CALL_MINUTES = 120
MAX_CONCURRENT_CALLS = 4  # the whole server (CPU of one small machine), all users together
MAX_USER_CALLS = 2  # one user's calls at one time
DAILY_MINUTE_CAP = 240  # one user's call minutes per day
# Calls on the server's keys by anyone but the admin: only to the demo line, a few per account, short.
DEMO_CALLS_PER_USER = 3
DEMO_MAX_MINUTES = 6
DEMO_DAILY_MINUTE_CAP = 90  # all such calls of all users per day
# Provider keys a user can save (keys.py). The required ones make real calls possible.
PROVIDERS = ("twilio", "openai", "deepgram", "fish", "llm")  # llm: another AI service for the talking (optional)
REQUIRED_PROVIDERS = ("twilio", "openai")
HOLD_EXTENSION_MINUTES = 15
TALK_EXTENSION_MINUTES = 2
TALK_RECENT_SECONDS = 120  # "live talk" for the watchdog: either side spoke this recently
BLOCKED_AREA_CODES = {
    "900", "976",  # premium rate
    # NANP members outside the US and Canada (often billed at premium rates)
    "242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721", "758",
    "767", "784", "809", "829", "849", "868", "869", "876",
}

# --- Call behaviour ---
QUESTION_WAIT_SECONDS = 120
MAX_WAIT_SECONDS = 50  # long-poll ceiling for get_call
HANDOVER_RECENT_SECONDS = 10  # connect_owner needs a "them" line this recent
END_CALL_SPEECH_WAIT_SECONDS = 15  # how long end_call waits for the last sentence to finish
BOT_DONE_GRACE_SECONDS = 30
KEY_PRESS_REJOIN_SECONDS = 20  # after a key press the call must join its new stream in this time
DIAL_TIMEOUT_SECONDS = 90  # no answer and no final status from Twilio in this time: the call is closed as failed
CALLER_ID_CACHE_SECONDS = 60  # GET /api/caller-id caches Twilio's answer this long
# How a call's goal turned out. partial: some of it was done, or an answer came without the result asked for.
OUTCOMES = ("done", "partial", "not_done", "voicemail", "no_human")
RECORD_CALLS_DEFAULT = True
FINAL_STATUSES = ("completed", "no_answer", "busy", "failed", "canceled")
LIVE_STATUSES = ("queued", "dialing", "in_progress")
# TODO: make these settings if the owner wants (QUESTION_WAIT_SECONDS, OWNER_DROP_GRACE_SECONDS, audio sizes).

INBOUND_RING_SECONDS = 25  # forwarded callback rings the user this long
# A callback is named after the user's newest outbound call to that number in this window.
INBOUND_BUSINESS_DAYS = 14
# TODO: SMS alerts (needs Twilio A2P 10DLC registration).

# Protected details (vault.py)
MAX_SECRETS = 20  # per user
SECRET_MAX = 200  # characters of one value
SECRET_FISH_RATE = 16000  # sample rate asked of Fish for a spoken secret
SECRET_QUIET_SECONDS = 20  # the recording stays paused this long after a secret was said (a read-back may follow)

# Dead lines (the line's sound level is watched, so hold music is not taken for silence)
SOUND_RMS = 150  # 16-bit audio quieter than this counts as silence
SILENT_PICKUP_SECONDS = 6  # answered and nobody speaks: the AI says a short hello once
DEAD_AIR_SECONDS = 75  # answered and no sound at all since: hang up
SILENT_HOLD_MINUTES = 10  # on hold with no sound for this long: no more hold extensions
QUIET_NUDGE_SECONDS = 30  # mid-call, no sound and no words for this long: the AI is asked to act (see calls._quiet_watch)
QUIET_NUDGES_MAX = 3  # per call
WRAP_UP_SECONDS = 40  # at the time limit in a live talk the AI gets this long to say goodbye

# List prices in US dollars, read on 2026-11-24 (OpenAI, Twilio, Deepgram and Fish Audio pricing pages).
# Used only to show a user an estimate of what a call cost on their own accounts: CallEnvoy bills nothing.
PRICES = {
    "twilio_minute": 0.014, "twilio_stream_minute": 0.004, "twilio_recording_minute": 0.0025,
    "stt_minute": {"deepgram": 0.0077, "openai": 0.006},
    "tts_1k_chars": {"fish": 0.015, "openai": 0.016},
    # per 1M tokens: input, cached input, output
    "llm_1m": {"gpt-6-luna": (0.10, 0.01, 0.50), "gpt-6.1-terra": (1.00, 0.05, 5.00), "gpt-4.1": (2.00, 0.50, 8.00)},
}

# --- Owner audio ---
OWNER_DROP_GRACE_SECONDS = 5
AUDIO_TICKET_SECONDS = 30
AUDIO_FIRST_MESSAGE_SECONDS = 5
OWNER_AUDIO_UP_HZ = 16000
AUDIO_DOWN_BYTES = 640  # 40 ms at 8 kHz, 16-bit
AUDIO_MAX_MESSAGE_BYTES = 4096
AUDIO_MAX_RATE = 2.0  # mic audio faster than this times real time is dropped
OWNER_GATHER_SECONDS = 10  # "Press 1 to join" wait on the owner's phone
OWNER_PROMPT_SECONDS = 15  # margin for answering late and hearing the spoken prompt before the Gather wait
DEMO_TICKET_SECONDS = 120  # the demo line's stream token lives this long
DEMO_REP_MAX_SECONDS = 600  # hard limit for one demo rep call

# --- Agent keys and the owner's sign-in ---
KEY_PREFIX = "ce_live_"
KEY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"  # no look-alikes (0/o, 1/l/i)
KEY_BODY_LENGTH = 32
KEY_DISPLAY_LENGTH = 12  # the stored, shown prefix
KEY_NAME_MAX = 40
MAX_KEYS = 20
KEY_USE_WRITE_SECONDS = 60  # last_used_at is written at most this often per key
IMPORTED_KEY_NAME = "First key (.env)"
SESSION_COOKIE = "ce_session"
SESSION_DAYS = 30
SIGNIN_TOKEN_MINUTES = 15
# Sign-in link requests (POST /api/auth/request), in memory: (limit, window seconds) per address, per client IP,
# and for all requests together.
SIGNIN_LIMIT_PER_ADDRESS = (3, 3600)
SIGNIN_LIMIT_PER_IP = (10, 3600)
SIGNIN_LIMIT_GLOBAL = (60, 86400)
EMAIL_MAX = 254
# The admin's "New sign-ups" switch (stored in the database once changed). SIGNUPS_OPEN=0 starts a server
# closed: only the admin (OWNER_EMAIL) can sign in until the admin opens it on the People page.
SIGNUPS_OPEN_DEFAULT = env("SIGNUPS_OPEN", "1") != "0"
USER_SEEN_WRITE_SECONDS = 60  # users.last_seen_at is written at most this often
# Agent sign-in in the browser (oauth.py)
OAUTH_REQUEST_SECONDS = 600  # the user has this long to sign in and approve
OAUTH_CODE_SECONDS = 300  # the client has this long to fetch its token after the approval
OAUTH_MAX_PENDING = 500  # unfinished sign-ins kept in memory
OAUTH_MAX_CLIENTS = 2000  # registered clients kept in the database
SMTP_PORT = 587  # STARTTLS
SMTP_TIMEOUT_SECONDS = 20

# --- Web push ---
PUSH_TTL_SECONDS = 60
PUSH_HOSTS = ("fcm.googleapis.com", ".push.apple.com", "updates.push.services.mozilla.com", ".notify.windows.com")
MAX_PUSH_DEVICES = 10

# --- User settings (section 4a): one list, defaults here, saved values in the profile table ---
SETTINGS: dict[str, dict] = {
    "name": {"type": "text", "max": 80, "default": None},
    "timezone": {"type": "text", "max": 60, "default": None},  # IANA name, e.g. America/Los_Angeles (the console sets it)
    "callback_number": {"type": "phone", "default": None},
    "details": {"type": "text", "max": 3000, "default": None},
    "caller_id": {"type": "choice", "choices": ["callenvoy", "own"], "default": "callenvoy"},
    "leave_voicemail": {"type": "bool", "default": True},
    "voice": {"type": "choice", "choices": VOICE_NAMES, "default": DEFAULT_VOICE},
    "ai_model": {"type": "choice", "choices": [*LLM_MODELS, CUSTOM_LLM], "default": LLM_MODEL},
    "record_calls": {"type": "bool", "default": RECORD_CALLS_DEFAULT},
    "max_minutes": {"type": "int", "min": 1, "max": MAX_CALL_MINUTES, "default": DEFAULT_CALL_MINUTES},
    "mode": {"type": "choice", "choices": ["handle", "transfer"], "default": "handle"},
    "reach": {"type": "choice", "choices": ["app", "phone", "app_then_phone"], "default": "app_then_phone"},
    "alert_wait_seconds": {"type": "int", "min": 5, "max": 120, "default": 20},
    "phone_ring_seconds": {"type": "int", "min": 10, "max": 60, "default": 25},
    "no_answer": {"type": "choice", "choices": ["ai_handles", "end_politely"], "default": "ai_handles"},
    "alert_on_human": {"type": "bool", "default": True},
    "listen_in": {"type": "bool", "default": False},
    "alert_sound": {"type": "bool", "default": True},
    "alert_notification": {"type": "bool", "default": True},
    "alert_push": {"type": "bool", "default": True},
    "push_shows_business": {"type": "bool", "default": True},
}
# Calling profile fields (section 22.4): optional text the AI may share only when the call needs it.
PROFILE_FIELDS = {
    "name_pronunciation": 80, "assistant_name": 30, "email": 120, "address": 300, "date_of_birth": 40,
    "insurance_carrier": 80, "insurance_member_id": 60, "insurance_group_number": 60,
    "dental_insurance_carrier": 80, "dental_insurance_member_id": 60,
    "vehicle": 120, "vin": 40, "frequent_flyer_numbers": 300, "known_traveler_number": 40, "redress_number": 40,
}
SETTINGS.update({k: {"type": "text", "max": n, "default": None} for k, n in PROFILE_FIELDS.items()})
SETTING_DEFAULTS = {k: v["default"] for k, v in SETTINGS.items()}

# --- Demo line (private test line; Twilio <Say> voice) ---
DEMO_SAY_VOICE = "Polly.Joanna"
DEMO_MENU = "Thank you for calling Northstar Internet. This is a demo line. For billing, press 1. For technical support, press 2. For all other questions, press 0."
DEMO_MENU_RETRY = "Sorry, I didn't get that. For billing, press 1. For technical support, press 2."
DEMO_HOLD = [  # about 50 s of spoken hold messages with pauses between them
    "You have reached billing. Your call is important to us. All of our agents are currently helping other customers. The estimated wait time is less than one minute.",
    "Thank you for holding. This call may be recorded for quality and training purposes. Please continue to hold, and the next available agent will be with you shortly.",
    "Your call is important to us. Please stay on the line.",
]
DEMO_HOLD_PAUSE_SECONDS = 10
DEMO_REP_NAME = "Maria"
DEMO_REP_MODEL = "gpt-6.1-terra"  # the demo line's agent (the cheapest model hung up before the caller spoke)
DEMO_BUSINESS = "Northstar Internet"
# The demo line is a second Twilio number of the server's account whose voice webhook is <address>/api/demo-line.
# It answers only the server's own number (TWILIO_FROM_NUMBER), so calls to it always run on the server's keys.
# Optional: without DEMO_LINE_NUMBER there is no demo line, and a user needs their own keys for any call.
DEMO_LINE_NUMBER = env("DEMO_LINE_NUMBER").strip()
DEMO_CALL = {  # GET /api/config "demo": pre-fills a first call to the demo line (the console's welcome step)
    "number": DEMO_LINE_NUMBER, "business": DEMO_BUSINESS,
    "goal": "Ask billing to remove a wrong charge of 30 dollars on the October bill and get a reference number.",
    "facts": "Service address: 12 Oak Street, Springfield.", "menu_tips": "Billing is option 1.",
} if DEMO_LINE_NUMBER else None


# The server's own accounts: a phone line and OpenAI. DEEPGRAM_API_KEY and FISH_API_KEY are optional extras
# (hearing and voices), as they are for a user: without them OpenAI hears and speaks.
REQUIRED_ENV = ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "OPENAI_API_KEY")


def dev_mode() -> bool:
    return env("CALLENVOY_DEV") == "1"


def voices(provider: str) -> list[dict]:
    return [v for v in VOICES if v["provider"] == provider]


def voice(name: str | None, provider: str = "fish") -> dict:
    """The named voice when this voice provider has it, else that provider's default (a Fish voice was picked,
    but the call runs without a Fish key, or the other way round)."""
    mine = voices(provider)
    return next((v for v in mine if v["name"] == name), next(v for v in mine if v["name"] == DEFAULT_VOICES[provider]))
