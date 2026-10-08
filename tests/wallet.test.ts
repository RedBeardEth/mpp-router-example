import { afterEach, expect, it, vi } from "vitest";
import { Credential } from "mppx";
import { type EIP1193Provider, toRlp, fromRlp } from "viem";
import {
  assertDirectCredential,
  signQuote,
  type ConnectedWallet,
} from "../src/wallet";
import { fixtureQuote, DEMO_CONFIG } from "../src/demo";
import { makeBody, readQuote } from "../src/router";
import fixture from "./fixtures/tempo.json";
afterEach(() => vi.unstubAllGlobals());
function wallet(): ConnectedWallet {
  return {
    id: "test",
    name: "Synthetic wallet",
    address: fixture.payer as `0x${string}`,
    provider: {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_accounts") return [fixture.payer];
        if (method === "eth_chainId") return "0xa5bf";
        if (method === "eth_signTransaction") return fixture.transaction;
        if (method === "eth_signTypedData_v4") return fixture.signature;
        throw Error("Unexpected wallet method: " + method);
      }),
    } as unknown as EIP1193Provider,
  };
}
it("uses the pinned SDK with an EIP-1193 wallet, never a send method", async () => {
  const rpc = vi.fn(async (_url: unknown, options: RequestInit) => {
    const { method, id } = JSON.parse(String(options.body));
    const responses: Record<string, unknown> = {
      eth_chainId: "0xa5bf",
      eth_getTransactionCount: "0x0",
      eth_gasPrice: "0x3e8",
      eth_maxPriorityFeePerGas: "0x3e8",
      eth_estimateGas: "0x1e8480",
      eth_getBlockByNumber: {
        number: "0x1",
        hash: "0x" + "aa".repeat(32),
        parentHash: "0x" + "bb".repeat(32),
        timestamp: "0x3e8",
        gasLimit: "0x1c9c380",
        gasUsed: "0x0",
        baseFeePerGas: "0x3e8",
        transactions: [],
      },
    };
    if (method === "eth_fillTransaction")
      return Response.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not supported" },
      });
    if (!(method in responses)) throw Error("Unexpected RPC: " + method);
    return Response.json({ jsonrpc: "2.0", id, result: responses[method] });
  });
  vi.stubGlobal("fetch", rpc);
  const config = { ...DEMO_CONFIG, recipient: fixture.payee },
    body = makeBody("gpt-5-mini", "test");
  const f = fixtureQuote(body, config),
    q = readQuote(f.response, f.value, body, config),
    w = wallet();
  const authorization = await signQuote(w, q, config);
  const payload = Credential.deserialize(authorization).payload as Record<
    string,
    unknown
  >;
  expect(payload.action).toBe("open");
  expect(payload.cumulativeAmount).toBe(q.amount);
  const calls = (
    w.provider.request as unknown as ReturnType<
      typeof vi.fn<(args: { method: string }) => Promise<unknown>>
    >
  ).mock.calls.map(([args]) => args.method);
  expect(calls).toContain("eth_signTransaction");
  expect(calls).toContain("eth_signTypedData_v4");
  expect(calls.some((m) => m.includes("send"))).toBe(false);
  expect(rpc.mock.calls.length).toBeLessThan(12);
});
it("rejects passkey and delegated envelopes before HTTP submission", () => {
  const w = wallet();
  assertDirectCredential(fixture.authorization, w);
  for (const position of [12, 13]) {
    const credential = Credential.deserialize(fixture.authorization),
      payload = credential.payload as Record<string, string>;
    const fields = fromRlp(
      ("0x" + payload.transaction.slice(4)) as `0x${string}`,
      "hex",
    ) as `0x${string}`[];
    fields[position] = "0x1234";
    payload.transaction = "0x78" + toRlp(fields).slice(2);
    expect(() =>
      assertDirectCredential(Credential.serialize(credential), w),
    ).toThrow(/direct secp256k1/);
  }
});
it("checks the selected account and chain again before signing", async () => {
  const w = wallet();
  vi.mocked(w.provider.request).mockImplementation(async () => [] as never);
  const body = makeBody("gpt-5-mini", "test"),
    f = fixtureQuote(body),
    q = readQuote(f.response, f.value, body, DEMO_CONFIG);
  await expect(signQuote(w, q, DEMO_CONFIG)).rejects.toThrow(
    /Wallet account or network changed/,
  );
});
