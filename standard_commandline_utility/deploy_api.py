from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from typing import List, Optional

from standard_commandline_utility.core.pipeline import run_pipeline


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description='DeployGuru: Fetch Cloud Logs for a resource')
    p.add_argument('resource', help='Resource name or log group (e.g. my-lambda or /aws/lambda/my-lambda)')
    p.add_argument('--service', default='lambda', help='Service type (lambda, ec2, etc.)')
    p.add_argument('--window', default='5m', help="Time window (e.g. '5m', '10m', '1h'). Default 5m")
    p.add_argument('--start-time', type=int, help='UTC epoch milliseconds start time. When set, fetch from this time until now')
    p.add_argument('--keywords', help="Comma-separated keywords to filter (ERROR,Exception)")
    p.add_argument('--region', default='ap-south-1', help='AWS region (default: ap-south-1)')
    p.add_argument('--profile', default='default', help='AWS profile (default: default)')
    p.add_argument('--max-events', type=int, help='Maximum events to return')
    p.add_argument('--stream-only', action='store_true', help='Fetch only from streams with lastEvent in the window and write to file')
    p.add_argument('--out', default='extracted_logs.txt', help='Output file when using --stream-only')
    args = p.parse_args(argv)

    keywords = None
    if args.keywords:
        keywords = [k.strip() for k in args.keywords.split(',') if k.strip()]

    try:
        return run_pipeline(
            resource=args.resource,
            service=args.service,
            window=args.window,
            start_time_ms=args.start_time,
            keywords=keywords,
            region=args.region,
            profile=args.profile,
            max_events=args.max_events,
            stream_only=args.stream_only,
            out=args.out,
        )
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
