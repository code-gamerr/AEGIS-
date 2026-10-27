# AEGIS

Adaptive Enforcement Grid for Infrastructure Security.

Local-first control plane at the intersection of **AI/ML**, **infrastructure**, and **cyber defense**. Isolation Forest scores cloud/K8s-shaped telemetry. A tabular Q-learning Blue policy proposes `monitor`, `decoy`, `isolate`, `restore`, or `contain`. High-impact actions stay human-gated. The red/blue gym uses **abstract labels only** — no exploit payloads.

## Why this exists

CNAPP and AI-SOC products (Wiz, XSIAM, Securffity Copilot) detect and copilot. Research gyms (CybORG / CAGE) train RL defenders but do not ship as an operator console. AEGIS is the missing local loop: detect → recommend → approve → audit, with a kill switch.

Longer research note (what we built, why now, which past incidents the loop is answering): [docs/AEGIS-RESEARCH-BRIEF.md](docs/AEGIS-RESEARCH-BRIEF.md).

## Stack

- API: FastAPI, SQLite, scikit-learn Isolation Forest, tabular Q-learning
- Console: React 19, Vite, Tailwind v4
- Run: two processes, or `docker compose up`

## Demo logins

| user | password | role |
|---|---|---|
| admin | aegis-admin | train policy, governance |
| operator | aegis-ops | ingest, respond, range |
| analyst | aegis-view | read only |

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r backend\requirements.txt
.\.venv\Scripts\python -m pytest backend\tests
cd backend
$env:PYTHONPATH = "."
..\..\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Docker

```powershell
docker compose up --build
```

Console on http://localhost:8080 — API on http://localhost:8000/api/health

Compose sets `AEGIS_BOOTSTRAP_EPISODES` to `0` (API default is 80) so the healthcheck is not blocked by RL train; operators train or import a policy.

## Safety

- Red actions in the gym: `recon`, `attempt_access`, `pivot`, `persist`, `degrade`
- `isolate` / `restore` / `contain` require an operator unless autonomy **and** auto-isolate are on
- Kill switch freezes high-impact actions
- Audit log on every mutation; retention purge is explicit

## Agent runs

Specialist traces live in [docs/agents/](docs/agents/).
