import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import React, { useState } from "react";

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
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [extractedLogs, setExtractedLogs] = useState("");

  const handleCheckDeployment = async () => {
    setIsLoading(true);
    setStatus("loading");
    console.log("[DeploymentCheck] Button clicked for resource:", resourceName);

    try {
      if (!resourceName || resourceName.trim() === "") {
        throw new Error("Resource name is required");
      }

      console.log(
        "[DeploymentCheck] Calling API: http://localhost:8000/api/deployment/run-command",
      );

      // Call backend API to extract real logs using 480h window (20 days)
      const response = await fetch(
        "http://localhost:8000/api/deployment/run-command",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resourceName,
            window: "480h", // Last 20 days
            // window: "1h", // Last 20 days
          }),
        },
      );

      console.log("[DeploymentCheck] API Response status:", response.status);
      console.log("[DeploymentCheck] API Response ok:", response.ok);

      if (!response.ok) {
        let errorText = "";
        try {
          const jsonError = await response.json();
          console.error("[DeploymentCheck] JSON Error response:", jsonError);
          errorText = jsonError.error || response.statusText;
        } catch {
          errorText = await response.text();
          console.error("[DeploymentCheck] Text Error response:", errorText);
        }
        throw new Error(`${errorText || response.statusText}`);
      }

      const data = await response.json();
      console.log("[DeploymentCheck] Received data:", data);
      console.log("[DeploymentCheck] Success flag:", data.success);
      console.log("[DeploymentCheck] Logs length:", data.logs?.length || 0);

      if (!data.success || !data.logs) {
        const errorMessage = data.error || "No logs available";
        console.error("[DeploymentCheck] API returned error:", errorMessage);
        alert(`❌ ${errorMessage}`);
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
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      console.error("[DeploymentCheck] Catch Error:", errorMessage);
      console.error("[DeploymentCheck] Full error:", error);
      alert(`❌ Error: ${errorMessage}`);
      setStatus("error");
      setIsLoading(false);
    }
  };

  const handleConfirmLogs = () => {
    try {
      const prompt = `Please analyze these deployment logs for ${resourceName}:\n\n${extractedLogs}`;
      setShowConfirmation(false);
      onLogsExtracted(extractedLogs, prompt);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
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
            if (status === "error") {
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
                : status === "success"
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-blue-600 hover:bg-blue-700"
          } text-white`}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⟳</span>
              Checking Deployment...
            </span>
          ) : status === "success" ? (
            <span className="flex items-center gap-2">
              <CheckCircleIcon className="h-5 w-5" />
              Logs Extracted
            </span>
          ) : status === "error" ? (
            <span className="flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5" />
              Retry Check
            </span>
          ) : (
            "Check Deployment"
          )}
        </button>
        {status === "success" && !showConfirmation && (
          <p className="text-sm text-green-600">
            ✓ Waiting for confirmation...
          </p>
        )}
        {status === "error" && (
          <p className="text-sm text-red-600">✗ Failed to extract logs</p>
        )}
      </div>
    </>
  );
};
