import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
// @ts-expect-error The production server is plain ESM without declarations.
import { createApp, routerOrigin } from "../server.mjs";

let upstream: Server, app: Server, base: string;
const seen: {
  method?: string;
  url?: string;
  headers: Record<string, any>;
  body: string;
}[] = [];
const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

beforeAll(async () => {
  upstream = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    seen.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    });
    if (request.url === "/v1/models") {
      response.writeHead(302, { Location: "https://elsewhere.invalid" });
      return response.end();
    }
    response.writeHead(402, {
      "Content-Type": "application/json",
      "Set-Cookie": "tracking=1",
      "PAYMENT-REQUIRED": "offer",
      "X-Status-Token": "token",
    });
    response.end('{"purchase_id":"p"}');
  });
  app = createApp(await listen(upstream));
  base = await listen(app);
});
afterAll(() => {
  app.close();
  upstream.close();
});

describe("production server", () => {
  it("forwards only allowlisted headers and preserves exact body bytes", async () => {
    const body = '{ "model":  "m", "input": "spacing kept" }';
    const response = await fetch(
      base + "/router/providers/anthropic/v1/messages",
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": "sig",
          "X-Quote-Binding": "binding",
          Cookie: "session=secret",
          "User-Agent": "browser",
        },
      },
    );
    expect(response.status).toBe(402);
    expect(response.headers.get("payment-required")).toBe("offer");
    expect(response.headers.get("x-status-token")).toBe("token");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const request = seen.at(-1)!;
    expect(request.url).toBe("/providers/anthropic/v1/messages");
    expect(request.body).toBe(body);
    expect(request.headers["payment-signature"]).toBe("sig");
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers["user-agent"]).not.toBe("browser");
  });
  it("rejects routes outside the allowlist and never follows redirects", async () => {
    const before = seen.length;
    expect((await fetch(base + "/router/admin")).status).toBe(404);
    expect(seen.length).toBe(before);
    expect((await fetch(base + "/router/v1/models")).status).toBe(502);
  });
  it("answers health checks and rejects unsafe router origins", async () => {
    expect(await (await fetch(base + "/healthz")).text()).toBe("ok");
    expect(() => routerOrigin("http://example.com")).toThrow();
    expect(() => routerOrigin("https://example.com/path")).toThrow();
    expect(routerOrigin("https://devnet-api.xgate.run")).toBe(
      "https://devnet-api.xgate.run",
    );
  });
});
