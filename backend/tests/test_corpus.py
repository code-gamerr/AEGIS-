from app.corpus import SAMPLE_NSL, campaign_events, map_nslkdd_row, score_detector
from app.gym import NetworkGym, eval_policy, greedy_blue
from app.ml import AnomalyDetector, QPolicy
from app.sim import attack_event, benign_event


def test_nslkdd_maps_ten_features():
    row = map_nslkdd_row(SAMPLE_NSL.split(","))
    assert row is not None
    assert row["labeled_attack"] is False
    assert row["nsl_label"] == "normal"
    assert row["bytes_out"] == 491
    assert row["source"] == "nsl-kdd"


def test_campaigns_are_labeled_abstract():
    rows = campaign_events(4)
    attacks = [r for r in rows if r.get("labeled_attack")]
    assert attacks
    assert all("campaign_id" in r for r in attacks)
    assert all(r.get("mitre") for r in attacks)


def test_bline_can_impact():
    gym = NetworkGym(red="bline")
    for _ in range(40):
        gym.step("monitor")
        if gym.state.done:
            break
    assert gym.state.done
    assert gym.state.outcome in {"impact", "contained", "timeout"}


def test_sleep_rarely_impacts():
    import random

    random.seed(3)
    hits = 0
    for _ in range(8):
        gym = NetworkGym(red="sleep")
        for _ in range(32):
            gym.step("monitor")
            if gym.state.done:
                break
        if gym.state.outcome == "impact":
            hits += 1
    assert hits <= 3


def test_eval_random_returns_rates():
    stats = eval_policy(None, episodes=6, red="meander", seed=153, actor="random")
    assert stats["episodes"] == 6
    assert 0 <= stats["contained_rate"] <= 1
    assert stats["actor"] == "random"


def test_greedy_prefers_isolate_on_high_sev():
    assert greedy_blue({"last_sev": 3, "compromised": 1, "red_progress": 1, "decoy": False}) == "isolate"


def test_detector_scores_holdout_shape():
    det = AnomalyDetector()
    rows = [benign_event() for _ in range(40)] + [attack_event() for _ in range(12)]
    det.fit(rows)
    m = score_detector(det, rows, 0.62)
    assert m["n"] == 52
    assert "precision" in m and "recall" in m


def test_fresh_policy_eval():
    p = QPolicy()
    p.replace({}, 0.2, persist=False)
    stats = eval_policy(p, episodes=4, actor="q", red="sleep", seed=1)
    assert stats["episodes"] == 4
