"""Makes one short mp3 per voice in config.VOICES under callenvoy/static/voices/ (costs a few cents of Fish and
OpenAI credit; needs FISH_API_KEY and OPENAI_API_KEY).

Run once: uv run python -m callenvoy.make_voice_samples [--force]
Fish samples use Fish's default mp3 rate: Fish refuses 8 kHz for mp3 (it accepts 32000 and 44100 only).
"""

import sys

import httpx

from . import config

FISH_TTS_URL = "https://api.fish.audio/v1/tts"
OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"


def request(voice: dict) -> tuple[str, dict, dict]:
    """(url, headers, body) of the text-to-speech request for one voice."""
    if voice["provider"] == "fish":
        return (FISH_TTS_URL, {"Authorization": f"Bearer {config.env('FISH_API_KEY')}", "model": config.TTS_MODEL},
                {"text": config.VOICE_SAMPLE_TEXT, "reference_id": voice["reference_id"], "format": "mp3"})
    return (OPENAI_TTS_URL, {"Authorization": f"Bearer {config.env('OPENAI_API_KEY')}"},
            {"model": config.OPENAI_TTS_MODEL, "voice": voice["reference_id"], "input": config.VOICE_SAMPLE_TEXT,
             "instructions": config.OPENAI_TTS_STYLE, "response_format": "mp3"})


def main() -> None:
    missing = [n for n in ("FISH_API_KEY", "OPENAI_API_KEY") if not config.env(n)]
    if missing:
        raise SystemExit(f"not set: {', '.join(missing)}")
    config.VOICES_DIR.mkdir(parents=True, exist_ok=True)
    force = "--force" in sys.argv
    with httpx.Client(timeout=60) as c:
        for v in config.VOICES:
            out = config.VOICES_DIR / f"{v['name'].lower()}.mp3"
            if out.exists() and not force:
                print(f"skip {out.name} (exists)")
                continue
            url, headers, body = request(v)
            r = c.post(url, headers=headers, json=body)
            if r.status_code >= 400:
                print(f"FAILED {v['name']}: HTTP {r.status_code} {r.text[:200]}")
                continue
            out.write_bytes(r.content)
            print(f"wrote {out.name} ({len(r.content)} bytes)")


if __name__ == "__main__":
    main()
