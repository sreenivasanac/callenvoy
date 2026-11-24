"""Protected details: labels, storage, how a value is spoken, and masking of a read-back."""

import pytest

from callenvoy import store, vault

from .conftest import uid


def test_save_find_and_never_plain_at_rest():
    vault.save(uid(), " SSN ", "123-45-6789")
    vault.save(uid(), "Account PIN", "4821")
    assert vault.labels(uid()) == ["SSN", "Account PIN"]
    assert vault.view(uid())[0]["hint"] == "ends in 89" and vault.view(uid())[1]["hint"] == "saved"
    assert "123-45-6789" not in " ".join(r["secret"] for r in store.saved_secrets(uid()))
    assert vault.value(uid(), "ssn") == "123-45-6789" and vault.value(uid(), "nope") is None
    vault.save(uid(), "ssn", "987-65-4321")  # the same label in another case replaces the value
    assert vault.labels(uid()) == ["SSN", "Account PIN"] and vault.value(uid(), "SSN") == "987-65-4321"
    for label, value, field in (("", "1234", "label"), ("x" * 41, "1234", "label"), ("<b>", "1234", "label"), ("ok", "", "value"),
                                ("ok", "7-1", "value")):  # too short to tell from ordinary words
        with pytest.raises(vault.VaultError) as e:
            vault.save(uid(), label, value)
        assert e.value.field == field
    assert store.delete_secret(uid(), "SSN") and vault.labels(uid()) == ["Account PIN"]


def test_spoken_form():
    assert vault.spoken("123-45-6789") == "1 2 3, 4 5, 6 7 8 9."
    assert vault.spoken("AB12 9") == "A B 1 2, 9."
    assert vault.spoken("blue horse 7") == "blue, horse, 7."


def test_a_read_back_is_masked_however_it_is_grouped():
    s = {"SSN": "123-45-6789", "PIN": "4821", "Password": "tulip-Garden9"}
    assert vault.mask("So that is 123 45 6789, correct?", s) == "So that is [SSN], correct?"
    assert vault.mask("one two three, four five, six seven eight nine", s) == "[SSN]"
    assert vault.mask("I have 1 2 3 4 5 six 7 8 nine on file", s) == "I have [SSN] on file"
    assert vault.mask("your pin four eight two one and ssn 123456789.", s) == "your pin [PIN] and ssn [SSN]."
    assert vault.mask("the password Tulip-Garden9 works", s) == "the password [Password] works"
    # other numbers stay: a wrong read-back must be seen as wrong, and ordinary numbers are not secrets
    assert vault.mask("is it 123 45 6788? I am one of four agents", s) == "is it 123 45 6788? I am one of four agents"
    assert vault.mask("call 1 800 482 1000", s) == "call 1 800 482 1000"
    # read back one character at a time, and short codes
    s = {"Code": "AB12CD", "CVV": "731"}
    assert vault.mask("that is A B 1 2 C D, right?", s) == "that is [Code], right?"
    assert vault.mask("a, b, one, two, c, d", s) == "[Code]"
    assert vault.mask("ab12cd and seven three one", s) == "[Code] and [CVV]"
    assert vault.mask("the code is 731.", s) == "the code is [CVV]."
    assert vault.mask("about 7310 people, a bad code", s) == "about 7310 people, a bad code"


# --- on a call: permission, a typed value, and nothing of the value anywhere it could be read ---

import asyncio  # noqa: E402
import json  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from callenvoy import auth, bot, calls, config, keys, main, twilio_api  # noqa: E402

from .conftest import CALL, owner_cookie, run  # noqa: E402
from .test_bot import Params  # noqa: E402

API, ORIGIN = "/callenvoy/api", {"Origin": config.PUBLIC_ORIGIN}
SSN = "123-45-6789"


def everything_stored() -> str:
    """All text in the database, to prove a value is in none of it."""
    out = []
    for (table,) in store.db.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall():
        out += [json.dumps([str(v) for v in row]) for row in store.db.execute(f"SELECT * FROM {table}").fetchall()]
    return "\n".join(out)


def test_only_the_console_can_allow_a_saved_secret_for_a_call():
    client = TestClient(main.app, base_url="http://localhost:3020")
    vault.save(uid(), "SSN", SSN)
    me = {**owner_cookie(), **ORIGIN}
    _, agent = auth.create_key(uid(), "Codex")
    by_agent = client.post(f"{API}/calls", json={**CALL, "allow_secrets": ["SSN"]}, headers={"Authorization": f"Bearer {agent}"})
    assert store.get_call(by_agent.json()["id"])["secrets"] is None  # ignored: an agent cannot allow it
    by_user = client.post(f"{API}/calls", json={**CALL, "allow_secrets": ["ssn"]}, headers=me)
    assert json.loads(store.get_call(by_user.json()["id"])["secrets"]) == ["SSN"]
    assert client.get(f"{API}/calls/{by_user.json()['id']}", headers=me).json()["secrets_allowed"] == ["SSN"]
    r = client.post(f"{API}/calls", json={**CALL, "allow_secrets": ["Passport"]}, headers=me)
    assert r.status_code == 400 and r.json()["field"] == "allow_secrets"
    # the vault itself: listed without values, and closed to agent keys
    listed = client.get(f"{API}/secrets", headers=me).json()
    assert listed["secrets"] == [{"label": "SSN", "hint": "ends in 89", "created_at": listed["secrets"][0]["created_at"]}]
    assert client.get(f"{API}/secrets", headers={"Authorization": f"Bearer {agent}"}).status_code == 403
    assert client.post(f"{API}/secrets", json={"label": "PIN", "value": "4821"}, headers=me).status_code == 201
    assert client.delete(f"{API}/secrets/pin", headers=me).json()["secrets"][0]["label"] == "SSN"
    assert client.delete(f"{API}/secrets/pin", headers=me).status_code == 404


def test_a_call_asks_the_user_and_the_value_is_stored_nowhere(monkeypatch, fresh):
    client = TestClient(main.app, base_url="http://localhost:3020")
    vault.save(uid(), "SSN", SSN)
    me = {**owner_cookie(), **ORIGIN}
    _, agent = auth.create_key(uid(), "Codex")
    paused, spoken, fail_pause = [], [], []

    async def fake_pause(creds, sid, on):
        if fail_pause:
            raise twilio_api.TwilioError("Twilio 500")
        paused.append(on)

    async def fake_speech(creds, voice, text):
        spoken.append(text)
        return b"\0\0" * 800, 8000  # 0.1 s

    monkeypatch.setattr(twilio_api, "pause_recording", fake_pause, raising=False)
    monkeypatch.setattr(vault, "speech", fake_speech)
    monkeypatch.setattr(config, "SECRET_QUIET_SECONDS", 0)
    for k in ("DEEPGRAM_API_KEY", "OPENAI_API_KEY", "FISH_API_KEY"):
        monkeypatch.setenv(k, "test")

    async def go():
        from unittest.mock import MagicMock
        cid = (await calls.place_call(uid(), calls.PlaceCallInput(**CALL)))["id"]
        store.update_call(cid, status="in_progress", twilio_sid="CA1")
        ws = MagicMock()
        ws.headers = {}
        b = bot.CallBot(ws, "MZ1", "CA1", "prompt", keys.server(), voice="Hannah", call_id=cid)
        fed = []

        async def feed(pcm, rate):
            fed.append((len(pcm), rate))

        b.gate.feed = feed
        calls.LIVE[cid].bot = b

        async def wait_for_question():
            for _ in range(200):
                v = client.get(f"{API}/calls/{cid}", headers=me).json()
                if v["open_questions"]:
                    return v["open_questions"][0]
                await asyncio.sleep(0.01)
            raise AssertionError("no question")

        # 1. a saved secret that was not allowed for this call: the user is asked, and only the console can answer
        p = Params(label="ssn", how="say")
        task = asyncio.create_task(b._tool_give_secret(p))
        q = await wait_for_question()
        assert q["kind"] == "permission" and q["label"] == "SSN" and SSN not in json.dumps(q)
        by_agent = client.post(f"{API}/calls/{cid}/answer", json={"question_id": q["id"], "answer": "yes"},
                               headers={"Authorization": f"Bearer {agent}"})
        assert by_agent.status_code == 403
        assert client.post(f"{API}/calls/{cid}/secret", json={"question_id": q["id"], "allow": True},
                           headers={"Authorization": f"Bearer {agent}"}).status_code == 403
        assert client.post(f"{API}/calls/{cid}/secret", json={"question_id": q["id"], "allow": True}, headers=me).status_code == 200
        await asyncio.wait_for(task, 2)
        await asyncio.sleep(0.05)
        assert spoken == ["1 2 3, 4 5, 6 7 8 9."] and fed == [(1600, 8000)]
        assert paused == [True, False]  # the recording paused while it was said, then went on
        fail_pause.append(1)  # the recording cannot be paused: the secret is not said
        p_fail = Params(label="SSN", how="say")
        await asyncio.wait_for(b._tool_give_secret(p_fail), 2)
        assert len(spoken) == 2 and len(fed) == 1 and "could not be given safely" in p_fail.results[0][0]
        fail_pause.clear()
        b._close_gates(True)  # the owner takes the call while a secret is being prepared: nothing is fed
        p_owner = Params(label="SSN", how="say")
        t = asyncio.create_task(b._tool_give_secret(p_owner))
        await asyncio.sleep(0.05)
        b._close_gates(False)
        await asyncio.wait_for(t, 2)
        fed.clear(); spoken.clear(); paused.clear()
        assert SSN not in p.results[0][0] and "[SSN]" in p.results[0][0]  # the model learns it was said, never what
        assert calls.masks(cid) == {"SSN": SSN}
        # a read-back reaches the transcript masked
        await b._line("them", "Okay, I have one two three, four five, six seven eight nine.")
        assert store.lines(cid)[-1]["text"] == "Okay, I have [SSN]."

        # 2. a second time on the same call: already allowed, no question
        p2 = Params(label="SSN", how="say")
        await asyncio.wait_for(b._tool_give_secret(p2), 2)
        assert len(spoken) == 1 and len(store.questions(cid)) == 1

        # 3. a detail that is not saved: the user types it for this call; a refusal gives nothing
        p3 = Params(label="Account PIN", how="say")
        task = asyncio.create_task(b._tool_give_secret(p3))
        q = await wait_for_question()
        assert q["kind"] == "secret" and q["label"] == "Account PIN"
        assert client.post(f"{API}/calls/{cid}/secret", json={"question_id": q["id"], "allow": True, "value": "77 41 05"},
                           headers=me).status_code == 200
        await asyncio.wait_for(task, 2)
        assert spoken[-1] == "7 7, 4 1, 0 5."
        p4 = Params(label="Card number", how="say")
        task = asyncio.create_task(b._tool_give_secret(p4))
        q = await wait_for_question()
        client.post(f"{API}/calls/{cid}/secret", json={"question_id": q["id"], "allow": False}, headers=me)
        await asyncio.wait_for(task, 2)
        assert "was not given" in p4.results[0][0] and len(spoken) == 2

        # nothing that is stored, shown to an agent, or sent to the model holds a value
        stored = everything_stored().replace(store.saved_secrets(uid())[0]["secret"], "")
        seen = client.get(f"{API}/calls/{cid}", headers={"Authorization": f"Bearer {agent}"}).text
        context = json.dumps(b.context.get_messages(), default=str)
        for value in (SSN, "123456789", "77 41 05", "774105"):
            assert value not in stored and value not in seen and value not in context, value
        assert [a["answer"] for a in client.get(f"{API}/calls/{cid}", headers=me).json()["answered_questions"]] == [
            "allowed", "given for this call (not stored)", "not allowed"]
    run(go())


def test_keying_a_secret_uses_the_keypad_path(monkeypatch, fresh):
    vault.save(uid(), "PIN", "48-21")
    for k in ("DEEPGRAM_API_KEY", "OPENAI_API_KEY", "FISH_API_KEY"):
        monkeypatch.setenv(k, "test")

    async def go():
        from unittest.mock import MagicMock
        cid = (await calls.place_call(uid(), calls.PlaceCallInput(**CALL), allow_secrets=["PIN"]))["id"]
        store.update_call(cid, status="in_progress", twilio_sid="CA1")
        ws = MagicMock()
        ws.headers = {}
        b = bot.CallBot(ws, "MZ1", "CA1", "prompt", keys.server(), voice="Hannah", call_id=cid)
        calls.LIVE[cid].bot = b
        p = Params(label="PIN", how="keypad")
        await b._tool_give_secret(p)
        sid, kw = fresh.updated[-1]
        assert '<Play digits="4821"/>' in kw["twiml"] and b.moved
        events = [l["text"] for l in store.lines(cid) if l["who"] == "event"]
        assert "keyed in PIN" in events and not any("4821" in e for e in events)
    run(go())
