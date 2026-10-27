param(
  [string]$Project = $env:GOOGLE_CLOUD_PROJECT,
  [string]$Region = $(if ($env:AEGIS_GCP_REGION) { $env:AEGIS_GCP_REGION } else { "us-central1" }),
  [string]$Bucket = $env:AEGIS_GCS_BUCKET,
  [int]$Episodes = 400
)

if (-not $Project) { throw "Set GOOGLE_CLOUD_PROJECT or pass -Project" }
if (-not $Bucket) { throw "Set AEGIS_GCS_BUCKET or pass -Bucket" }

$Image = "$Region-docker.pkg.dev/$Project/aegis/trainer:latest"
$Uri = "gs://$Bucket/aegis/policy"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$JobFile = Join-Path $env:TEMP "aegis-vertex-job.yaml"

gcloud config set project $Project
gcloud artifacts repositories describe aegis --location=$Region 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud artifacts repositories create aegis --repository-format=docker --location=$Region --description="AEGIS trainers"
}
gcloud storage buckets describe "gs://$Bucket" 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud storage buckets create "gs://$Bucket" --location=$Region
}

Set-Location $Root
gcloud builds submit --config train/gcp/cloudbuild.yaml --substitutions=_REGION=$Region

@"
workerPoolSpecs:
  - machineSpec:
      machineType: n1-standard-4
    replicaCount: 1
    containerSpec:
      imageUri: $Image
      args: ["--episodes", "$Episodes"]
      env:
        - name: AEGIS_PLATFORM
          value: gcp
        - name: AEGIS_EPISODES
          value: "$Episodes"
        - name: AEGIS_GCS_URI
          value: $Uri
        - name: AIP_MODEL_DIR
          value: $Uri
        - name: AEGIS_DATA
          value: /tmp/aegis-out
"@ | Set-Content -Encoding ascii $JobFile

gcloud ai custom-jobs create --region=$Region --display-name="aegis-rl-$(Get-Date -Format yyyyMMdd-HHmmss)" --config=$JobFile
Write-Host "Job submitted. Artifacts -> $Uri"
Write-Host "Pull locally: `$env:AEGIS_GCS_URI='$Uri'; python -m app.train_job --pull"
