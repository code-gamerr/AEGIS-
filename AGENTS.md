# AEGIS

Local-first closed-loop RL control plane for infrastructure defense.
Operators watch cloud/K8s-shaped telemetry, score anomalies, and let a
constrained Blue policy recommend isolate / restore / decoy / monitor.
High-impact actions stay human-gated. Red activity in the gym is abstract
state transitions, never exploit payloads.

## Conventions

- Language/framework: Python 3.12 FastAPI + React 19 / Vite / Tailwind v4
- Test command: `python -m pytest backend/tests`
- Lint command: none required for MVP
- Source code lives in: `backend/app`, `frontend/src`
- Tests live in: `backend/tests`
- Other important paths: `docker-compose.yml`, `data/`

## Notes for agents

- Do not add exploit PoCs, malware, or attack reproduction steps.
- Gym Red actions are labels (`recon`, `attempt_access`, `pivot`, `persist`, `degrade`).
- Isolation Forest detects; tabular Q-learning only proposes Blue actions.
- `isolate` and `restore` require an operator unless autonomy is on *and* the
  action is below the blast-radius gate.
- Audit every mutation. Retention and PII tags live in `governance_settings`.
- Remote training: `python -m app.train_job` on Kaggle (`train/kaggle`) or Vertex (`train/gcp`). Import `q_policy.json` via `/api/policy/import` or pull `gs://` via `/api/policy/pull`.
