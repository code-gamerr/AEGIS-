from __future__ import annotations

import random
from collections import deque
from dataclasses import dataclass, field

from app.ml import BLUE_ACTIONS, QPolicy, discretize

# Abstract attacker labels only. No payloads, no exploit steps.
RED_ACTIONS = ["recon", "attempt_access", "pivot", "persist", "degrade"]
SUBNETS = {
    "user": ["ws-1", "ws-2", "ws-3", "vpn-gw"],
    "ent": ["app-api", "id-svc", "ci-runner", "db-core"],
    "ops": ["k8s-api", "pay-proc", "tel-bus", "vault"],
}
EDGES = {
    "ws-1": ["vpn-gw", "ws-2"],
    "ws-2": ["ws-1", "ws-3", "vpn-gw"],
    "ws-3": ["ws-2", "vpn-gw"],
    "vpn-gw": ["ws-1", "ws-2", "ws-3", "app-api", "id-svc"],
    "app-api": ["vpn-gw", "db-core", "id-svc", "ci-runner"],
    "id-svc": ["vpn-gw", "app-api", "k8s-api"],
    "ci-runner": ["app-api", "k8s-api"],
    "db-core": ["app-api", "vault"],
    "k8s-api": ["id-svc", "ci-runner", "tel-bus", "pay-proc"],
    "pay-proc": ["k8s-api", "vault"],
    "tel-bus": ["k8s-api"],
    "vault": ["db-core", "pay-proc"],
}
CRITICAL = {"k8s-api", "pay-proc", "vault", "db-core"}


def subnet_of(node: str) -> str:
    for name, nodes in SUBNETS.items():
        if node in nodes:
            return name
    return "user"


@dataclass
class Host:
    compromised: bool = False
    isolated: bool = False
    decoy: bool = False
    up: bool = True
    scanned: bool = False
    persisted: bool = False


@dataclass
class GymState:
    hosts: dict[str, Host] = field(default_factory=dict)
    red_pos: str | None = None
    red_progress: int = 0
    step: int = 0
    last_sev: int = 0
    done: bool = False
    outcome: str = "ongoing"
    log: list[dict] = field(default_factory=list)

    def snapshot(self) -> dict:
        compromised = [k for k, h in self.hosts.items() if h.compromised]
        isolated = [k for k, h in self.hosts.items() if h.isolated]
        decoys = [k for k, h in self.hosts.items() if h.decoy]
        down = [k for k, h in self.hosts.items() if not h.up]
        return {
            "step": self.step,
            "red_pos": self.red_pos,  # operator dashboard only – never expose to Blue policy (POMDP boundary)
            "red_progress": self.red_progress,
            "compromised": compromised,
            "isolated": isolated,
            "decoy": decoys,
            "down": down,
            "done": self.done,
            "outcome": self.outcome,
            "last_sev": self.last_sev,
            "obs": self.obs(),
            "log": self.log[-12:],
        }

    def obs(self) -> dict:
        return {
            "red_progress": self.red_progress,
            "compromised": sum(1 for h in self.hosts.values() if h.compromised),
            "isolated": sum(1 for h in self.hosts.values() if h.isolated),
            "last_sev": self.last_sev,
            "decoy": any(h.decoy for h in self.hosts.values()),
        }


class NetworkGym:
    def __init__(self, red: str = "meander") -> None:
        self.red = red if red in {"meander", "bline", "sleep"} else "meander"
        self.state = self.reset()

    def reset(self) -> GymState:
        hosts = {n: Host() for nodes in SUBNETS.values() for n in nodes}
        self.state = GymState(hosts=hosts)
        return self.state

    def _next_toward_ops(self, pos: str) -> str:
        blocked = {n for n, h in self.state.hosts.items() if h.isolated}
        goals = [n for n in CRITICAL if n not in blocked] or list(CRITICAL)
        q: deque[str] = deque([pos])
        parent: dict[str, str | None] = {pos: None}
        found: str | None = None
        while q:
            cur = q.popleft()
            if cur in goals and cur != pos:
                found = cur
                break
            for n in EDGES.get(cur, []):
                if n in parent or n in blocked:
                    continue
                parent[n] = cur
                q.append(n)
        if found is None:
            nbrs = [n for n in EDGES.get(pos, []) if n not in blocked]
            return random.choice(nbrs or [pos])
        cur = found
        while parent[cur] is not None and parent[cur] != pos:
            cur = parent[cur]  # type: ignore[assignment]
        return cur

    def _log(self, actor: str, action: str, target: str, note: str) -> None:
        self.state.log.append({"actor": actor, "action": action, "target": target, "note": note})

    def red_step(self) -> str:
        if self.red == "sleep" and random.random() < 0.88:
            self._log("red", "recon", self.state.red_pos or "none", "Sleep / idle turn.")
            return "recon"
        s = self.state
        pos = s.red_pos
        if pos is None:
            target = "vpn-gw" if self.red == "bline" else random.choice(SUBNETS["user"])
            s.hosts[target].scanned = True
            s.red_pos = target
            s.last_sev = 1
            self._log("red", "recon", target, "Abstract recon on a user-subnet host.")
            return "recon"
        host = s.hosts[pos]
        if host.isolated:
            s.red_pos = None
            self._log("red", "blocked", pos, "Path cut; red lost the foothold.")
            return "blocked"
        if host.decoy and not host.compromised:
            s.last_sev = 1
            self._log("red", "recon", pos, "Red spent a turn on a decoy.")
            return "recon"
        if not host.compromised:
            if random.random() < 0.55:
                host.compromised = True
                s.red_progress = max(s.red_progress, 1)
                s.last_sev = 2
                self._log("red", "attempt_access", pos, "Abstract access attempt succeeded.")
                return "attempt_access"
            host.scanned = True
            self._log("red", "attempt_access", pos, "Abstract access attempt failed.")
            return "attempt_access"
        if not host.persisted and random.random() < 0.4:
            host.persisted = True
            s.red_progress = max(s.red_progress, 3)
            self._log("red", "persist", pos, "Abstract persistence flag set.")
            return "persist"
        if self.red == "bline" and pos in CRITICAL and host.compromised:
            host.up = False
            s.red_progress = 4
            s.last_sev = 3
            s.done = True
            s.outcome = "impact"
            self._log("red", "degrade", pos, "Abstract service degradation in ops.")
            return "degrade"
        nbrs = [n for n in EDGES[pos] if not s.hosts[n].isolated]
        if self.red == "bline":
            choice = self._next_toward_ops(pos)
        else:
            ops = [n for n in nbrs if subnet_of(n) == "ops"]
            choice = random.choice(ops or nbrs or [pos])
        if subnet_of(choice) == "ops" and s.hosts[choice].compromised:
            s.hosts[choice].up = False
            s.red_progress = 4
            s.last_sev = 3
            s.done = True
            s.outcome = "impact"
            self._log("red", "degrade", choice, "Abstract service degradation in ops.")
            return "degrade"
        s.red_pos = choice
        s.hosts[choice].scanned = True
        if s.hosts[choice].compromised is False and random.random() < 0.5:
            s.hosts[choice].compromised = True
            s.red_progress = max(s.red_progress, 2)
            s.last_sev = 2
            self._log("red", "pivot", choice, "Abstract pivot to adjacent host.")
            return "pivot"
        self._log("red", "recon", choice, "Abstract recon after pivot.")
        return "recon"

    def blue_step(self, action: str) -> float:
        s = self.state
        reward = 0.2
        target = s.red_pos or "ws-1"
        if action == "monitor":
            s.last_sev = max(s.last_sev, 1 if s.hosts[target].compromised else 0)
            self._log("blue", "monitor", target, "Deep inspection, no blast radius.")
            reward += 0.4 if s.hosts[target].compromised else -0.05
        elif action == "decoy":
            s.hosts[target].decoy = True
            self._log("blue", "decoy", target, "Decoy service advertised.")
            reward += 0.6
        elif action == "isolate":
            s.hosts[target].isolated = True
            reward -= 0.8  # availability cost
            if s.hosts[target].compromised:
                reward += 3.5
                if target in CRITICAL:
                    reward += 2.0
            else:
                reward -= 2.2
            self._log("blue", "isolate", target, "Network isolation of the host.")
        elif action == "restore":
            h = s.hosts[target]
            was = h.compromised
            h.compromised = False
            h.persisted = False
            h.isolated = False
            h.up = True
            if s.red_pos == target:
                s.red_pos = None
                s.red_progress = max(0, s.red_progress - 1)
            reward += 4.0 if was else -1.5
            self._log("blue", "restore", target, "Host rebuilt from known-good image.")
        elif action == "contain":
            for name, h in s.hosts.items():
                if subnet_of(name) == subnet_of(target):
                    h.isolated = True
            reward -= 3.5
            if any(s.hosts[n].compromised for n in SUBNETS[subnet_of(target)]):
                reward += 2.0
            self._log("blue", "contain", target, "Subnet-wide contain (high blast radius).")

        n_comp = sum(1 for h in s.hosts.values() if h.compromised)
        n_iso = sum(1 for h in s.hosts.values() if h.isolated)
        n_down = sum(1 for h in s.hosts.values() if not h.up)
        reward -= 1.4 * n_comp
        reward -= 0.35 * n_iso
        reward -= 2.5 * n_down
        if any(s.hosts[n].compromised for n in SUBNETS["ops"]):
            reward -= 4.0
        if n_comp == 0 and n_down == 0:
            reward += 1.2
            if s.step > 6:
                s.done = True
                s.outcome = "contained"
        return reward

    def step(self, blue_action: str) -> dict:
        s = self.state
        if s.done:
            return s.snapshot()
        prev = discretize(s.obs())
        self.red_step()
        reward = self.blue_step(blue_action)
        s.step += 1
        if s.step >= 32 and not s.done:
            s.done = True
            s.outcome = "timeout"
        nxt = discretize(s.obs())
        snap = s.snapshot()
        snap["reward"] = round(reward, 3)
        snap["prev_state"] = prev
        snap["next_state"] = nxt
        snap["blue_action"] = blue_action
        return snap


def greedy_blue(obs: dict) -> str:
    if int(obs.get("last_sev") or 0) >= 3 or int(obs.get("compromised") or 0) >= 2:
        return "isolate"
    if int(obs.get("red_progress") or 0) >= 2:
        return "restore"
    if not obs.get("decoy") and int(obs.get("last_sev") or 0) >= 1:
        return "decoy"
    return "monitor"


def eval_policy(
    policy: QPolicy | None,
    episodes: int = 200,
    red: str = "meander",
    seed: int = 153,
    actor: str = "q",
) -> dict:
    saved = random.getstate()
    random.seed(seed)
    gym = NetworkGym(red=red)
    rewards: list[float] = []
    outcomes: dict[str, int] = {}
    for _ in range(episodes):
        gym.reset()
        total = 0.0
        while not gym.state.done:
            obs = gym.state.obs()
            if actor == "random":
                action = random.choice(BLUE_ACTIONS)
            elif actor == "greedy":
                action = greedy_blue(obs)
            else:
                action = policy.act(discretize(obs), greedy=True) if policy else "monitor"
            snap = gym.step(action)
            total += snap["reward"]
        rewards.append(total)
        outcomes[gym.state.outcome] = outcomes.get(gym.state.outcome, 0) + 1
    random.setstate(saved)
    n = max(episodes, 1)
    return {
        "actor": actor,
        "red": red,
        "episodes": episodes,
        "seed": seed,
        "avg_reward": round(sum(rewards) / n, 3),
        "contained_rate": round(outcomes.get("contained", 0) / n, 4),
        "impact_rate": round(outcomes.get("impact", 0) / n, 4),
        "timeout_rate": round(outcomes.get("timeout", 0) / n, 4),
        "outcomes": outcomes,
    }


def train_policy(policy: QPolicy, episodes: int = 250, reds: list[str] | None = None) -> dict:
    reds = reds or ["meander"]
    gym = NetworkGym()
    rewards = []
    outcomes: dict[str, int] = {}
    policy.epsilon = 0.25
    for ep in range(episodes):
        gym.red = reds[ep % len(reds)]
        gym.reset()
        total = 0.0
        while not gym.state.done:
            state = discretize(gym.state.obs())
            action = policy.act(state)
            snap = gym.step(action)
            policy.learn(state, action, snap["reward"], snap["next_state"], gym.state.done)
            total += snap["reward"]
        policy.epsilon = max(0.05, policy.epsilon * 0.995)
        rewards.append(total)
        outcomes[gym.state.outcome] = outcomes.get(gym.state.outcome, 0) + 1
    policy.save()
    avg = sum(rewards) / max(len(rewards), 1)
    tail = rewards[-40:] or rewards
    contained_rate = outcomes.get("contained", 0) / episodes
    return {
        "episodes": episodes,
        "avg_reward": round(avg, 3),
        "tail_reward": round(sum(tail) / len(tail), 3),
        "outcomes": outcomes,
        "contained_rate": contained_rate,
        "epsilon": round(policy.epsilon, 3),
        "curve": [round(r, 2) for r in rewards[:: max(1, episodes // 40)]],
        "rewards": [round(r, 3) for r in rewards],
        "reds": reds,
        "prefs": policy.action_prefs(),
        "q_parameters": len(policy.q) * len(BLUE_ACTIONS),
        "q_states": len(policy.q),
    }
