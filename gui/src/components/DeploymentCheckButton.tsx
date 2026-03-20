import React, { useState } from "react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

interface DeploymentCheckProps {
  resourceName: string;
  onLogsExtracted: (logs: string, prompt: string) => void;
  onError: (error: string) => void;
}

export const DeploymentCheckButton: React.FC<DeploymentCheckProps> = ({
  resourceName,
  onLogsExtracted,
  onError,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");

  const handleCheckDeployment = async () => {
    setIsLoading(true);
    setStatus("loading");

    try {
      // Run the deployment check command
      const response = await fetch("/api/deployment/run-command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resourceName,
          window: "10m",
          command: `python -m standard_commandline_utility.deploy_api ${resourceName} --window 10m --stream-only --out extracted_logs.txt`,
        }),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }

      const data = await response.json();
      const { logs, success } = data;

      if (!success) {
        throw new Error("Command execution failed");
      }

      // Generate a prompt for the logs
      const prompt = `Please analyze these deployment logs for ${resourceName}:\n\n${logs}`;

      setStatus("success");
      onLogsExtracted(logs, prompt);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setStatus("error");
      onError(errorMessage);
      console.error("Deployment check failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleCheckDeployment}
        disabled={isLoading}
        className={`rounded-lg px-4 py-2 font-medium transition-colors ${
          isLoading
            ? "cursor-not-allowed bg-gray-400"
            : status === "error"
              ? "bg-red-600 hover:bg-red-700"
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
            Check Failed
          </span>
        ) : (
          "Check Deployment"
        )}
      </button>
      {status === "success" && (
        <p className="text-sm text-green-600">
          ✓ Logs extracted and sent to AI agent
        </p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600">✗ Failed to extract logs</p>
      )}
    </div>
  );
};
