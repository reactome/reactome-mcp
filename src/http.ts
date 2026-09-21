import { randomUUID } from "node:crypto";
import { resolveToolGroups } from "./tools/index.js";
import { estimateAnalysisBodyBytes } from "./tools/limits.js";
import type { Server } from "node:http";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { logger } from "./logger.js";
import {
  MCP_HTTP_HOST,
  MCP_MAX_SESSIONS,
  MCP_SESSION_TTL_MS,
  CONTENT_SERVICE_URL,
  ANALYSIS_SERVICE_URL,
  MAX_ANALYSIS_IDENTIFIERS,
} from "./config.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
}

/**
 * Serve MCP over Streamable HTTP.
 *
 * stdio remains the default and is untouched: every existing user has a client
 * configured to spawn this process. This is the transport a hosted instance
 * needs, because a reverse proxy cannot front a process that talks over
 * stdin/stdout.
 *
 * Each session gets its **own** server instance. Sharing one across sessions
 * would mean one client's in-flight request and another's could interleave on
 * shared per-connection state; `createServer()` exists precisely so that
 * building one per session is cheap.
 */
/**
 * The request body ceiling that actually applies, in bytes.
 *
 * Not ours and not configurable: `createMcpExpressApp` mounts
 * `express.json()` with no limit, so express's `100kb` default is what a
 * request meets. Measured against a real server rather than read off the
 * default -- 102,392 bytes are accepted, 102,992 are refused with 413.
 */
const EXPRESS_JSON_LIMIT_BYTES = 102_400;

export function startHttpServer(port: number, host: string = MCP_HTTP_HOST): Promise<Server> {
  // Validate the tool-group configuration *here*, before anything binds.
  //
  // `createServer()` is called per session (see the session handler below),
  // so a bad MCP_TOOL_GROUPS would otherwise let the process start, answer
  // /health with "ok", and fail every individual session -- while the
  // documentation said the server refuses to start. It does over stdio,
  // where createServer runs once at boot. It did not here, which is the
  // transport that is actually deployed.
  resolveToolGroups();

  // Defaults to 127.0.0.1 and turns on DNS-rebinding protection for localhost
  // hosts, which is what stops a web page in the user's browser from driving
  // this server.
  const app = createMcpExpressApp({ host });

  // No second body parser here. `createMcpExpressApp` mounts `express.json()`
  // with no limit of its own, so express's 100 KiB default is the real
  // ceiling, and it is reached first: a parser added afterwards never sees a
  // request, because body-parser skips a body that has already been read.
  //
  // An `express.json({ limit: "4mb" })` sat on this line and did nothing. It
  // was worse than absent -- it was the number anyone reading this file would
  // have believed, and it is four times larger than what actually applies.
  // Measured, not read: 102,392 bytes are accepted and 102,992 are refused
  // with 413, which is express's `100kb` exactly.
  //
  // 100 KiB is not a number anyone here chose, but it is a defensible one for
  // a public instance, and MAX_ANALYSIS_IDENTIFIERS is set to fit inside it.
  // `tests/body-limit.test.ts` holds the two together, so an SDK upgrade that
  // moves this ceiling fails there rather than in production.

  // That test guards the *default* cap. `MCP_MAX_ANALYSIS_IDENTIFIERS` can
  // raise it at runtime, which puts the two ceilings back into disagreement
  // on a deployment no test ever sees -- and the symptom is a bare 413 that
  // names nothing. So the check is repeated here, against the configured
  // value, where the operator who set it will read it.
  const worstCaseBody = estimateAnalysisBodyBytes(MAX_ANALYSIS_IDENTIFIERS);
  if (worstCaseBody > EXPRESS_JSON_LIMIT_BYTES) {
    logger.warn("MCP_MAX_ANALYSIS_IDENTIFIERS is larger than this transport can carry", {
      maxAnalysisIdentifiers: MAX_ANALYSIS_IDENTIFIERS,
      worstCaseBodyBytes: worstCaseBody,
      bodyLimitBytes: EXPRESS_JSON_LIMIT_BYTES,
      effect: "a request at the cap is refused with 413 before validation runs",
      hint: "lower the cap, or use stdio, which has no body limit",
    });
  }

  const sessions = new Map<string, Session>();

  const closeSession = (sessionId: string, why: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    logger.info("mcp session closed", { sessionId, why, open: sessions.size });
    void Promise.resolve(session.transport.close()).catch(() => {
      // Already gone; nothing useful left to do.
    });
  };

  // Sessions that are never closed by the client would otherwise accumulate a
  // server each until the process dies.
  const reaper = setInterval(() => {
    const cutoff = Date.now() - MCP_SESSION_TTL_MS;
    for (const [id, session] of sessions) {
      if (session.lastSeen < cutoff) closeSession(id, "idle");
    }
  }, 60_000);
  reaper.unref();

  const existing = (req: Request): Session | undefined => {
    const id = req.header("mcp-session-id");
    if (!id) return undefined;
    const session = sessions.get(id);
    if (session) session.lastSeen = Date.now();
    return session;
  };

  app.post("/mcp", (req: Request, res: Response) => {
    void (async () => {
      const session = existing(req);
      if (session) {
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // No session header: this must be an initialize request, which is the
      // only thing allowed to create one.
      const body: unknown = req.body;
      const isInitialize =
        typeof body === "object" &&
        body !== null &&
        (body as { method?: unknown }).method === "initialize";

      if (!isInitialize) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid session. Send initialize first." },
          id: null,
        });
        return;
      }

      if (sessions.size >= MCP_MAX_SESSIONS) {
        // Refuse rather than let a client loop exhaust memory. 503 tells a
        // proxy this is load, not a malformed request.
        logger.warn("mcp session limit reached", { open: sessions.size });
        res.status(503).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Server at session capacity. Retry shortly." },
          id: null,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId: string) => {
          sessions.set(sessionId, { transport, server, lastSeen: Date.now() });
          logger.info("mcp session opened", { sessionId, open: sessions.size });
        },
        onsessionclosed: (sessionId: string) => closeSession(sessionId, "client closed"),
      });

      const server = createServer();
      transport.onclose = () => {
        if (transport.sessionId) closeSession(transport.sessionId, "transport closed");
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    })().catch((error: unknown) => {
      logger.error("mcp post failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    });
  });

  // GET opens the server-to-client stream; DELETE ends the session. Both
  // require an established session.
  const requireSession = (req: Request, res: Response): Session | undefined => {
    const session = existing(req);
    if (!session) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Unknown or missing mcp-session-id" },
        id: null,
      });
      return undefined;
    }
    return session;
  };

  app.get("/mcp", (req: Request, res: Response) => {
    const session = requireSession(req, res);
    if (!session) return;
    void session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", (req: Request, res: Response) => {
    const session = requireSession(req, res);
    if (!session) return;
    void session.transport.handleRequest(req, res);
  });

  // For whatever fronts this. Deliberately says nothing about Reactome's own
  // health: this endpoint reports that the process is up, not that the
  // Content Service is.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      name: SERVER_NAME,
      version: SERVER_VERSION,
      sessions: sessions.size,
      contentService: CONTENT_SERVICE_URL,
      analysisService: ANALYSIS_SERVICE_URL,
    });
  });

  return new Promise<Server>((resolve, reject) => {
    const http = app.listen(port, host, () => {
      logger.info("reactome mcp http server listening", {
        host,
        port,
        contentService: CONTENT_SERVICE_URL,
        analysisService: ANALYSIS_SERVICE_URL,
      });
      resolve(http);
    });

    http.on("error", reject);

    const shutdown = () => {
      clearInterval(reaper);
      for (const id of [...sessions.keys()]) closeSession(id, "shutdown");
      http.close();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
