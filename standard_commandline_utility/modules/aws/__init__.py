from __future__ import annotations

"""AWS modules namespace for `standard_commandline_utility`.

Expose service-specific modules under `standard_commandline_utility.modules.aws`.
"""

from standard_commandline_utility.api.aws import AWSProvider
from standard_commandline_utility.api.aws import LambdaFetcher as lambda_fetcher

__all__ = ["AWSProvider", "lambda_fetcher"]
