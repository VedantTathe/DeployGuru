/**
 * Simple Node.js Express server to test the deployment check API
 * Run: node test-deployment-api.js
 * Then test: curl -X POST http://localhost:8081/api/deployment/run-command -H "Content-Type: application/json" -d '{"resourceName":"JalSaathi","window":"10m"}'
 */

const express = require("express");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || "0.0.0.0";

// Store for active debug sessions
const activeSessions = new Map();

// Middleware
app.use(express.json());

// Simple CORS middleware - allow everything
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD",
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, X-Requested-With, Origin",
  );
  res.header("Access-Control-Max-Age", "86400");

  // Handle preflight (OPTIONS) requests
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

const DEBUG_SESSIONS_DIR = path.join(process.cwd(), ".debug-sessions");

function ensureDebugSessionsDir() {
  if (!fs.existsSync(DEBUG_SESSIONS_DIR)) {
    fs.mkdirSync(DEBUG_SESSIONS_DIR, { recursive: true });
  }
}

function pollLiveDebugSession(session) {
  try {
    const deployCommand =
      `python -m standard_commandline_utility.deploy_api ${session.resourceName} ` +
      `--start-time ${session.sessionStartTimeMs} --stream-only --out "${session.logsFilePath}"`;

    execSync(deployCommand, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    session.lastPollAt = Date.now();
    session.pollCount += 1;
    console.log(
      `   📊 [POLL #${session.pollCount}] Synced CloudWatch logs to ${path.basename(session.logsFilePath)}`,
    );
  } catch (error) {
    const stderr = error?.stderr ? error.stderr.toString() : error.message;
    console.warn(
      `   ⚠️  [POLL ERROR #${session.pollCount + 1}] Failed to fetch CloudWatch logs: ${stderr.substring(0, 500)}`,
    );
  }
}

// Start a live debug session with continuous polling
app.post("/api/deployment/live/start", (req, res) => {
  try {
    const { resourceName, pollIntervalSeconds, pollWindow, sessionStartTime } =
      req.body;

    console.log(`\n📨 [API REQUEST] /api/deployment/live/start received`);
    console.log(`   ├─ resourceName: ${resourceName}`);
    console.log(`   ├─ pollIntervalSeconds: ${pollIntervalSeconds}`);
    console.log(`   └─ pollWindow: ${pollWindow}`);

    if (!resourceName) {
      return res.status(400).json({ error: "resourceName is required" });
    }

    const requestedStartTime = Number(sessionStartTime);
    const sessionStartTimeMs = Number.isFinite(requestedStartTime)
      ? Math.floor(requestedStartTime)
      : Date.now();

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    ensureDebugSessionsDir();
    const logsFilePath = path.join(DEBUG_SESSIONS_DIR, `${sessionId}.txt`);

    const session = {
      resourceName,
      startTime: new Date(),
      status: "running",
      pollInterval: pollIntervalSeconds || 15,
      pollWindow: pollWindow || "2m",
      sessionStartTimeMs,
      logsFilePath,
      pollCount: 0,
      lastPollAt: null,
    };

    activeSessions.set(sessionId, session);

    console.log(
      `\n🐛 [LIVE DEBUG] Started debug session ${sessionId} for ${resourceName}`,
    );
    console.log(`   ├─ Poll Interval: ${pollIntervalSeconds}s`);
    console.log(`   └─ Poll Window: ${pollWindow}`);

    // Prime file and start continuous CloudWatch polling loop
    fs.writeFileSync(
      logsFilePath,
      `[${new Date().toISOString()}] Live debug session started for ${resourceName}\n` +
        `[${new Date().toISOString()}] Session window start (UTC epoch ms): ${sessionStartTimeMs}\n`,
      "utf-8",
    );

    const pollInterval = (pollIntervalSeconds || 15) * 1000;

    pollLiveDebugSession(session);

    const pollingTimer = setInterval(() => {
      if (!activeSessions.has(sessionId)) {
        clearInterval(pollingTimer);
        return;
      }

      const currentSession = activeSessions.get(sessionId);
      pollLiveDebugSession(currentSession);
    }, pollInterval);

    // Store the interval timer so we can clear it on stop
    session.pollingTimer = pollingTimer;

    res.json({
      success: true,
      sessionId: sessionId,
      sessionStartTime: sessionStartTimeMs,
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
    // Read final logs from CloudWatch output file
    let finalLogs = "";
    if (fs.existsSync(session.logsFilePath)) {
      finalLogs = fs.readFileSync(session.logsFilePath, "utf-8");
    }

    const nonEmptyLines = finalLogs
      .split("\n")
      .filter((line) => line.trim().length > 0);

    const summary = {
      totalLines: nonEmptyLines.length,
      errorCount: (finalLogs.match(/\[ERROR\]/g) || []).length,
      warningCount: (finalLogs.match(/\[WARN\]/g) || []).length,
      totalLogEntries: nonEmptyLines.length,
      pollCycles: session.pollCount,
      sessionDurationSeconds: Math.round(
        (Date.now() - session.startTime.getTime()) / 1000,
      ),
      logsFilePath: session.logsFilePath,
    };

    console.log(`   └─ Summary: ${JSON.stringify(summary)}`);

    console.log(`\n✅ [FILE SAVED] Live debug logs saved to:`);
    console.log(`   📄 ${session.logsFilePath}\n`);

    res.json({
      success: true,
      sessionId: sessionId,
      logs: finalLogs,
      summary: summary,
      logsFile: path.basename(session.logsFilePath),
      logsFilePath: session.logsFilePath,
      message: `Debug session stopped. Synced logs over ${session.pollCount} poll cycles.`,
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
