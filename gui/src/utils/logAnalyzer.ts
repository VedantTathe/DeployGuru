export interface ServiceLogs {
  serviceName: string;
  errorCount: number;
  warningCount: number;
  logs: string[];
}

export interface LogAnalysis {
  hasErrors: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  debugCount: number;
  errors: string[];
  warnings: string[];
  errorsByService: Record<string, number>;
  warningsByService: Record<string, number>;
  serviceLogs: ServiceLogs[];
  summary: string;
  status: "success" | "warning" | "error";
  servicesAnalyzed?: number;
}

export const analyzeDeploymentLogs = (logs: string): LogAnalysis => {
  const lines = logs.split("\n").filter((line) => line.trim().length > 0);

  // Count occurrences
  const errorCount = (logs.match(/\[ERROR\]/g) || []).length;
  const warningCount = (logs.match(/\[WARN\]/g) || []).length;
  const infoCount = (logs.match(/\[INFO\]/g) || []).length;
  const debugCount = (logs.match(/\[DEBUG\]/g) || []).length;

  // Extract error lines (clean up)
  const errors = lines
    .filter((line) => line.includes("[ERROR]"))
    .map((line) => {
      // Extract just the error message, remove timestamps and IDs
      const match = line.match(/\[ERROR\]\s*(.+)/);
      return match ? match[1].trim() : line.trim();
    });

  // Extract warning lines (clean up)
  const warnings = lines
    .filter((line) => line.includes("[WARN]"))
    .map((line) => {
      const match = line.match(/\[WARN\]\s*(.+)/);
      return match ? match[1].trim() : line.trim();
    });

  // Parse service info by finding [service-name] patterns in logs
  const errorsByService: Record<string, number> = {};
  const warningsByService: Record<string, number> = {};

  lines.forEach((line) => {
    // Extract service name from pattern like: [service-name] or [database]
    // Look for bracketed service names in the log line
    const serviceMatches = line.match(/\[([a-z0-9\-]+)\]/g);

    if (serviceMatches && serviceMatches.length > 0) {
      // Get the first bracketed term that looks like a service name (not a log level)
      for (const match of serviceMatches) {
        const serviceName = match.slice(1, -1); // Remove brackets
        // Skip log levels
        if (
          ["ERROR", "WARN", "INFO", "DEBUG"].includes(serviceName.toUpperCase())
        ) {
          continue;
        }

        if (line.includes("[ERROR]")) {
          errorsByService[serviceName] =
            (errorsByService[serviceName] || 0) + 1;
        }
        if (line.includes("[WARN]")) {
          warningsByService[serviceName] =
            (warningsByService[serviceName] || 0) + 1;
        }
        break; // Only count first service found
      }
    }
  });

  // Determine status
  const hasErrors = errorCount > 0;
  const hasWarnings = warningCount > 0;

  let status: "success" | "warning" | "error" = "success";
  let summary = "";

  if (hasErrors) {
    status = "error";
    const servicesWithErrors = Object.keys(errorsByService);
    summary = `🔴 Found ${errorCount} error${errorCount > 1 ? "s" : ""}`;
    if (servicesWithErrors.length > 1) {
      summary += ` in ${servicesWithErrors.length} services`;
    } else if (servicesWithErrors.length === 1) {
      summary += ` in ${servicesWithErrors[0]}`;
    }
    if (hasWarnings) {
      summary += ` and ${warningCount} warning${warningCount > 1 ? "s" : ""}`;
    }
  } else if (hasWarnings) {
    status = "warning";
    const servicesWithWarnings = Object.keys(warningsByService);
    summary = `⚠️ Found ${warningCount} warning${warningCount > 1 ? "s" : ""}`;
    if (servicesWithWarnings.length > 0) {
      summary += ` in ${servicesWithWarnings.length} service${servicesWithWarnings.length > 1 ? "s" : ""}`;
    }
  } else {
    status = "success";
    summary = "✅ No errors or warnings found";
  }

  const servicesAnalyzed = new Set([
    ...Object.keys(errorsByService),
    ...Object.keys(warningsByService),
  ]).size;

  return {
    hasErrors,
    errorCount,
    warningCount,
    infoCount,
    debugCount,
    errors,
    warnings,
    errorsByService,
    warningsByService,
    serviceLogs: [],
    summary,
    status,
    servicesAnalyzed,
  };
};
