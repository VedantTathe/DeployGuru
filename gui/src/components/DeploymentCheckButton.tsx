import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import React, { useEffect, useMemo, useRef, useState } from "react";

// Detect if we're in Codespaces environment
let IS_CODESPACES = false;
let CODESPACES_API_BASE_URL = "";

const getCodespaceNameFromHost = (host: string): string => {
  const appMatch = host.match(/^([a-z0-9\-]+)-\d+\.app\.github\.dev$/);
  if (appMatch) return appMatch[1];

  const devMatch = host.match(/^([a-z0-9\-]+)\.github\.dev$/);
  if (devMatch) return devMatch[1];

  return "";
};

const getHostnameFromUrl = (value: string): string => {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
};

try {
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "";
  const ancestorHosts =
    typeof window !== "undefined" && window.location.ancestorOrigins
      ? Array.from(window.location.ancestorOrigins).map(getHostnameFromUrl)
      : [];
  const referrerHost =
    typeof document !== "undefined"
      ? getHostnameFromUrl(document.referrer)
      : "";

  const candidates = [hostname, referrerHost, ...ancestorHosts].filter(Boolean);

  for (const host of candidates) {
    if (!host.includes("github.dev")) {
      continue;
    }

    IS_CODESPACES = true;
    const codespaceName = getCodespaceNameFromHost(host);
    if (codespaceName && codespaceName !== "assets") {
      CODESPACES_API_BASE_URL = `https://${codespaceName}-8081.app.github.dev`;
      console.log(
        "[DEBUG] 🔗 Detected Codespaces environment:",
        CODESPACES_API_BASE_URL,
      );
      break;
    }
  }
} catch (e) {
  console.log("[DEBUG] ⚠️ Could not detect Codespaces:", e);
}

const LOCALHOST_API_BASE_URL = "http://localhost:8081";

// In Codespaces, TRY localhost first (works via service worker tunnel)
// Then fall back to port-forwarded URL if that fails
let DEFAULT_DEPLOYMENT_API_BASE_URL =
  import.meta.env.VITE_DEPLOYMENT_API_BASE_URL || LOCALHOST_API_BASE_URL;

// Set fallback to port-forwarded URL in Codespaces
const FALLBACK_DEPLOYMENT_API_BASE_URL =
  IS_CODESPACES && CODESPACES_API_BASE_URL ? CODESPACES_API_BASE_URL : "";
const DEPLOYMENT_API_BASE_URL = DEFAULT_DEPLOYMENT_API_BASE_URL;

type ParsedLogLevel = "error" | "warning" | "info" | "debug" | "trace" | null;

const normalizeLevel = (level: string): ParsedLogLevel => {
  const value = level.trim().toUpperCase();
  if (["ERROR", "ERR", "FATAL"].includes(value)) return "error";
  if (["WARN", "WARNING"].includes(value)) return "warning";
  if (value === "INFO") return "info";
  if (value === "DEBUG") return "debug";
  if (value === "TRACE") return "trace";
  return null;
};

const parseLogLevel = (line: string): ParsedLogLevel => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // CloudWatch/Lambda style: <ts>\t<requestId>\tERROR\t...
  const tabDelimitedLevel = trimmed.match(
    /	(INFO|WARN|WARNING|ERROR|ERR|FATAL|DEBUG|TRACE)\t/i,
  );
  if (tabDelimitedLevel?.[1]) {
    return normalizeLevel(tabDelimitedLevel[1]);
  }

  // CloudWatch flattened text can become space-delimited columns:
  // <ingestionTs>  <stream>  <eventTs>  <requestId>  ERROR  <message>
  const spacedColumnLevel = trimmed.match(
    /\s{2,}(INFO|WARN|WARNING|ERROR|ERR|FATAL|DEBUG|TRACE)\s{2,}/i,
  );
  if (spacedColumnLevel?.[1]) {
    return normalizeLevel(spacedColumnLevel[1]);
  }

  // Bracketed level tokens: [ERROR], [WARN], [INFO], etc.
  const bracketedLevel = trimmed.match(
    /\[(INFO|WARN|WARNING|ERROR|ERR|FATAL|DEBUG|TRACE)\]/i,
  );
  if (bracketedLevel?.[1]) {
    return normalizeLevel(bracketedLevel[1]);
  }

  // Prefix level tokens: ERROR ..., WARN ..., INFO ...
  const prefixLevel = trimmed.match(
    /^(INFO|WARN|WARNING|ERROR|ERR|FATAL|DEBUG|TRACE)\b/i,
  );
  if (prefixLevel?.[1]) {
    return normalizeLevel(prefixLevel[1]);
  }

  // JSON key style: "level":"error" or "severity":"warning"
  const jsonLevel = trimmed.match(
    /"(?:level|severity)"\s*:\s*"(info|warn|warning|error|err|fatal|debug|trace)"/i,
  );
  if (jsonLevel?.[1]) {
    return normalizeLevel(jsonLevel[1]);
  }

  return null;
};

const extractLogLines = (logs: string): string[] => {
  const trimmed = logs.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as any).events)
    ) {
      return (parsed as any).events
        .map((event: any) =>
          typeof event?.message === "string" ? event.message : "",
        )
        .filter((line: string) => line.trim().length > 0);
    }
  } catch {
    // Not JSON; treat as plain text logs.
  }

  return logs.split("\n").filter((line) => line.trim().length > 0);
};

const getLogSeverityCounts = (
  logs: string,
): { errorCount: number; warningCount: number } => {
  const lines = extractLogLines(logs);
  let errorCount = 0;
  let warningCount = 0;

  for (const line of lines) {
    const level = parseLogLevel(line);
    if (level === "error") {
      errorCount += 1;
      continue;
    }
    if (level === "warning") {
      warningCount += 1;
    }
  }

  return { errorCount, warningCount };
};

const isMockLiveDebugPayload = (logs: string): boolean => {
  return (
    logs.includes("[LIVE DEBUG SESSION LOGS]") &&
    logs.includes("COLLECTED LOGS:")
  );
};

const hasConcreteErrorDetail = (line: string): boolean => {
  return /(Exception|Error:|Unhandled|Traceback|stack\s*trace|failed|timeout|refused|denied|invalid|not\s+found)/i.test(
    line,
  );
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error occurred";
};

interface DeploymentCheckProps {
  resourceName: string;
  onLogsExtracted: (logs: string, prompt: string) => void;
  onError: (error: string) => void;
}

interface ConfirmationModalProps {
  logs: string;
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  logs,
  isOpen,
  onConfirm,
  onCancel,
  isLoading,
}) => {
  if (!isOpen) return null;

  const MAX_VISIBLE_LOG_LINES = 100;
  const LOG_PAGE_SIZE = 100;
  const MAX_VISIBLE_ERROR_LINES = 50;

  const allLines = useMemo(
    () => logs.split("\n").filter((line) => line.trim().length > 0),
    [logs],
  );

  const [visibleLineCount, setVisibleLineCount] = useState(
    MAX_VISIBLE_LOG_LINES,
  );

  useEffect(() => {
    setVisibleLineCount(MAX_VISIBLE_LOG_LINES);
  }, [logs, isOpen]);

  const visibleLines = useMemo(() => {
    if (allLines.length <= visibleLineCount) {
      return allLines;
    }
    return allLines.slice(-visibleLineCount);
  }, [allLines, visibleLineCount]);

  const renderedLogs = useMemo(() => visibleLines.join("\n"), [visibleLines]);

  // Parse logs to show errors and warnings separately while limiting rendered lines.
  const errorLines = useMemo(() => {
    return allLines
      .filter((line) => parseLogLevel(line) === "error")
      .slice(-MAX_VISIBLE_ERROR_LINES);
  }, [allLines]);

  const warningLines = useMemo(() => {
    return allLines
      .filter((line) => parseLogLevel(line) === "warning")
      .slice(-MAX_VISIBLE_ERROR_LINES);
  }, [allLines]);

  const hasDetailedErrorContext = useMemo(() => {
    return errorLines.some((line) => hasConcreteErrorDetail(line));
  }, [errorLines]);

  const { errorCount, warningCount } = useMemo(
    () => getLogSeverityCounts(logs),
    [logs],
  );

  const isMockLiveDebugLog = useMemo(
    () => isMockLiveDebugPayload(logs),
    [logs],
  );

  const logContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [renderedLogs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black bg-opacity-50 py-4">
      <div className="mx-4 flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white p-6">
        <h2 className="mb-2 text-2xl font-bold">🐛 Debug Logs Analysis</h2>

        {/* Summary Bar */}
        <div className="mb-4 flex gap-4 rounded-lg bg-gray-100 p-3">
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold text-gray-700">Errors:</span>
            <span className="rounded bg-red-500 px-2 py-1 font-bold text-white">
              {errorCount}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold text-gray-700">
              Warnings:
            </span>
            <span className="rounded bg-yellow-500 px-2 py-1 font-bold text-white">
              {warningCount}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold text-gray-700">
              Total Lines:
            </span>
            <span className="rounded bg-blue-500 px-2 py-1 font-bold text-white">
              {allLines.length}
            </span>
          </div>
        </div>

        {allLines.length > visibleLineCount && (
          <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Showing latest {visibleLineCount} of {allLines.length} lines.
            <button
              type="button"
              onClick={() =>
                setVisibleLineCount((prev) => prev + LOG_PAGE_SIZE)
              }
              className="ml-2 rounded bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700"
            >
              Load 100 more
            </button>
          </div>
        )}

        {isMockLiveDebugLog && (
          <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Detected mock live-debug payload format. These logs are likely
            generated by the local test API, not directly fetched CloudWatch
            entries.
          </div>
        )}

        {/* Errors Highlight */}
        {errorCount > 0 && (
          <div className="mb-4 rounded-lg border-2 border-red-500 bg-red-50 p-3">
            <h3 className="mb-2 font-bold text-red-700">
              ⛔ Critical Errors Found:
            </h3>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {errorLines.map((line, idx) => (
                <div key={idx} className="font-mono text-xs text-red-600">
                  {line}
                </div>
              ))}
            </div>
            {!hasDetailedErrorContext && (
              <div className="mt-3 rounded border border-red-300 bg-red-100 px-2 py-1 text-xs text-red-800">
                These error entries do not include a concrete exception message
                or stack trace. The backend is likely logging generic event text
                at ERROR level.
              </div>
            )}
          </div>
        )}

        {warningCount > 0 && (
          <div className="mb-4 rounded-lg border border-yellow-400 bg-yellow-50 p-3">
            <h3 className="mb-2 font-bold text-yellow-800">
              ⚠️ Warnings Found:
            </h3>
            <div className="max-h-24 space-y-1 overflow-y-auto">
              {warningLines.map((line, idx) => (
                <div key={idx} className="font-mono text-xs text-yellow-800">
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {errorCount === 0 && (
          <div className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
            ✅ No errors found in these logs. No AI fix is needed.
          </div>
        )}

        {/* Full Logs */}
        <div
          ref={logContainerRef}
          className="scroll-container mb-4 h-[45vh] min-h-0 overflow-y-scroll rounded border-2 border-gray-300 bg-gray-900 p-4"
          style={{ scrollbarGutter: "stable" }}
        >
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-green-400">
            {renderedLogs}
          </pre>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="rounded bg-gray-400 px-4 py-2 font-medium text-white hover:bg-gray-500 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading || errorCount === 0}
            className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            <span>✨</span>
            {isLoading
              ? "Sending to AI..."
              : errorCount === 0
                ? "No Errors to Fix"
                : "Fix with AI"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const DeploymentCheckButton: React.FC<DeploymentCheckProps> = ({
  resourceName,
  onLogsExtracted,
  onError,
}) => {
  const MAX_LIVE_LOG_LINES = 5000;
  const LIVE_LOG_RENDER_LIMIT = 100;
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error" | "no-logs"
  >("idle");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [extractedLogs, setExtractedLogs] = useState("");
  const [liveLogLines, setLiveLogLines] = useState<string[]>([]);
  const [timeWindow, setTimeWindow] = useState("1000h");
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const liveLogContainerRef = useRef<HTMLDivElement | null>(null);
  const liveEventSourceRef = useRef<EventSource | null>(null);

  const closeLiveStream = () => {
    if (liveEventSourceRef.current) {
      liveEventSourceRef.current.close();
      liveEventSourceRef.current = null;
    }
  };

  const openLiveStream = (sessionId: string, activeApiBaseUrl: string) => {
    closeLiveStream();

    const streamUrl = `${activeApiBaseUrl}/api/deployment/live/stream?sessionId=${encodeURIComponent(sessionId)}`;
    const eventSource = new EventSource(streamUrl);
    liveEventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type !== "log" || !payload.line) {
          return;
        }

        setLiveLogLines((prev) => {
          const next = [...prev, payload.line];
          if (next.length > MAX_LIVE_LOG_LINES) {
            return next.slice(next.length - MAX_LIVE_LOG_LINES);
          }
          return next;
        });
      } catch (error) {
        console.warn("[DEBUG] Failed to parse live stream event", error);
      }
    };

    eventSource.onerror = (error) => {
      console.warn("[DEBUG] Live stream connection warning", error);
    };
  };

  const visibleLiveLines = useMemo(() => {
    if (liveLogLines.length <= LIVE_LOG_RENDER_LIMIT) {
      return liveLogLines;
    }
    return liveLogLines.slice(-LIVE_LOG_RENDER_LIMIT);
  }, [liveLogLines]);

  useEffect(() => {
    if (
      !liveSessionId ||
      !isAutoScrollEnabled ||
      !liveLogContainerRef.current
    ) {
      return;
    }
    liveLogContainerRef.current.scrollTop =
      liveLogContainerRef.current.scrollHeight;
  }, [liveSessionId, visibleLiveLines, isAutoScrollEnabled]);

  useEffect(() => {
    return () => {
      closeLiveStream();
    };
  }, []);

  const callDeploymentApi = async (
    endpoint: string,
    method: "GET" | "POST",
    body?: Record<string, any>,
  ): Promise<{ response: Response; activeApiBaseUrl: string }> => {
    const execute = (baseUrl: string) => {
      const url = `${baseUrl}${endpoint}`;
      console.log(`[DEBUG] 🌐 Fetching: ${method} ${url}`);
      console.log(`[DEBUG] 📍 Full URL: ${url}`);
      if (body) {
        console.log(`[DEBUG] 📤 Request body:`, JSON.stringify(body, null, 2));
      }
      console.log(`[DEBUG] 🔄 Sending fetch request...`);

      const fetchPromise = fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
        .then((response) => {
          console.log(`[DEBUG] ✅ Fetch succeeded, status: ${response.status}`);
          return response;
        })
        .catch((error) => {
          console.error(`[DEBUG] ❌ Fetch failed with error:`, error);
          console.error(`[DEBUG] Error code: ${(error as any).code}`);
          console.error(`[DEBUG] Error message: ${error.message}`);
          throw error;
        });

      console.log(`[DEBUG] ⏳ Fetch promise created, waiting for response...`);
      return fetchPromise;
    };

    let activeApiBaseUrl = DEPLOYMENT_API_BASE_URL;
    try {
      console.log(`[DEBUG] 🔗 Trying primary API: ${activeApiBaseUrl}`);
      const response = await execute(activeApiBaseUrl);
      console.log(
        `[DEBUG] ✓ Primary API responded with status: ${response.status}`,
      );
      console.log(`[DEBUG] Response OK: ${response.ok}`);
      return { response, activeApiBaseUrl };
    } catch (primaryError) {
      console.error(`[DEBUG] ❌ Primary API failed:`, primaryError);
      console.error(`[DEBUG] Error type:`, (primaryError as Error).name);
      console.error(`[DEBUG] Error message:`, (primaryError as Error).message);

      const shouldTryFallback =
        !import.meta.env.VITE_DEPLOYMENT_API_BASE_URL &&
        activeApiBaseUrl === DEFAULT_DEPLOYMENT_API_BASE_URL &&
        FALLBACK_DEPLOYMENT_API_BASE_URL;

      if (!shouldTryFallback) {
        console.error(`[DEBUG] No fallback available, throwing error`);
        throw primaryError;
      }

      activeApiBaseUrl = FALLBACK_DEPLOYMENT_API_BASE_URL;
      console.log(`[DEBUG] 🔗 Trying fallback API: ${activeApiBaseUrl}`);
      const response = await execute(activeApiBaseUrl);
      console.log(
        `[DEBUG] ✓ Fallback API responded with status: ${response.status}`,
      );
      return { response, activeApiBaseUrl };
    }
  };

  const startLiveCheck = async () => {
    console.log("[DEBUG] 🐛 startLiveCheck() called");
    console.log("[DEBUG] 📍 Current resourceName:", resourceName);
    console.log("[DEBUG] 🔗 Using API Base URL:", DEPLOYMENT_API_BASE_URL);

    setIsLoading(true);
    setStatus("loading");
    try {
      const requestBody = {
        resourceName: resourceName || "JalSaathiStack",
        pollIntervalSeconds: 15,
        sessionStartTime: Date.now(),
      };

      console.log(`[DEBUG] 📡 About to call /api/deployment/live/start`);
      console.log(`[DEBUG] 📤 Request body:`, requestBody);

      const { response, activeApiBaseUrl } = await callDeploymentApi(
        "/api/deployment/live/start",
        "POST",
        requestBody,
      );

      console.log(`[DEBUG] 📨 API Response received from ${activeApiBaseUrl}`);
      console.log(`[DEBUG] Status: ${response.status}, OK: ${response.ok}`);

      const data = await response.json();
      console.log(`[DEBUG] 📦 Response data:`, data);

      if (!response.ok || !data.success || !data.sessionId) {
        const errorMsg = data.error || "Failed to start debugging";
        console.error(`[DEBUG] ❌ Start debug failed: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      console.log(`[DEBUG] ✅ Session started with ID: ${data.sessionId}`);
      setLiveLogLines([]);
      setIsAutoScrollEnabled(true);
      setLiveSessionId(data.sessionId);
      openLiveStream(data.sessionId, activeApiBaseUrl);
      setStatus("success");
      alert(
        "🐛 Debug session started! Reproduce the issue now, then click 'Stop Debug' to analyze the logs.",
      );
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error(`[DEBUG] 🚨 ERROR in startLiveCheck:`, errorMessage);
      console.error(`[DEBUG] Error object:`, error);
      setStatus("error");
      onError(errorMessage);
      alert(`❌ Failed to start debug session\n\n${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const stopLiveCheck = async () => {
    if (!liveSessionId) {
      console.warn("[DEBUG] ⚠️ No sessionId available");
      return;
    }
    console.log(
      `[DEBUG] 🛑 stopLiveCheck() called with sessionId: ${liveSessionId}`,
    );
    setIsLoading(true);
    setStatus("loading");
    try {
      console.log(
        `[DEBUG] 📡 Calling /api/deployment/live/stop with sessionId: ${liveSessionId}`,
      );
      const { response, activeApiBaseUrl } = await callDeploymentApi(
        "/api/deployment/live/stop",
        "POST",
        {
          sessionId: liveSessionId,
        },
      );

      console.log(`[DEBUG] 📨 API Response received from ${activeApiBaseUrl}`);
      console.log(`[DEBUG] Status: ${response.status}, OK: ${response.ok}`);

      const data = await response.json();
      console.log(
        `[DEBUG] 📦 Response data (logs length: ${data.logs?.length || 0} chars):`,
        data,
      );

      if (!response.ok || !data.success) {
        const errorMsg = data.error || "Failed to stop debug session";
        console.error(`[DEBUG] ❌ Stop debug failed: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      console.log(`[DEBUG] ✅ Session stopped and logs received`);
      closeLiveStream();
      setLiveSessionId(null);
      const finalLogs =
        typeof data.logs === "string" && data.logs.trim().length > 0
          ? data.logs
          : liveLogLines.join("\n");
      const severity = getLogSeverityCounts(finalLogs);
      setExtractedLogs(finalLogs);
      setShowConfirmation(true);
      setStatus("success");

      const summary = data.summary || {};
      console.log(
        `[DEBUG] 📊 Summary - Lines: ${summary.totalLines || 0}, Errors: ${summary.errorCount || 0}, Warnings: ${summary.warningCount || 0}`,
      );
      alert(
        `✅ Debug session stopped\n\nTotal lines: ${summary.totalLines || 0}\nErrors: ${severity.errorCount}\nWarnings: ${severity.warningCount}\n\n${severity.errorCount > 0 ? "Review logs and confirm to fix errors with AI." : "No errors found. No need to fix with AI."}`,
      );
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error(`[DEBUG] 🚨 ERROR in stopLiveCheck:`, errorMessage);
      console.error(`[DEBUG] Error object:`, error);
      setStatus("error");
      onError(errorMessage);
      alert(`❌ Failed to stop debug session\n\n${errorMessage}`);
    } finally {
      closeLiveStream();
      setIsLoading(false);
    }
  };

  const handleCheckDeployment = async () => {
    console.log("[DEBUG] ========================================");
    console.log("[DEBUG] 🔘 Button clicked - handleCheckDeployment()");
    console.log("[DEBUG] 📍 Current status:", status);
    console.log("[DEBUG] 📍 Current liveSessionId:", liveSessionId);
    console.log("[DEBUG] ========================================");

    if (liveSessionId) {
      console.log("[DEBUG] Session already running, stopping it...");
      await stopLiveCheck();
      return;
    }

    console.log("[DEBUG] Starting new debug session...");
    await startLiveCheck();
    return;

    setIsLoading(true);
    setStatus("loading");
    const window = "1h"; // Last 42 days
    setTimeWindow(window);
    console.log("[DeploymentCheck] Button clicked for resource:", resourceName);

    try {
      if (!resourceName || resourceName.trim() === "") {
        throw new Error("Resource name is required");
      }

      console.log(
        `[DeploymentCheck] Calling API: ${DEPLOYMENT_API_BASE_URL}/api/deployment/run-command`,
      );

      // Call backend API to extract real logs.
      // If default port is not reachable, retry test server port once.
      const requestBody = JSON.stringify({
        resourceName,
        window: "1h",
      });

      const callDeploymentApi = (baseUrl: string) =>
        fetch(`${baseUrl}/api/deployment/run-command`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: requestBody,
        });

      let response: Response;
      let activeApiBaseUrl = DEPLOYMENT_API_BASE_URL;

      try {
        response = await callDeploymentApi(activeApiBaseUrl);
      } catch (primaryError) {
        const shouldTryFallback =
          !import.meta.env.VITE_DEPLOYMENT_API_BASE_URL &&
          activeApiBaseUrl === DEFAULT_DEPLOYMENT_API_BASE_URL;

        if (!shouldTryFallback) {
          throw primaryError;
        }

        console.warn(
          `[DeploymentCheck] Primary API unreachable on ${DEFAULT_DEPLOYMENT_API_BASE_URL}, retrying ${FALLBACK_DEPLOYMENT_API_BASE_URL}`,
        );
        activeApiBaseUrl = FALLBACK_DEPLOYMENT_API_BASE_URL;
        response = await callDeploymentApi(activeApiBaseUrl);
      }

      console.log(`[DeploymentCheck] Using API base URL: ${activeApiBaseUrl}`);

      console.log("[DeploymentCheck] API Response status:", response.status);
      console.log("[DeploymentCheck] API Response ok:", response.ok);

      let data: any = null;

      // Try to parse response as JSON regardless of status
      try {
        data = await response.json();
      } catch {
        // If we can't parse JSON, it's a real error
        throw new Error(
          `API responded with status ${response.status}: ${response.statusText}`,
        );
      }

      console.log("[DeploymentCheck] Received data:", data);
      console.log("[DeploymentCheck] Success flag:", data.success);
      console.log("[DeploymentCheck] Logs length:", data.logs?.length || 0);

      // Check response success flag (works for both 200 and 500)
      if (
        !data.success ||
        !data.logs ||
        (data.logs && data.logs.trim() === "")
      ) {
        const errorMessage = data.error || "";
        console.error("[DeploymentCheck] Response data:", JSON.stringify(data));
        console.error(
          "[DeploymentCheck] API returned error/no-logs:",
          errorMessage,
        );
        console.log("[DeploymentCheck] Logs value:", JSON.stringify(data.logs));
        console.log(
          "[DeploymentCheck] Logs empty?:",
          data.logs === "" || !data.logs || data.logs.trim() === "",
        );

        // IMPORTANT: If success is false, check if this is a "no logs" message
        // by looking for keywords in the error message
        const errorLower = errorMessage.toLowerCase();
        const isNoLogsKeywordMatch =
          errorLower.includes("no log") ||
          errorLower.includes("no streams") ||
          errorLower.includes("no events") ||
          errorLower.includes("requested window");

        console.log(
          "[DeploymentCheck] Error keyword match:",
          isNoLogsKeywordMatch,
        );
        console.log("[DeploymentCheck] Has success=false:", !data.success);

        // If we don't have success and found no-logs keywords, or if logs are empty and success is false
        const isNoLogsScenario =
          !data.success && (isNoLogsKeywordMatch || !data.logs);

        console.log(
          "[DeploymentCheck] Final determination - Is no-logs:",
          isNoLogsScenario,
        );

        if (isNoLogsScenario) {
          // Not an error - just no logs in the time range
          console.log(
            "[DeploymentCheck] ✓ Showing NO LOGS dialog and setting to no-logs status",
          );
          alert(`ℹ️  No logs found in the last ${window}`);
          setStatus("no-logs");
          setIsLoading(false);
          return;
        }

        // Actual error
        const displayMessage =
          errorMessage ||
          "Failed to check deployment.\n\nEnsure:\n• AWS credentials are configured\n• The resource has recent activity\n• The CloudWatch log group exists";
        console.log(
          "[DeploymentCheck] ✗ Showing ERROR dialog and setting to error status",
        );
        alert(`❌ Deployment Check Failed\n\n${displayMessage}`);
        setStatus("error");
        setIsLoading(false);
        return;
      }

      console.log("[DeploymentCheck] Extracted logs successfully");

      // Store logs and show confirmation modal
      setExtractedLogs(data.logs);
      setShowConfirmation(true);
      setStatus("success");
      setIsLoading(false);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error("[DeploymentCheck] Catch Error:", errorMessage);
      console.error("[DeploymentCheck] Full error:", error);

      // Provide helpful error message
      const helpfulMessage = errorMessage.includes("ECONNREFUSED")
        ? "Cannot connect to backend. Ensure deployment API server is running on port 8000 or 8080."
        : errorMessage.includes("AWS")
          ? "AWS credentials issue. Please configure AWS credentials."
          : errorMessage.includes("API responded")
            ? errorMessage
            : `Unexpected error: ${errorMessage}`;

      console.log("[DeploymentCheck] Showing error alert:", helpfulMessage);
      alert(`❌ Error: ${helpfulMessage}`);
      setStatus("error");
      setIsLoading(false);
    }
  };

  const handleConfirmLogs = () => {
    try {
      if (isMockLiveDebugPayload(extractedLogs)) {
        alert(
          "⚠️ Mock/test logs detected (LIVE DEBUG SESSION LOGS format). Point Deployment API to real backend CloudWatch API before fixing with AI.",
        );
        setShowConfirmation(false);
        setStatus("idle");
        return;
      }

      const { errorCount, warningCount } = getLogSeverityCounts(extractedLogs);

      if (errorCount === 0) {
        alert(
          "✅ Found 0 errors in the extracted logs. No need to fix with AI.",
        );
        setShowConfirmation(false);
        setStatus("success");
        return;
      }

      const prompt = `You are a senior backend reliability engineer. Analyze these AWS CloudWatch logs for ${resourceName}.\n\nDetected by DeployGuru:\n- Errors: ${errorCount}\n- Warnings: ${warningCount}\n\nPlease do the following:\n1. Count and list each distinct error with frequency.\n2. Identify the most likely root cause(s).\n3. Propose the minimal safe fix with exact code changes.\n4. Provide validation steps/tests to confirm the fix.\n\nCloudWatch logs:\n${extractedLogs}`;
      setShowConfirmation(false);
      onLogsExtracted(extractedLogs, prompt);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setStatus("error");
      onError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelLogs = () => {
    setShowConfirmation(false);
    setStatus("idle");
    setIsLoading(false);
  };

  const handleShowError = (errorMessage: string) => {
    // Show error as alert
    alert(`❌ Error: ${errorMessage}`);
    setStatus("error");
    onError(errorMessage);
    setIsLoading(false);
  };

  return (
    <>
      <ConfirmationModal
        logs={extractedLogs}
        isOpen={showConfirmation}
        onConfirm={handleConfirmLogs}
        onCancel={handleCancelLogs}
        isLoading={isLoading}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            if (status === "error" || status === "no-logs") {
              setStatus("idle");
            }
            handleCheckDeployment().catch((error) => {
              console.error(
                "[DEBUG] Unexpected handleCheckDeployment error",
                error,
              );
            });
          }}
          disabled={isLoading}
          className={`rounded-lg px-4 py-2 font-medium transition-colors ${
            isLoading
              ? "cursor-not-allowed bg-gray-400"
              : status === "error"
                ? "cursor-pointer bg-orange-600 hover:bg-orange-700"
                : status === "no-logs"
                  ? "cursor-pointer bg-blue-400 hover:bg-blue-500"
                  : liveSessionId
                    ? "bg-red-600 hover:bg-red-700"
                    : status === "success"
                      ? "bg-green-600 hover:bg-green-700"
                      : "bg-blue-600 hover:bg-blue-700"
          } text-white`}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⟳</span>
              {liveSessionId ? "Stopping Debug..." : "Starting Debug..."}
            </span>
          ) : liveSessionId ? (
            <span className="flex items-center gap-2">⏹ Stop Debug</span>
          ) : status === "success" ? (
            <span className="flex items-center gap-2">
              <CheckCircleIcon className="h-5 w-5" />
              Start Debug
            </span>
          ) : status === "error" ? (
            <span className="flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5" />
              Retry Start
            </span>
          ) : status === "no-logs" ? (
            <span className="flex items-center gap-2">
              <span>ℹ️</span>
              Start Debug
            </span>
          ) : (
            "Start Debug"
          )}
        </button>
        {liveSessionId && (
          <div className="flex items-end gap-2">
            <p className="text-sm text-red-600">
              🔴 Debug session running ({liveSessionId.substring(0, 12)}...).
              Reproduce issue, then stop.
            </p>
            <span className="animate-pulse text-lg">●●●</span>
          </div>
        )}
        {status === "success" && !showConfirmation && (
          <p className="text-sm text-green-600">
            ✅ Logs received! Waiting for confirmation modal...
          </p>
        )}
        {status === "error" && (
          <div className="text-sm text-red-600">
            <div>⛔ Failed to start debug</div>
            <div className="text-xs text-gray-600">
              👉 Check browser console (F12) for detailed error logs
            </div>
          </div>
        )}
        {status === "no-logs" && (
          <p className="text-sm text-blue-600">
            ℹ️ No logs found in last {timeWindow}
          </p>
        )}
        <div className="text-xs text-gray-500">
          💡 Open console (F12) to see detailed debug logs
        </div>
      </div>
      {liveSessionId && (
        <div className="mt-3 rounded-lg border border-gray-300 bg-gray-900 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-200">
            <span>
              Live logs: {liveLogLines.length} lines (showing latest{" "}
              {visibleLiveLines.length})
            </span>
            <button
              type="button"
              onClick={() => setIsAutoScrollEnabled(true)}
              className="rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
            >
              Jump to latest
            </button>
          </div>
          <div
            ref={liveLogContainerRef}
            onScroll={(event) => {
              const target = event.currentTarget;
              const distanceFromBottom =
                target.scrollHeight - target.scrollTop - target.clientHeight;
              setIsAutoScrollEnabled(distanceFromBottom < 24);
            }}
            className="scroll-container h-64 overflow-y-scroll rounded border border-gray-700 p-2"
            style={{ scrollbarGutter: "stable" }}
          >
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-green-300">
              {visibleLiveLines.join("\n")}
            </pre>
          </div>
        </div>
      )}
    </>
  );
};
