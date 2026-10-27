#!/usr/bin/env bash
set -euo pipefail
PROJECT="${GOOGLE_CLOUD_PROJECT:?set GOOGLE_CLOUD_PROJECT}"
REGION="${AEGIS_GCP_REGION:-us-central1}"
BUCKET="${AEGIS_GCS_BUCKET:?set AEGIS_GCS_BUCKET}"
EPISODES="${AEGIS_EPISODES:-400}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/aegis/trainer:latest"
URI="gs://${BUCKET}/aegis/policy"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
JOB="$(mktemp)"

gcloud config set project "$PROJECT"
gcloud artifacts repositories describe aegis --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create aegis --repository-format=docker --location="$REGION"
gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${BUCKET}" --location="$REGION"

cd "$ROOT"
gcloud builds submit --config train/gcp/cloudbuild.yaml --substitutions=_REGION="$REGION"

cat > "$JOB" <<EOF
workerPoolSpecs:
  - machineSpec:
      machineType: n1-standard-4
    replicaCount: 1
    containerSpec:
      imageUri: ${IMAGE}
      args: ["--episodes", "${EPISODES}"]
      env:
        - name: AEGIS_PLATFORM
          value: gcp
        - name: AEGIS_EPISODES
          value: "${EPISODES}"
        - name: AEGIS_GCS_URI
          value: ${URI}
        - name: AIP_MODEL_DIR
          value: ${URI}
        - name: AEGIS_DATA
          value: /tmp/aegis-out
EOF

gcloud ai custom-jobs create \
  --region="$REGION" \
  --display-name="aegis-rl-$(date +%Y%m%d-%H%M%S)" \
  --config="$JOB"

echo "Job submitted. Artifacts -> ${URI}"
echo "Pull locally: AEGIS_GCS_URI=${URI} python -m app.train_job --pull"
