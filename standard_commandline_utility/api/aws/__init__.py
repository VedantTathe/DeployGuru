from __future__ import annotations

import time
from typing import List, Optional, Dict

import boto3
from botocore.exceptions import ClientError

from standard_commandline_utility.core import LogProvider, ServiceFetcher


class AWSProvider(LogProvider):
    def __init__(self, session_kwargs: dict | None = None):
        self._session_kwargs = session_kwargs or {}

    def _session(self):
        return boto3.Session(**self._session_kwargs) if self._session_kwargs else boto3.Session()

    def create_service_fetcher(self, service: str, resource: str):
        if service.lower() == 'lambda':
            return LambdaFetcher(self._session(), resource)
        raise NotImplementedError(f"Service {service} not implemented for AWS")


class LambdaFetcher(ServiceFetcher):
    def __init__(self, session: boto3.Session, resource_name: str):
        self.session = session
        self.logs = session.client('logs')
        self.resource_name = resource_name
        self._resolved_log_group: Optional[str] = None

    def resolve_resource(self) -> str:
        if self._resolved_log_group:
            return self._resolved_log_group
        rn = self.resource_name
        if rn.startswith('/'):
            resp = self.logs.describe_log_groups(logGroupNamePrefix=rn, limit=50)
            for g in resp.get('logGroups', []):
                if g['logGroupName'] == rn:
                    self._resolved_log_group = rn
                    return rn
            if resp.get('logGroups'):
                self._resolved_log_group = resp['logGroups'][0]['logGroupName']
                return self._resolved_log_group

        lambda_group = f"/aws/lambda/{rn}"
        resp = self.logs.describe_log_groups(logGroupNamePrefix=lambda_group, limit=50)
        if resp.get('logGroups'):
            self._resolved_log_group = resp['logGroups'][0]['logGroupName']
            return self._resolved_log_group

        prefix = '/aws/lambda/'
        next_token = None
        candidates = []
        while True:
            args = {'logGroupNamePrefix': prefix, 'limit': 50}
            if next_token:
                args['nextToken'] = next_token
            resp = self.logs.describe_log_groups(**args)
            for g in resp.get('logGroups', []):
                if rn in g['logGroupName']:
                    candidates.append(g['logGroupName'])
            next_token = resp.get('nextToken')
            if not next_token:
                break

        if candidates:
            best = None
            best_ts = 0
            for grp in candidates:
                try:
                    sresp = self.logs.describe_log_streams(logGroupName=grp, orderBy='LastEventTime', descending=True, limit=1)
                except ClientError:
                    continue
                streams = sresp.get('logStreams', [])
                if streams:
                    lst = streams[0].get('lastEventTimestamp') or 0
                    if lst > best_ts:
                        best_ts = lst
                        best = grp
            if best:
                self._resolved_log_group = best
                return best
            self._resolved_log_group = candidates[0]
            return candidates[0]

        resp = self.logs.describe_log_groups(logGroupNamePrefix=rn, limit=50)
        if resp.get('logGroups'):
            self._resolved_log_group = resp['logGroups'][0]['logGroupName']
            return self._resolved_log_group

        next_token = None
        while True:
            args = {'limit': 50}
            if next_token:
                args['nextToken'] = next_token
            resp = self.logs.describe_log_groups(**args)
            for g in resp.get('logGroups', []):
                if rn in g['logGroupName']:
                    self._resolved_log_group = g['logGroupName']
                    return g['logGroupName']
            next_token = resp.get('nextToken')
            if not next_token:
                break

        raise ValueError(f"No log group found for resource '{rn}'")

    def list_active_streams(self, start_time_s: int, end_time_s: int) -> List[str]:
        lg = self.resolve_resource()
        start_ms = int(start_time_s * 1000)
        end_ms = int(end_time_s * 1000)
        streams = []
        next_token = None
        while True:
            kwargs = {'logGroupName': lg, 'orderBy': 'LastEventTime', 'descending': True, 'limit': 50}
            if next_token:
                kwargs['nextToken'] = next_token
            resp = self.logs.describe_log_streams(**kwargs)
            for s in resp.get('logStreams', []):
                last_evt = s.get('lastEventTimestamp') or 0
                if last_evt >= start_ms and last_evt <= end_ms:
                    streams.append(s['logStreamName'])
                if last_evt < start_ms:
                    break
            next_token = resp.get('nextToken')
            if not next_token:
                break
        return streams

    def fetch_events(self, start_time_s: int, end_time_s: int, keywords: Optional[List[str]] = None, max_events: Optional[int] = None) -> List[Dict]:
        lg = self.resolve_resource()
        start_ms = int(start_time_s * 1000)
        end_ms = int(end_time_s * 1000)

        events = []
        kwargs = {'logGroupName': lg, 'startTime': start_ms, 'endTime': end_ms, 'interleaved': True}
        next_token = None
        backoff = 0.5
        while True:
            if next_token:
                kwargs['nextToken'] = next_token
            try:
                resp = self.logs.filter_log_events(**kwargs)
            except ClientError as e:
                code = e.response.get('Error', {}).get('Code', '')
                if code in ('ThrottlingException', 'Throttling'):
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 8)
                    continue
                raise
            events.extend(resp.get('events', []))
            next_token = resp.get('nextToken')
            if not next_token:
                break

        if keywords:
            lowered = [k.lower() for k in keywords]
            events = [e for e in events if any(kw in e.get('message', '').lower() for kw in lowered)]

        events.sort(key=lambda e: e.get('timestamp', 0))
        if max_events:
            return events[-max_events:]
        return events
