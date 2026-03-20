# DeployGuru Deployment Check - Codebase Integration Map

This document maps all the components involved in the Deployment Check feature and how they should integrate.

---

## 1. 📍 **Logs File Location & Extraction**

### Where Logs Come From:

- **Type**: CloudWatch Logs (AWS)
- **Extraction Tool**: `standard_commandline_utility`
- **Output File**: `extracted_logs.txt` (default)
- **Default Time Window**: Last 10 minutes

### Log Extraction Command:

```bash
python -m standard_commandline_utility.deploy_api <resource-name> \
  --window 10m \
  --stream-only \
  --out extracted_logs.txt
```

### Relevant Files:

- [standard_commandline_utility/deploy_api.py](standard_commandline_utility/deploy_api.py) - CLI entry point
- [standard_commandline_utility/core/pipeline.py](standard_commandline_utility/core/pipeline.py) - Log fetching pipeline
- [standard_commandline_utility/README.md](standard_commandline_utility/README.md) - CLI documentation

### Key Features:

- Auto-resolves CloudWatch Log Group from resource name
- Configurable time windows (5m, 10m, 30m, 1h, 6h, 24h)
- Keyword filtering (ERROR, Exception, Timeout, etc.)
- Cross-stream extraction
- AWS credential/region resolution via boto3

---

## 2. 🔧 **Deployment Check Utility/Command**

### Command Specifications:

```bash
python -m standard_commandline_utility.deploy_api <resource-name> [flags]
```

### Arguments:

| Argument        | Type       | Default            | Description                       |
| --------------- | ---------- | ------------------ | --------------------------------- |
| `resource`      | positional | -                  | Lambda function name or log group |
| `--service`     | string     | lambda             | Service type (lambda, ec2, etc.)  |
| `--window`      | string     | 5m                 | Time window (e.g., 10m, 1h)       |
| `--keywords`    | string     | -                  | Comma-separated filter terms      |
| `--region`      | string     | -                  | AWS region override               |
| `--profile`     | string     | -                  | AWS CLI profile name              |
| `--max-events`  | integer    | -                  | Limit number of events            |
| `--stream-only` | flag       | -                  | Write to file instead of stdout   |
| `--out`         | string     | extracted_logs.txt | Output file path                  |

### Example Usage:

```python
# From deploy_api.py (lines 32-40)
return run_pipeline(
    resource=args.resource,
    service=args.service,
    window=args.window,
    keywords=keywords,
    region=args.region,
    profile=args.profile,
    max_events=args.max_events,
    stream_only=args.stream_only,
    out=args.out,
)
```

---

## 3. 📝 **GUI Textbox Component (Logs Display)**

### Component: DeploymentCheckButton

**File**: [gui/src/components/DeploymentCheckButton.tsx](gui/src/components/DeploymentCheckButton.tsx)

```tsx
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

  // Calls: POST /api/deployment/check
  // Response: { logs: string, prompt: string }
  // Callback: onLogsExtracted(logs, prompt)
};
```

### Features:

- ✅ Loading state with spinner
- ✅ Success state with green checkmark
- ✅ Error state with warning icon
- ✅ Calls `/api/deployment/check` endpoint
- ✅ Receives logs and prompt from backend
- ✅ Triggers `onLogsExtracted` callback with logs + AI prompt

### UI Output:

```
[⟳ Checking Deployment...] or [✓ Logs Extracted] or [⚠ Check Failed]
```

---

## 4. 🔘 **Submit Button Component**

### Parent Component: Chat.tsx

**File**: [gui/src/pages/gui/Chat.tsx](gui/src/pages/gui/Chat.tsx) (lines 502-512)

```tsx
<DeploymentCheckButton
  resourceName="JalSaathi"
  onLogsExtracted={(logs, prompt) => {
    // Send logs and prompt to chat
    const message = `\`\`\`deployment-analysis\n${logs}\n\`\`\`\n\n${prompt}`;
    // You can dispatch this to send message to agent
    console.log("Logs extracted:", logs);
  }}
  onError={(error) => {
    console.error("Deployment check failed:", error);
  }}
/>
```

### Flow:

```
1. User clicks "Check Deployment" button (DeploymentCheckButton)
   ↓
2. Button calls POST /api/deployment/check with resourceName="JalSaathi" and window="10m"
   ↓
3. Backend (NOT YET IMPLEMENTED) extracts logs
   ↓
4. Backend returns { logs: string, prompt: string }
   ↓
5. onLogsExtracted callback fires with logs + prompt
   ↓
6. Message is constructed and can be sent to chat agent
   ↓
7. Continue agent receives logs with deployment-check prompt
```

### Message Format for Chat:

```
\`\`\`deployment-analysis
[extracted logs here]
\`\`\`

[AI prompt for analysis here]
```

---

## 5. 🚀 **DeploymentCheckButton Integration**

### Current Status:

- ✅ Button component exists and is imported
- ✅ Button is placed in Chat.tsx
- ✅ UI has loading/success/error states
- ❌ **API endpoint `/api/deployment/check` NOT YET IMPLEMENTED**
- ❌ **Backend service to run CLI command NOT YET IMPLEMENTED**

### What Needs to Be Implemented:

#### A. Backend API Endpoint

**Location**: `extensions/cli/src/routes/deploymentRouter.ts` (needs to be created)

```typescript
// POST /api/deployment/check
// Request: { resourceName: string, window: string }
// Response: { success: true, logs: string, prompt: string, timestamp: string }
```

#### B. Backend Service

**Location**: `extensions/cli/src/services/DeploymentService.ts` (needs to be created)

```typescript
class DeploymentService {
  async extractLogs(resourceName: string, window: string): Promise<string>;
  // - Executes: python -m standard_commandline_utility.deploy_api <resourceName> --window <window> --stream-only
  // - Returns: content of extracted_logs.txt

  async generateAIPrompt(logs: string): Promise<string>;
  // - Loads: .continue/prompts/deployment-check.md
  // - Injects logs into prompt context
  // - Returns: formatted prompt
}
```

---

## 6. 📚 **AI Prompt Template**

### Location:

[.continue/prompts/deployment-check.md](.continue/prompts/deployment-check.md)

### Content:

```markdown
---
name: Deployment Check
description: Extract and analyze deployment logs from the last 10 minutes
enabled: true
---

# Deployment Check & Analysis

You are a deployment debugging expert. Analyze the provided deployment logs.

**Tasks:**

1. **Scan for Errors**: Look for ERROR, EXCEPTION, FAILED, Timeout, Connection
2. **Identify Root Cause**: Explain what went wrong and why
3. **Provide Fixes**: Give clear step-by-step solutions
4. **Prevent Future Issues**: Suggest monitoring strategies

**Be:** Specific, actionable, focused on critical issues
```

---

## 7. 🔗 **JSON API Contracts**

### Endpoint 1: Check Deployment & Extract Logs

```
POST /api/deployment/check
Content-Type: application/json

REQUEST:
{
  "resourceName": "JalSaathi",
  "window": "10m"
}

RESPONSE (200 OK):
{
  "success": true,
  "logs": "[2026-03-20 10:15:32 ERROR] Connection timeout...",
  "prompt": "Analyze these logs...",
  "timestamp": "2026-03-20T16:30:00Z"
}

RESPONSE (500 Error):
{
  "success": false,
  "error": "Failed to extract logs: [error details]"
}
```

### Endpoint 2: Send Logs to Agent (Future)

```
POST /api/deployment/send-to-agent
Content-Type: application/json

REQUEST:
{
  "logs": "...",
  "prompt": "Analyze these logs...",
  "conversationId": "optional-id"
}

RESPONSE:
{
  "success": true,
  "message": "Logs sent to Continue AI agent for analysis",
  "conversationId": "..."
}
```

---

## 8. 📊 **Component Data Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│ Chat.tsx (gui/src/pages/gui/Chat.tsx)                           │
│                                                                 │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ DeploymentCheckButton                                    │   │
│ │ resourceName="JalSaathi"                                 │   │
│ │ onLogsExtracted={(logs, prompt) => {...}}               │   │
│ │ onError={(error) => {...}}                              │   │
│ └──────────────────────────────────────────────────────────┘   │
│          │                                                       │
│          │ User clicks button                                    │
│          │                                                       │
│          ├─→ POST /api/deployment/check                         │
│          │   { resourceName: "JalSaathi", window: "10m" }       │
│          │                                                       │
│          │   [Backend - NOT YET IMPLEMENTED]                    │
│          │   1. Run CLI: python -m standard_commandline_utility │
│          │   2. Read extracted_logs.txt                          │
│          │   3. Load .continue/prompts/deployment-check.md      │
│          │   4. Return { logs, prompt } JSON                    │
│          │                                                       │
│          ←─ Response: { logs, prompt }                          │
│          │                                                       │
│          └─→ onLogsExtracted(logs, prompt)                      │
│              Format message and send to chat                    │
│              Message to Continue Agent with analysis prompt     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. 📂 **File Structure Summary**

### GUI Components:

```
gui/
├── src/
│   ├── components/
│   │   └── DeploymentCheckButton.tsx ✅ (EXISTS)
│   └── pages/
│       └── gui/
│           └── Chat.tsx ✅ (EXISTS, uses button)
└── ...
```

### Backend (CLI Extension):

```
extensions/cli/
├── src/
│   ├── routes/
│   │   └── deploymentRouter.ts ❌ (NEEDS CREATION)
│   ├── services/
│   │   └── DeploymentService.ts ❌ (NEEDS CREATION)
│   └── ...
└── ...
```

### Configuration & Utility:

```
.continue/
└── prompts/
    └── deployment-check.md ✅ (EXISTS)

standard_commandline_utility/
├── deploy_api.py ✅ (ENTRY POINT)
├── core/
│   └── pipeline.py ✅ (FETCHES LOGS)
└── README.md ✅ (DOCUMENTATION)
```

---

## 10. 🔑 **Key Integration Points**

| Component                        | Status     | Purpose                             |
| -------------------------------- | ---------- | ----------------------------------- |
| DeploymentCheckButton.tsx        | ✅ Exists  | UI trigger and state management     |
| Chat.tsx integration             | ✅ Exists  | Parent component, callback handling |
| deployment-check.md prompt       | ✅ Exists  | AI analysis instructions            |
| standard_commandline_utility CLI | ✅ Exists  | CloudWatch log extraction           |
| POST /api/deployment/check       | ❌ Missing | Backend API endpoint                |
| DeploymentService.ts             | ❌ Missing | Backend service logic               |
| deploymentRouter.ts              | ❌ Missing | Express route handler               |

---

## 11. 📋 **Implementation Checklist**

- [ ] Create `extensions/cli/src/services/DeploymentService.ts`

  - [ ] Implement `extractLogs(resourceName, window)` method
  - [ ] Implement `generateAIPrompt(logs)` method
  - [ ] Handle CLI execution and error cases

- [ ] Create `extensions/cli/src/routes/deploymentRouter.ts`

  - [ ] POST /api/deployment/check endpoint
  - [ ] Validate request parameters
  - [ ] Call DeploymentService
  - [ ] Return JSON response

- [ ] Update `extensions/cli/src/index.ts` or main Express setup

  - [ ] Register deploymentRouter routes

- [ ] Test integration end-to-end
  - [ ] Button click → API call → CLI execution → Log extraction → Response
  - [ ] Error handling for missing AWS credentials
  - [ ] Error handling for invalid resource names

---

## 12. 🎯 **Next Steps**

1. **Implement Backend Endpoint**:

   - Create deployment service to orchestrate CLI calls
   - Register Express route handler
   - Add error handling and logging

2. **Setup Environment**:

   - Ensure Python environment has standard_commandline_utility
   - Verify AWS credentials are available in deployment context
   - Configure allowed resource names

3. **Wire Up Agent Message Sending**:

   - Currently logs are logged to console in Chat.tsx
   - Need to actually send the message to Continue agent
   - Implement missing flow in onLogsExtracted callback

4. **Testing**:
   - Manual testing with real AWS resources
   - Unit tests for CLI invocation
   - E2E tests for full flow

---

## 📖 **Reference Files**

- [DEPLOYMENT_CHECK_SETUP.md](DEPLOYMENT_CHECK_SETUP.md) - Original setup guide
- [gui/src/components/DeploymentCheckButton.tsx](gui/src/components/DeploymentCheckButton.tsx) - Button component
- [gui/src/pages/gui/Chat.tsx](gui/src/pages/gui/Chat.tsx#L502) - Integration point
- [.continue/prompts/deployment-check.md](.continue/prompts/deployment-check.md) - AI prompt
- [standard_commandline_utility/README.md](standard_commandline_utility/README.md) - CLI docs
