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
      if (!resourceName || resourceName.trim() === "") {
        throw new Error("Resource name is required");
      }

      // simulate delay like real deployment check
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const logs = `
2026-03-20T15:45:32.123Z undefined ERROR [PROFILE_ERROR-001] FAILED TO LOAD USER DATA - userId: 507f1f77bcf86cd799439011, timestamp: 2026-03-20T15:45:32.123Z

2026-03-20T15:45:32.145Z undefined ERROR Error: [PROFILE_ERROR-001] Internal Server Error: Unable to load profile data for user 507f1f77bcf86cd799439011. Please try again later.
    at getProfile (/var/task/src/modules/auth/controller.js:95)
    at Layer.handle [as handle_request] (/var/task/node_modules/express/lib/router/layer.js:95:27)
    at next (/var/task/node_modules/express/lib/router/index.js:281:27)
    at /var/task/src/middlewares/auth.js:45:18

2026-03-20T15:45:32.167Z undefined END RequestId: a1b2c3d4-e5f6-7890-abcd-ef1234567890

2026-03-20T15:46:15.456Z undefined ERROR [PROFILE_ERROR-002] CORRUPTED PROFILE DATA - userId: 507f1f77bcf86cd799439011, missingFields: email=false, name=true, phone=false, timestamp: 2026-03-20T15:46:15.456Z

2026-03-20T15:46:15.489Z undefined ERROR Error: [PROFILE_ERROR-002] Internal Server Error: Profile data corrupted or incomplete. Contact support.
    at getProfile (/var/task/src/modules/auth/controller.js:101)
    at Layer.handle [as handle_request] (/var/task/node_modules/express/lib/router/layer.js:95:27)
    at next (/var/task/node_modules/express/lib/router/index.js:281:27)
    at /var/task/src/middlewares/auth.js:45:18
    

2026-03-20T15:46:15.512Z undefined END RequestId: x9y8z7w6-v5u4-t3s2-r1q0-p9o8n7m6l5k4
`;

      const prompt = `Please analyze these deployment logs for ${resourceName}:\n\n${logs}`;

      setStatus("success");
      onLogsExtracted(logs, prompt);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      setStatus("error");
      onError(errorMessage);
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
