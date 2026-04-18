import chalk from "chalk";
import type { ChatHistoryItem } from "core/index.js";
import express, { Request, Response } from "express";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

import { ToolPermissionServiceState } from "src/services/ToolPermissionService.js";
import { posthogService } from "src/telemetry/posthogService.js";
import { prependPrompt } from "src/util/promptProcessor.js";

import { getAccessToken, getAssistantSlug } from "../auth/workos.js";
import { runEnvironmentInstallSafe } from "../environment/environmentHandler.js";
import { processCommandFlags } from "../flags/flagProcessor.js";
import { setAgentId } from "../index.js";
import { toolPermissionManager } from "../permissions/permissionManager.js";
import {
  getService,
  initializeServices,
  SERVICE_NAMES,
  services,
} from "../services/index.js";
import {
  AgentFileServiceState,
  AuthServiceState,
  ConfigServiceState,
  ModelServiceState,
} from "../services/types.js";
import {
  createSession,
  getCompleteStateSnapshot,
  loadOrCreateSessionById,
} from "../session.js";
import { messageQueue } from "../stream/messageQueue.js";
import { constructSystemMessage } from "../systemMessage.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import { reportFailureTool } from "../tools/reportFailure.js";
import { gracefulExit, updateAgentMetadata } from "../util/exit.js";
import { formatError } from "../util/formatError.js";
import { getGitDiffSnapshot } from "../util/git.js";
import { logger } from "../util/logger.js";
import { readStdinSync } from "../util/stdin.js";

import { ExtendedCommandOptions } from "./BaseCommandOptions.js";
import {
  checkAgentComplete,
  removePartialAssistantMessage,
  streamChatResponseWithInterruption,
  type ServerState,
} from "./serve.helpers.js";

interface ServeOptions extends ExtendedCommandOptions {
  timeout?: string;
  port?: string;
  /** Storage identifier for remote sync */
  id?: string;
}

/**
 * Decide whether to enqueue the initial prompt on server startup.
 * We only want to send it when starting a brand-new session; if any non-system
 * messages already exist (e.g., after resume), skip to avoid replaying.
 */
export function shouldQueueInitialPrompt(
  history: ChatHistoryItem[],
  prompt?: string | null,
): boolean {
  if (!prompt) {
    return false;
  }

  // If there are any non-system messages, we already have conversation context
  const hasConversation = history.some(
    (item) => item.message.role !== "system",
  );
  return !hasConversation;
}

// eslint-disable-next-line max-statements
export async function serve(prompt?: string, options: ServeOptions = {}) {
  await posthogService.capture("sessionStart", {});

  // Set agent ID for error reporting if provided
  setAgentId(options.id);

  // Check if prompt should come from stdin instead of parameter
  let actualPrompt = prompt;
  if (!prompt) {
    // Try to read from stdin (for piped input like: cat file | cn serve)
    const stdinInput = readStdinSync();
    if (stdinInput) {
      actualPrompt = stdinInput;
    }
  }

  const timeoutSeconds = parseInt(options.timeout || "300", 10);
  const timeoutMs = timeoutSeconds * 1000;
  const port = parseInt(options.port || "8000", 10);

  // Environment install script will be deferred until after server startup to avoid blocking

  // Initialize services with tool permission overrides
  const { permissionOverrides } = processCommandFlags(options);

  await initializeServices({
    options,
    toolPermissionOverrides: permissionOverrides,
    headless: true, // Skip onboarding in serve mode
  });

  // Get initialized services from the service container
  const [configState, modelState, permissionsState, agentFileState] =
    await Promise.all([
      getService<ConfigServiceState>(SERVICE_NAMES.CONFIG),
      getService<ModelServiceState>(SERVICE_NAMES.MODEL),
      getService<ToolPermissionServiceState>(SERVICE_NAMES.TOOL_PERMISSIONS),
      getService<AgentFileServiceState>(SERVICE_NAMES.AGENT_FILE),
    ]);

  if (!configState.config || !modelState.llmApi || !modelState.model) {
    throw new Error("Failed to initialize required services");
  }

  const { config, llmApi, model } = {
    config: configState.config,
    llmApi: modelState.llmApi,
    model: modelState.model,
  };

  // Organization selection is already handled in initializeServices
  const authState = await getService<AuthServiceState>(SERVICE_NAMES.AUTH);
  if (authState.organizationId) {
    telemetryService.updateOrganization(authState.organizationId);
  }
  const accessToken = getAccessToken(authState.authConfig);

  // Log configuration information
  const organizationId = authState.organizationId || "personal";
  const assistantName = config.name;
  const assistantSlug = getAssistantSlug(authState.authConfig);
  const modelProvider = model.provider;
  const modelName = model.model;

  console.log(chalk.blue(`\nConfiguration:`));
  console.log(chalk.dim(`  Organization: ${organizationId}`));
  console.log(
    chalk.dim(
      `  Assistant: ${assistantName}${
        assistantSlug ? ` (${assistantSlug})` : ""
      }`,
    ),
  );
  console.log(chalk.dim(`  Model: ${modelProvider}/${modelName}`));
  if (options.config) {
    console.log(chalk.dim(`  Config file: ${options.config}`));
  }

  // Initialize session with system message
  const systemMessage = await constructSystemMessage(
    permissionsState.currentMode,
    options.rule,
    undefined,
    true,
  );

  const initialHistory: ChatHistoryItem[] = [];
  if (systemMessage) {
    initialHistory.push({
      message: { role: "system" as const, content: systemMessage },
      contextItems: [],
    });
  }

  const trimmedId = options.id?.trim();
  const session =
    trimmedId && trimmedId.length > 0
      ? loadOrCreateSessionById(trimmedId, initialHistory)
      : createSession(initialHistory);

  // Align ChatHistoryService with server session and enable remote mode
  try {
    await services.chatHistory.initialize(session, false);
  } catch {
    // Fallback: continue even if service init fails; stream will still work with arrays
  }

  // Initialize server state
  const state: ServerState = {
    session,
    config,
    model,
    isProcessing: false,
    lastActivity: Date.now(),
    currentAbortController: null,
    serverRunning: true,
    pendingPermission: null,
  };

  const syncSessionHistory = () => {
    try {
      state.session.history = services.chatHistory.getHistory();
    } catch (e) {
      logger.debug(
        `Failed to sync session history from ChatHistoryService: ${formatError(e)}`,
      );
    }
  };

  const storageSyncService = services.storageSync;
  let storageSyncActive = await storageSyncService.startFromOptions({
    storageOption: options.id,
    accessToken,
    syncSessionHistory,
    getCompleteStateSnapshot: () =>
      getCompleteStateSnapshot(
        state.session,
        state.isProcessing,
        messageQueue.getQueueLength(),
        state.pendingPermission,
      ),
    isActive: () => state.serverRunning,
  });

  const stopStorageSync = () => {
    if (storageSyncActive) {
      storageSyncService.stop();
      storageSyncActive = false;
    }
  };

  // Record session start
  telemetryService.recordSessionStart();
  telemetryService.startActiveTime();

  const app = express();
  app.use(express.json());

  // GET /state - Return the current state
  app.get("/state", (_req: Request, res: Response) => {
    state.lastActivity = Date.now();
    syncSessionHistory();
    const stateSnapshot = getCompleteStateSnapshot(
      state.session,
      state.isProcessing,
      messageQueue.getQueueLength(),
      state.pendingPermission,
    );
    res.json(stateSnapshot);
  });

  // POST /message - Queue a message and potentially interrupt
  app.post("/message", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();

    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message field is required" });
    }

    // Queue the message
    await messageQueue.enqueueMessage(message);

    res.json({
      queued: true,
      position: messageQueue.getQueueLength(),
    });

    // Process messages if not already processing
    if (!state.isProcessing) {
      processMessages(state, llmApi);
    }
  });

  // POST /permission - Approve or reject pending tool permission
  app.post("/permission", async (req: Request, res: Response) => {
    state.lastActivity = Date.now();

    const { requestId, approved } = req.body;

    if (!state.pendingPermission) {
      return res.status(400).json({ error: "No pending permission request" });
    }

    if (state.pendingPermission.requestId !== requestId) {
      return res.status(400).json({ error: "Invalid request ID" });
    }

    // Remove the permission request message if it exists
    // Permission requests are handled separately in unified format

    // Send the permission response to the toolPermissionManager
    if (approved) {
      toolPermissionManager.approveRequest(requestId);
    } else {
      toolPermissionManager.rejectRequest(requestId);
    }

    // Clear pending permission state
    state.pendingPermission = null;

    res.json({
      success: true,
      approved,
    });
  });

  // POST /pause - Pause the current agent run (like pressing escape in TUI)
  app.post("/pause", async (_req: Request, res: Response) => {
    state.lastActivity = Date.now();

    // Check if there's anything to pause
    if (!state.isProcessing) {
      return res.json({
        success: false,
        message: "No active processing to pause",
      });
    }

    // Abort the current processing
    if (state.currentAbortController) {
      state.currentAbortController.abort();
    }

    // Set isProcessing to false
    state.isProcessing = false;

    res.json({
      success: true,
      message: "Agent run paused",
    });
  });

  // GET /diff - Return git diff against main branch
  app.get("/diff", async (_req: Request, res: Response) => {
    state.lastActivity = Date.now();

    try {
      const diffResult = await getGitDiffSnapshot();

      if (!diffResult.repoFound) {
        res.status(404).json({
          error: "Not in a git repository or main branch doesn't exist",
          diff: "",
        });
        return;
      }

      res.json({
        diff: diffResult.diff,
      });
    } catch (error) {
      logger.error(`Git diff error: ${formatError(error)}`);
      res.status(500).json({
        error: `Failed to get git diff: ${formatError(error)}`,
        diff: "",
      });
    }
  });

  // Track intervals for cleanup
  let inactivityChecker: NodeJS.Timeout | null = null;

  // GET /api/health - Simple health check
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    });
  });

  // OPTIONS /api/deployment/run-command - Handle CORS preflight requests
  app.options("/api/deployment/run-command", (req: Request, res: Response) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(200);
  });

  // POST /api/deployment/run-command - Run deployment check command and read logs
  app.post(
    "/api/deployment/run-command",
    async (req: Request, res: Response) => {
      // Add CORS headers for browser requests
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");

      state.lastActivity = Date.now();

      try {
        const { resourceName, window: timeWindow } = req.body;

        if (!resourceName) {
          return res.status(400).json({ error: "resourceName is required" });
        }

        // Build the command to execute
        const deployCommand = `python -m standard_commandline_utility.deploy_api ${resourceName} --window ${timeWindow || "10m"} --stream-only --out extracted_logs.txt`;

        logger.info(`Executing deployment command: ${deployCommand}`);

        // Execute the command
        let commandOutput = "";
        let execError = null;
        let errorOutput = "";

        try {
          commandOutput = execSync(deployCommand, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            cwd: process.cwd(),
          });
          logger.info("Deployment command executed successfully");
        } catch (error: any) {
          // Command may fail, but logs file might still be created
          execError = error;
          errorOutput =
            typeof error?.stderr === "string"
              ? error.stderr
              : error?.stderr?.toString?.() || error?.message || "";
          logger.warn(`Command execution failed: ${error.message}`);
          // Continue - we'll check for the logs file anyway
        }

        // Wait a moment for file to be written
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Read the extracted logs file
        const logsFilePath = path.join(process.cwd(), "extracted_logs.txt");
        let logs = "";
        let fileExists = false;

        try {
          fileExists = fs.existsSync(logsFilePath);
          if (fileExists) {
            logs = fs.readFileSync(logsFilePath, "utf-8");
            logger.info(
              `Successfully read logs from ${logsFilePath} (${logs.length} bytes)`,
            );

            // Check if logs are empty
            if (logs.trim() === "") {
              const detailedError =
                execError && errorOutput
                  ? `Deployment command failed: ${errorOutput.substring(0, 1200)}`
                  : `No log streams have events in the requested window for resource "${resourceName}".`;
              logger.warn(
                "Logs file is empty - no events in the requested window",
              );
              return res.status(500).json({
                success: false,
                error: detailedError,
                logs: "",
              });
            }

            return res.json({
              success: true,
              logs: logs,
              resourceName: resourceName,
              fileExists: fileExists,
              timestamp: new Date().toISOString(),
            });
          } else {
            // No logs file - return error instead of mock data
            const detailedError =
              execError && errorOutput
                ? `Deployment command failed: ${errorOutput.substring(0, 1200)}`
                : `No log streams have events in the requested window for resource "${resourceName}".`;
            logger.warn(`Logs file not found at ${logsFilePath}`);
            return res.status(500).json({
              success: false,
              error: detailedError,
              logs: "",
            });
          }
        } catch (fileError: any) {
          logger.error(`Failed to read logs file: ${fileError.message}`);
          return res.status(500).json({
            success: false,
            error: `Error reading logs: ${fileError.message}`,
            logs: "",
          });
        }
      } catch (error) {
        const errorMsg = formatError(error);
        logger.error(`Deployment endpoint error: ${errorMsg}`);
        res.status(500).json({
          success: false,
          error: `Failed to run deployment command: ${errorMsg}`,
          logs: "",
        });
      }
    },
  );

  // Live debugging session management
  interface LiveDebugSession {
    sessionId: string;
    resourceName: string;
    logsFilePath: string;
    startTime: number;
    logs: string[];
  }

  const activeSessions = new Map<string, LiveDebugSession>();

  // OPTIONS /api/deployment/live/start - Handle CORS preflight
  app.options("/api/deployment/live/start", (req: Request, res: Response) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(200);
  });

  // POST /api/deployment/live/start - Start live debugging session
  app.post(
    "/api/deployment/live/start",
    async (req: Request, res: Response) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");

      state.lastActivity = Date.now();

      try {
        const { resourceName, pollIntervalSeconds, pollWindow } = req.body;

        if (!resourceName) {
          return res.status(400).json({
            success: false,
            error: "resourceName is required",
          });
        }

        const sessionId = `debug-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const logsDir = path.join(process.cwd(), ".debug-sessions");

        // Create debug sessions directory if it doesn't exist
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }

        const logsFilePath = path.join(logsDir, `${sessionId}.txt`);

        // Initialize session
        const session: LiveDebugSession = {
          sessionId,
          resourceName,
          logsFilePath,
          startTime: Date.now(),
          logs: [],
        };

        activeSessions.set(sessionId, session);

        // Create empty log file
        fs.writeFileSync(
          logsFilePath,
          `[${new Date().toISOString()}] Debug session started for resource: ${resourceName}\n`,
        );

        logger.info(
          `Started live debug session: ${sessionId} for resource: ${resourceName}`,
        );

        return res.json({
          success: true,
          sessionId,
          message: `Live debug session started. Resource: ${resourceName}`,
        });
      } catch (error) {
        const errorMsg = formatError(error);
        logger.error(`Failed to start live debug session: ${errorMsg}`);
        return res.status(500).json({
          success: false,
          error: `Failed to start debug session: ${errorMsg}`,
        });
      }
    },
  );

  // OPTIONS /api/deployment/live/stop - Handle CORS preflight
  app.options("/api/deployment/live/stop", (req: Request, res: Response) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(200);
  });

  // POST /api/deployment/live/stop - Stop live debugging session and return logs
  app.post("/api/deployment/live/stop", async (req: Request, res: Response) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");

    state.lastActivity = Date.now();

    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error: "sessionId is required",
        });
      }

      const session = activeSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: `Session not found: ${sessionId}`,
        });
      }

      // Read the logs from file
      let logs = "";
      try {
        if (fs.existsSync(session.logsFilePath)) {
          logs = fs.readFileSync(session.logsFilePath, "utf-8");
        }
      } catch (fileError: any) {
        logger.warn(`Failed to read logs file: ${fileError.message}`);
      }

      // Append session end marker
      const endMarker = `\n[${new Date().toISOString()}] Debug session ended\n`;
      fs.appendFileSync(session.logsFilePath, endMarker);

      // Calculate summary
      const lines = logs.split("\n").filter((line) => line.trim().length > 0);
      const errorCount = lines.filter((line) =>
        line.toLowerCase().includes("error"),
      ).length;
      const warningCount = lines.filter((line) =>
        line.toLowerCase().includes("warn"),
      ).length;

      logger.info(
        `Stopped live debug session: ${sessionId}. Logs: ${logs.length} bytes`,
      );

      // Clean up session (keep the file for history)
      activeSessions.delete(sessionId);

      return res.json({
        success: true,
        sessionId,
        logs,
        summary: {
          totalLines: lines.length,
          errorCount,
          warningCount,
          sessionDuration: Date.now() - session.startTime,
          logsFile: session.logsFilePath,
        },
      });
    } catch (error) {
      const errorMsg = formatError(error);
      logger.error(`Failed to stop live debug session: ${errorMsg}`);
      return res.status(500).json({
        success: false,
        error: `Failed to stop debug session: ${errorMsg}`,
      });
    }
  });

  app.post("/exit", async (_req: Request, res: Response) => {
    console.log(
      chalk.yellow("\nReceived exit request, shutting down server..."),
    );

    // Respond immediately before shutting down
    res.json({
      message: "Server shutting down",
      success: true,
    });

    // Set server running flag to false to stop processing
    state.serverRunning = false;
    stopStorageSync();

    // Abort any current processing
    if (state.currentAbortController) {
      state.currentAbortController.abort();
    }

    // Clean up intervals
    if (inactivityChecker) {
      clearInterval(inactivityChecker);
      inactivityChecker = null;
    }

    // Give a moment for the response to be sent
    const handleExitResponse = async () => {
      server.close(async () => {
        telemetryService.stopActiveTime();

        // Update metadata one final time before exiting (with completion flag)
        try {
          const history = services.chatHistory?.getHistory();
          await updateAgentMetadata({ history, isComplete: true });
        } catch (err) {
          logger.debug("Failed to update metadata (non-critical)", err as any);
        }

        gracefulExit(0).catch((err) => {
          logger.error(`Graceful exit failed: ${formatError(err)}`);
          process.exit(1);
        });
      });
    };
    setTimeout(handleExitResponse, 100);
  });

  const server = app.listen(port, async () => {
    console.log(chalk.green(`Server started on http://localhost:${port}`));
    console.log(chalk.dim("Endpoints:"));
    console.log(chalk.dim("  GET  /state      - Get current agent state"));
    console.log(
      chalk.dim(
        "  POST /message    - Send a message (body: { message: string })",
      ),
    );
    console.log(
      chalk.dim(
        "  POST /permission - Approve/reject tool (body: { requestId, approved })",
      ),
    );
    console.log(chalk.dim("  POST /pause      - Pause the current agent run"));
    console.log(
      chalk.dim("  GET  /diff       - Get git diff against main branch"),
    );
    console.log(
      chalk.dim("  POST /exit       - Gracefully shut down the server"),
    );
    console.log(
      chalk.dim(
        `\nServer will shut down after ${timeoutSeconds} seconds of inactivity`,
      ),
    );

    // Run environment install script after server startup
    runEnvironmentInstallSafe();

    // If initial prompt provided, queue it for processing
    const initialPrompt = prependPrompt(
      agentFileState?.agentFile?.prompt,
      actualPrompt,
    );

    if (initialPrompt) {
      const existingHistory =
        (() => {
          try {
            return services.chatHistory.getHistory();
          } catch {
            return state.session.history;
          }
        })() ?? [];

      if (shouldQueueInitialPrompt(existingHistory, initialPrompt)) {
        logger.info(chalk.dim("\nProcessing initial prompt..."));
        await messageQueue.enqueueMessage(initialPrompt);
        processMessages(state, llmApi);
      } else {
        logger.info(
          chalk.dim(
            "Skipping initial prompt because existing conversation history was found.",
          ),
        );
      }
    }
  });

  async function processMessages(state: ServerState, llmApi: any) {
    let processedMessage = false;
    while (state.serverRunning) {
      const queuedMessage = messageQueue.getNextMessage();
      if (!queuedMessage) {
        break;
      }

      const userMessage = queuedMessage.message;
      state.isProcessing = true;
      state.lastActivity = Date.now();
      processedMessage = true;

      // Add user message via ChatHistoryService (single source of truth)
      try {
        services.chatHistory.addUserMessage(userMessage);
      } catch {
        // Fallback to local array if service unavailable
        state.session.history.push({
          message: { role: "user", content: userMessage },
          contextItems: [],
        });
      }

      try {
        // Create new abort controller for this response
        state.currentAbortController = new AbortController();

        // Stream the response with interruption support
        await streamChatResponseWithInterruption(
          state,
          llmApi,
          state.currentAbortController,
          () => false,
        );

        // No direct persistence here; ChatHistoryService handles persistence when appropriate

        state.lastActivity = Date.now();

        // Update metadata after successful agent turn
        try {
          const history = services.chatHistory?.getHistory();
          await updateAgentMetadata({
            history,
            isComplete: checkAgentComplete(history),
          });
        } catch (metadataErr) {
          logger.debug(
            "Failed to update metadata after turn (non-critical)",
            metadataErr as any,
          );
        }
      } catch (e: any) {
        if (e.name === "AbortError") {
          logger.debug("Response interrupted");
          removePartialAssistantMessage(state.session.history);
        } else {
          logger.error(`Error: ${formatError(e)}`);

          // Add error message via ChatHistoryService
          const errorMessage = `Error: ${formatError(e)}`;
          try {
            services.chatHistory.addAssistantMessage(errorMessage);
          } catch {
            state.session.history.push({
              message: { role: "assistant", content: errorMessage },
              contextItems: [],
            });
          }

          // Report failure to control plane (retries exhausted or non-retryable error)
          try {
            await reportFailureTool.run({
              errorMessage: formatError(e),
            });
          } catch (reportError) {
            logger.error(
              `Failed to report agent failure: ${formatError(reportError)}`,
            );
            // Don't block on reporting failure
          }
        }
      } finally {
        state.currentAbortController = null;
        state.isProcessing = false;
      }
    }

    if (
      processedMessage &&
      state.serverRunning &&
      messageQueue.getQueueLength() === 0
    ) {
      await storageSyncService.markAgentStatusUnread();
    }
  }

  // Check for inactivity and shutdown
  inactivityChecker = setInterval(() => {
    if (!state.isProcessing && Date.now() - state.lastActivity > timeoutMs) {
      console.log(
        chalk.yellow(
          `\nShutting down due to ${timeoutSeconds} seconds of inactivity`,
        ),
      );
      state.serverRunning = false;
      stopStorageSync();
      server.close(async () => {
        telemetryService.stopActiveTime();

        // Update metadata one final time before exiting (with completion flag)
        try {
          const history = services.chatHistory?.getHistory();
          await updateAgentMetadata({ history, isComplete: true });
        } catch (err) {
          logger.debug("Failed to update metadata (non-critical)", err as any);
        }

        gracefulExit(0).catch((err) => {
          logger.error(`Graceful exit failed: ${formatError(err)}`);
          process.exit(1);
        });
      });
      if (inactivityChecker) {
        clearInterval(inactivityChecker);
        inactivityChecker = null;
      }
    }
  }, 1000);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\nShutting down server..."));
    state.serverRunning = false;
    stopStorageSync();
    if (inactivityChecker) {
      clearInterval(inactivityChecker);
      inactivityChecker = null;
    }
    server.close(async () => {
      telemetryService.stopActiveTime();

      // Update metadata one final time before exiting (with completion flag)
      try {
        const history = services.chatHistory?.getHistory();
        await updateAgentMetadata({ history, isComplete: true });
      } catch (err) {
        logger.debug("Failed to update metadata (non-critical)", err as any);
      }

      gracefulExit(0).catch((err) => {
        logger.error(`Graceful exit failed: ${formatError(err)}`);
        process.exit(1);
      });
    });
  });
}
