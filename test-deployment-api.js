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

// Store for active debug sessions
const activeSessions = new Map();

// Middleware
app.use(express.json());

// CORS headers middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  // Prevent authentication prompts
  res.header("WWW-Authenticate", "none");
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

// Single log file for live debug sessions
const LIVE_DEBUG_LOG_FILE = path.join(
  "/workspaces/DeployGuru",
  "live_debug_session.txt",
);

// Function to generate sample log entries with timestamps
function generateNewLogEntries() {
  const logLevels = ["INFO", "DEBUG", "WARN", "ERROR"];
  const services = [
    "service-a",
    "service-b",
    "database",
    "auth",
    "api-gateway",
  ];
  const actions = [
    "Request received",
    "Processing data",
    "Query executed",
    "Cache hit",
    "Authentication failed",
    "Connection timeout",
    "Reconnecting",
    "Data validated",
  ];

  const now = new Date();
  const entries = [];

  // Generate 2-3 random log entries
  const count = Math.floor(Math.random() * 2) + 2;
  for (let i = 0; i < count; i++) {
    const level = logLevels[Math.floor(Math.random() * logLevels.length)];
    const service = services[Math.floor(Math.random() * services.length)];
    const action = actions[Math.floor(Math.random() * actions.length)];
    const timestamp = new Date(now.getTime() - Math.random() * 1000);

    entries.push(
      `${timestamp.toISOString()} [${level}] [${service}] ${action}`,
    );
  }

  return entries.join("\n");
}

// Start a live debug session with continuous polling
app.post("/api/deployment/live/start", (req, res) => {
  try {
    const { resourceName, pollIntervalSeconds, pollWindow } = req.body;

    console.log(`\n📨 [API REQUEST] /api/deployment/live/start received`);
    console.log(`   ├─ resourceName: ${resourceName}`);
    console.log(`   ├─ pollIntervalSeconds: ${pollIntervalSeconds}`);
    console.log(`   └─ pollWindow: ${pollWindow}`);

    if (!resourceName) {
      return res.status(400).json({ error: "resourceName is required" });
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session = {
      resourceName,
      startTime: new Date(),
      status: "running",
      pollInterval: pollIntervalSeconds || 15,
      pollWindow: pollWindow || "2m",
      collectedLogs: [],
      logCount: 0,
      pollCount: 0,
    };

    activeSessions.set(sessionId, session);

    console.log(
      `\n🐛 [LIVE DEBUG] Started debug session ${sessionId} for ${resourceName}`,
    );
    console.log(`   ├─ Poll Interval: ${pollIntervalSeconds}s`);
    console.log(`   └─ Poll Window: ${pollWindow}`);

    // Start continuous polling loop
    const pollInterval = (pollIntervalSeconds || 15) * 1000;

    const pollingTimer = setInterval(() => {
      if (!activeSessions.has(sessionId)) {
        clearInterval(pollingTimer);
        return;
      }

      const currentSession = activeSessions.get(sessionId);
      const newLogs = generateNewLogEntries();
      currentSession.collectedLogs.push(newLogs);
      currentSession.logCount += newLogs.split("\n").length;
      currentSession.pollCount += 1;

      console.log(
        `   📊 [POLL #${currentSession.pollCount}] Collected ${newLogs.split("\n").length} new log entries (Total: ${currentSession.logCount})`,
      );
    }, pollInterval);

    // Store the interval timer so we can clear it on stop
    session.pollingTimer = pollingTimer;

    res.json({
      success: true,
      sessionId: sessionId,
      message: `Debug session started for ${resourceName}. Polling every ${pollIntervalSeconds || 15}s for logs in the last ${pollWindow || "2m"}...`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`❌ Failed to start debug session: ${error.message}`);
    res.status(500).json({
      success: false,
      error: `Failed to start debug session: ${error.message}`,
    });
  }
});

// Stop a live debug session and return collected logs
app.post("/api/deployment/live/stop", (req, res) => {
  try {
    const { sessionId } = req.body;

    console.log(`\n📨 [API REQUEST] /api/deployment/live/stop received`);
    console.log(`   └─ sessionId: ${sessionId}`);

    if (!sessionId) {
      console.error(`❌ sessionId is required`);
      return res.status(400).json({ error: "sessionId is required" });
    }

    if (!activeSessions.has(sessionId)) {
      console.error(`❌ Session ${sessionId} not found`);
      return res.status(404).json({
        success: false,
        error: `Session ${sessionId} not found`,
      });
    }

    const session = activeSessions.get(sessionId);

    // Stop the polling timer
    if (session.pollingTimer) {
      clearInterval(session.pollingTimer);
    }

    activeSessions.delete(sessionId);

    console.log(
      `\n🛑 [LIVE DEBUG] Stopped debug session ${sessionId} for ${session.resourceName}`,
    );
    console.log(`   ├─ Total poll cycles: ${session.pollCount}`);
    console.log(`   ├─ Total log entries: ${session.logCount}`);

    // Compile final logs
    const finalLogs = `[LIVE DEBUG SESSION LOGS]
Resource: ${session.resourceName}
Session ID: ${sessionId}
Started: ${session.startTime.toISOString()}
Ended: ${new Date().toISOString()}
Duration: ${Math.round((Date.now() - session.startTime.getTime()) / 1000)}s
Poll Interval: ${session.pollInterval}s
Poll Window: ${session.pollWindow}
Total Polls: ${session.pollCount}
Total Log Entries: ${session.logCount}

════════════════════════════════════════════════════════════

COLLECTED LOGS:

${session.collectedLogs.join("\n")}

════════════════════════════════════════════════════════════`;

    const summary = {
      totalLines: finalLogs.split("\n").length,
      errorCount: (finalLogs.match(/\[ERROR\]/g) || []).length,
      warningCount: (finalLogs.match(/\[WARN\]/g) || []).length,
      totalLogEntries: session.logCount,
      pollCycles: session.pollCount,
    };

    console.log(`   └─ Summary: ${JSON.stringify(summary)}`);

    // Save logs to file
    try {
      fs.writeFileSync(LIVE_DEBUG_LOG_FILE, finalLogs, "utf-8");
      console.log(`\n✅ [FILE SAVED] Live debug logs saved to:`);
      console.log(`   📄 ${LIVE_DEBUG_LOG_FILE}\n`);
    } catch (fileError) {
      console.error(
        `❌ [FILE ERROR] Failed to save logs file: ${fileError.message}`,
      );
    }

    res.json({
      success: true,
      sessionId: sessionId,
      logs: finalLogs,
      summary: summary,
      logsFile: path.basename(LIVE_DEBUG_LOG_FILE),
      logsFilePath: LIVE_DEBUG_LOG_FILE,
      message: `Debug session stopped. Collected ${session.logCount} log entries over ${session.pollCount} poll cycles.`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`❌ Failed to stop debug session: ${error.message}`);
    res.status(500).json({
      success: false,
      error: `Failed to stop debug session: ${error.message}`,
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

3️⃣  Live Debug Start:
   curl -X POST http://localhost:${PORT}/api/deployment/live/start \
     -H "Content-Type: application/json" \
     -d '{"resourceName":"JalSaathi","pollIntervalSeconds":15,"pollWindow":"2m"}'

4️⃣  Live Debug Stop:
   curl -X POST http://localhost:${PORT}/api/deployment/live/stop \
     -H "Content-Type: application/json" \
     -d '{"sessionId":"<sessionId>"}'

5️⃣  Browser Test:
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
