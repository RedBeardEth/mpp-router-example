import { describe, it, expect, vi } from "vitest";
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  decodePaymentSignatureHeader,
} from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { privateKeyToAccount } from "viem/accounts";
import { type EIP1193Provider } from "viem";
import {
  BASE,
  makeBody,
  OPERATIONS,
  readX402Quote,
  RouterClient,
  type Operation,
} from "../src/router";
import { DEMO_CONFIG, privacy } from "../src/demo";
import { signX402 } from "../src/x402";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const chain = BASE.testnet;
const binding = "0x" + "aa".repeat(32),
  token = "0x" + "bb".repeat(32);

function offer(
  operation: Operation = "messages",
  patch: (r: PaymentRequired) => void = () => {},
) {
  const purchase = "anonymous-" + "cd".repeat(32);
  const body = makeBody("claude-haiku-4-5", "Test prompt", operation);
  const required: PaymentRequired = {
    x402Version: 2,
    resource: {
      url: DEMO_CONFIG.origin + OPERATIONS[operation],
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: `eip155:${chain.id}`,
        asset: chain.token.toLowerCase(),
        amount: "9664",
        payTo: DEMO_CONFIG.recipient,
        maxTimeoutSeconds: 120,
        extra: {
          name: "USDC",
          version: "2",
          purchaseId: purchase,
          paymentFlow: "authorization",
          assetTransferMethod: "eip3009",
        },
      },
      {
        scheme: "upto",
        network: `eip155:${chain.id}`,
        asset: chain.token,
        amount: "9664",
        payTo: DEMO_CONFIG.recipient,
        maxTimeoutSeconds: 120,
        extra: {},
      },
    ],
  } as PaymentRequired;
  patch(required);
  const value = {
    purchase_id: purchase,
    quote_binding: binding,
    privacy,
    execution_profile: { model: "claude-haiku-4-5", quote_ceiling: "9664" },
    qualified_profile: {
      model: "claude-haiku-4-5",
      operation,
      privacy_revision: privacy.revision,
    },
  };
  const response = () =>
    Response.json(value, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required),
        "X-Quote-Binding": binding,
        "X-Status-Token": token,
      },
    });
  return { body, value, response, purchase };
}

function wallet() {
  const provider = {
    request: vi.fn(async ({ method, params }: any) => {
      if (method === "eth_accounts") return [account.address];
      if (method === "eth_chainId") return "0x" + chain.id.toString(16);
      if (method === "eth_signTypedData_v4")
        return account.signTypedData(JSON.parse(params[1]));
      throw Error("Unexpected wallet method: " + method);
    }),
  } as unknown as EIP1193Provider;
  return { id: "test", name: "Synthetic", provider, address: account.address };
}

describe("x402 exact quotes", () => {
  it("selects the single Base exact offer for the Messages route", () => {
    const f = offer();
    const q = readX402Quote(
      f.response(),
      f.value,
      f.body,
      DEMO_CONFIG,
      0,
      "messages",
    );
    expect(q.rail).toBe("x402");
    expect(q.offer.scheme).toBe("exact");
    expect(q.amount).toBe("9664");
    expect(q.expires).toBe(120000);
  });
  it.each([
    ["recipient", (r: any) => (r.accepts[0].payTo = "0x" + "12".repeat(20))],
    ["token", (r: any) => (r.accepts[0].asset = "0x" + "12".repeat(20))],
    ["purchase", (r: any) => (r.accepts[0].extra.purchaseId = "other")],
    [
      "permit2",
      (r: any) => (r.accepts[0].extra.assetTransferMethod = "permit2"),
    ],
    ["over-limit", (r: any) => (r.accepts[0].amount = "100001")],
    ["resource", (r: any) => (r.resource.url = "https://other.invalid/x")],
    ["network", (r: any) => (r.accepts[0].network = "eip155:8453")],
  ])("rejects an unexpected %s before wallet use", (_, patch) => {
    const f = offer("messages", patch);
    expect(() =>
      readX402Quote(
        f.response(),
        f.value,
        f.body,
        DEMO_CONFIG,
        Date.now(),
        "messages",
      ),
    ).toThrow();
  });
});

describe("x402 purchase", () => {
  it("signs with eth_signTypedData_v4 and submits PAYMENT-SIGNATURE once", async () => {
    const f = offer();
    let paid: Headers | undefined;
    const transport = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("PAYMENT-SIGNATURE")) return f.response();
      paid = headers;
      return Response.json(
        {
          type: "message",
          content: [{ type: "text", text: "Hello." }],
          usage: { input_tokens: 9, output_tokens: 3 },
        },
        {
          headers: {
            "PAYMENT-RESPONSE": encodePaymentResponseHeader({
              success: true,
              transaction: "0x" + "44".repeat(32),
              network: `eip155:${chain.id}`,
              payer: account.address,
            }),
          },
        },
      );
    });
    const client = new RouterClient(DEMO_CONFIG, transport);
    const q = await client.quote(f.body, "messages", "x402");
    const w = wallet();
    const header = await signX402(w, q as any, DEMO_CONFIG);
    const methods = (w.provider.request as any).mock.calls.map(
      ([a]: any) => a.method,
    );
    expect(methods).toContain("eth_signTypedData_v4");
    expect(methods).not.toContain("eth_sendTransaction");
    expect(methods).not.toContain("eth_signTransaction");
    const result = await client.submit(q, header);
    expect(result.text).toBe("Hello.");
    expect(result.spent).toBe("9664");
    expect(result.usage).toEqual({ input: 9, output: 3 });
    expect(result.explorer).toContain(chain.explorer);
    expect(paid?.get("X-Quote-Binding")).toBe(binding);
    expect(paid?.get("Authorization")).toBeNull();
    expect(
      decodePaymentSignatureHeader(paid!.get("PAYMENT-SIGNATURE")!).accepted,
    ).toEqual(q.rail === "x402" && q.offer);
    expect(transport.mock.calls[1][0]).toBe("/router" + OPERATIONS.messages);
    await expect(client.submit(q, header)).rejects.toThrow(/already/);
  });
  it("rejects a settlement on another network", async () => {
    const f = offer();
    const client = new RouterClient(DEMO_CONFIG, async (_input, init) =>
      new Headers(init?.headers).has("PAYMENT-SIGNATURE")
        ? Response.json(
            { type: "message", content: [{ type: "text", text: "Hi" }] },
            {
              headers: {
                "PAYMENT-RESPONSE": encodePaymentResponseHeader({
                  success: true,
                  transaction: "0x" + "44".repeat(32),
                  network: "eip155:8453",
                }),
              },
            },
          )
        : f.response(),
    );
    const q = await client.quote(f.body, "messages", "x402");
    const header = await signX402(wallet(), q as any, DEMO_CONFIG);
    await expect(client.submit(q, header)).rejects.toThrow(/receipt/);
  });
});
