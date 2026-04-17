/**
 * Simple Node.js Express server to test the deployment check API
 * Run: node test-deployment-api.js
 * Then test: curl -X POST http://localhost:8080/api/deployment/run-command -H "Content-Type: application/json" -d '{"resourceName":"JalSaathi","window":"10m"}'
 */

const express = require("express");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

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

        // Check if logs are empty - be very explicit
        const isLogsEmpty = logs === "" || logs === null || logs.trim() === "";
        console.log(
          `📊 Logs empty check: ${isLogsEmpty} (logs length: ${logs.length})`,
        );

        if (isLogsEmpty) {
          console.warn(
            `⚠️  Logs file is empty - returning NO LOGS error response`,
          );
          return res.status(500).json({
            success: false,
            error: `No log streams have events in the requested window for resource "${resourceName}".`,
            logs: "",
          });
        }

        console.log(`✓ Logs have content, returning success response`);
        // Return success response
        return res.json({
          success: true,
          logs: logs,
          resourceName: resourceName,
          fileExists: fileExists,
          timestamp: new Date().toISOString(),
        });
      } else {
        // No logs file - return proper error
        console.warn(`⚠️  Logs file not found at ${logsFilePath}`);
        return res.status(500).json({
          success: false,
          error: `No log streams have events in the requested window for resource "${resourceName}".`,
          logs: "",
        });
      }
    } catch (fileError) {
      console.error(`❌ Failed to read logs file: ${fileError.message}`);
      return res.status(500).json({
        success: false,
        error: `Error reading logs: ${fileError.message}`,
        logs: "",
      });
    }
  } catch (error) {
    console.error(`❌ Deployment endpoint error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: `Failed to run deployment command: ${error.message}`,
      logs: "",
    });
  }
});

const server = app.listen(PORT, HOST, () => {
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

server.on("error", (error) => {
  console.error("❌ Server error:", error.message);
});

server.on("close", () => {
  console.warn("⚠️  Server closed.");
});

process.on("beforeExit", (code) => {
  console.warn(`⚠️  Node beforeExit with code ${code}`);
});

process.on("exit", (code) => {
  console.warn(`ℹ️  Node process exiting with code ${code}`);
});

process.on("SIGTERM", () => {
  console.warn("⚠️  Received SIGTERM, shutting down test server...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.warn("⚠️  Received SIGINT, shutting down test server...");
  server.close(() => process.exit(0));
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled rejection:", reason);
});

// Keep stdin open in environments that may auto-exit background-like processes.
if (!process.stdin.isTTY) {
  process.stdin.resume();
}
