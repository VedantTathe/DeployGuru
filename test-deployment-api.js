/**
 * Simple Node.js Express server to test the deployment check API
 * Run: node test-deployment-api.js
 * Then test: curl -X POST http://localhost:8000/api/deployment/run-command -H "Content-Type: application/json" -d '{"resourceName":"JalSaathi","window":"10m"}'
 */

const express = require("express");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 8000;

// Middleware
app.use(express.json());

// CORS headers middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  });
});

// Deployment run-command endpoint
app.post("/api/deployment/run-command", async (req, res) => {
  try {
    const { resourceName, window: timeWindow } = req.body;

    if (!resourceName) {
      return res.status(400).json({ error: "resourceName is required" });
    }

    console.log(`\n📋 Received deployment check request for: ${resourceName}`);

    // Build the command to execute
    const deployCommand = `python -m standard_commandline_utility.deploy_api ${resourceName} --window ${timeWindow || "10m"} --stream-only --out extracted_logs.txt`;

    console.log(`⚙️  Executing command: ${deployCommand}`);

    // Execute the command
    let commandOutput = "";
    let errorOutput = "";
    let execError = null;

    try {
      commandOutput = execSync(deployCommand, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.cwd(),
      });
      console.log("✅ Deployment command executed successfully");
    } catch (error) {
      execError = error;
      errorOutput = error.stderr ? error.stderr.toString() : error.message;
      console.warn(
        `⚠️  Command execution failed with error:\n${errorOutput.substring(0, 500)}`,
      );
    }

    // Wait for file to be written
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Read the extracted logs file
    const logsFilePath = path.join(process.cwd(), "extracted_logs.txt");
    let logs = "";
    let fileExists = false;

    try {
      fileExists = fs.existsSync(logsFilePath);
      if (fileExists) {
        logs = fs.readFileSync(logsFilePath, "utf-8");
        console.log(
          `✅ Successfully read logs from ${logsFilePath} (${logs.length} bytes)`,
        );
      } else {
        logs =
          commandOutput || "No logs file found and no command output available";
        console.warn(`⚠️  Logs file not found at ${logsFilePath}`);
      }
    } catch (fileError) {
      console.error(`❌ Failed to read logs file: ${fileError.message}`);
      logs = commandOutput || `Error reading logs: ${fileError.message}`;
    }

    res.json({
      success: true,
      logs: logs,
      resourceName: resourceName,
      fileExists: fileExists,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`❌ Deployment endpoint error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: `Failed to run deployment command: ${error.message}`,
      logs: "",
    });
  }
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║  🚀 Test Deployment API Server Running!               ║
╚════════════════════════════════════════════════════════╝

📍 Server: http://localhost:${PORT}

🧪 Test Endpoints:

1️⃣  Health Check:
   curl http://localhost:${PORT}/api/health

2️⃣  Deployment Command:
   curl -X POST http://localhost:${PORT}/api/deployment/run-command \
     -H "Content-Type: application/json" \
     -d '{"resourceName":"JalSaathi","window":"10m"}'

3️⃣  Browser Test:
   Open in browser: http://localhost:${PORT}/api/health

Press CTRL+C to stop the server
════════════════════════════════════════════════════════
  `);
});
