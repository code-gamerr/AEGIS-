from fastapi.testclient import TestClient

from app.main import app


def test_health_and_login_and_command():
    with TestClient(app) as client:
        h = client.get("/api/health")
        assert h.status_code == 200
        assert h.json()["ok"] is True
        bad = client.post("/api/auth/login", json={"username": "admin", "password": "nope"})
        assert bad.status_code == 401
        ok = client.post("/api/auth/login", json={"username": "admin", "password": "aegis-admin"})
        assert ok.status_code == 200
        token = ok.json()["token"]
        cmd = client.get("/api/command", headers={"Authorization": f"Bearer {token}"})
        assert cmd.status_code == 200
        body = cmd.json()
        assert body["kpis"]["assets"] == 12
        assert "policy_source" in body["kpis"]
        assert "events" in body
        det = client.get("/api/detections", headers={"Authorization": f"Bearer {token}"})
        assert det.status_code == 200
        gov = client.get("/api/governance", headers={"Authorization": f"Bearer {token}"})
        assert gov.status_code == 200


def test_admin_can_import_policy():
    with TestClient(app) as client:
        token = client.post("/api/auth/login", json={"username": "admin", "password": "aegis-admin"}).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        body = {"q": {"1,0,0,0,0": [0.1, 0.2, 0.0, 0.4, -0.1]}, "epsilon": 0.05, "platform": "kaggle", "notes": "test"}
        r = client.post("/api/policy/import", headers=headers, json=body)
        assert r.status_code == 200
        exported = client.get("/api/policy/export", headers=headers).json()
        assert "1,0,0,0,0" in exported["q"]


def test_analyst_cannot_isolate():
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"username": "analyst", "password": "aegis-view"})
        token = login.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        incs = client.get("/api/incidents", headers=headers).json()
        if not incs:
            return
        r = client.post(f"/api/incidents/{incs[0]['id']}/act", headers=headers, json={"action": "isolate"})
        assert r.status_code == 403


def test_unknown_action_rejected():
    with TestClient(app) as client:
        token = client.post("/api/auth/login", json={"username": "admin", "password": "aegis-admin"}).json()["token"]
        r = client.post(
            "/api/incidents/1/act",
            headers={"Authorization": f"Bearer {token}"},
            json={"action": "explode"},
        )
        assert r.status_code == 400


def test_policy_import_rejects_invalid_epsilon():
    with TestClient(app) as client:
        token = client.post("/api/auth/login", json={"username": "admin", "password": "aegis-admin"}).json()["token"]
        body = {"q": {"1,0,0,0,0": [0.1, 0.2, 0.0, 0.4, -0.1]}, "epsilon": 2, "platform": "kaggle", "notes": "bad"}
        r = client.post("/api/policy/import", headers={"Authorization": f"Bearer {token}"}, json=body)
        assert r.status_code == 422
