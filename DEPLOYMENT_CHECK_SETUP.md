# Deployment Check Integration Guide

This integration allows you to extract deployment logs directly from Continue and analyze them with AI to identify and fix issues.

## How It Works

1. **Extract Logs**: Click "Check Deployment" button → extracts logs from last 10 minutes
2. **AI Analysis**: Logs are sent to Continue AI agent with a deployment analysis prompt
3. **Identify Issues**: Agent analyzes errors, warnings, and anomalies
4. **Get Fixes**: Receive step-by-step solutions and prevention strategies

## Components

### 1. DeploymentService (`extensions/cli/src/services/DeploymentService.ts`)

- Runs the CLI command: `python -m standard_commandline_utility.deploy_api`
- Extracts logs to `extracted_logs.txt`
- Generates AI prompt for analysis

### 2. DeploymentCheckButton (`gui/src/components/DeploymentCheckButton.tsx`)

- UI Button component
- Shows loading/success/error states
- Calls the backend API

### 3. Deployment Router (`extensions/cli/src/routes/deploymentRouter.ts`)

- Express endpoint: `POST /api/deployment/check`
- Handles log extraction and AI prompt generation
- Sends logs to Continue agent

### 4. DeploymentAnalysisAgent (`extensions/cli/src/agents/DeploymentAnalysisAgent.ts`)

- Analyzes deployment logs
- Extracts error patterns
- Creates context for Continue agent

## Usage

### In Continue Chat UI

Add the button to your chat interface:

```tsx
import { DeploymentCheckButton } from "@/components/DeploymentCheckButton";

<DeploymentCheckButton
  resourceName="JalSaathi"
  onLogsExtracted={(logs, prompt) => {
    // Send to Continue agent
    sendMessageToAgent(prompt, logs);
  }}
  onError={(error) => {
    console.error(error);
  }}
/>;
```

### CLI Usage

Extract logs manually:

```bash
python -m standard_commandline_utility.deploy_api JalSaathi \
  --window 10m \
  --stream-only \
  --out extracted_logs.txt
```

Then read the file and send to Continue:

```bash
cat extracted_logs.txt | pbcopy  # Copy to clipboard
# Paste in Continue chat with the deployment-check prompt
```

## API Endpoints

### 1. Check Deployment & Extract Logs

```
POST /api/deployment/check
Content-Type: application/json

{
  "resourceName": "JalSaathi",
  "window": "10m"
}

Response:
{
  "success": true,
  "logs": "...",
  "prompt": "Analyze these logs...",
  "timestamp": "2026-03-20T..."
}
```

### 2. Send Logs to Agent

```
POST /api/deployment/send-to-agent
Content-Type: application/json

{
  "logs": "...",
  "prompt": "Analyze these logs...",
  "conversationId": "optional-id"
}

Response:
{
  "success": true,
  "message": "Logs sent to Continue AI agent for analysis",
  "conversationId": "..."
}
```

## Key Features

✅ **Automatic Log Extraction** - Last 10 minutes by default  
✅ **Error Pattern Detection** - Identifies ERROR, Exception, Timeout, etc.  
✅ **AI-Powered Analysis** - Clear root causes and solutions  
✅ **Prevention Tips** - Suggests how to avoid future issues  
✅ **Context Integration** - Sends full logs to Continue agent  
✅ **Status Indicators** - Loading, success, and error states

## Configuration

### Environment Variables

```
DEPLOYMENT_LOG_WINDOW=10m              # Time window (default: 10m)
DEPLOYMENT_LOG_FILE=extracted_logs.txt # Output file
AWS_PROFILE=your-profile               # AWS profile (optional)
AWS_REGION=us-east-1                   # AWS region (optional)
```

### Available Log Windows

- `5m` - Last 5 minutes
- `10m` - Last 10 minutes (default)
- `30m` - Last 30 minutes
- `1h` - Last 1 hour
- `6h` - Last 6 hours
- `24h` - Last 24 hours

## Integration with Continue Prompts

The prompt is available at:

```
.continue/prompts/deployment-check.md
```

Use in Continue with:

```
/deployment-check
<logs or paste logs here>
```

## Troubleshooting

### Logs are empty

- Check if the resource name is correct
- Increase the time window (e.g., `30m` instead of `10m`)
- Verify AWS credentials are configured

### API returning 500 error

- Ensure Python and `standard_commandline_utility` are installed
- Check AWS permissions for the resource
- View CLI output for detailed error messages

### Logs not showing errors clearly

- Increase window size to capture more data
- Use specific keywords with `--keywords ERROR,Exception`
- Scroll up for earlier errors

## Future Enhancements

- Real-time log streaming
- Multiple resource comparison
- Automated fix application
- Notification on critical errors
- Log retention and history
- Custom error detection rules
