"""The real owner gates and the bot's tool handlers (no services are contacted, no network)."""

import asyncio
import math
import struct
import time
from unittest.mock import MagicMock

import pytest
from pipecat.frames.frames import (
    InterruptionFrame,
    LLMContextFrame,
    OutputAudioRawFrame,
    TextFrame,
    TTSAudioRawFrame,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection
from pipecat.tests.utils import run_test

from callenvoy import bot, calls, keys, store

from .conftest import CALL, run, uid


def ctx():
    return LLMContextFrame(LLMContext())


@pytest.mark.parametrize("gate_cls", [bot.LLMGate, bot.OwnerGate])
def test_closed_gates_block_the_llm_both_ways(gate_cls):
    g = gate_cls()
    g.closed = True
    run(run_test(g, frames_to_send=[ctx(), TextFrame("x")], expected_down_frames=[TextFrame]))
    g = gate_cls()
    g.closed = True
    run(run_test(g, frames_to_send=[ctx()], frames_to_send_direction=FrameDirection.UPSTREAM,
                 expected_up_frames=[]))
    run(run_test(gate_cls(), frames_to_send=[ctx()], expected_down_frames=[LLMContextFrame]))
    run(run_test(gate_cls(), frames_to_send=[ctx()], frames_to_send_direction=FrameDirection.UPSTREAM,
                 expected_up_frames=[LLMContextFrame]))


def test_owner_gate_closed_drops_bot_audio_and_interruptions():
    gate = bot.OwnerGate()
    gate.closed = True
    run(run_test(gate, frames_to_send=[InterruptionFrame(), TTSAudioRawFrame(b"\0" * 320, 8000, 1), TextFrame("x")],
                 expected_down_frames=[TextFrame]))
    run(run_test(bot.OwnerGate(), frames_to_send=[InterruptionFrame()], expected_down_frames=[InterruptionFrame]))


def test_owner_audio_and_keys_pass_a_closed_gate():
    gate = bot.OwnerGate()
    gate.closed = True
    pushed = []

    async def capture(frame, direction=None):
        pushed.append(frame)

    gate.push_frame = capture
    run(gate.feed(b"\1\0" * 320, 16000))
    run(gate.press("5"))
    assert isinstance(pushed[0], OutputAudioRawFrame) and pushed[0].sample_rate == 16000
    assert isinstance(pushed[1], OutputAudioRawFrame) and pushed[1].audio == bot.dtmf_pcm("5")


def _power(pcm: bytes, hz: int) -> float:
    """Strength of one frequency in the first 120 ms of 8 kHz PCM (a plain correlation)."""
    xs = struct.unpack(f"<{len(pcm) // 2}h", pcm)[:960]
    return math.hypot(sum(x * math.cos(2 * math.pi * hz * n / 8000) for n, x in enumerate(xs)),
                      sum(x * math.sin(2 * math.pi * hz * n / 8000) for n, x in enumerate(xs)))


def test_key_tone_has_the_right_two_frequencies_and_length():
    pcm = bot.dtmf_pcm("5")
    assert len(pcm) == 2 * 8000 * 200 // 1000  # 120 ms tone and 80 ms gap
    assert len(bot.dtmf_pcm("1w#")) == 2 * 8000 * 900 // 1000
    strong = {hz for hz in bot.DTMF_ROWS + bot.DTMF_COLS if _power(pcm, hz) > 1e6}
    assert strong == {770, 1336}
    assert max(abs(x) for x in struct.unpack(f"<{len(pcm) // 2}h", pcm)) <= 16382  # no clipping


def test_interruption_does_not_cut_a_key_tone():
    gate = bot.OwnerGate()
    gate.tones_until = time.monotonic() + 5  # as press() sets it
    run(run_test(gate, frames_to_send=[InterruptionFrame(), TextFrame("x")], expected_down_frames=[TextFrame]))


class Params:
    def __init__(self, **arguments):
        self.arguments = arguments
        self.results = []
        self.llm = MagicMock()

    async def result_callback(self, result, properties=None):
        self.results.append((result, properties))


@pytest.fixture
def make_bot(monkeypatch):
    for k in ("DEEPGRAM_API_KEY", "OPENAI_API_KEY", "FISH_API_KEY"):
        monkeypatch.setenv(k, "test")

    def make(call_id):
        ws = MagicMock()
        ws.headers = {}
        return bot.CallBot(ws, "MZ1", "CA1", "prompt", keys.server(), voice="Hannah", call_id=call_id)
    return make


def test_tools_refuse_while_the_owner_has_the_call(make_bot, fresh):
    async def go():
        v = await calls.place_call(uid(), calls.PlaceCallInput(**CALL))
        b = make_bot(v["id"])
        calls.LIVE[v["id"]].bot = b
        b._close_gates(True)
        for name, args in (("end_call", {"result": "done", "summary": "s"}), ("press_digits", {"digits": "1"}),
                           ("connect_owner", {})):
            p = Params(**args)
            await getattr(b, f"_tool_{name}")(p)
            assert p.results[0][0] == bot.OWNER_HAS_CALL and p.results[0][1].run_llm is False, name
            assert not p.llm.push_frame.called, name  # no key tone pushed
        await asyncio.sleep(1.2)  # end_call would hang up after about 1 s
        assert store.get_call(v["id"])["outcome_result"] is None and not fresh.updated
    run(go())


def test_ask_user_answer_waits_for_the_hand_back(make_bot):
    async def go():
        v = await calls.place_call(uid(), calls.PlaceCallInput(**CALL))
        cid = v["id"]
        b = make_bot(cid)
        calls.LIVE[cid].bot = b
        p = Params(question="What is the address?")
        task = asyncio.create_task(b._tool_ask_user(p))
        await asyncio.sleep(0.01)
        b._close_gates(True)  # the owner takes the call
        q = (await calls.get_call(uid(), cid))["open_questions"][0]
        await calls.answer_question(uid(), cid, q["id"], "1 Main St")
        await asyncio.sleep(0.05)
        assert p.results == []  # held back while the owner has the call
        b._close_gates(False)  # hand-back
        await asyncio.wait_for(task, 1)
        assert p.results[0][0] == "1 Main St"
    run(go())


def test_demo_rep_hard_limit(make_bot, fresh):
    async def go():
        rep = make_bot(None)
        stopped = []

        async def stop():
            stopped.append(True)

        rep.stop = stop
        await rep._limit(0.01)
        assert fresh.updated == [("CA1", {"hang_up": True})] and stopped
    run(go())


def test_resume_messages_closes_open_tool_calls():
    msgs = [{"role": "system", "content": "p"},
            {"role": "assistant", "tool_calls": [{"id": "a", "function": {"name": "press_digits"}}]},
            {"role": "tool", "tool_call_id": "a", "content": "IN_PROGRESS"},
            {"role": "assistant", "tool_calls": [{"id": "b", "function": {"name": "wait"}}]}]
    out = bot.resume_messages(msgs)
    assert [m.get("content") for m in out if m["role"] == "tool"] == ["done", "done"]
    assert out[-1] == {"role": "tool", "tool_call_id": "b", "content": "done"} and msgs[2]["content"] == "IN_PROGRESS"


def test_voice_and_hearing_follow_the_keys():
    """Without a Deepgram or Fish key a call hears and speaks through OpenAI; a saved key switches that part."""
    from dataclasses import replace

    from pipecat.services.deepgram.stt import DeepgramSTTService
    from pipecat.services.fish.tts import FishAudioTTSService
    from pipecat.services.openai.stt import OpenAIRealtimeSTTService
    from pipecat.services.openai.tts import OpenAITTSService

    full = keys.server()  # the test server has all four keys
    assert isinstance(bot.hearing(full), DeepgramSTTService) and isinstance(bot.speech(full, "Rohan"), FishAudioTTSService)
    two = replace(full, deepgram="", fish="")  # a user with Twilio + OpenAI only
    assert two.hearing == "openai" and two.voice_provider == "openai"
    assert isinstance(bot.hearing(two), OpenAIRealtimeSTTService)
    assert isinstance(bot.hearing(two, own_vad=False), OpenAIRealtimeSTTService)
    tts = bot.speech(two, "Rohan")  # a Fish voice name on an account without Fish: the OpenAI default
    assert isinstance(tts, OpenAITTSService) and tts._settings.voice == "marin"
    assert bot.speech(two, "Cedar")._settings.voice == "cedar"
    assert isinstance(bot.speech(replace(two, fish="f"), "Cedar"), FishAudioTTSService)


def test_openai_hearing_holds_audio_until_the_session_is_ready():
    """Audio and a commit that arrive before OpenAI has our session settings are sent, in order, once it has."""
    from pipecat.services.openai.stt import OpenAIRealtimeSTTService

    for name in ("_send_audio", "_commit_audio_buffer"):  # the Pipecat internals the class builds on
        assert callable(getattr(OpenAIRealtimeSTTService, name))
    h = bot.OpenAIHearing(api_key="sk-test")
    assert h._session_ready is False
    sent = []

    async def ws_send(message):
        sent.append(message["type"])

    async def resample(audio, _from, _to):
        return audio

    h._ws_send, h._resampler.resample = ws_send, resample

    async def go():
        await h._send_audio(b"\x01\x00" * 80)
        await h._send_audio(b"\x02\x00" * 80)
        await h._commit_audio_buffer()  # the first words ended before the session was ready
        assert sent == []
        h._session_ready = True
        await h._send_audio(b"\x03\x00" * 80)
        assert sent == ["input_audio_buffer.append"] * 2 + ["input_audio_buffer.commit", "input_audio_buffer.append"]
        await h._commit_audio_buffer()
        assert sent[-1] == "input_audio_buffer.commit" and h._held == []
        # the session becomes ready between two audio frames and the next thing is a commit: held audio goes first
        h._session_ready, sent[:] = False, []
        await h._send_audio(b"\x04\x00" * 80)
        h._session_ready = True
        await h._commit_audio_buffer()
        assert sent == ["input_audio_buffer.append", "input_audio_buffer.commit"]
    run(go())


def test_the_ai_cannot_hang_up_while_a_question_is_open(make_bot):
    async def go():
        v = await calls.place_call(uid(), calls.PlaceCallInput(**CALL))
        cid = v["id"]
        b = make_bot(cid)
        calls.LIVE[cid].bot = b
        asking = asyncio.create_task(b._tool_ask_user(Params(question="Which address?")))
        await asyncio.sleep(0.05)
        p = Params(result="not_done", summary="No address.")
        await b._tool_end_call(p)
        assert "Do not end the call" in p.results[0][0] and store.get_call(cid)["outcome_result"] is None
        q = store.questions(cid)[0]
        await calls.answer_question(uid(), cid, q["id"], "12 Oak Street")
        await asyncio.wait_for(asking, 2)
        p2 = Params(result="done", summary="Fixed.")
        await b._tool_end_call(p2)  # nothing open any more: the call may end
        assert store.get_call(cid)["outcome_result"] == "done"
    run(go())
