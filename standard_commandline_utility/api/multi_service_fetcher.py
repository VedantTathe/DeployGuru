import boto3
from typing import List, Dict, Optional
import json
import os
import re
from pathlib import Path

class StackConfig:
    """Load and manage stack configuration for multi-service log fetching."""
    
    def __init__(self, stack_name: str):
        self.stack_name = stack_name
        self.config = self._load_config(stack_name)
    
    def _load_config(self, stack_name: str) -> Dict:
        """Load stack configuration from JSON file."""
        # Try multiple paths
        possible_paths = [
            Path(__file__).parent.parent.parent / "manual-testing-sandbox" / stack_name / "stack-config.json",
            Path.cwd() / "manual-testing-sandbox" / stack_name / "stack-config.json",
            Path.cwd() / f"{stack_name}-config.json",
        ]
        
        for path in possible_paths:
            if path.exists():
                with open(path, 'r') as f:
                    return json.load(f)
        
        # If no config found, create default single-service config
        return {
            "stackName": stack_name,
            "services": [
                {
                    "name": "default",
                    "type": "lambda",
                    "logGroup": f"/aws/lambda/{stack_name}",
                    "logStream": "default",
                    "critical": True
                }
            ]
        }
    
    def get_services(self, critical_only: bool = False) -> List[Dict]:
        """Get list of services in the stack."""
        services = self.config.get("services", [])
        if critical_only:
            return [s for s in services if s.get("critical", True)]
        return services
    
    def get_log_groups(self, critical_only: bool = False) -> List[str]:
        """Get list of log groups to query."""
        services = self.get_services(critical_only)
        return [s["logGroup"] for s in services]
    
    def get_service_by_logstream(self, logstream_name: str) -> Optional[Dict]:
        """Find service config by log stream name."""
        for service in self.get_services():
            if service.get("logStream") == logstream_name:
                return service
        return None
    
    def get_service_by_name(self, service_name: str) -> Optional[Dict]:
        """Find service config by service name."""
        for service in self.get_services():
            if service.get("name") == service_name:
                return service
        return None


class MultiServiceLogFetcher:
    """Fetch logs from multiple log groups of a stack."""
    
    def __init__(self, session_kwargs: Optional[dict] = None):
        self.session_kwargs = session_kwargs or {}
        self.logs_client = boto3.Session(**self.session_kwargs).client("logs")
    
    def fetch_stack_logs(
        self,
        stack_name: str,
        start_time_s: int,
        end_time_s: int,
        keywords: Optional[List[str]] = None,
        critical_only: bool = False
    ) -> Dict:
        """Fetch logs from all services in a stack."""
        config = StackConfig(stack_name)
        log_groups = config.get_log_groups(critical_only=critical_only)
        
        aggregated_logs = []
        log_group_stats = {}
        service_stats = {}
        
        for log_group in log_groups:
            try:
                logs, count = self._fetch_from_log_group(
                    log_group,
                    start_time_s,
                    end_time_s,
                    keywords,
                    config
                )
                aggregated_logs.extend(logs)
                log_group_stats[log_group] = {
                    "count": count,
                    "status": "success"
                }
                
                # Track by service
                for log in logs:
                    service = log.get("serviceName", "unknown")
                    if service not in service_stats:
                        service_stats[service] = 0
                    service_stats[service] += 1
                    
            except Exception as e:
                log_group_stats[log_group] = {
                    "count": 0,
                    "status": "error",
                    "error": str(e)
                }
        
        # Sort by timestamp
        aggregated_logs.sort(key=lambda x: x.get("timestamp", 0))
        
        return {
            "stack_name": stack_name,
            "logs": aggregated_logs,
            "log_group_stats": log_group_stats,
            "service_stats": service_stats,
            "total_logs": len(aggregated_logs),
            "services_queried": len(log_groups),
            "services_with_logs": len([s for s in service_stats.values() if s > 0]),
        }
    
    def _fetch_from_log_group(
        self,
        log_group: str,
        start_time_s: int,
        end_time_s: int,
        keywords: Optional[List[str]] = None,
        config: Optional[StackConfig] = None
    ) -> tuple:
        """Fetch logs from a single log group."""
        start_ms = int(start_time_s * 1000)
        end_ms = int(end_time_s * 1000)
        
        events = []
        next_token = None
        
        while True:
            kwargs = {
                "logGroupName": log_group,
                "startTime": start_ms,
                "endTime": end_ms,
            }
            if next_token:
                kwargs["nextToken"] = next_token
            
            try:
                resp = self.logs_client.filter_log_events(**kwargs)
            except Exception as e:
                print(f"Warning: Failed to fetch from {log_group}: {e}")
                return [], 0
            
            for event in resp.get("events", []):
                message = event.get("message", "")
                
                # Apply keyword filter
                if keywords:
                    if not any(kw.lower() in message.lower() for kw in keywords):
                        continue
                
                # Extract service name from log message
                service_name = self._extract_service_from_message(message, log_group, config)
                
                events.append({
                    "timestamp": event.get("timestamp", 0),
                    "message": message,
                    "logStreamName": event.get("logStreamName", ""),
                    "logGroupName": log_group,
                    "serviceName": service_name,
                })
            
            next_token = resp.get("nextToken")
            if not next_token:
                break
        
        return events, len(events)
    
    def _extract_service_from_message(self, message: str, log_group: str, config: Optional[StackConfig] = None) -> str:
        """Extract service name from log message."""
        
        # Pattern 1: [service-name] in log message
        service_match = re.search(r'\[([a-z0-9\-]+)\]', message)
        if service_match:
            service_name = service_match.group(1)
            # Verify it's a real service if we have config
            if config:
                svc = config.get_service_by_name(service_name)
                if svc:
                    return service_name
            # Otherwise use it anyway
            return service_name
        
        # Pattern 2: Extract from log group name
        if log_group:
            # e.g., /aws/lambda/JalSaathi-service-a -> service-a
            match = re.search(r'([a-z0-9\-]+)$', log_group)
            if match:
                return match.group(1)
        
        return "unknown"

