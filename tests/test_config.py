import pytest

from callenvoy import config


def test_voices():
    fish, openai = config.voices("fish"), config.voices("openai")
    assert len(fish) == 10 and len(openai) == 6 and len(config.VOICES) == 16
    names = [v["name"] for v in config.VOICES]
    assert len(set(names)) == 16  # one setting holds either kind, so no name may repeat
    assert config.DEFAULT_VOICE in names
    indian = [v for v in fish if v["accent"] == "Indian English"]
    assert sorted(v["gender"] for v in indian) == ["female", "male", "male"]
    assert all(len(v["reference_id"]) == 32 for v in fish)
    # a voice the call's provider does not have falls back to that provider's default
    assert config.voice("Rohan", "fish")["name"] == "Rohan" and config.voice("Rohan", "openai")["name"] == "Marin"
    assert config.voice("Cedar", "openai")["reference_id"] == "cedar" and config.voice("Cedar", "fish")["name"] == "Hannah"
    assert config.voice(None, "openai")["name"] == "Marin"


def test_voice_samples():
    files = list(config.VOICES_DIR.glob("*.mp3"))
    if not files:
        pytest.skip("voice samples not made yet: uv run python -m callenvoy.make_voice_samples")
    for v in config.VOICES:
        assert (config.VOICES_DIR / f"{v['name'].lower()}.mp3").is_file(), v["name"]
