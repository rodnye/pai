import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const host = process.env.MOCK_HOST || "127.0.0.1";
const port = Number(process.env.MOCK_PORT || 4010);

const numberFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** Defaults injected into the page; the Debug panel can still override them per browser profile. */
const defaults = {
  thinkingMs: numberFromEnv("MOCK_THINKING_MS", 900),
  tokenMs: numberFromEnv("MOCK_TOKEN_MS", 45),
};

const indexFile = fileURLToPath(new URL("./index.html", import.meta.url));

/** Small helper so rejected promises from async handlers reach the Express error handler. */
const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

const app = express();

// Match the original server's behavior closely.
app.disable("x-powered-by");
app.set("etag", false);
app.set("strict routing", false);

// Cache-Control: no-store on every response.
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Only GET and HEAD are allowed (Express will auto-handle HEAD for GET routes).
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).type("text/plain").send("Method not allowed");
    return;
  }
  next();
});

// Read on every request so edits to index.html show up with a simple reload.
const sendIndex = asyncHandler(async (_req, res) => {
  res.type("html").send(await readFile(indexFile, "utf8"));
});

app.get("/", sendIndex);
app.get("/login", sendIndex);

app.get("/mock-config.js", (_req, res) => {
  res
    .type("js")
    .send(`window.__MOCK_DEFAULTS__ = ${JSON.stringify(defaults)};`);
});

app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

app.get("/favicon.ico", (_req, res) => {
  res.status(204).type("image/x-icon").end();
});

// 404 fallback.
app.use((_req, res) => {
  res.status(404).type("text/plain").send("Not found");
});

// Centralized error handler.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).type("text/plain").send("Internal error");
});

const server = app.listen(port, host, () => {
  const base = `http://${host}:${port}`;
  console.log(`IA-1 mock listening on ${base}`);
  console.log(`  login:  ${base}/login   (demo@ia-1.test / demo1234)`);
  console.log(`  use it: PAI_IA1_BASE_URL=${base}`);
});

const shutdown = (): void => {
  server.close();
  server.closeAllConnections();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
