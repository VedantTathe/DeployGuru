from __future__ import annotations

"""Lambda-specific helpers and fetcher re-export.

This module re-exports the existing `LambdaFetcher` implementation. In future
we can move Lambda-specific higher-level helpers here (parsers, formatters).
"""

from standard_commandline_utility.api.aws import LambdaFetcher

__all__ = ["LambdaFetcher"]
