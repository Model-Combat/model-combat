from __future__ import annotations

import os
from urllib.request import urlopen


def main() -> int:
    judge_url = os.environ.get("MODEL_COMBAT_JUDGE_URL")
    team_id = os.environ.get("MODEL_COMBAT_TEAM_ID")
    if not judge_url or not team_id:
        return 2
    with urlopen(f"{judge_url.rstrip('/')}/team/targets?team_id={team_id}") as response:
        print(response.read().decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
