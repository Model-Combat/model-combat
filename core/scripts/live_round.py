#!/usr/bin/env python3
"""Run a Model Combat round end-to-end with a live two-column dashboard.

Usage:
  scripts/live_round.py                 # create a new round and watch
  scripts/live_round.py <round_id>      # attach to an existing round

Default view is a refreshing two-column dashboard (left=team-1, right=team-2)
with the latest events visible at the bottom of each column.

Pass --stream for an append-only log mode (every event ever, no truncation,
useful when piping to a file).
"""
from __future__ import annotations

import argparse
import collections
import os
import shutil
import signal
import sys
import textwrap
import threading
import time
import urllib.parse
from typing import Any

import httpx

JUDGE_URL = os.environ.get("MODEL_COMBAT_JUDGE_URL", "http://127.0.0.1:8000")
REQUESTED_BY = "live-round"
POLL_INTERVAL = 1.0
DEFAULT_LEFT_PROVIDER = "anthropic"
DEFAULT_RIGHT_PROVIDER = "anthropic"
DEFAULT_LEFT_MODEL = "claude-opus-4-7"
DEFAULT_RIGHT_MODEL = "claude-sonnet-4-6"
DEFAULT_ARTIFACT = "gotify-v1"

# Max output lines shown per tool call (full content is still in /traces).
MAX_OUTPUT_LINES = 6
MAX_TEXT_LINES = 8

RESET = "\x1b[0m"
DIM = "\x1b[2m"
BOLD = "\x1b[1m"
GREEN = "\x1b[32m"
RED = "\x1b[31m"
YELLOW = "\x1b[33m"
CYAN = "\x1b[36m"
BLUE = "\x1b[34m"
MAGENTA = "\x1b[35m"
GREY = "\x1b[90m"
HOME = "\x1b[H"
CLEAR_TO_EOL = "\x1b[K"
CLEAR_TO_EOS = "\x1b[J"
ALT_SCREEN_ON = "\x1b[?1049h"
ALT_SCREEN_OFF = "\x1b[?1049l"
HIDE_CURSOR = "\x1b[?25l"
SHOW_CURSOR = "\x1b[?25h"


def fetch_json(path: str) -> Any:
    with httpx.Client(timeout=httpx.Timeout(15.0)) as client:
        r = client.get(JUDGE_URL.rstrip("/") + path)
        r.raise_for_status()
        return r.json()


def post_json(path: str, payload: dict | None = None) -> Any:
    with httpx.Client(timeout=httpx.Timeout(None)) as client:
        r = client.post(JUDGE_URL.rstrip("/") + path, json=payload or {})
        r.raise_for_status()
        return r.json()


def create_round(artifact: str) -> str:
    return post_json("/admin/rounds", {"requested_by": REQUESTED_BY, "artifact_ids": [artifact]})["round_id"]


def kick_off_match(round_id: str, opts: dict[str, str | None]) -> threading.Thread:
    qs = urllib.parse.urlencode({k: v for k, v in opts.items() if v is not None})
    url = f"{JUDGE_URL.rstrip('/')}/admin/rounds/{round_id}/run-match?{qs}"

    def _run():
        try:
            with httpx.Client(timeout=httpx.Timeout(None)) as client:
                client.post(url)
        except Exception:
            pass

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return t


# -------------------- formatting helpers --------------------

def visible_len(s: str) -> int:
    out = 0
    i = 0
    while i < len(s):
        if s[i] == "\x1b" and i + 1 < len(s) and s[i + 1] == "[":
            j = i + 2
            while j < len(s) and s[j] not in "ABCDEFGHJKSTfminsulh":
                j += 1
            i = j + 1
        else:
            out += 1
            i += 1
    return out


def pad_to(s: str, width: int) -> str:
    """Pad to width if shorter, or truncate (visible-char aware) if longer.

    Truncating an ANSI-coloured string is tricky — we walk one visible char
    at a time, copy bytes verbatim for escape sequences, and stop after
    we've emitted `width` visible characters. Appends RESET to be safe.
    """
    vl = visible_len(s)
    if vl == width:
        return s
    if vl < width:
        return s + " " * (width - vl)
    out: list[str] = []
    emitted = 0
    i = 0
    while i < len(s) and emitted < width:
        if s[i] == "\x1b" and i + 1 < len(s) and s[i + 1] == "[":
            j = i + 2
            while j < len(s) and s[j] not in "ABCDEFGHJKSTfminsulh":
                j += 1
            out.append(s[i : j + 1])
            i = j + 1
        else:
            out.append(s[i])
            emitted += 1
            i += 1
    return "".join(out) + RESET


def wrap_to_width(text: str, width: int) -> list[str]:
    """Wrap a text block to fit `width` visible chars. Preserves blank lines."""
    out: list[str] = []
    for raw in text.splitlines() or [""]:
        if not raw.strip():
            out.append("")
            continue
        wrapped = textwrap.wrap(raw.rstrip(), width=max(20, width), break_long_words=True, break_on_hyphens=False)
        out.extend(wrapped or [""])
    return out


def truncate_lines(lines: list[str], cap: int) -> list[str]:
    if len(lines) <= cap:
        return lines
    keep = max(1, cap - 1)
    return lines[:keep] + [f"{DIM}… {len(lines) - keep} more lines (see /admin/rounds/<id>/traces){RESET}"]


def format_event(event: dict, col_width: int) -> list[str]:
    """Render one trace event to lines that fit inside col_width.

    No team prefix here — that's added when rendering the column.
    """
    etype = event["event_type"]
    payload = event.get("payload") or {}
    ts = event.get("created_at", "")[11:19]

    head_color = {
        "step_begin": GREY,
        "response": CYAN,
        "bash": YELLOW,
        "read_file": BLUE,
        "write_file": BLUE,
        "http_request": YELLOW,
        "submit_flag": GREEN,
        "error": RED,
        "aborted": RED,
        "finish": GREEN,
    }.get(etype, "")

    if etype == "step_begin":
        step = payload.get("step", "?")
        return [f"{DIM}{ts}{RESET}  {BOLD}── step {step} ──{RESET}"]

    if etype == "response":
        calls = [c.get("name") for c in payload.get("tool_calls", [])]
        reasoning = (payload.get("reasoning") or "").strip()
        text = (payload.get("text") or "").strip()
        head = f"{DIM}{ts}{RESET}  {head_color}response{RESET} tools={calls or '[]'}"
        lines = [head]
        if reasoning:
            lines.append(f"  {MAGENTA}thinking:{RESET}")
            for w in truncate_lines(wrap_to_width(reasoning, col_width - 4), MAX_TEXT_LINES):
                lines.append(f"  {MAGENTA}{w}{RESET}")
        if text:
            lines.append(f"  {CYAN}says:{RESET}")
            for w in truncate_lines(wrap_to_width(text, col_width - 4), MAX_TEXT_LINES):
                lines.append(f"  {CYAN}{w}{RESET}")
        return lines

    if etype == "bash":
        cmd = (payload.get("arguments") or {}).get("command", "").strip()
        out = (payload.get("output") or "").rstrip()
        first_cmd_line = cmd.splitlines()[0] if cmd else ""
        head = f"{DIM}{ts}{RESET}  {head_color}$ {RESET}{first_cmd_line}"
        lines = [head]
        # If the command itself is multi-line, show a few more lines indented
        extra_cmd_lines = cmd.splitlines()[1:] if cmd else []
        for cl in extra_cmd_lines[:3]:
            lines.append(f"  {DIM}{cl}{RESET}")
        if len(extra_cmd_lines) > 3:
            lines.append(f"  {DIM}…{RESET}")
        if out:
            wrapped = wrap_to_width(out, col_width - 4)
            for w in truncate_lines(wrapped, MAX_OUTPUT_LINES):
                lines.append(f"  {GREY}{w}{RESET}")
        return lines

    if etype == "http_request":
        args = payload.get("arguments") or {}
        method = args.get("method", "GET")
        url = args.get("url", "")
        out = (payload.get("output") or "").rstrip()
        head = f"{DIM}{ts}{RESET}  {head_color}{method}{RESET} {url}"
        lines = [head]
        if out:
            wrapped = wrap_to_width(out, col_width - 4)
            for w in truncate_lines(wrapped, MAX_OUTPUT_LINES):
                lines.append(f"  {GREY}{w}{RESET}")
        return lines

    if etype == "submit_flag":
        flag = (payload.get("arguments") or {}).get("flag", "")
        out = (payload.get("output") or "").strip()
        flag_preview = flag if len(flag) <= 60 else flag[:57] + "…"
        head = f"{DIM}{ts}{RESET}  {head_color}submit_flag{RESET} {flag_preview}"
        lines = [head]
        if out:
            for w in wrap_to_width(out, col_width - 4)[:3]:
                lines.append(f"  {GREEN}{w}{RESET}")
        return lines

    if etype in ("read_file", "write_file"):
        path = (payload.get("arguments") or {}).get("path", "")
        out = (payload.get("output") or "").rstrip()
        verb = "read" if etype == "read_file" else "wrote"
        head = f"{DIM}{ts}{RESET}  {head_color}{verb}{RESET} {path}"
        lines = [head]
        if etype == "write_file" and out:
            for w in wrap_to_width(out, col_width - 4)[:2]:
                lines.append(f"  {GREY}{w}{RESET}")
        return lines

    if etype in ("error", "aborted"):
        msg = (payload.get("error") or payload.get("reason") or "").strip()
        head = f"{DIM}{ts}{RESET}  {head_color}{etype}{RESET}"
        lines = [head]
        for w in truncate_lines(wrap_to_width(msg, col_width - 4), MAX_TEXT_LINES):
            lines.append(f"  {RED}{w}{RESET}")
        return lines

    if etype == "finish":
        summary = (payload.get("summary") or "").strip()
        head = f"{DIM}{ts}{RESET}  {head_color}finish{RESET}"
        lines = [head]
        for w in truncate_lines(wrap_to_width(summary, col_width - 4), MAX_TEXT_LINES):
            lines.append(f"  {GREEN}{w}{RESET}")
        return lines

    # fallback
    return [f"{DIM}{ts}{RESET}  {etype} {str(payload)[:col_width - 20]}"]


# -------------------- dashboard rendering --------------------

def format_score_header(scoreboard: list[dict], team_ids: list[str]) -> str:
    by_id = {row["team_id"]: row for row in scoreboard}
    parts = []
    for tid, label_color in zip(team_ids, (BLUE, YELLOW)):
        row = by_id.get(tid)
        if not row:
            parts.append(f"{label_color}{tid[-6:]}{RESET}: ?")
            continue
        score = row["score"]
        sc = GREEN if score > 0 else (RED if score < 0 else DIM)
        parts.append(
            f"{label_color}{tid[-6:]}{RESET}: {sc}{score:+d}{RESET}"
            f" {DIM}(+{row['flags_stolen']}/-{row['flags_lost']} flags){RESET}"
        )
    return "   ".join(parts)


def render_dashboard(round_id: str, round_state: dict, traces: list[dict], scoreboard: list[dict], left_label: str, right_label: str) -> str:
    width, height = shutil.get_terminal_size((140, 40))
    col_width = max(40, (width - 3) // 2)
    body_height = max(10, height - 6)

    team_ids = round_state.get("team_ids", []) or []
    left_id = team_ids[0] if team_ids else None
    right_id = team_ids[1] if len(team_ids) > 1 else None

    left_lines: list[str] = []
    right_lines: list[str] = []
    for ev in traces:
        rendered = format_event(ev, col_width)
        if ev["team_id"] == left_id:
            left_lines.extend(rendered)
        elif ev["team_id"] == right_id:
            right_lines.extend(rendered)

    # Tail to fit body_height
    left_visible = left_lines[-body_height:]
    right_visible = right_lines[-body_height:]
    # Pad shorter column to equal length
    rows = max(len(left_visible), len(right_visible), body_height)
    left_visible = ([""] * (rows - len(left_visible))) + left_visible
    right_visible = ([""] * (rows - len(right_visible))) + right_visible

    header = [
        f"{BOLD}Model Combat — round {round_id[:8]}{RESET}   "
        f"status={round_state.get('status','?')}   wave={round_state.get('current_wave','?')}",
        format_score_header(scoreboard, team_ids),
        f"{DIM}{'─' * width}{RESET}",
        f"{pad_to(f'{BLUE}{BOLD}L│ {left_label}{RESET}', col_width)} {DIM}│{RESET} "
        f"{pad_to(f'{YELLOW}{BOLD}R│ {right_label}{RESET}', col_width)}",
        f"{DIM}{'─' * width}{RESET}",
    ]
    body_rows = [
        f"{pad_to(l, col_width)} {DIM}│{RESET} {pad_to(r, col_width)}"
        for l, r in zip(left_visible, right_visible)
    ]
    footer = f"{DIM}refresh {POLL_INTERVAL:.0f}s · Ctrl-C to detach · full transcript: /admin/rounds/{round_id}/traces{RESET}"

    # Render: home cursor, draw every line with CLEAR_TO_EOL so leftover
    # characters from a previously-wider line don't bleed, then CLEAR_TO_EOS
    # to wipe any extra lines from a previously-taller render.
    out_lines = header + body_rows + [footer]
    rendered = HOME + ("\n".join(line + CLEAR_TO_EOL for line in out_lines)) + CLEAR_TO_EOS
    return rendered


def stream_mode(round_id: str, left_id: str | None, right_id: str | None) -> int:
    """Append-only log mode: every event, no truncation. For piping to files."""
    seen: set[str] = set()
    scoreboard: list[dict] = []
    while True:
        try:
            round_state = fetch_json(f"/admin/rounds/{round_id}")
            traces = fetch_json(f"/admin/rounds/{round_id}/traces?limit=5000")
            scoreboard = fetch_json(f"/leaderboard?round_id={round_id}")
        except Exception as exc:
            print(f"error: {exc}", file=sys.stderr)
            time.sleep(POLL_INTERVAL)
            continue
        for ev in traces:
            if ev["trace_id"] in seen:
                continue
            seen.add(ev["trace_id"])
            tag = "L" if ev["team_id"] == left_id else ("R" if ev["team_id"] == right_id else "?")
            payload = ev.get("payload") or {}
            ts = (ev.get("created_at") or "")[11:19]
            print(f"[{ts}] {tag}│ {ev['event_type']}  {payload}")
        if round_state.get("status") in {"finalized", "aborted", "failed"}:
            break
        time.sleep(POLL_INTERVAL)
    print("\nFinal scoreboard:")
    for row in scoreboard:
        print(f"  {row['team_id'][-12:]}  {row['score']:+5d}  flags +{row['flags_stolen']} / -{row['flags_lost']}")
    return 0


# -------------------- main --------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Live two-column round viewer.")
    parser.add_argument("round_id", nargs="?", help="Attach to an existing round id.")
    parser.add_argument("--no-match", action="store_true", help="Don't kick off run-match; just attach.")
    parser.add_argument("--artifact", default=DEFAULT_ARTIFACT)
    parser.add_argument("--left-provider", default=DEFAULT_LEFT_PROVIDER)
    parser.add_argument("--right-provider", default=DEFAULT_RIGHT_PROVIDER)
    parser.add_argument("--left-model", default=DEFAULT_LEFT_MODEL)
    parser.add_argument("--right-model", default=DEFAULT_RIGHT_MODEL)
    parser.add_argument("--left-reasoning", default=None)
    parser.add_argument("--right-reasoning", default=None)
    parser.add_argument("--stream", action="store_true", help="Append-only stream mode (for piping to a file).")
    args = parser.parse_args()

    if args.round_id:
        round_id = args.round_id
        kicked_off = False
    else:
        print("Creating round…", file=sys.stderr)
        round_id = create_round(args.artifact)
        print(f"round_id={round_id}", file=sys.stderr)
        kicked_off = True

    if kicked_off and not args.no_match:
        kick_off_match(
            round_id,
            {
                "left_provider": args.left_provider,
                "right_provider": args.right_provider,
                "left_model": args.left_model,
                "right_model": args.right_model,
                "left_reasoning": args.left_reasoning,
                "right_reasoning": args.right_reasoning,
            },
        )

    round_state = fetch_json(f"/admin/rounds/{round_id}")
    team_ids = round_state.get("team_ids", []) or []
    left_id = team_ids[0] if team_ids else None
    right_id = team_ids[1] if len(team_ids) > 1 else None

    if args.stream:
        return stream_mode(round_id, left_id, right_id)

    def _teardown_tty():
        sys.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF)
        sys.stdout.flush()

    signal.signal(signal.SIGINT, lambda *_: (_teardown_tty(), sys.exit(0)))
    # Enter the alt screen and hide the cursor. The alt screen has its own
    # scrollback and gets fully released on exit, so the dashboard can't
    # contaminate the user's terminal history.
    sys.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR + HOME + CLEAR_TO_EOS)
    sys.stdout.flush()

    left_label = f"{args.left_provider}:{args.left_model}"
    right_label = f"{args.right_provider}:{args.right_model}"

    scoreboard: list[dict] = []
    try:
        while True:
            try:
                round_state = fetch_json(f"/admin/rounds/{round_id}")
                traces = fetch_json(f"/admin/rounds/{round_id}/traces?limit=2000")
                scoreboard = fetch_json(f"/leaderboard?round_id={round_id}")
            except Exception as exc:
                sys.stdout.write(HOME + CLEAR_TO_EOS + f"{RED}error talking to judge: {exc}{RESET}\n")
                sys.stdout.flush()
                time.sleep(POLL_INTERVAL)
                continue
            sys.stdout.write(render_dashboard(round_id, round_state, traces, scoreboard, left_label, right_label))
            sys.stdout.flush()
            if round_state.get("status") in {"finalized", "aborted", "failed"}:
                break
            time.sleep(POLL_INTERVAL)
    finally:
        _teardown_tty()

    print()
    print(f"{BOLD}Final scoreboard{RESET}")
    for row in scoreboard:
        score = row["score"]
        color = GREEN if score > 0 else (RED if score < 0 else "")
        print(
            f"  {row['team_id'][-12:]}   {color}{score:+5d}{RESET}"
            f"   flags +{row['flags_stolen']} / -{row['flags_lost']}"
            f"   services up={row['services_up']} down={row['services_down']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
