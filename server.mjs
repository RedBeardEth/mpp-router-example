// Production server: serves the built app and the same narrow same-origin
// proxy that Vite provides in development. No dependencies, no content logging,
// no caching and no retries. Configuration must match the values the app was
// built with (see Dockerfile).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./dist/", import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY = 1024 * 1024;
const TIMEOUT_MS = 130_000;
const ROUTE =
  /^\/router\/(v1\/models|providers\/openai\/v1\/responses|providers\/anthropic\/v1\/messages|v1\/purchases\/[A-Za-z0-9:._%~-]+(\/receipt)?)$/;
const FORWARD = [
  "content-type",
  "authorization",
  "payment-signature",
  "x-quote-binding",
  "x-status-token",
];
const DROP = new Set([
  "set-cookie",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // MPP signing reads the Tempo RPC from the browser; x402 needs none.
    "connect-src 'self' https://rpc.moderato.tempo.xyz https://rpc.tempo.xyz",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; "),
};

export function routerOrigin(value = process.env.ROUTER_ORIGIN) {
  const url = new URL(value || "http://127.0.0.1:38080");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    !(url.protocol === "https:" || (url.protocol === "http:" && loopback))
  )
    throw new Error("ROUTER_ORIGIN must be an HTTPS or loopback HTTP origin.");
  return url.origin;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY)
      throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxy(request, response, path, origin) {
  if (!["GET", "POST"].includes(request.method)) return send(response, 405);
  const headers = {};
  for (const name of FORWARD) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  // Closing the tab cancels the upstream wait; it never retries the POST.
  response.on("close", () => abort.abort());
  try {
    const body =
      request.method === "POST" ? await readBody(request) : undefined;
    const upstream = await fetch(origin + path, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: abort.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400)
      return send(response, 502);
    const out = { ...SECURITY, "Cache-Control": "no-store" };
    upstream.headers.forEach((value, name) => {
      if (!DROP.has(name)) out[name] = value;
    });
    response.writeHead(upstream.status, out);
    if (upstream.body)
      for await (const chunk of upstream.body) response.write(chunk);
    response.end();
  } catch (error) {
    if (!response.headersSent) send(response, error.status ?? 502);
    else response.destroy();
  } finally {
    clearTimeout(timer);
  }
}

function send(response, status, body = "", type = "text/plain") {
  response.writeHead(status, {
    ...SECURITY,
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function serveStatic(request, response, pathname) {
  if (!["GET", "HEAD"].includes(request.method)) return send(response, 405);
  const relative = normalize(decodeURIComponent(pathname)).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  let file = join(ROOT, relative);
  if (!file.startsWith(ROOT)) return send(response, 404);
  if (pathname === "/" || !extname(pathname)) file = join(ROOT, "index.html");
  try {
    const data = await readFile(file);
    const hashed = pathname.startsWith("/assets/");
    response.writeHead(200, {
      ...SECURITY,
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": hashed
        ? "public, max-age=31536000, immutable"
        : "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    send(response, 404, "Not found");
  }
}

export function createApp(origin = routerOrigin()) {
  return createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === "/healthz") return send(response, 200, "ok");
    if (pathname.startsWith("/router/")) {
      if (!ROUTE.test(pathname)) return send(response, 404);
      return proxy(request, response, pathname.slice("/router".length), origin);
    }
    return serveStatic(request, response, pathname);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.requestTimeout = TIMEOUT_MS + 10_000;
  app.listen(PORT, HOST, () =>
    console.log(`Serving on http://${HOST}:${PORT} → ${routerOrigin()}`),
  );
  const stop = () => app.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
