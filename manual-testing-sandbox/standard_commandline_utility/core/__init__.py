from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Dict, Optional


class LogProvider(ABC):
    """Abstract provider (AWS, GCP, Azure) - creates service-specific fetchers."""

    @abstractmethod
    def create_service_fetcher(self, service: str, resource: str):
        """Return a ServiceFetcher for the given service/resource."""


class ServiceFetcher(ABC):
    """Abstract fetcher for a service's logs (e.g., Lambda, EC2)."""

    @abstractmethod
    def resolve_resource(self) -> str:
        """Resolve and return the concrete resource identifier (e.g., log group)."""

    @abstractmethod
    def fetch_events(self, start_time_s: int, end_time_s: int, keywords: Optional[List[str]] = None, max_events: Optional[int] = None) -> List[Dict]:
        """Fetch log events (unordered) as a list of dicts with at least 'timestamp','message','logStreamName'."""

    @abstractmethod
    def list_active_streams(self, start_time_s: int, end_time_s: int) -> List[str]:
        """Return log stream names that had events inside the window."""
