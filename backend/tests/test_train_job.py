from app.train_job import run


def test_train_job_writes_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("AEGIS_DATA", str(tmp_path))
    monkeypatch.setenv("AEGIS_PLATFORM", "local")
    monkeypatch.setenv("AEGIS_OFFLINE", "1")
    stats = run(8)
    assert stats["episodes"] == 8
    assert stats["platform"] == "local"
    assert "contained_rate" in stats
    assert "holdout" in stats
    assert stats["comparable_to_mythos"] is False
    assert (tmp_path / "q_policy.json").exists()
    assert (tmp_path / "metrics.json").exists()
    assert (tmp_path / "iforest.joblib").exists()
    assert (tmp_path / "reward_curve.svg").exists()
    assert (tmp_path / "eval_contained.svg").exists()
