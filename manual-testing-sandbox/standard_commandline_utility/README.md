# standard_commandline_utility — CloudWatch log extractor

Overview

This utility locates CloudWatch Logs for an AWS resource (for example a Lambda function), automatically resolves the corresponding log group, scans across all matching log streams for a configurable recent time window, and returns ordered log events. It's designed for quick incident triage and scripted automation.

Key features

- Auto-resolve CloudWatch Log Group from an AWS resource name (Lambda, etc.)
- Cross-stream extraction (doesn't require specifying a stream name)
- Configurable time windows (examples: `5m`, `30m`, `1h`)
- Keyword filtering (ERROR, Exception, custom terms)
- Pagination-safe fetching with backoff
- `--stream-only` export mode to write per-stream results to a file

Installation

1. Ensure Python 3.10+ is available.
2. Install dependencies (boto3):

```bash
pip install -r requirements.txt
```

Quick start (module invocation)

Run from the project root (recommended):

```bash
python -m standard_commandline_utility.deploy_api <resource-name> [flags]
```

Example — fetch 30 minutes of logs for a Lambda function, filter for "ERROR":

```bash
python -m standard_commandline_utility.deploy_api StratosStack-StratosApiFunction --window 30m --keywords ERROR
```

Flags / CLI options

- `resource`: Positional. The resource short name (e.g., Lambda function name or logical name). The tool will try to resolve the right CloudWatch Log Group.
- `--service`: Service to target. Default: `lambda`.
- `--window`: Time window to search (examples: `5m`, `10m`, `1h`, `24h`). Interpreted as a duration relative to now.
- `--keywords`: Comma-separated keywords to filter (server-side filter is used where possible; additional client-side filtering applied). Example: `--keywords ERROR,Timeout`
- `--region`: AWS region override (optional). If not provided, boto3's default resolution is used.
- `--profile`: AWS CLI profile name (optional). If not provided, boto3 uses the default profile/environment resolution.
- `--max-events`: Integer. Return only the latest N events matching the query (after ordering by timestamp).
- `--stream-only`: When set, the tool writes per-stream event groups to an output file instead of printing a merged list.
- `--out`: Output file path for `--stream-only` mode (default: `extracted_logs.txt`).

How AWS credentials and region are resolved

This utility uses `boto3.Session()` and therefore follows the standard boto3 credential/provider chain. You can supply credentials and region via any of these mechanisms (priority order shown is simplified):

1. Environment variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (if using temporary creds).
2. AWS CLI profile: pass `--profile <name>` or set `AWS_PROFILE` environment variable; boto3 will read `~/.aws/credentials` and `~/.aws/config`.
3. IAM role attached to the EC2/Container/Instance where the tool runs (IMDS / ECS task role / instance profile).
4. Default region: environment variables `AWS_REGION` / `AWS_DEFAULT_REGION`, or profile config; you can override with `--region`.

Output behavior

- By default the utility prints ordered log events (oldest → newest) to stdout.
- When `--max-events` is provided, the CLI returns the latest N events (after sorting by timestamp).
- When `--stream-only` is used, the tool collects events grouped by stream and writes them to the file given by `--out` (default `extracted_logs.txt`).

Examples

- Fetch last 5 minutes for a Lambda and print:

```bash
python -m standard_commandline_utility.deploy_api MyFunction --window 5m
```

- Fetch last 1 hour searching for `Exception` and `Timeout`, limit to 200 latest events:

```bash
python -m standard_commandline_utility.deploy_api MyFunction --window 1h --keywords Exception,Timeout --max-events 200
```

- Stream-only export for later analysis:

```bash
python -m standard_commandline_utility.deploy_api MyFunction --window 30m --stream-only --out extracted_logs.txt
```

Troubleshooting

- If you see `ModuleNotFoundError` when running `python -m ...`, run the command from the project root directory (where `standard_commandline_utility` lives) or add the project root to `PYTHONPATH`.
- PowerShell: be careful with characters like `$` in arguments (example: `$LATEST`). Wrap such arguments in single quotes to avoid interpolation.
- If the tool finds multiple log-group candidates from a resource short name, it prefers the group with the most recent events.

Development notes & next steps

- Packaging: you can scaffold a `pyproject.toml` and add a console-script entry to run this tool without `python -m`.
- Testing: consider adding `pytest` tests with `moto` to mock CloudWatch Logs calls.
- Extensions: add providers for other clouds (GCP/Azure) and additional service-specific fetchers (EC2, containers), and structured JSON-lines output.

Relevant files

- `standard_commandline_utility/deploy_api.py` — CLI entrypoint delegating to the pipeline.
- `standard_commandline_utility/core/pipeline.py` — Orchestration logic.
- `standard_commandline_utility/api/aws/__init__.py` — AWS provider and fetcher implementations.
- `standard_commandline_utility/utils/time_utils.py` — Helpers to parse durations and format timestamps.

License & attribution

This repository is provided as-is for internal use. Review and add a license file if you plan to publish or share it externally.
