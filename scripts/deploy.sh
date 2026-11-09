#!/usr/bin/env bash
# Deploy ClipGen.AI: checks first, then the API to Cloud Run and the front end to Firebase Hosting.
#
#   PROJECT_ID=my-project REGION=asia-southeast2 ./scripts/deploy.sh
#
# Requires the gcloud and firebase CLIs, and an authenticated session.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-project-5869a4b9-e007-42d4-b48}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-clipgen}"
# The master step (download, ffmpeg, upload) is the slow one, so the request timeout is generous.
TIMEOUT="${TIMEOUT:-600}"

cd "$(dirname "$0")/.."

echo "==> Checking the code"
npm run check

echo "==> Deploying the API to Cloud Run (${SERVICE} in ${REGION})"
gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  --cpu 2 \
  --memory 2Gi \
  --timeout "$TIMEOUT" \
  --max-instances 3 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"

echo "==> Deploying the front end and the Firestore rules"
firebase deploy --only firestore:rules,hosting --project "$PROJECT_ID"

echo "==> Done. Front end: $(firebase hosting:channel:list 2>/dev/null | head -n 1 || echo 'see the Firebase console')"
