#!/bin/sh
set -eu

BASE_URL="${MODEL_COMBAT_TARGET_URL:?MODEL_COMBAT_TARGET_URL is required}"
STATE_DIR="${MODEL_COMBAT_STATE_DIR:-$PWD/.model_combat}"
STATE_FILE="${STATE_DIR}/gotify_state.env"

curl -fsS "${BASE_URL}/health" >/dev/null

if [ -f "$STATE_FILE" ]; then
  . "$STATE_FILE"
  BODY_FILE="${STATE_DIR}/health_check.body"
  STATUS="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' -b "$ALICE_COOKIE" "${BASE_URL}/application/${APP_ID}/message")"
  [ "$STATUS" = "200" ] || {
    echo "owner workflow failed with status $STATUS" >&2
    exit 1
  }
  grep -Fq "$FLAG" "$BODY_FILE" || {
    echo "owner workflow did not recover flag" >&2
    exit 1
  }
fi

echo "health_check ok"
