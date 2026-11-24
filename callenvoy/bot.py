"""The Pipecat voice bot on one Twilio call: pipeline, the bot's tools, the owner gates and the audio tap.

Pipeline (plan section 7): transport.input -> Deepgram STT -> user aggregator -> LLMGate -> OpenAI LLM
-> Fish TTS -> OwnerGate -> transport.output -> AudioBufferProcessor (tap) -> assistant aggregator.
Written against pipecat-ai 1.15.0 (PipelineTask / PipelineRunner are deprecated aliases there; the
PipelineWorker / WorkerRunner names are used).

While the owner has the call the AI must not act: LLMGate drops context frames going down (new user turns),
OwnerGate drops context frames going up (function results from the assistant aggregator travel upstream),
the bot's key tones, its late speech and interruptions; the tools that act on the line refuse.
"""

import asyncio
import json
import logging
import math
import re
import struct
import time

from openai import AsyncOpenAI
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    FunctionCallResultProperties,
    InputAudioRawFrame,
    InterruptionFrame,
    LLMContextFrame,
    LLMMessagesAppendFrame,
    LLMRunFrame,
    OutputAudioRawFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.audio.audio_buffer_processor import AudioBufferProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.fish.tts import FishAudioTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.stt import OpenAIRealtimeSTTService
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
from pipecat.workers.runner import WorkerRunner

from . import calls, config, owner, prompt, store, twilio_api, usage

log = logging.getLogger("callenvoy.bot")
DIGITS = re.compile(r"^[0-9*#w]{1,20}$")
NO_LLM = FunctionCallResultProperties(run_llm=False)

# Key tones played into the call audio. Timing and level follow Call4me's voice/dtmf.ts (MIT): 120 ms tone,
# 80 ms gap, each of the two frequencies at a quarter of full scale (about -9 dBm0); "w" is half a second of
# silence. Pipecat's bundled tone files are much quieter, and the first real call showed the real problem:
# the menu was still talking, so an interruption cut the tone after 80 ms and the menu never heard the key.
DTMF_ROWS, DTMF_COLS, DTMF_KEYS = (697, 770, 852, 941), (1209, 1336, 1477), ("123", "456", "789", "*0#")
DTMF_TONE_MS, DTMF_GAP_MS, DTMF_WAIT_MS, DTMF_RATE = 120, 80, 500, 8000


def dtmf_pcm(digits: str) -> bytes:
    """16-bit mono PCM at 8 kHz for `digits` (0-9 * # and w)."""
    silence = lambda ms: [0] * (DTMF_RATE * ms // 1000)  # noqa: E731
    out: list[int] = []
    for key in digits:
        if key == "w":
            out += silence(DTMF_WAIT_MS)
            continue
        row = next(i for i, keys in enumerate(DTMF_KEYS) if key in keys)
        lo, hi = DTMF_ROWS[row], DTMF_COLS[DTMF_KEYS[row].index(key)]
        out += [int(8191 * (math.sin(2 * math.pi * lo * n / DTMF_RATE) + math.sin(2 * math.pi * hi * n / DTMF_RATE)))
                for n in range(DTMF_RATE * DTMF_TONE_MS // 1000)] + silence(DTMF_GAP_MS)
    return struct.pack(f"<{len(out)}h", *out)


class LLMGate(FrameProcessor):
    """Before the LLM: while closed, drops LLMContextFrame (in both directions), so the LLM does not run.
    The other side's words still reach the transcript and the context."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.closed = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if not (self.closed and isinstance(frame, LLMContextFrame)):
            await self.push_frame(frame, direction)


class OwnerGate(LLMGate):
    """Before transport.output. While closed it also drops the AI's late speech, its key tones and
    InterruptionFrame (the other side starting to talk must not cut the owner's audio), and the upstream
    LLMContextFrame of a function result. feed() and press() push the owner's audio and keys past the gate.
    While key tones play, InterruptionFrame is dropped too: a menu that keeps talking must not cut a tone."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.bot_speaking = False
        self.tones_until = 0.0  # time.monotonic() until which key tones are playing

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        if isinstance(frame, BotStartedSpeakingFrame):
            self.bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self.bot_speaking = False
        if (self.closed and isinstance(frame, (InterruptionFrame, TTSAudioRawFrame))) or (
                isinstance(frame, InterruptionFrame) and time.monotonic() < self.tones_until):
            await FrameProcessor.process_frame(self, frame, direction)
            return
        await super().process_frame(frame, direction)

    async def feed(self, pcm: bytes, sample_rate: int) -> None:
        await self.push_frame(OutputAudioRawFrame(audio=pcm, sample_rate=sample_rate, num_channels=1))

    async def press(self, digits: str) -> None:
        pcm = dtmf_pcm(digits)
        self.tones_until = time.monotonic() + len(pcm) / 2 / DTMF_RATE + 0.3  # 0.3 s for the output queue
        await self.feed(pcm, DTMF_RATE)

    async def cut(self) -> None:
        """Cuts the bot's current speech: one InterruptionFrame both ways (stops LLM/TTS, empties the output queue)."""
        await self.broadcast_frame(InterruptionFrame)


class LineSink(FrameProcessor):
    """End of the owner's speech-to-text pipeline: hands final transcriptions to a callback."""

    def __init__(self, on_text, **kwargs):
        super().__init__(**kwargs)
        self._on_text = on_text

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            await self._on_text(frame.text.strip())
        await self.push_frame(frame, direction)


def _tool(name: str, description: str, properties: dict | None = None, required: list | None = None) -> FunctionSchema:
    return FunctionSchema(name=name, description=description, properties=properties or {}, required=required or [])


TOOLS = {
    "press_digits": _tool(
        "press_digits", "Press keys on the phone keypad, right after a menu names them. 'w' waits half a second.",
        {"digits": {"type": "string", "description": 'keys to press, e.g. "1" or "104#"'}}, ["digits"]),
    "wait": _tool(
        "wait", "Stay silent: a phone menu is still talking, you are on hold, or the speech is not meant for you.",
        {"reason": {"type": "string", "enum": ["menu", "hold", "not_for_me"]}}, ["reason"]),
    "ask_user": _tool(
        "ask_user", "Ask the person you call for a question you need answered (a detail you lack, or an offer outside "
        "what you may accept). Returns their answer, or tells you none came in time.",
        {"question": {"type": "string", "description": "short, self-contained question"}}, ["question"]),
    "connect_owner": _tool(
        "connect_owner", "Bring the person you call for onto the line. Say your one line first. If the result says "
        "they cannot be reached, do not call this again."),
    "end_call": _tool(
        "end_call", "Hang up, after the goodbye or after a voicemail.",
        {"result": {"type": "string", "enum": list(config.OUTCOMES)},
         "summary": {"type": "string", "description": "one or two sentences: what happened"},
         "details": {"type": "object", "description": "facts to keep, e.g. {\"reference_number\": \"NS-1234\"}"}},
        ["result", "summary"]),
}
OWNER_HAS_CALL = "The person you call for has the call now. Do nothing and stay silent until you are told it is handed back."


class OpenAIHearing(OpenAIRealtimeSTTService):
    """OpenAI's streaming speech-to-text, with the first audio held back until the session is configured.

    A new session runs for about a second on OpenAI's defaults (its own speech detection, no transcription)
    before our settings arrive. Pipecat sends audio from the first moment, and the speech that began in that
    second was never transcribed: on a real call the start of the phone menu, and the first words after every
    key press (a key press opens a new stream and a new session). So audio and a commit that come before the
    session is ready wait here and are sent, in order, when it is.
    Written against pipecat-ai 1.15.0 (_session_ready, _send_audio, _commit_audio_buffer; tests/test_bot.py
    checks that they still exist)."""

    HOLD_BYTES = 16000 * 15  # at most 15 s of 8 kHz 16-bit audio is held; older audio goes first

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._held: list[bytes] = []
        self._commit_held = False

    async def _flush(self):
        """Sends what was held, then the commit that was held with it. Only once the session is ready."""
        held, self._held = self._held, []
        for chunk in held:
            await super()._send_audio(chunk)
        if held and self._commit_held:
            await super()._commit_audio_buffer()
        self._commit_held = False

    async def _send_audio(self, audio: bytes):
        if not self._session_ready:
            self._held.append(audio)
            while sum(map(len, self._held)) > self.HOLD_BYTES:
                self._held.pop(0)
            return
        await self._flush()
        await super()._send_audio(audio)

    async def _commit_audio_buffer(self):
        if not self._session_ready:  # the speech ended before the session was ready: commit after the flush
            self._commit_held = bool(self._held)
            return
        await self._flush()  # the session became ready between two audio frames: held speech goes out first
        await super()._commit_audio_buffer()


def hearing(creds, own_vad: bool = True):
    """Speech-to-text for one pipeline: Deepgram when the account has a key for it, else OpenAI (streaming).
    `own_vad` False: the pipeline has no voice-activity detector (the owner's side line), so OpenAI must find
    the ends of speech itself, which needs its turn-detecting model."""
    if creds.deepgram:
        return DeepgramSTTService(api_key=creds.deepgram, settings=DeepgramSTTService.Settings(model=config.STT_MODEL))
    if own_vad:
        return OpenAIHearing(api_key=creds.openai)
    return OpenAIHearing(api_key=creds.openai, turn_detection={"type": "server_vad"},
                         settings=OpenAIRealtimeSTTService.Settings(model=config.OPENAI_VAD_STT_MODEL))


def speech(creds, voice_name: str | None, voice_id: str | None = None):
    """Text-to-speech: Fish Audio when the account has a key for it, else OpenAI. `voice_id` (a Fish reference
    id) is for the demo rep; a call names its voice, and gets the provider's default when that provider lacks it."""
    if creds.fish:
        return FishAudioTTSService(api_key=creds.fish, settings=FishAudioTTSService.Settings(
            model=config.TTS_MODEL, voice=voice_id or config.voice(voice_name, "fish")["reference_id"]))
    return OpenAITTSService(api_key=creds.openai, sample_rate=config.OPENAI_TTS_RATE, settings=OpenAITTSService.Settings(
        model=config.OPENAI_TTS_MODEL, voice=config.voice(voice_name, "openai")["reference_id"],
        instructions=config.OPENAI_TTS_STYLE))


def save_outcome(call_id: str, result, summary, details=None, evals: dict | None = None) -> None:
    fields = {"evals": json.dumps(evals)} if evals is not None else {}
    store.update_call(call_id, outcome_result=result if result in config.OUTCOMES else "not_done",
                      outcome_summary=str(summary or "")[:1000],
                      outcome_details=json.dumps(details if isinstance(details, dict) else {}), **fields)


def thinking(creds, model: str | None = None):
    """The LLM of a call: the user's chosen model on the account's OpenAI key, with the request settings that
    model needs (config.LLM_MODELS); or, when they chose it and saved one, their own OpenAI-compatible service."""
    if model == config.CUSTOM_LLM and creds.llm:
        base, key, name = creds.llm
        return OpenAILLMService(api_key=key, base_url=base, settings=OpenAILLMService.Settings(model=name))
    model = model if model in config.LLM_MODELS else config.LLM_MODEL
    return OpenAILLMService(api_key=creds.openai, settings=OpenAILLMService.Settings(
        model=model, **config.LLM_MODELS[model]["settings"]))


RECAP_PROMPT = """You grade a finished phone call that an AI assistant made for a person. You get the goal, what the
assistant itself reported (it may be missing or too kind), and the whole transcript ("them" is the business, "ai"
the assistant, "owner" the person who joined, "event" notes from the system). Judge only from the transcript.
Return one JSON object:
- "result": "done" (the goal was fully reached on this call), "partial" (part of it was reached, or a clear answer
  came but not the result asked for), "not_done" (nothing was reached), "voicemail" (only a voicemail or answering
  machine), or "no_human" (no live person and no usable answer).
- "summary": one or two plain sentences on what happened. Name anything that differs from the goal.
- "details": an object of facts worth keeping (reference number, name of the person, dates, amounts). {} if none.
- "follow_up": what the person should do next, in one short sentence, or "" when nothing is left to do.
- "reached_person": true when a live person spoke with the assistant."""


def resume_messages(messages: list) -> list:
    """The context for the next stream of the same call (after a key press). A tool call without a finished
    result would make OpenAI refuse the next request, so every open one gets the result "done"."""
    done = {m.get("tool_call_id") for m in messages if isinstance(m, dict) and m.get("role") == "tool"}
    out = []
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "tool" and m.get("content") == "IN_PROGRESS":
            m = {**m, "content": "done"}
        out.append(m)
        if isinstance(m, dict) and m.get("role") == "assistant":
            out += [{"role": "tool", "tool_call_id": c["id"], "content": "done"}
                    for c in m.get("tool_calls") or [] if c["id"] not in done]
    return out


class CallBot:
    """One pipeline for one phone leg, on the accounts in `creds` (keys.Creds). With call_id None it is the
    demo rep (no call row, only end_call)."""

    def __init__(self, websocket, stream_sid: str, twilio_call_sid: str, system_prompt: str, creds,
                 voice: str | None = None, voice_id: str | None = None,
                 call_id: str | None = None, messages: list | None = None, model: str | None = None):
        self.call_id = call_id
        self.creds = creds
        self.moved = False  # a key press moved the call to a new stream: this bot ends without a summary
        self.twilio_call_sid = twilio_call_sid
        self.owner_name = "the account holder"
        self.released = asyncio.Event()  # set while the AI has the call (not the owner)
        self.turn_start: dict[str, float] = {}  # who -> time.time() the current turn began (transcript `at`)
        self.released.set()
        self.owner_stt: PipelineWorker | None = None
        self.owner_runner: asyncio.Task | None = None
        serializer = TwilioFrameSerializer(
            stream_sid, twilio_call_sid, creds.twilio_sid, creds.twilio_token,
            params=TwilioFrameSerializer.InputParams(auto_hang_up=False))
        # allowed_origins=[]: Twilio sends no Origin; the one-use ws_token already guards this socket.
        self.transport = FastAPIWebsocketTransport(websocket, FastAPIWebsocketParams(
            audio_in_enabled=True, audio_out_enabled=True, add_wav_header=False, serializer=serializer,
            allowed_origins=[]))
        stt = hearing(creds)
        self.llm = thinking(creds, model)
        tts = speech(creds, voice, voice_id)
        self.meter = usage.Meter()
        # What this bot runs on, kept with the call so that its cost can be estimated (usage.cost).
        self.runs_on = {"llm": self.llm._settings.model, "stt": creds.hearing, "tts": creds.voice_provider}
        ear = usage.Ear(lambda at: calls.note_sound(self.call_id, at))
        names = list(TOOLS) if call_id else ["end_call"]
        self.context = LLMContext(messages=messages or [{"role": "system", "content": system_prompt}],
                                  tools=ToolsSchema(standard_tools=[TOOLS[n] for n in names]))
        self.aggs = LLMContextAggregatorPair(self.context, user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer()))
        self.llm_gate = LLMGate()
        self.gate = OwnerGate()
        self.tap = AudioBufferProcessor(sample_rate=config.CALL_SAMPLE_RATE, buffer_size=config.AUDIO_DOWN_BYTES)
        self.task = PipelineWorker(
            Pipeline([self.transport.input(), ear, stt, self.aggs.user(), self.llm_gate, self.llm, tts, self.meter,
                      self.gate, self.transport.output(), self.tap, self.aggs.assistant()]),
            params=PipelineParams(audio_in_sample_rate=config.CALL_SAMPLE_RATE,
                                  audio_out_sample_rate=config.CALL_SAMPLE_RATE,
                                  enable_metrics=True, enable_usage_metrics=True),  # token and character counts
            idle_timeout_secs=None,  # the default 300 s would kill every long hold; our watchdog replaces it
            enable_rtvi=False)

        for n in names:
            # ask_user is async (the talk goes on) and has no Pipecat timeout: it waits QUESTION_WAIT_SECONDS for
            # an answer, then for the hand-back if the owner has the call.
            self.llm.register_function(n, getattr(self, f"_tool_{n}"), cancel_on_interruption=n != "ask_user")

        @self.aggs.user().event_handler("on_user_turn_started")
        async def _them_start(_agg, _strategy):
            self.turn_start["them"] = time.time()

        @self.aggs.assistant().event_handler("on_assistant_turn_started")
        async def _ai_start(_agg):
            self.turn_start["ai"] = time.time()

        @self.aggs.user().event_handler("on_user_turn_stopped")
        async def _them(_agg, _strategy, message):
            await self._line("them", getattr(message, "content", None))

        @self.aggs.assistant().event_handler("on_assistant_turn_stopped")
        async def _ai(_agg, message):
            await self._line("ai", getattr(message, "content", None))

        @self.tap.event_handler("on_track_audio_data")
        async def _tap(_proc, them, played, _rate, _channels):
            if self.call_id:
                await owner.tap(self.call_id, them, played)

        @self.transport.event_handler("on_client_disconnected")
        async def _gone(_transport, _ws):
            await self.task.cancel()

    @property
    def owner_has_call(self) -> bool:
        return not self.released.is_set()

    # --- run / stop ---

    async def run(self, speak_first: bool = False, max_seconds: float | None = None) -> None:
        """Runs until the call ends. max_seconds is a hard limit (the demo rep has no call row or watchdog)."""
        if speak_first:  # the demo rep greets; the caller bot waits for the other side
            await self.task.queue_frame(LLMRunFrame())
        limit = asyncio.create_task(self._limit(max_seconds)) if max_seconds else None
        try:
            await WorkerRunner(handle_sigint=False).run(self.task)
        finally:
            if limit:
                limit.cancel()
            await self._stop_owner_stt()
            if self.call_id:
                self.save_usage()
            if self.call_id and not self.moved:
                await self.recap()

    def save_usage(self, more: dict | None = None) -> None:
        """Adds what this bot counted to the call (once per bot; a key press starts the next bot at zero)."""
        row = store.get_call(self.call_id)
        if row:
            store.update_call(self.call_id, usage=usage.add(row["usage"], {**self.meter.used, **self.runs_on, **(more or {})}))
        self.meter.used = dict.fromkeys(usage.COUNTERS, 0)

    async def say(self, text: str) -> None:
        """Speaks a fixed line without asking the LLM (the hello on a silent pick-up)."""
        if not self.owner_has_call:
            await self.task.queue_frame(TTSSpeakFrame(text))

    async def _limit(self, seconds: float) -> None:
        await asyncio.sleep(seconds)
        log.warning("call %s reached its hard limit of %s s", self.twilio_call_sid, seconds)
        try:
            await twilio_api.update_call(self.creds, self.twilio_call_sid, hang_up=True)
        except Exception as e:  # noqa: BLE001
            log.warning("hang up at the hard limit failed: %s", e)
        await self.stop()

    async def stop(self) -> None:
        await self.task.cancel()

    # --- control from calls.py / owner.py ---

    async def tell(self, text: str, run_llm: bool) -> None:
        """Appends a developer note to the AI's context (and runs the LLM when asked; the gate blocks that run
        while the owner has the call)."""
        await self.task.queue_frame(LLMMessagesAppendFrame(messages=[{"role": "developer", "content": text}],
                                                           run_llm=run_llm))

    async def set_tap(self, on: bool) -> None:
        """Owner audio needs the tap; it runs only while an owner link is attached."""
        await (self.tap.start_recording() if on else self.tap.stop_recording())

    def _close_gates(self, closed: bool) -> None:
        self.llm_gate.closed = self.gate.closed = closed
        (self.released.clear if closed else self.released.set)()

    async def take_over(self, rate: int, name: str) -> None:
        self.owner_name = name
        self._close_gates(True)
        await self.gate.cut()
        await self.tell(prompt.joined_note(name), run_llm=False)
        await self._start_owner_stt(rate)

    async def hand_back(self, note: str) -> None:
        self._close_gates(False)
        await self._stop_owner_stt()
        await self.tell(note, run_llm=True)

    async def owner_link_changed(self, rate: int) -> None:
        await self._stop_owner_stt()
        await self._start_owner_stt(rate)

    async def feed(self, pcm: bytes, rate: int) -> None:
        await self.gate.feed(pcm, rate)
        if self.owner_stt:
            await self.owner_stt.queue_frame(InputAudioRawFrame(audio=pcm, sample_rate=rate, num_channels=1))

    async def press(self, digit: str) -> None:
        """The owner's own key press on the phone, passed to the business."""
        if DIGITS.match(digit) and digit != "w":
            await self.gate.press(digit)

    # --- internals ---

    async def _line(self, who: str, text: str | None) -> None:
        text = (text or "").strip()
        if not text or not self.call_id:
            return
        store.add_line(self.call_id, who, text, calls.line_at(self.call_id, self.turn_start.pop(who, None)))
        calls.note_line(self.call_id, who)
        if who == "ai":
            row = store.get_call(self.call_id)
            if row and row["phase"] not in ("connecting_owner", "owner_on_call"):
                store.update_call(self.call_id, phase="talking")
            if row and not row["human_at"]:  # first words to the other side: a live person (section 8)
                store.update_call(self.call_id, human_at=store.now())
                if row["mode"] == "handle" and row["alert_on_human"] and not row["connect_when"]:
                    await owner.on_human(self.call_id)

    async def _start_owner_stt(self, rate: int) -> None:
        """A second tiny pipeline (Deepgram -> sink) for the owner's speech, while the owner has the call."""
        async def on_text(text: str) -> None:
            store.add_line(self.call_id, "owner", text, calls.line_at(self.call_id))  # end of the words: no start time
            await self.tell(f"{self.owner_name} said to them: {text}", run_llm=False)

        self.owner_stt = PipelineWorker(
            Pipeline([hearing(self.creds, own_vad=False), LineSink(on_text)]),
            params=PipelineParams(audio_in_sample_rate=rate), idle_timeout_secs=None, enable_rtvi=False)
        self.owner_runner = asyncio.create_task(WorkerRunner(handle_sigint=False).run(self.owner_stt))

    async def _stop_owner_stt(self) -> None:
        if self.owner_stt:
            await self.owner_stt.cancel()
        if self.owner_runner:
            try:
                await asyncio.wait_for(self.owner_runner, 5)
            except Exception:  # noqa: BLE001
                pass
        self.owner_stt = self.owner_runner = None

    async def recap(self) -> None:
        """After the call: one request grades the whole transcript and writes the outcome. The assistant's own
        report from end_call is only a hint: people hang up before it runs, and it tends to grade itself kindly.
        If the request fails, the assistant's report stays (or "not_done" when there was none)."""
        row = store.get_call(self.call_id)
        if not row:
            return
        lines = store.lines(self.call_id)
        text = "\n".join(f"{l['who']}: {l['text']}" for l in lines)
        if not any(l["who"] != "event" for l in lines):
            save_outcome(self.call_id, "no_human", row["outcome_summary"] or "Nobody spoke on the call.", evals={})
            return
        own = (f"{row['outcome_result']}: {row['outcome_summary']} {row['outcome_details'] or ''}"
               if row["outcome_result"] else "(none: the call ended before the assistant reported)")
        try:
            r = await AsyncOpenAI(api_key=self.creds.openai).chat.completions.create(
                model=config.RECAP_MODEL, response_format={"type": "json_object"},
                **config.LLM_MODELS[config.RECAP_MODEL]["settings"].get("extra", {}),
                messages=[{"role": "system", "content": RECAP_PROMPT},
                          {"role": "user", "content": f"Goal: {row['goal']}\n\nThe assistant's own report: {own}\n\n"
                                                      f"Transcript:\n{text[-24000:]}"}])
            out = json.loads(r.choices[0].message.content or "{}")
            save_outcome(self.call_id, out.get("result"), out.get("summary"), out.get("details"),
                         evals={"follow_up": str(out.get("follow_up") or "")[:300],
                                "reached_person": bool(out.get("reached_person"))})
        except Exception as e:  # noqa: BLE001
            log.warning("recap failed for %s: %s", self.call_id, type(e).__name__)
            if not row["outcome_result"]:
                save_outcome(self.call_id, "not_done", "The call ended before the assistant reported a result.")

    # --- the bot's tools ---

    async def _tool_press_digits(self, params) -> None:
        if self.owner_has_call:
            await params.result_callback(OWNER_HAS_CALL, properties=NO_LLM)
            return
        digits = str(params.arguments.get("digits", ""))
        if not DIGITS.match(digits):
            await params.result_callback("Use 1 to 20 of 0-9 * # (and w to pause).", properties=NO_LLM)
            return
        store.update_call(self.call_id, phase="menu")
        calls.event(self.call_id, f"pressed {digits.replace('w', '')}")
        self.moved = True
        try:
            await calls.press_keys(self.call_id, digits, self)
        except Exception as e:  # noqa: BLE001
            self.moved = False
            log.warning("key press failed for %s: %s", self.call_id, e)
            await params.result_callback("The key press failed. Try once more.")
            return
        await params.result_callback("pressed", properties=NO_LLM)

    async def _tool_wait(self, params) -> None:
        reason = params.arguments.get("reason")
        row = store.get_call(self.call_id)
        phase = {"menu": "menu", "hold": "on_hold"}.get(reason)
        if phase and not self.owner_has_call and row and row["phase"] != phase:
            store.update_call(self.call_id, phase=phase)
            if phase == "on_hold":
                calls.event(self.call_id, "waiting on hold")
        if phase and not self.owner_has_call:
            await owner.false_alarm(self.call_id)
        await params.result_callback("waiting", properties=NO_LLM)

    async def _tool_ask_user(self, params) -> None:
        question = str(params.arguments.get("question", "")).strip()[:500]
        if not question:
            await params.result_callback("Give the question.")
            return
        answer = await calls.ask(self.call_id, question)
        await self.released.wait()  # an answer (or the timeout) during a take-over waits for the hand-back
        await params.result_callback(
            answer if answer is not None else
            "No answer yet. Say you do not have that detail right now and carry on. A later answer may still arrive.")

    async def _tool_connect_owner(self, params) -> None:
        if self.owner_has_call:
            await params.result_callback(OWNER_HAS_CALL, properties=NO_LLM)
            return
        live = calls.LIVE.get(self.call_id)
        row = store.get_call(self.call_id)
        name = prompt.owner_name(row, calls.get_profile(row["user_id"]))
        o = owner.get(self.call_id)
        if o.unreachable:
            await params.result_callback(f"{name} could not be reached a moment ago, so do not try again. "
                                         + prompt.no_answer_rule(row, name))
            return
        if o.handover:
            await params.result_callback(f"{name} is already being brought on. Keep the person company.", properties=NO_LLM)
            return
        if not live or time.monotonic() - live.last_them > config.HANDOVER_RECENT_SECONDS:
            await params.result_callback("Nobody has spoken to you in the last few seconds. This is not a live person "
                                         "yet: keep waiting silently (call wait).", properties=NO_LLM)
            return
        fields = {"phase": "connecting_owner"}
        if not row["human_at"]:
            fields["human_at"] = store.now()
        store.update_call(self.call_id, **fields)
        calls.event(self.call_id, "connecting the owner")
        await owner.handover(self.call_id)
        await params.result_callback(f"Bringing {name} on the line. Keep the person company until you are told "
                                     f"{name} joined; do not start to solve the issue.", properties=NO_LLM)

    async def _tool_end_call(self, params) -> None:
        if self.owner_has_call:
            await params.result_callback(OWNER_HAS_CALL, properties=NO_LLM)
            return
        args = params.arguments
        if self.call_id:
            save_outcome(self.call_id, args.get("result"), args.get("summary"), args.get("details"))
            calls.event(self.call_id, "AI ended the call")
        await params.result_callback("ending", properties=NO_LLM)
        asyncio.create_task(self._hang_up_after_speech())

    async def _hang_up_after_speech(self) -> None:
        """Lets the last sentence finish, then hangs up through Twilio (one place ends a call) and stops the task."""
        await asyncio.sleep(1.0)
        deadline = time.monotonic() + config.END_CALL_SPEECH_WAIT_SECONDS
        while self.gate.bot_speaking and time.monotonic() < deadline:
            await asyncio.sleep(0.2)
        if self.owner_has_call:  # the owner took the call while the goodbye was playing
            return
        try:
            if self.call_id:
                await calls.stop_call(calls.call_row(self.call_id))
            else:
                await twilio_api.update_call(self.creds, self.twilio_call_sid, hang_up=True)
        except Exception as e:  # noqa: BLE001
            log.warning("hang up after end_call failed: %s", e)
        await self.stop()
