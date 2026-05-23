from __future__ import annotations

import os
from urllib.parse import urlencode
from urllib.request import urlopen


def main() -> int:
    judge_url = os.environ.get("MODEL_COMBAT_JUDGE_URL")
    round_id = os.environ.get("MODEL_COMBAT_ROUND_ID")
    if not judge_url or not round_id:
        return 2
    query = urlencode({"round_id": round_id})
    with urlopen(f"{judge_url.rstrip('/')}/leaderboard?{query}") as response:
        print(response.read().decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
