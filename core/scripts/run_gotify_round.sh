#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

JUDGE_URL="${MODEL_COMBAT_JUDGE_URL:-http://127.0.0.1:8000}"
REQUESTED_BY="${MODEL_COMBAT_REQUESTED_BY:-local-script}"
ARTIFACT_ID="${MODEL_COMBAT_ARTIFACT_ID:-gotify-v1}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

need_cmd curl
need_cmd python3
need_cmd uv

json_get() {
  key_path="$1"
  python3 -c 'import json,sys
data=json.load(sys.stdin)
value=data
for part in sys.argv[1].split("."):
    if part.isdigit():
        value=value[int(part)]
    else:
        value=value[part]
print(value)
' "$key_path"
}

post_json() {
  endpoint="$1"
  body="$2"
  curl -fsS -X POST "${JUDGE_URL}${endpoint}" \
    -H 'Content-Type: application/json' \
    -d "$body"
}

echo "Running provider preflight..."
uv run python scripts/preflight_model_providers.py

echo "Creating round for artifact ${ARTIFACT_ID}..."
CREATE_RESPONSE="$(post_json "/admin/rounds" "{\"requested_by\":\"${REQUESTED_BY}\",\"artifact_ids\":[\"${ARTIFACT_ID}\"]}")"
echo "$CREATE_RESPONSE"

ROUND_ID="$(printf '%s' "$CREATE_RESPONSE" | json_get "round_id")"

echo
echo "Running match (provision, start, agents, finalize)..."
env -u ANTHROPIC_API_KEY curl -fsS -X POST \
  "${JUDGE_URL}/admin/rounds/${ROUND_ID}/run-match?left_provider=openai&right_provider=anthropic"

echo
echo "Final scoreboard:"
curl -fsS "${JUDGE_URL}/leaderboard?round_id=${ROUND_ID}"

echo
echo "Round ${ROUND_ID} finalized."
