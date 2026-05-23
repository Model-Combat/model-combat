#!/bin/sh
set -eu

BASE_URL="${MODEL_COMBAT_TARGET_URL:?MODEL_COMBAT_TARGET_URL is required}"
STATE_DIR="${MODEL_COMBAT_STATE_DIR:-$PWD/.model_combat}"
STATE_FILE="${STATE_DIR}/gotify_state.env"

[ -f "$STATE_FILE" ] || {
  echo "missing state file" >&2
  exit 1
}

. "$STATE_FILE"

BODY_FILE="${STATE_DIR}/get_flag.body"
STATUS="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' -b "$ALICE_COOKIE" "${BASE_URL}/message")"

[ "$STATUS" = "200" ] || {
  echo "owner read failed with status $STATUS" >&2
  exit 1
}

grep -Fq "$FLAG" "$BODY_FILE" || {
  echo "owner read did not recover flag" >&2
  exit 1
}

echo "get_flag ok"
