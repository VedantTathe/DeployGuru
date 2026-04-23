from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from standard_commandline_utility.api.aws import AWSProvider
from standard_commandline_utility.utils.time_utils import parse_duration, iso_ts


def run_pipeline(
    resource: str,
    service: str = 'lambda',
    window: str = '5m',
    keywords: Optional[List[str]] = None,
    region: Optional[str] = None,
    profile: Optional[str] = None,
    max_events: Optional[int] = None,
    stream_only: bool = False,
    out: str = 'extracted_logs.txt',
) -> int:
    """Orchestrate fetching logs for the given resource.

    Returns exit code (0 success, >0 error).
    """
    duration_s = parse_duration(window)
    end_time = int(datetime.now(timezone.utc).timestamp())
    start_time = end_time - duration_s

    session_kwargs = {}
    if profile:
        session_kwargs['profile_name'] = profile
    if region:
        session_kwargs['region_name'] = region

    provider = AWSProvider(session_kwargs=session_kwargs)
    fetcher = provider.create_service_fetcher(service, resource)

    if stream_only:
        streams = fetcher.list_active_streams(start_time, end_time)
        if not streams:
            print(f"Resolved log group: {fetcher.resolve_resource()}")
            print("No log streams have events in the requested window.")
            open(out, 'w', encoding='utf-8').close()
            return 0

        out_lines: List[str] = []
        evs = fetcher.fetch_events(start_time, end_time, keywords=None, max_events=None)
        for stream_name in streams:
            for e in evs:
                if e.get('logStreamName') == stream_name:
                    ts = iso_ts(e.get('timestamp', 0))
                    msg = e.get('message', '')
                    msg = msg.rstrip('\n')
                    out_lines.append(f"{ts}  {stream_name}  {msg}")

        out_lines.sort()
        with open(out, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(out_lines))

        print(f"Resolved log group: {fetcher.resolve_resource()}")
        print(f"Wrote {len(out_lines)} lines from {len(streams)} streams to {out}")
        return 0

    events = fetcher.fetch_events(start_time, end_time, keywords=keywords, max_events=max_events)

    print(f"Resolved log group: {fetcher.resolve_resource()}")
    print(f"Events found: {len(events)}")
    streams = sorted({e.get('logStreamName', '-') for e in events})
    if streams:
        shown = ', '.join(streams[:10])
        more = '... (more)' if len(streams) > 10 else ''
        print(f"Log streams used ({len(streams)}): {shown} {more}")
    else:
        print("Log streams used: none")

    for e in events:
        ts = iso_ts(e.get('timestamp', 0))
        stream = e.get('logStreamName', '-')
        msg = e.get('message', '').rstrip('\n')
        print(f"{ts}  {stream}  {msg}")

    return 0
