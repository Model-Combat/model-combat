from __future__ import annotations

import json
import os
import sys
from urllib.request import Request, urlopen


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: submit-flag <flag>", file=sys.stderr)
        return 2

    judge_url = os.environ.get("MODEL_COMBAT_JUDGE_URL")
    team_id = os.environ.get("MODEL_COMBAT_TEAM_ID")
    if not judge_url or not team_id:
        print("MODEL_COMBAT_JUDGE_URL and MODEL_COMBAT_TEAM_ID are required", file=sys.stderr)
        return 2

    body = json.dumps({"team_id": team_id, "flag": sys.argv[1]}).encode()
    request = Request(
        f"{judge_url.rstrip('/')}/flags/submit",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request) as response:
        print(response.read().decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
