#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

# Load .env so secrets always come from there. `set -a` exports each assignment,
# overriding any stale value already in the shell environment (a common bite).
# Walk up from ROOT — most repos keep .env at the project root, but ours has
# the harness at <repo>/core, so users often leave .env one level up.
ENV_FILE=""
for candidate in "$ROOT/.env" "$ROOT/../.env"; do
  if [ -f "$candidate" ]; then
    ENV_FILE="$candidate"
    break
  fi
done
if [ -n "$ENV_FILE" ]; then
  echo "Loading $ENV_FILE" >&2
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

JUDGE_URL="${MODEL_COMBAT_JUDGE_URL:-http://127.0.0.1:8000}"
JUDGE_LOG="/tmp/mc-judge.log"
JUDGE_PID_FILE="/tmp/mc-judge.pid"
STARTED_JUDGE=0

cleanup() {
  if [ "$STARTED_JUDGE" = "1" ] && [ -f "$JUDGE_PID_FILE" ]; then
    PID="$(cat "$JUDGE_PID_FILE" 2>/dev/null || true)"
    if [ -n "$PID" ]; then
      kill "$PID" 2>/dev/null || true
    fi
    rm -f "$JUDGE_PID_FILE"
  fi
}
trap cleanup EXIT INT TERM

# Always start the judge with the freshly-loaded environment. If an older
# judge (from a previous run) is still listening, kill it first so it doesn't
# serve us with a stale API key cached in its process env.
if [ -f "$JUDGE_PID_FILE" ]; then
  OLD_PID="$(cat "$JUDGE_PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping previous judge (pid $OLD_PID) …" >&2
    kill "$OLD_PID" 2>/dev/null || true
    # wait briefly for the port to free
    for _ in $(seq 1 10); do
      curl -fsS "$JUDGE_URL/healthz" >/dev/null 2>&1 || break
      sleep 1
    done
  fi
  rm -f "$JUDGE_PID_FILE"
fi
# If someone else's judge is already listening (e.g. you run uvicorn yourself),
# we'll just reuse it. Use --no-reuse-judge to force-fail instead.
if curl -fsS "$JUDGE_URL/healthz" >/dev/null 2>&1; then
  echo "Reusing already-running judge at $JUDGE_URL (kill it yourself if its .env is stale)." >&2
else
  echo "Starting judge at $JUDGE_URL …" >&2
  uv run uvicorn model_combat.api.app:create_app \
    --factory --host 127.0.0.1 --port 8000 \
    > "$JUDGE_LOG" 2>&1 &
  echo $! > "$JUDGE_PID_FILE"
  STARTED_JUDGE=1
  for _ in $(seq 1 30); do
    if curl -fsS "$JUDGE_URL/healthz" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl -fsS "$JUDGE_URL/healthz" >/dev/null 2>&1; then
    echo "Judge failed to start. See $JUDGE_LOG" >&2
    exit 1
  fi
fi

exec uv run python scripts/live_round.py "$@"
