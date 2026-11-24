import asyncio

import pytest

from callenvoy import calls, config, store

from .conftest import CALL, run, uid


def place(**kw):
    return run(calls.place_call(uid(), calls.PlaceCallInput(**{**CALL, **kw})))


def end_all():
    for r in store.live_calls():
        store.update_call(r["id"], status="completed", talk_seconds=0)


def test_recording_order_and_no_record_params(fresh):
    place()
    assert fresh.created[-1]["record"] is True  # constant default
    store.save_profile(uid(), {"record_calls": False})
    end_all()
    v = place()
    assert fresh.created[-1]["record"] is False and v["recorded"] is False
    end_all()
    place(record=True)  # the call value wins over the setting
    assert fresh.created[-1]["record"] is True


from callenvoy.twilio_api import create_call as REAL_CREATE  # noqa: E402  (taken before the fixture fakes it)


def test_create_call_sends_a_real_form_body(monkeypatch):
    """Goes through httpx itself: a list passed as `data=` is not form-encoded and fails in an AsyncClient."""
    from functools import partial
    from urllib.parse import parse_qs

    import httpx

    from callenvoy import twilio_api

    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent["type"] = request.headers["content-type"]
        sent["form"] = parse_qs(request.content.decode())
        return httpx.Response(201, json={"sid": "CA1"})

    monkeypatch.setattr(twilio_api.httpx, "AsyncClient", partial(httpx.AsyncClient, transport=httpx.MockTransport(handler)))
    from callenvoy import keys
    assert run(REAL_CREATE(keys.server(), to="+14155550123", url="u", status_callback="s", record=False)) == "CA1"
    assert sent["type"] == "application/x-www-form-urlencoded" and sent["form"]["To"] == ["+14155550123"]
    assert sent["form"]["StatusCallbackEvent"] == ["initiated", "ringing", "answered", "completed"]
    assert not set(sent["form"]) & {"Record", "RecordingChannels", "RecordingStatusCallback"}
    run(REAL_CREATE(keys.server(), to="+14155550123", url="u", status_callback="s", record=True))
    assert sent["form"]["RecordingChannels"] == ["dual"] and sent["form"]["Record"] == ["true"]
    assert sent["form"]["Trim"] == ["do-not-trim"]  # transcript `at` times need the leading silence


def test_settings_order_and_bad_values():
    store.save_profile(uid(), {"mode": "transfer", "voice": "Rohan", "callback_number": "+14155550199"})
    v = place()
    row = store.get_call(v["id"])
    assert row["mode"] == "transfer" and row["voice"] == "Rohan" and row["alert_wait_seconds"] == 20
    v = place(mode="handle", voice="Ethan", alert_wait_seconds=60)
    row = store.get_call(v["id"])
    assert row["mode"] == "handle" and row["voice"] == "Ethan" and row["alert_wait_seconds"] == 60
    with pytest.raises(calls.CallError, match="handle, transfer"):
        calls.save_profile(uid(), {"mode": "nope"})
    with pytest.raises(calls.CallError, match="1 to 120"):
        calls.save_profile(uid(), {"max_minutes": 500})
    with pytest.raises(Exception):
        calls.PlaceCallInput(**CALL, voice="Nobody")


def test_save_profile_round_trips_every_setting():
    values = {"name": "Alex", "callback_number": "(415) 555-0199", "details": "d", "caller_id": "own",
              "leave_voicemail": False, "voice": "Meera", "record_calls": False, "max_minutes": 10, "mode": "transfer",
              "reach": "phone", "alert_wait_seconds": 30, "phone_ring_seconds": 40, "no_answer": "end_politely",
              "alert_on_human": False, "listen_in": True, "alert_sound": False, "alert_notification": False,
              "alert_push": False, "push_shows_business": False, "timezone": "America/Los_Angeles",
              "ai_model": "gpt-6.1-terra"}
    values.update({k: "x" for k in config.PROFILE_FIELDS})
    assert set(values) == set(config.SETTINGS)
    p = calls.save_profile(uid(), values)
    assert p == {**values, "callback_number": "+14155550199"}
    p = calls.save_profile(uid(), {"name": "", "vin": ""})  # empty string removes a text field
    assert p["name"] is None and p["vin"] is None


def test_profile_field_limits():
    with pytest.raises(calls.CallError, match="longer than 30"):
        calls.save_profile(uid(), {"assistant_name": "x" * 31})
    with pytest.raises(calls.CallError, match="callback_number"):
        calls.save_profile(uid(), {"callback_number": "12345"})


def test_phone_reach_without_callback_number_refused():
    with pytest.raises(calls.CallError) as e:
        place(mode="transfer", reach="phone")
    assert e.value.field == "reach"
    place(mode="transfer", reach="app_then_phone")  # accepted; the phone step is skipped


def test_from_own_refused_until_verified(fresh):
    store.save_profile(uid(), {"callback_number": "+14155550199"})
    with pytest.raises(calls.CallError, match="verif") as e:
        place(**{"from": "own"})
    assert e.value.field == "from"
    run(calls.verify_number(uid()))  # Twilio calls the number; the user types the code
    fresh.verified.add("+14155550199")
    v = place(**{"from": "own"})
    assert v["calling_number"] == "+14155550199" and fresh.created[-1]["from_number"] == "+14155550199"


def test_watchdog_rules():
    m = 60
    start, planned = 0.0, 30 * m
    assert calls.next_deadline(planned, planned, start, "on_hold", 0) == planned + 15 * m
    assert calls.next_deadline(planned, planned, start, "talking", planned - 30) == planned + 2 * m
    assert calls.next_deadline(planned, planned, start, "talking", planned - 600) is None
    assert calls.next_deadline(planned, planned, start, "menu", 0) is None
    ceiling = config.MAX_CALL_MINUTES * m
    assert calls.next_deadline(ceiling - 60, ceiling - 60, start, "on_hold", 0) == ceiling  # capped
    assert calls.next_deadline(ceiling, ceiling, start, "on_hold", 0) is None  # never past the ceiling


def test_long_poll_returns_early_on_new_line_and_on_timeout():
    async def go():
        v = await calls.place_call(uid(), calls.PlaceCallInput(**CALL))
        cid = v["id"]
        loop = asyncio.get_running_loop()
        loop.call_later(0.05, store.add_line, cid, "them", "hello")
        t0 = loop.time()
        got = await calls.get_call(uid(), cid, wait_seconds=5)
        assert loop.time() - t0 < 2 and got["transcript"][-1]["text"] == "hello"
        t0 = loop.time()
        got = await calls.get_call(uid(), cid, wait_seconds=1, since_line=got["next_line"])
        assert 0.9 < loop.time() - t0 < 2 and got["transcript"] == []
    run(go())


def test_answer_question_round_trip_and_finished_call():
    async def go():
        v = await calls.place_call(uid(), calls.PlaceCallInput(**CALL))
        cid = v["id"]
        waiter = asyncio.create_task(calls.ask(cid, "What is the address?"))
        await asyncio.sleep(0.01)
        q = (await calls.get_call(uid(), cid))["open_questions"][0]
        await calls.answer_question(uid(), cid, q["id"], "1 Main St")
        assert await waiter == "1 Main St"
        store.update_call(cid, status="completed")
        qid = store.add_question(cid, "late?")
        with pytest.raises(calls.CallError, match="ended"):
            await calls.answer_question(uid(), cid, qid, "x")
    run(go())


def test_inbound_row_and_business_name():
    v = place(business="Dr. Chen's office", to="+14155550123")
    store.update_call(v["id"], status="completed")
    assert calls.inbound({"From": "+14155550123", "CallSid": "CAin"}) is None  # no callback number
    store.save_profile(uid(), {"callback_number": "+14155550199"})
    fwd = calls.inbound({"From": "+14155550123", "CallSid": "CAin"})
    row = store.get_call(fwd["id"])
    assert row["direction"] == "inbound" and row["business"] == "Dr. Chen's office" and not row["record"]
    assert calls.inbound({"From": "+16175550100"})["forward_to"] == "+14155550199"
    run(calls.inbound_done(fwd["id"], {"DialCallStatus": "no-answer", "DialCallDuration": "0"}))
    assert store.get_call(fwd["id"])["status"] == "no_answer"
    view = calls.view(store.get_call(fwd["id"]))
    assert view["direction"] == "inbound" and view["finished"] and view["calling_number"] == "+14155550199"


def test_final_status_with_a_recording_id_ends_the_call(fresh):
    """Twilio adds RecordingSid to the "completed" status of a recorded call; it is not a recording callback."""
    cid = place()["id"]
    run(calls.on_status(cid, {"CallStatus": "completed", "CallDuration": "42", "RecordingSid": "RE1"}))
    row = store.get_call(cid)
    assert row["status"] == "completed" and row["talk_seconds"] == 42 and not row["recording_sid"]
    run(calls.on_status(cid, {"RecordingSid": "RE1", "RecordingStatus": "completed", "RecordingDuration": "40"}))
    assert store.get_call(cid)["recording_sid"] == "RE1"


def test_late_dialing_does_not_overwrite_a_final_status(fresh, monkeypatch):
    """Fix 3a: Twilio's final status can arrive before create_call returns."""
    from callenvoy import twilio_api

    real = twilio_api.create_call

    async def fast_fail(creds, **kw):
        sid = await real(creds, **kw)
        cid = kw["url"].rsplit("/", 1)[1]
        await calls.on_status(cid, {"CallStatus": "busy", "CallSid": sid})
        return sid

    monkeypatch.setattr(twilio_api, "create_call", fast_fail)
    v = place()
    assert v["status"] == "busy" and v["finished"]


def test_stuck_dialing_call_is_closed(fresh, monkeypatch):
    """Fix 3b: no answer and no final status within DIAL_TIMEOUT_SECONDS: failed, hung up, slot freed."""
    monkeypatch.setattr(config, "DIAL_TIMEOUT_SECONDS", 0.05)

    async def go():
        v = await calls.place_call(uid(), calls.PlaceCallInput(**CALL))
        await asyncio.sleep(0.2)
        row = store.get_call(v["id"])
        assert row["status"] == "failed" and "no status from Twilio" in row["error"]
        assert (row["twilio_sid"], {"hang_up": True}) in fresh.updated
        assert v["id"] not in calls.LIVE and not store.live_calls()
        v2 = await calls.place_call(uid(), calls.PlaceCallInput(**CALL))
        store.update_call(v2["id"], status="in_progress")  # answered: the timeout leaves it alone
        await asyncio.sleep(0.2)
        assert store.get_call(v2["id"])["status"] == "in_progress"
    run(go())


def test_inbound_get_call_waits_until_the_forward_ends():
    """Contract 8: a forwarded call is live until the <Dial> action callback."""
    store.save_profile(uid(), {"callback_number": "+14155550199"})

    async def go():
        fwd = calls.inbound({"From": "+14155550123", "CallSid": "CAin"})
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        got = await calls.get_call(uid(), fwd["id"], wait_seconds=1)
        assert loop.time() - t0 > 0.9 and not got["finished"]
        loop.call_later(0.05, lambda: asyncio.ensure_future(
            calls.inbound_done(fwd["id"], {"DialCallStatus": "completed", "DialCallDuration": "30"})))
        t0 = loop.time()
        got = await calls.get_call(uid(), fwd["id"], wait_seconds=5)
        assert loop.time() - t0 < 2 and got["finished"] and got["talk_seconds"] == 30
    run(go())


def test_caller_id_cache(fresh, monkeypatch):
    """Fix 14: Twilio is asked once per CALLER_ID_CACHE_SECONDS; a verify request clears the cache."""
    store.save_profile(uid(), {"callback_number": "+14155550199"})
    asked = []
    real = fresh.caller_id_verified

    async def counting(creds, number):
        asked.append(number)
        return await real(creds, number)

    from callenvoy import twilio_api

    monkeypatch.setattr(twilio_api, "caller_id_verified", counting)
    run(calls.verify_number(uid()))  # starts the verification (and clears the cache)
    asked.clear()
    assert run(calls.caller_id(uid())) == {"number": "+14155550199", "verified": False}
    fresh.verified.add("+14155550199")
    assert run(calls.caller_id(uid()))["verified"] is False and len(asked) == 1  # cached
    run(calls.verify_number(uid()))  # clears the cache (and sees it is verified now)
    assert run(calls.caller_id(uid()))["verified"] is True


class StubBot:
    """Stands in for bot.CallBot in the key press tests."""
    def __init__(self):
        self.moved, self.summaries, self.tap = True, 0, False

    async def recap(self):
        self.summaries += 1

    async def set_tap(self, on):
        self.tap = on


def test_key_press_moves_the_call_to_a_new_stream(fresh):
    """Twilio plays real digits, then the call joins a new stream with a new one-use token and the next bot."""
    async def go():
        cid = (await calls.place_call(uid(), calls.PlaceCallInput(**CALL)))["id"]
        old, new = StubBot(), StubBot()
        await calls.stream_started(cid, old)
        await calls.press_keys(cid, "1w2", old)
        token = store.get_call(cid)["ws_token"]
        _sid, kw = fresh.updated[-1]
        assert '<Play digits="1w2"/><Connect><Stream url=' in kw["twiml"] and token in kw["twiml"]
        await calls.bot_finished(cid, old)  # the old stream closed: the call is still live, with no bot
        assert calls.LIVE[cid].bot is None and not calls.is_final(store.get_call(cid))
        await calls.stream_started(cid, new)
        await asyncio.sleep(0.6)  # the wait for the new stream sees it and stops
        assert calls.LIVE[cid].bot is new and old.summaries == 0 and len(calls.LIVE[cid].tasks) >= 1
        await calls.finish(cid)
    run(go())


def test_key_press_then_no_new_stream_closes_the_call(fresh):
    async def go():
        cid = (await calls.place_call(uid(), calls.PlaceCallInput(**CALL)))["id"]
        old = StubBot()
        await calls.stream_started(cid, old)
        await calls.press_keys(cid, "1", old)
        await calls.bot_finished(cid, old)
        await calls.on_status(cid, {"CallStatus": "completed", "CallDuration": "9"})  # the business hung up
        assert cid in calls.LIVE  # kept until the summary is written
        await asyncio.sleep(0.7)
        assert old.summaries == 1 and cid not in calls.LIVE and store.get_call(cid)["ws_token"] is None
    run(go())


def test_hang_up_while_dialing_hangs_up_the_returned_call(monkeypatch, fresh):
    """A hang-up that lands while Twilio's dial request is pending: the call Twilio then returns is hung up."""
    from callenvoy import twilio_api

    async def slow_create(creds, **kw):
        row = store.live_calls()[0]
        await calls.hang_up(uid(), row["id"])  # the user hangs up before Twilio has answered the request
        return "CAlate"

    monkeypatch.setattr(twilio_api, "create_call", slow_create)
    v = place()
    assert v["status"] == "canceled" and ("CAlate", {"hang_up": True}) in fresh.updated


def test_cost_estimate_and_evals():
    """A finished call shows what it cost (list prices) and plain measures of how it went."""
    import json

    from callenvoy import usage
    v = place()
    cid = v["id"]
    assert calls.view(store.get_call(cid))["cost"] is None  # nothing until the call has ended
    used = usage.add(None, {"llm_in": 100_000, "llm_cached": 80_000, "llm_out": 1_000, "tts_chars": 1_000,
                            "llm": "gpt-6-luna", "stt": "deepgram", "tts": "fish"})
    used = usage.add(used, {"llm_in": 100_000, "llm_cached": 0, "llm_out": 0, "tts_chars": 0, "llm": "gpt-6-luna"})
    assert json.loads(used)["llm_in"] == 200_000 and json.loads(used)["llm"] == "gpt-6-luna"  # counts add, names are set
    store.add_line(cid, "event", "pressed 1")
    store.add_question(cid, "Which address?")
    store.update_call(cid, status="completed", talk_seconds=125, usage=used, answered_at="2026-11-24T10:00:00Z",
                      human_at="2026-11-24T10:01:10Z", outcome_result="partial", evals=json.dumps({"follow_up": "Call back Monday."}))
    out = calls.view(store.get_call(cid))
    c = out["cost"]
    # 3 started minutes of phone, stream and recording; 125 s of hearing; tokens; 1,000 spoken characters
    assert c["parts"]["phone"] == round(3 * (0.014 + 0.004 + 0.0025), 4)
    assert c["parts"]["hearing"] == round(125 / 60 * 0.0077, 4) and c["parts"]["voice"] == 0.015
    assert c["parts"]["ai"] == round((120_000 * 0.10 + 80_000 * 0.01 + 1_000 * 0.50) / 1e6, 4) and c["complete"]
    assert c["total"] == round(sum(c["parts"].values()), 3)
    e = out["evals"]
    assert e == {"goal": "partial", "reached_person": True, "seconds_to_person": 70, "keys_pressed": 1,
                 "questions_asked": 1, "ended_by": "them", "follow_up": "Call back Monday."}
    store.update_call(cid, usage=usage.add(None, {"llm": "some-other-model", "llm_in": 5}))
    c = calls.view(store.get_call(cid))["cost"]
    assert c["parts"]["ai"] is None and c["complete"] is False  # a model without a known price is left out, and said so


def test_silent_hold_gets_no_more_time():
    m = 60
    planned = 30 * m
    assert calls.next_deadline(planned, planned, 0.0, "on_hold", 0, False, planned - 60) == planned + 15 * m  # music plays
    assert calls.next_deadline(planned, planned, 0.0, "on_hold", 0, False, planned - 11 * m) is None  # silent 11 minutes
    assert calls.next_deadline(planned, planned, 0.0, "on_hold", 0, True, planned - 11 * m) == planned + 15 * m  # owner is on


def test_quiet_line_nudges_the_ai_once_per_silent_stretch(monkeypatch):
    """Both sides waiting for each other: after a silent stretch the AI is told once, and again only after sound."""
    real_sleep = asyncio.sleep

    v = place()
    cid = v["id"]
    store.update_call(cid, status="in_progress")
    told = []

    class Bot:
        async def tell(self, text, run_llm):
            told.append(run_llm)

    live = calls.LIVE[cid]
    live.bot = Bot()
    clock = {"now": 1000.0}
    monkeypatch.setattr(calls.time, "monotonic", lambda: clock["now"])
    live.last_talk = live.last_sound = 1000.0

    async def fast_sleep(seconds):
        clock["now"] += seconds
        if clock["now"] == 1060.0:
            live.last_sound = clock["now"]  # hold music starts: the stretch ends
        if clock["now"] >= 1130.0:
            store.update_call(cid, status="completed")
        await real_sleep(0)

    monkeypatch.setattr(calls.asyncio, "sleep", fast_sleep)
    run(calls._quiet_watch(cid))
    assert told == [True, True]  # at 30 s of silence, and once more 30 s after the music stopped
