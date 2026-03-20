from __future__ import annotations

from datetime import datetime, timezone


def parse_duration(s: str) -> int:
    s = s.strip().lower()
    if s.endswith('ms'):
        return max(0, int(s[:-2]) // 1000)
    if s.endswith('s'):
        return int(s[:-1])
    if s.endswith('m'):
        return int(s[:-1]) * 60
    if s.endswith('h'):
        return int(s[:-1]) * 3600
    return int(s)


def iso_ts(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()
