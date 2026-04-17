import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import React, { useState } from "react";

const DEFAULT_DEPLOYMENT_API_BASE_URL = "http://localhost:8080";
const FALLBACK_DEPLOYMENT_API_BASE_URL = "http://localhost:8000";
const DEPLOYMENT_API_BASE_URL =
  import.meta.env.VITE_DEPLOYMENT_API_BASE_URL ||
  DEFAULT_DEPLOYMENT_API_BASE_URL;

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="mx-4 flex max-h-96 w-full max-w-2xl flex-col rounded-lg bg-white p-6">
        <h2 className="mb-4 text-xl font-bold">
          Extracted Logs - Please Review
        </h2>
        <div className="mb-4 flex-1 overflow-y-auto rounded border border-gray-300 bg-gray-100 p-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-sm">
            {logs}
          </pre>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="rounded bg-gray-300 px-4 py-2 font-medium text-gray-800 hover:bg-gray-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="rounded bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isLoading ? "Sending..." : "Confirm & Send to AI"}
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
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error" | "no-logs"
  >("idle");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [extractedLogs, setExtractedLogs] = useState("");
  const [timeWindow, setTimeWindow] = useState("1000h");
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);

  const callDeploymentApi = async (
    endpoint: string,
    method: "GET" | "POST",
    body?: Record<string, any>,
  ): Promise<{ response: Response; activeApiBaseUrl: string }> => {
    const execute = (baseUrl: string) =>
      fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    let activeApiBaseUrl = DEPLOYMENT_API_BASE_URL;
    try {
      const response = await execute(activeApiBaseUrl);
      return { response, activeApiBaseUrl };
    } catch (primaryError) {
      const shouldTryFallback =
        !import.meta.env.VITE_DEPLOYMENT_API_BASE_URL &&
        activeApiBaseUrl === DEFAULT_DEPLOYMENT_API_BASE_URL;

      if (!shouldTryFallback) {
        throw primaryError;
      }

      activeApiBaseUrl = FALLBACK_DEPLOYMENT_API_BASE_URL;
      const response = await execute(activeApiBaseUrl);
      return { response, activeApiBaseUrl };
    }
  };

  const startLiveCheck = async () => {
    setIsLoading(true);
    setStatus("loading");
    try {
      const { response } = await callDeploymentApi(
        "/api/deployment/live/start",
        "POST",
        {
          resourceName: resourceName || "JalSaathiStack",
          pollIntervalSeconds: 15,
          pollWindow: "2m",
        },
      );

      const data = await response.json();
      if (!response.ok || !data.success || !data.sessionId) {
        throw new Error(data.error || "Failed to start live deployment check");
      }

      setLiveSessionId(data.sessionId);
      setStatus("success");
      alert(
        "✅ Live deployment capture started. Explore your website now, then click 'Stop Check Deployment' to analyze captured errors.",
      );
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setStatus("error");
      onError(errorMessage);
      alert(`❌ Failed to start live capture\n\n${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const stopLiveCheck = async () => {
    if (!liveSessionId) return;
    setIsLoading(true);
    setStatus("loading");
    try {
      const { response } = await callDeploymentApi(
        "/api/deployment/live/stop",
        "POST",
        {
          sessionId: liveSessionId,
        },
      );

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to stop live deployment check");
      }

      setLiveSessionId(null);
      setExtractedLogs(data.logs || "");
      setShowConfirmation(true);
      setStatus("success");

      const summary = data.summary || {};
      alert(
        `✅ Live capture stopped\n\nTotal lines: ${summary.totalLines || 0}\nErrors: ${summary.errorCount || 0}\nWarnings: ${summary.warningCount || 0}\n\nReview logs and confirm to process with AI.`,
      );
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setStatus("error");
      onError(errorMessage);
      alert(`❌ Failed to stop live capture\n\n${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckDeployment = async () => {
    if (liveSessionId) {
      await stopLiveCheck();
      return;
    }

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
      const prompt = `Please analyze these deployment logs for ${resourceName}:\n\n${extractedLogs}\n\n026-04-16T07:59:40.940Z
START RequestId: 466f7547-aae5-4e59-97db-a564f73c3963 Version: $LATEST
2026-04-16T07:59:40.943Z
2026-04-16T07:59:40.943Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO [authenticateToken] Auth header: Present
2026-04-16T07:59:40.943Z
2026-04-16T07:59:40.943Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO [authenticateToken] Token: Extracted
2026-04-16T07:59:40.943Z
2026-04-16T07:59:40.943Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO [authenticateToken] Token decoded, userId: 6999efaa4cbbb56b08424def
2026-04-16T07:59:40.954Z
2026-04-16T07:59:40.954Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO [authenticateToken] User found: { id: new ObjectId('6999efaa4cbbb56b08424def'), role: 'customer', email: 'tathevedant70@gmail.com' }
2026-04-16T07:59:40.979Z
2026-04-16T07:59:40.979Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 📍 Default Address Query Result: { _id: new ObjectId('6999efeb4cbbb56b08424e0a'), label: 'home', coordinates: { latitude: 16.846084162549758, longitude: 74.59834140555783 }, hasLat: true, hasLng: true }
2026-04-16T07:59:40.979Z
2026-04-16T07:59:40.979Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 📍 Using default address coordinates: { customerLat: 16.846084162549758, customerLon: 74.59834140555783 }
2026-04-16T07:59:40.980Z
2026-04-16T07:59:40.980Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 📍 Customer Info:
2026-04-16T07:59:40.980Z
2026-04-16T07:59:40.980Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO - User ID: new ObjectId('6999efaa4cbbb56b08424def')
2026-04-16T07:59:40.980Z
2026-04-16T07:59:40.980Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO - Name: Vedant Tathe
2026-04-16T07:59:40.980Z
2026-04-16T07:59:40.980Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO - Has Default Address: true
2026-04-16T07:59:40.980Z
2026-04-16T07:59:40.980Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO - Has Coordinates: true
2026-04-16T07:59:40.980Z
2026-04-16T07:59:40.980Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO - Latitude: 16.846084162549758
2026-04-16T07:59:40.980Z
2026-04-16T07:59:40.980Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO - Longitude: 74.59834140555783
2026-04-16T07:59:41.074Z
2026-04-16T07:59:41.074Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 📊 getNearbyProviders - Total providers: 9
2026-04-16T07:59:41.075Z
2026-04-16T07:59:41.075Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO ⚠️ Provider shreyash bhai water wala has no coordinates, skipping
2026-04-16T07:59:41.075Z
2026-04-16T07:59:41.075Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 🔍 Provider: vedant pani wale, Distance: 0.05km, Radius: 7km, InRange: true, Hours: 08:00-13:00, Accepting: true
2026-04-16T07:59:41.075Z
2026-04-16T07:59:41.075Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 🔍 Provider: koli water supliers, Distance: 1.53km, Radius: 8km, InRange: true, Hours: 08:00-20:00, Accepting: true
2026-04-16T07:59:41.075Z
2026-04-16T07:59:41.075Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 🔍 Provider: Demo Water Provider, Distance: 307.57km, Radius: 10km, InRange: false, Hours: 08:00-20:00, Accepting: true
2026-04-16T07:59:41.075Z
2026-04-16T07:59:41.075Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 🔍 Provider: Sahil Patil's Water Supply, Distance: 0.13km, Radius: 5km, InRange: true, Hours: 08:00-20:00, Accepting: true
2026-04-16T07:59:41.075Z
2026-04-16T07:59:41.075Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 🔍 Provider: sandy, Distance: 7.80km, Radius: 5km, InRange: false, Hours: 08:00-20:00, Accepting: false
2026-04-16T07:59:41.075Z
2026-04-16T07:59:41.075Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 🔍 Provider: naresh wale, Distance: 21.09km, Radius: 10km, InRange: false, Hours: 08:00-20:00, Accepting: false
2026-04-16T07:59:41.076Z
2026-04-16T07:59:41.076Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 🔍 Provider: ankan wale, Distance: 1.60km, Radius: 7km, InRange: true, Hours: 08:00-20:00, Accepting: false
2026-04-16T07:59:41.076Z
2026-04-16T07:59:41.076Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO 🔍 Provider: provider's water supply, Distance: 0.04km, Radius: 10km, InRange: true, Hours: 08:00-20:00, Accepting: false
2026-04-16T07:59:41.076Z
2026-04-16T07:59:41.076Z 466f7547-aae5-4e59-97db-a564f73c3963 INFO ✅ Providers in range: 5
2026-04-16T07:59:41.076Z
2026-04-16T07:59:41.076Z 466f7547-aae5-4e59-97db-a564f73c3963 ERROR 🔥 [TEST_ERROR_2] BACKEND ERROR: Nearby providers validation failed
2026-04-16T07:59:41.076Z
2026-04-16T07:59:41.076Z 466f7547-aae5-4e59-97db-a564f73c3963 ERROR ❌ Get nearby providers error: TEST_ERROR: Failed to validate nearby providers data - Invalid provider object structure { errorType: 'Error' }
2026-04-16T07:59:41.095Z
END RequestId: 466f7547-aae5-4e59-97db-a564f73c3963
2026-04-16T07:59:41.095Z
REPORT RequestId: 466f7547-aae5-4e59-97db-a564f73c3963 Duration: 154.35 ms Billed Duration: 155 ms Memory Size: 512 MB Max Memory Used: 166 MB
2026-04-16T07:59:43.441Z
START RequestId: b88081ed-b3d6-49a9-8b56-b9ac231315cc Version: $LATEST
2026-04-16T07:59:43.443Z
2026-04-16T07:59:43.443Z b88081ed-b3d6-49a9-8b56-b9ac231315cc INFO [authenticateToken] Auth header: Present
2026-04-16T07:59:43.443Z
2026-04-16T07:59:43.443Z b88081ed-b3d6-49a9-8b56-b9ac231315cc INFO [authenticateToken] Token: Extracted
2026-04-16T07:59:43.444Z
2026-04-16T07:59:43.444Z b88081ed-b3d6-49a9-8b56-b9ac231315cc INFO [authenticateToken] Token decoded, userId: 6999efaa4cbbb56b08424def
2026-04-16T07:59:43.450Z
2026-04-16T07:59:43.450Z b88081ed-b3d6-49a9-8b56-b9ac231315cc INFO [authenticateToken] User found: { id: new ObjectId('6999efaa4cbbb56b08424def'), role: 'customer', email: 'tathevedant70@gmail.com' }
2026-04-16T07:59:43.450Z
2026-04-16T07:59:43.450Z b88081ed-b3d6-49a9-8b56-b9ac231315cc INFO [authorizeRoles] Checking roles: [ 'customer' ]
2026-04-16T07:59:43.453Z
2026-04-16T07:59:43.453Z b88081ed-b3d6-49a9-8b56-b9ac231315cc INFO [authorizeRoles] req.user exists? true
2026-04-16T07:59:43.453Z
2026-04-16T07:59:43.453Z b88081ed-b3d6-49a9-8b56-b9ac231315cc INFO [authorizeRoles] User role: customer
2026-04-16T07:59:43.453Z
2026-04-16T07:59:43.453Z b88081ed-b3d6-49a9-8b56-b9ac231315cc INFO [authorizeRoles] Authorization successful
2026-04-16T07:59:43.536Z
END RequestId: b88081ed-b3d6-49a9-8b56-b9ac231315cc
2026-04-16T07:59:43.536Z
REPORT RequestId: b88081ed-b3d6-49a9-8b56-b9ac231315cc Duration: 94.77 ms Billed Duration: 95 ms Memory Size: 512 MB Max Memory Used: 166 MB
2026-04-16T08:03:24.386Z
2026-04-16T08:03:24.386Z b88081ed-b3d6-49a9-8b56-b9ac231315cc WARN [2026-04-16T08:03:24.386Z] [PID: 2] [32m[NODE-CRON][32m [33m[WARN][0m missed execution at Thu Apr 16 2026 08:00:00 GMT+0000 (Coordinated Universal Time)! Possible blocking IO or high CPU user at the same process used by node-cron.
2026-04-16T08:03:24.395Z
2026-04-16T08:03:24.395Z b88081ed-b3d6-49a9-8b56-b9ac231315cc WARN [2026-04-16T08:03:24.395Z] [PID: 2] [32m[NODE-CRON][32m [33m[WARN][0m missed execution at Thu Apr 16 2026 08:01:00 GMT+0000 (Coordinated Universal Time)! Possible blocking IO or high CPU user at the same process used by node-cron.
2026-04-16T08:03:24.396Z
START RequestId: 0dc73a73-1af4-4b7f-8a86-495d8978c735 Version: $LATEST
2026-04-16T08:03:24.433Z
2026-04-16T08:03:24.433Z b88081ed-b3d6-49a9-8b56-b9ac231315cc WARN [2026-04-16T08:03:24.433Z] [PID: 2] [32m[NODE-CRON][32m [33m[WARN][0m missed execution at Thu Apr 16 2026 08:02:00 GMT+0000 (Coordinated Universal Time)! Possible blocking IO or high CPU user at the same process used by node-cron.
2026-04-16T08:03:24.436Z
2026-04-16T08:03:24.436Z b88081ed-b3d6-49a9-8b56-b9ac231315cc WARN [2026-04-16T08:03:24.436Z] [PID: 2] [32m[NODE-CRON][32m [33m[WARN][0m missed execution at Thu Apr 16 2026 08:03:00 GMT+0000 (Coordinated Universal Time)! Possible blocking IO or high CPU user at the same process used by node-cron.
2026-04-16T08:03:24.477Z
2026-04-16T08:03:24.477Z 0dc73a73-1af4-4b7f-8a86-495d8978c735 INFO [authenticateToken] Auth header: Present`;
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
            handleCheckDeployment();
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
              {liveSessionId ? "Stopping Capture..." : "Starting Capture..."}
            </span>
          ) : liveSessionId ? (
            <span className="flex items-center gap-2">
              ⏹ Stop Check Deployment
            </span>
          ) : status === "success" ? (
            <span className="flex items-center gap-2">
              <CheckCircleIcon className="h-5 w-5" />
              Start Check Deployment
            </span>
          ) : status === "error" ? (
            <span className="flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5" />
              Retry Start
            </span>
          ) : status === "no-logs" ? (
            <span className="flex items-center gap-2">
              <span>ℹ️</span>
              Start Check Deployment
            </span>
          ) : (
            "Start Check Deployment"
          )}
        </button>
        {liveSessionId && (
          <p className="text-sm text-red-600">
            🔴 Live capture running for Lambda logs. Reproduce issue, then stop.
          </p>
        )}
        {status === "success" && !showConfirmation && (
          <p className="text-sm text-green-600">
            ✓ Waiting for confirmation...
          </p>
        )}
        {status === "error" && (
          <p className="text-sm text-red-600">✗ Failed to extract logs</p>
        )}
        {status === "no-logs" && (
          <p className="text-sm text-blue-600">
            ℹ️ No logs found in last {timeWindow}
          </p>
        )}
      </div>
    </>
  );
};
