# Deployment Check - Quick Reference

## 📍 File Locations

### Front-end (GUI)

1. **Button Component**

   - Path: [gui/src/components/DeploymentCheckButton.tsx](gui/src/components/DeploymentCheckButton.tsx)
   - Status: ✅ Exists
   - Calls: `POST /api/deployment/check`

2. **Parent Component (Uses Button)**

   - Path: [gui/src/pages/gui/Chat.tsx](gui/src/pages/gui/Chat.tsx#L502)
   - Status: ✅ Exists
   - Integration: Lines 502-512

3. **Textbox Display**
   - Not a separate component
   - Logs are formatted and sent as message parameter
   - Format: Code block with logs + AI prompt

### Back-end (CLI Extension)

4. **Backend Service** (NEEDS CREATION)

   - Target Path: `extensions/cli/src/services/DeploymentService.ts`
   - Purpose: Run CLI command, extract logs, generate prompt

5. **Backend API Endpoint** (NEEDS CREATION)
   - Target Path: `extensions/cli/src/routes/deploymentRouter.ts`
   - Purpose: Express route handler for `/api/deployment/check`

### Utility & Configuration

6. **Log Extraction CLI**

   - Path: [standard_commandline_utility/deploy_api.py](standard_commandline_utility/deploy_api.py)
   - Status: ✅ Exists
   - Command: `python -m standard_commandline_utility.deploy_api <resource> --window 10m --stream-only`

7. **Output Logs File**

   - Path: `extracted_logs.txt` (in current working directory)
   - Format: Text file with CloudWatch log entries

8. **AI Analysis Prompt**
   - Path: [.continue/prompts/deployment-check.md](.continue/prompts/deployment-check.md)
   - Status: ✅ Exists
   - Contains: Deployment analysis instructions for AI agent

---

## 🔗 Code Integration Paths

### 1️⃣ GUI Component: DeploymentCheckButton

```tsx
// File: gui/src/components/DeploymentCheckButton.tsx
import React, { useState } from "react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

interface DeploymentCheckProps {
  resourceName: string; // e.g. "JalSaathi"
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
      // 1. Call backend API
      const response = await fetch("/api/deployment/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceName,
          window: "10m",
        }),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }

      // 2. Parse response
      const data = await response.json();
      const { logs, prompt } = data;

      // 3. Update UI and trigger callback
      setStatus("success");
      onLogsExtracted(logs, prompt); // ← Sends logs + prompt to parent
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
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
```

### 2️⃣ Parent Component: Chat Integration

```tsx
// File: gui/src/pages/gui/Chat.tsx (lines 502-512)

import { DeploymentCheckButton } from "../../components/DeploymentCheckButton";

// ... inside Chat component JSX:
<DeploymentCheckButton
  resourceName="JalSaathi"
  onLogsExtracted={(logs, prompt) => {
    // Send logs and prompt to chat
    const message = `\`\`\`deployment-analysis\n${logs}\n\`\`\`\n\n${prompt}`;
    // TODO: Dispatch this to send message to agent
    console.log("Logs extracted:", logs);
  }}
  onError={(error) => {
    console.error("Deployment check failed:", error);
  }}
/>;
```

### 3️⃣ Backend: API Endpoint (NEEDS CREATION)

```typescript
// File: extensions/cli/src/routes/deploymentRouter.ts (CREATE THIS FILE)

import express, { Router, Request, Response } from "express";
import { DeploymentService } from "../services/DeploymentService.js";

const router = Router();
const deploymentService = new DeploymentService();

// POST /api/deployment/check
router.post("/check", async (req: Request, res: Response) => {
  try {
    const { resourceName, window = "10m" } = req.body;

    if (!resourceName) {
      return res.status(400).json({
        success: false,
        error: "resourceName is required",
      });
    }

    // Call service to extract logs and generate prompt
    const { logs, prompt } = await deploymentService.checkDeployment(
      resourceName,
      window,
    );

    res.json({
      success: true,
      logs,
      prompt,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Deployment check failed:", error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export { router as deploymentRouter };
```

### 4️⃣ Backend: Service Layer (NEEDS CREATION)

```typescript
// File: extensions/cli/src/services/DeploymentService.ts (CREATE THIS FILE)

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export class DeploymentService {
  async checkDeployment(
    resourceName: string,
    window: string = "10m",
  ): Promise<{ logs: string; prompt: string }> {
    try {
      // 1. Extract logs using CLI
      const logs = await this.extractLogs(resourceName, window);

      // 2. Load and format prompt
      const prompt = await this.generateAIPrompt(logs);

      return { logs, prompt };
    } catch (error) {
      throw new Error(`Failed to check deployment: ${error}`);
    }
  }

  private async extractLogs(
    resourceName: string,
    window: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const command = "python";
      const args = [
        "-m",
        "standard_commandline_utility.deploy_api",
        resourceName,
        "--window",
        window,
        "--stream-only",
        "--out",
        "extracted_logs.txt",
      ];

      const proc = spawn(command, args, {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";
      let stdout = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`CLI failed: ${stderr}`));
          return;
        }

        // Read the extracted logs file
        const logsPath = path.join(process.cwd(), "extracted_logs.txt");
        if (fs.existsSync(logsPath)) {
          const logs = fs.readFileSync(logsPath, "utf-8");
          resolve(logs);
        } else {
          reject(new Error("Logs file not created"));
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });
  }

  private async generateAIPrompt(logs: string): Promise<string> {
    // Load deployment-check prompt from .continue/prompts
    const promptPath = path.join(
      process.cwd(),
      ".continue/prompts/deployment-check.md",
    );

    if (fs.existsSync(promptPath)) {
      const promptTemplate = fs.readFileSync(promptPath, "utf-8");
      // Extract the prompt section (after YAML frontmatter)
      const promptContent = promptTemplate.split("---").pop() || "";
      return promptContent.trim();
    }

    // Fallback prompt
    return `Analyze the following deployment logs and identify any errors or issues:

Logs:
\`\`\`
${logs}
\`\`\`

Please:
1. Identify any ERROR, EXCEPTION, or FAILED messages
2. Explain the root cause
3. Provide step-by-step solutions
4. Suggest prevention strategies`;
  }
}
```

### 5️⃣ CLI Command Reference

```bash
# From: standard_commandline_utility/deploy_api.py

# Extract logs for last 10 minutes
python -m standard_commandline_utility.deploy_api JalSaathi --window 10m --stream-only

# With keywords filter
python -m standard_commandline_utility.deploy_api JalSaathi \
  --window 10m \
  --keywords ERROR,Exception,Timeout \
  --stream-only \
  --out extracted_logs.txt

# With AWS profile
python -m standard_commandline_utility.deploy_api JalSaathi \
  --window 30m \
  --profile my-aws-profile \
  --region us-east-1 \
  --stream-only

# Without --stream-only (prints to stdout)
python -m standard_commandline_utility.deploy_api JalSaathi --window 5m
```

### 6️⃣ AI Prompt Template

```markdown
# From: .continue/prompts/deployment-check.md

---

name: Deployment Check
description: Extract and analyze deployment logs from the last 10 minutes, identify issues, and suggest fixes
enabled: true

---

# Deployment Check & Analysis

You are a deployment debugging expert. Analyze the provided deployment logs and help fix any issues.

**Your tasks:**

1. **Scan for Errors**: Look for ERROR, EXCEPTION, FAILED, Timeout, and Connection messages
2. **Identify Root Cause**: Explain what went wrong and why
3. **Provide Fixes**: Give clear step-by-step solutions
4. **Prevent Future Issues**: Suggest monitoring and prevention strategies

**Be:**

- Specific and actionable
- Focused on the most critical issues
- Clear about severity and impact
- Helpful in understanding the root cause

If logs are empty or unclear, ask the user for clarification about:

- What deployment was performed?
- What was the expected result?
- When did the issue occur?
```

---

## 🔄 API Request/Response Flow

### Request

```json
POST /api/deployment/check
Content-Type: application/json

{
  "resourceName": "JalSaathi",
  "window": "10m"
}
```

### Response (Success - 200)

```json
{
  "success": true,
  "logs": "[2026-03-20 10:15:32.123 ERROR] Connection timeout to database\n[2026-03-20 10:15:35.456 WARN] Retry attempt 1/3...",
  "prompt": "Analyze the following deployment logs and identify any errors or issues...",
  "timestamp": "2026-03-20T16:30:00Z"
}
```

### Response (Error - 500)

```json
{
  "success": false,
  "error": "Failed to extract logs: CLI command failed - AWS credentials not found"
}
```

---

## 📝 Component Checklist

- [x] DeploymentCheckButton.tsx - GUI component exists
- [x] Chat.tsx integration - Button is placed and wired
- [x] deployment-check.md prompt - AI prompt exists
- [x] standard_commandline_utility - Log extraction CLI exists
- [ ] DeploymentService.ts - Backend service (NEEDS CREATION)
- [ ] deploymentRouter.ts - API endpoint handler (NEEDS CREATION)
- [ ] Main Express app setup - Register routes (NEEDS UPDATE)

---

## 🚀 How It All Works Together

```
User clicks "Check Deployment" button
    ↓
DeploymentCheckButton.handleCheckDeployment() triggered
    ↓
POST /api/deployment/check { resourceName: "JalSaathi", window: "10m" }
    ↓
DeploymentRouter receives request
    ↓
DeploymentService.checkDeployment() called
    ↓
[1] Runs CLI: python -m standard_commandline_utility.deploy_api JalSaathi --window 10m --stream-only
    ↓
[2] Reads extracted_logs.txt file
    ↓
[3] Loads .continue/prompts/deployment-check.md template
    ↓
[4] Returns { logs, prompt } as JSON
    ↓
DeploymentCheckButton receives response
    ↓
Button status changes to "success" (green checkmark)
    ↓
onLogsExtracted(logs, prompt) callback triggered
    ↓
Chat component receives logs + prompt
    ↓
Message formatted: \`\`\`deployment-analysis\n${logs}\n\`\`\`\n\n${prompt}
    ↓
Message sent to Continue agent for analysis
    ↓
Agent responds with: Root cause analysis + fixes + prevention tips
```

---

## 💾 Environment Setup

```bash
# 1. Python environment must have standard_commandline_utility
pip install -r standard_commandline_utility/requirements.txt

# 2. AWS credentials must be configured (one of):
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
# OR
~/.aws/credentials (configured for profile)
# OR
IAM role on EC2 instance

# 3. Resource name must exist in AWS CloudWatch Logs
# e.g., Lambda function named "JalSaathi" with log group "/aws/lambda/JalSaathi"
```
