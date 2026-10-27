"""Train Isolation Forest + Blue Q-policy on local, Kaggle, or GCP (Vertex)."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from app.corpus import build_corpus, score_detector
from app.gym import eval_policy, train_policy
from app.ml import AnomalyDetector, QPolicy
from app.paths import data_dir, detect_platform, gcs_uri

REDS = ["meander", "bline", "sleep"]
ACTORS = ["random", "greedy", "q"]
MYTHOS = {
    "model": "Claude Mythos Preview (Anthropic, restricted)",
    "domain": "frontier LLM (coding, science, agents) — not cyber-defence RL",
    "source": "https://hugobowne.github.io/mythos-preview-model-card/sources/06-capabilities",
    "scores": {
        "SWE-bench Verified": 93.9,
        "SWE-bench Pro": 77.8,
        "Terminal-Bench 2.0": 82.0,
        "GPQA Diamond": 94.5,
        "HLE (no tools)": 56.8,
        "HLE (with tools)": 64.7,
        "OSWorld": 79.6,
    },
    "cage2_sota_total": -54.57,
    "cage2_sota_team": "CardiffUni PPO + Greedy Decoys",
}


def push_gcs(local: Path, uri: str) -> str:
    try:
        from google.cloud import storage  # type: ignore

        rest = uri[5:]
        bucket_name, _, prefix = rest.partition("/")
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        for f in local.iterdir():
            if f.is_file():
                name = f"{prefix}/{f.name}" if prefix else f.name
                bucket.blob(name).upload_from_filename(str(f))
        return f"uploaded:{uri}"
    except Exception as exc:
        gsutil = subprocess.run(
            ["gsutil", "-m", "cp", "-r", str(local / "*"), f"{uri}/"],
            capture_output=True,
            text=True,
        )
        if gsutil.returncode == 0:
            return f"gsutil:{uri}"
        return f"upload-skipped:{exc}"


def pull_gcs(uri: str, local: Path) -> None:
    local.mkdir(parents=True, exist_ok=True)
    try:
        from google.cloud import storage  # type: ignore

        rest = uri[5:]
        bucket_name, _, prefix = rest.partition("/")
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blobs = client.list_blobs(bucket_name, prefix=prefix)
        for blob in blobs:
            name = Path(blob.name).name
            if name:
                blob.download_to_filename(str(local / name))
        return
    except Exception:
        subprocess.run(["gsutil", "-m", "cp", "-r", f"{uri}/*", str(local)], check=False)


def _esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _svg_line(path: Path, ys: list[float], title: str, ylabel: str) -> None:
    w, h, pad = 760, 280, 48
    if not ys:
        return
    lo, hi = min(ys), max(ys)
    span = (hi - lo) or 1.0
    pts = []
    inner_w, inner_h = w - 2 * pad, h - 2 * pad
    for i, y in enumerate(ys):
        x = pad + inner_w * i / max(len(ys) - 1, 1)
        py = pad + inner_h * (1 - (y - lo) / span)
        pts.append(f"{x:.1f},{py:.1f}")
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
        f'<rect width="{w}" height="{h}" fill="#0f1419"/>'
        f'<text x="{pad}" y="22" fill="#d7e0ea" font-size="14">{_esc(title)}</text>'
        f'<text x="8" y="{h/2}" fill="#8b9aab" font-size="11" transform="rotate(-90 12 {h/2})">{_esc(ylabel)}</text>'
        f'<polyline fill="none" stroke="#6ee7b7" stroke-width="2" points="{" ".join(pts)}"/>'
        f'<text x="{pad}" y="{h-12}" fill="#8b9aab" font-size="11">min {lo:.1f} · max {hi:.1f} · n={len(ys)}</text>'
        f"</svg>",
        encoding="utf-8",
    )


def _svg_grouped_bars(path: Path, labels: list[str], series: dict[str, list[float]], title: str) -> None:
    w, h, pad = 760, 300, 50
    colors = ["#94a3b8", "#fbbf24", "#6ee7b7"]
    n_g, n_s = len(labels), max(len(series), 1)
    inner_w, inner_h = w - 2 * pad, h - 2 * pad - 20
    max_v = max((v for vals in series.values() for v in vals), default=1) or 1
    gw = inner_w / max(n_g, 1)
    bw = gw / (n_s + 1.5)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
        f'<rect width="{w}" height="{h}" fill="#0f1419"/>',
        f'<text x="{pad}" y="22" fill="#d7e0ea" font-size="14">{_esc(title)}</text>',
    ]
    for gi, lab in enumerate(labels):
        gx = pad + gi * gw
        for si, (name, vals) in enumerate(series.items()):
            v = vals[gi] if gi < len(vals) else 0
            bh = inner_h * (v / max_v)
            x = gx + bw * (si + 0.4)
            y = pad + 8 + inner_h - bh
            parts.append(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{bh:.1f}" fill="{colors[si % 3]}"/>'
            )
        parts.append(
            f'<text x="{gx + gw/2:.1f}" y="{h-18}" fill="#8b9aab" font-size="11" text-anchor="middle">{_esc(lab)}</text>'
        )
    lx = pad
    for si, name in enumerate(series):
        parts.append(f'<rect x="{lx}" y="{h-8}" width="8" height="8" fill="{colors[si % 3]}"/>')
        parts.append(f'<text x="{lx+12}" y="{h-1}" fill="#8b9aab" font-size="10">{_esc(name)}</text>')
        lx += 90
    parts.append("</svg>")
    path.write_text("".join(parts), encoding="utf-8")


def _moving_avg(xs: list[float], win: int) -> list[float]:
    out, acc = [], 0.0
    for i, x in enumerate(xs):
        acc += x
        if i >= win:
            acc -= xs[i - win]
        out.append(acc / min(i + 1, win))
    return out


def run(episodes: int) -> dict:
    platform = detect_platform()
    out = data_dir()
    corpus = build_corpus(allow_download=os.environ.get("AEGIS_OFFLINE") != "1")
    detector = AnomalyDetector()
    detector.fit(corpus["fit_rows"])
    detector.save(out / "iforest.joblib")
    sweep_ts = [0.40, 0.50, 0.62] if episodes < 50 else [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.62]
    sweep = {f"{t:.2f}": score_detector(detector, corpus["holdout"], t) for t in sweep_ts}
    det = {
        "corpus": {k: corpus[k] for k in ("sources", "n_fit", "n_holdout", "n_public", "n_synthetic", "n_attack_fit")},
        "holdout_0.62": sweep["0.62"],
        "holdout_0.50": sweep["0.50"],
        "holdout_0.40": sweep["0.40"],
        "sweep": sweep,
    }

    policy = QPolicy()
    policy.path = out / "q_policy.json"
    policy.replace({}, 0.25, persist=False)
    stats = train_policy(policy, episodes=episodes, reds=REDS)
    rewards = stats.pop("rewards", stats.get("curve") or [])

    eval_eps = 12 if episodes < 50 else (60 if episodes < 400 else 200)
    holdout = {}
    for actor in ACTORS:
        for red in REDS:
            holdout[f"{actor}/{red}"] = eval_policy(
                policy, episodes=eval_eps, red=red, seed=153, actor=actor
            )

    q_meander = holdout["q/meander"]["contained_rate"]
    _svg_line(
        out / "reward_curve.svg",
        _moving_avg(rewards, max(20, episodes // 50)) if rewards else stats["curve"],
        "Blue Q-learning reward (moving average)",
        "episode return",
    )
    _svg_grouped_bars(
        out / "eval_contained.svg",
        REDS,
        {
            actor: [holdout[f"{actor}/{red}"]["contained_rate"] * 100 for red in REDS]
            for actor in ACTORS
        },
        "Hold-out contained rate (%) vs Red strategy (seed=153)",
    )
    _svg_grouped_bars(
        out / "eval_reward.svg",
        REDS,
        {
            actor: [holdout[f"{actor}/{red}"]["avg_reward"] for red in REDS]
            for actor in ACTORS
        },
        "Hold-out mean return vs Red strategy (seed=153)",
    )
    _svg_line(
        out / "detector_recall.svg",
        [sweep[f"{t:.2f}"]["recall"] for t in sweep_ts],
        "Isolation Forest recall on NSL-KDD holdout vs score threshold",
        "recall",
    )

    metrics = {
        "platform": platform,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "artifact_dir": str(out),
        **stats,
        "detector": det,
        "holdout": holdout,
        "holdout_contained_q_meander": q_meander,
        "promoted": q_meander >= 0.40 or episodes < 80,
        "parameter_count": stats.get("q_parameters", 0),
        "state_space": 480,
        "mythos": MYTHOS,
        "comparable_to_mythos": False,
        "why_not_100m": (
            "Blue obs is 480 discrete cells. Tabular Q is exact for that MDP. "
            "A 100M-param net cannot compete with Mythos (frontier LLM on SWE-bench/GPQA) "
            "and is the wrong capacity for this gym. CAGE-2 is the relevant leaderboard."
        ),
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    uri = gcs_uri()
    metrics["gcs"] = push_gcs(out, uri) if uri else None
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                k: metrics[k]
                for k in (
                    "platform",
                    "episodes",
                    "avg_reward",
                    "tail_reward",
                    "holdout_contained_q_meander",
                    "parameter_count",
                    "gcs",
                )
            },
            indent=2,
        )
    )
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="AEGIS remote/local trainer")
    parser.add_argument("--episodes", type=int, default=None)
    parser.add_argument("--pull", action="store_true", help="Download artifacts from AEGIS_GCS_URI / AIP_MODEL_DIR")
    args = parser.parse_args()
    if args.pull:
        uri = gcs_uri()
        if not uri:
            raise SystemExit("Set AEGIS_GCS_URI or AIP_MODEL_DIR (gs://...) to pull")
        pull_gcs(uri, data_dir())
        print(f"pulled {uri} -> {data_dir()}")
        return
    default_eps = "4000" if detect_platform() != "local" else "80"
    episodes = args.episodes if args.episodes is not None else int(os.environ.get("AEGIS_EPISODES", default_eps))
    run(episodes)


if __name__ == "__main__":
    main()
