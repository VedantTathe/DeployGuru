from __future__ import annotations

"""EC2 logs/stubs for future implementation.

Provide a clear stub that raises NotImplementedError for now.
"""

class EC2Fetcher:
    def __init__(self, *args, **kwargs):
        raise NotImplementedError("EC2 log fetching not implemented yet. Use LambdaFetcher for now.")

__all__ = ["EC2Fetcher"]
