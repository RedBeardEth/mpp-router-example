import { readFile, stat } from "node:fs/promises";
const [file, expectedOrigin] = process.argv.slice(2);
try {
  if (!file || !expectedOrigin)
    throw Error(
      "Usage: node scripts/recover.mjs RECORD.json ORIGINAL_ROUTER_ORIGIN",
    );
  if ((await stat(file)).size > 4096)
    throw Error("Recovery record is too large.");
  const saved = JSON.parse(await readFile(file, "utf8"));
  const url = new URL(expectedOrigin);
  if (
    url.origin !== expectedOrigin ||
    saved.origin !== expectedOrigin ||
    saved.version !== 1 ||
    saved.attempted !== true ||
    !["testnet", "mainnet"].includes(saved.network) ||
    !/^[\w:.-]{1,128}$/.test(saved.purchase) ||
    !/^0x[\da-f]{64}$/.test(saved.token)
  )
    throw Error("Invalid record or origin mismatch.");
  if (url.hostname === "demo.router.invalid")
    throw Error("Demo records only work inside demo mode.");
  if (
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw Error("HTTPS or loopback HTTP required.");
  for (const suffix of ["", "/receipt"]) {
    const response = await fetch(
      `${expectedOrigin}/v1/purchases/${encodeURIComponent(saved.purchase)}${suffix}`,
      {
        headers: { "X-Status-Token": saved.token },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      },
    );
    if (![200, 202].includes(response.status))
      throw Error(
        `Metadata unavailable (HTTP ${response.status}). Keep the original record.`,
      );
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 65536) throw Error("Metadata exceeds size limit.");
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (data.purchase_id !== saved.purchase)
      throw Error("Metadata purchase mismatch.");
    console.log(JSON.stringify(data, null, 2));
  }
} catch (error) {
  console.error(
    error instanceof Error && !error.message.includes("fetch")
      ? error.message
      : "Metadata request failed. Keep the original recovery record.",
  );
  process.exitCode = 1;
}
