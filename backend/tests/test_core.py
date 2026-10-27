from app.gym import NetworkGym, train_policy
from app.ml import QPolicy, event_vector, rule_hits
from app.sim import attack_event, benign_event


def test_feature_vector_length():
    v = event_vector(benign_event())
    assert len(v) == 10


def test_rule_hits_on_bruteforce():
    hits = rule_hits({"failed_auth": 6, "east_west": 0, "dest_ops": 0})
    assert hits and hits[0][0] == "T1110"


def test_rule_hits_unusual_proc():
    hits = rule_hits({"unusual_proc": 1})
    assert hits and hits[0][0] == "T1059"
    assert hits[0][1] == "Unusual process"


def test_rule_hits_conn_burst():
    hits = rule_hits({"conn_burst": 6})
    assert hits and hits[0][0] == "T1046"
    assert hits[0][1] == "Conn burst recon"


def test_rule_hits_high_entropy_dns():
    hits = rule_hits({"dns_entropy": 4.3, "bytes_out": 1000})
    assert hits and hits[0][0] == "T1071"
    assert hits[0][1] == "High-entropy DNS"


def test_gym_terminates():
    gym = NetworkGym()
    for _ in range(40):
        gym.step("monitor")
        if gym.state.done:
            break
    assert gym.state.done
    assert gym.state.outcome in {"impact", "contained", "timeout"}


def test_restore_clears_foothold():
    gym = NetworkGym()
    gym.state.red_pos = "ws-1"
    gym.state.hosts["ws-1"].compromised = True
    gym.blue_step("restore")
    assert gym.state.hosts["ws-1"].compromised is False
    assert gym.state.red_pos is None


def test_q_policy_learns():
    policy = QPolicy()
    policy.path = policy.path.with_name("q_test.json")
    stats = train_policy(policy, episodes=40)
    assert stats["episodes"] == 40
    assert "curve" in stats
    assert policy.q
