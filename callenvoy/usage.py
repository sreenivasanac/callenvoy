"""What a call used and what that costs, as an estimate for the user.

CallEnvoy bills nothing: the providers bill the account whose keys the call ran on. So that a user sees what
a call cost them, each bot counts its LLM tokens and spoken characters (Pipecat's usage metrics), the totals
are kept on the call, and `cost` prices them with the list prices in config.PRICES.
"""

import audioop
import json
import math
import time

from pipecat.frames.frames import Frame, InputAudioRawFrame, MetricsFrame
from pipecat.metrics.metrics import LLMUsageMetricsData, TTSUsageMetricsData
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from . import config

COUNTERS = ("llm_in", "llm_cached", "llm_out", "tts_chars")


class Meter(FrameProcessor):
    """Sits after the LLM and the voice in the pipeline and adds up what they report."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.used = dict.fromkeys(COUNTERS, 0)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, MetricsFrame):
            for d in frame.data:
                if isinstance(d, LLMUsageMetricsData):  # OpenAI-style counts: the input figure includes the cached part
                    self.used["llm_in"] += d.value.prompt_tokens or 0
                    self.used["llm_cached"] += d.value.cache_read_input_tokens or 0
                    self.used["llm_out"] += d.value.completion_tokens or 0
                elif isinstance(d, TTSUsageMetricsData):
                    self.used["tts_chars"] += d.value or 0
        await self.push_frame(frame, direction)


class Ear(FrameProcessor):
    """Notes when the line last carried any sound (speech, music, tones), so a dead line can be told from a
    hold with music: speech-to-text alone hears nothing in either. `on_sound` gets the monotonic time."""

    def __init__(self, on_sound, **kwargs):
        super().__init__(**kwargs)
        self._on_sound = on_sound
        self._told = 0.0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InputAudioRawFrame) and frame.audio:
            now = time.monotonic()
            # At most once a second: this runs for every 20 ms of audio.
            if now - self._told >= 1 and audioop.rms(frame.audio, 2) >= config.SOUND_RMS:
                self._told = now
                self._on_sound(now)
        await self.push_frame(frame, direction)


def add(saved: str | None, more: dict) -> str:
    """The call's stored usage (JSON) plus one bot's counts. Text values (which model, which provider) are set."""
    total = json.loads(saved) if saved else {}
    for k, v in more.items():
        total[k] = total.get(k, 0) + v if isinstance(v, (int, float)) and not isinstance(v, bool) else v
    return json.dumps(total)


def cost(row: dict) -> dict | None:
    """The estimated cost of a call in US dollars, by part, from list prices. None before the call was answered.
    `ai` is None when the model's price is not known (a custom service): the total then leaves it out."""
    seconds = row.get("talk_seconds")
    if not seconds:
        return None
    p, used = config.PRICES, json.loads(row["usage"]) if row.get("usage") else {}
    minutes = math.ceil(seconds / 60)  # Twilio bills each started minute
    phone = minutes * (p["twilio_minute"] + p["twilio_stream_minute"] + (p["twilio_recording_minute"] if row.get("record") else 0))
    phone += math.ceil((row.get("owner_seconds") or 0) / 60) * p["twilio_minute"] if row.get("reach") != "app" else 0
    hearing = seconds / 60 * p["stt_minute"].get(used.get("stt", ""), 0)
    voice = used.get("tts_chars", 0) / 1000 * p["tts_1k_chars"].get(used.get("tts", ""), 0)
    rate = p["llm_1m"].get(used.get("llm", ""))
    ai = None
    if used.get("engine") == "live":  # billed by the minute of the session; the text model's tokens are small beside it
        ai = seconds / 60 * p["live_minute"]
    elif rate:
        fresh = max(0, used.get("llm_in", 0) - used.get("llm_cached", 0))
        ai = (fresh * rate[0] + used.get("llm_cached", 0) * rate[1] + used.get("llm_out", 0) * rate[2]) / 1_000_000
    parts = {"phone": round(phone, 4), "hearing": round(hearing, 4), "ai": None if ai is None else round(ai, 4),
             "voice": round(voice, 4)}
    return {"total": round(sum(v for v in parts.values() if v), 3), "parts": parts, "complete": ai is not None,
            "model": used.get("llm")}
