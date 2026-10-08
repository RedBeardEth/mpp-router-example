import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const origin = env.ROUTER_ORIGIN || "http://127.0.0.1:38080";
  const url = new URL(origin);
  if (env.TEMPO_NETWORK && !["mainnet", "testnet"].includes(env.TEMPO_NETWORK))
    throw new Error("TEMPO_NETWORK must be testnet or mainnet.");
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error(
      "ROUTER_ORIGIN must be an HTTPS origin or loopback HTTP origin.",
    );
  const proxy = {
    "^/router/(v1/models|providers/openai/v1/responses|v1/purchases/[A-Za-z0-9:._%~-]+(/receipt)?)$":
      {
        target: origin,
        changeOrigin: true,
        followRedirects: false,
        timeout: 135000,
        proxyTimeout: 130000,
        rewrite: (path: string) => path.replace(/^\/router/, ""),
        configure(proxy: any) {
          proxy.on("proxyReq", (request: any) => {
            // Do not send browser identity, cookies, or arbitrary app headers to the router.
            const allowed = new Set([
              "host",
              "content-type",
              "content-length",
              "authorization",
              "x-quote-binding",
              "x-status-token",
            ]);
            for (const name of request.getHeaderNames())
              if (!allowed.has(name.toLowerCase())) request.removeHeader(name);
          });
          proxy.on("proxyRes", (response: any) => {
            response.headers["cache-control"] = "no-store";
            delete response.headers["set-cookie"];
          });
        },
      },
  };
  return {
    plugins: [react()],
    optimizeDeps: {
      include: ["react", "react-dom/client", "react/jsx-runtime"],
    },
    define: {
      __APP_CONFIG__: JSON.stringify({
        origin,
        recipient: env.ROUTER_RECIPIENT || "",
        network: env.TEMPO_NETWORK || "testnet",
        maxAmount: env.MAX_PAYMENT || "0.10",
      }),
      __DEMO__: mode === "demo",
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy,
      headers: { "Cache-Control": "no-store" },
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy,
      headers: { "Cache-Control": "no-store" },
    },
    build: { target: "es2022" },
  };
});
