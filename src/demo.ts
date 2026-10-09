/** Isolated fixture adapter. Imported only by demo mode and tests. Never signs or calls a network. */
import { Challenge, Credential, Receipt } from "mppx";
import { ESCROW, NETWORKS, ROUTE, type Config, type Quote } from "./router";
export const DEMO_CONFIG: Config = {
  origin: "https://demo.router.invalid",
  recipient: "0x1111111111111111111111111111111111111111",
  network: "testnet",
  maxAmount: "0.10",
};
export const DEMO_WALLET = "0x2222222222222222222222222222222222222222";
export const DEMO_CHANNEL = "0x" + "33".repeat(32);
export const DEMO_TX = "0x" + "44".repeat(32);
export const privacy = {
  revision: "anonymous-volatile-v1",
  mode: "anonymous",
  router_content_retention: "none",
  result_replay_available: false,
  delivery: "live_response_only",
};
export function fixtureQuote(body: string, config = DEMO_CONFIG) {
  const purchase = "demo-" + crypto.randomUUID();
  const challenge = Challenge.from({
    id: crypto.randomUUID(),
    realm: "demo.router.invalid",
    method: "tempo",
    intent: "session",
    expires: new Date(Date.now() + 60000).toISOString(),
    opaque: btoa(
      JSON.stringify({ purchase, resource: config.origin + ROUTE }),
    ).replace(/=/g, ""),
    request: {
      amount: "10000",
      suggestedDeposit: "10000",
      currency: NETWORKS[config.network].token,
      recipient: config.recipient,
      unitType: "request",
      methodDetails: {
        chainId: NETWORKS[config.network].id,
        sessionProtocol: "v2",
        escrowContract: ESCROW,
        feePayer: true,
      },
    },
  });
  const binding = "0x" + "aa".repeat(32),
    token = "0x" + "bb".repeat(32),
    model = JSON.parse(body).model;
  const value = {
    purchase_id: purchase,
    quote_binding: binding,
    privacy,
    execution_profile: { model, quote_ceiling: "10000" },
    qualified_profile: {
      model,
      operation: "responses",
      privacy_revision: privacy.revision,
    },
  };
  return {
    challenge,
    value,
    response: Response.json(value, {
      status: 402,
      headers: {
        "WWW-Authenticate": Challenge.serialize(challenge),
        "X-Quote-Binding": binding,
        "X-Status-Token": token,
      },
    }),
  };
}
export function demoCredential(quote: Quote) {
  if (quote.rail !== "mpp") throw new Error("Demo mode uses MPP only.");
  return Credential.serialize({
    challenge: quote.challenge,
    source: `did:pkh:eip155:42431:${DEMO_WALLET}`,
    payload: {
      action: "open",
      type: "transaction",
      cumulativeAmount: quote.amount,
      channelId: DEMO_CHANNEL,
      transaction: "0x78deadbeef",
    },
  });
}
export function createDemoTransport(): typeof fetch {
  return async (input, init) => {
    const path = String(input).replace(/^\/router/, "");
    if (path === "/v1/models")
      return Response.json({
        data: [
          { id: "gpt-5-mini", qualified_operations: ["responses"], privacy },
        ],
      });
    if (path.startsWith("/v1/purchases/")) {
      const purchase = path.split("/")[3];
      return Response.json(
        path.endsWith("/receipt")
          ? {
              purchase_id: purchase,
              status: "verified",
              payment_profile: "tempo-mpp",
              charged_atomic: "5000",
              settlement_reference: DEMO_TX,
              delivery: "not_available",
            }
          : {
              purchase_id: purchase,
              inference: "completion_committed",
              payment: "verified",
              delivery: "not_available",
              result_replay_available: false,
            },
      );
    }
    if (path === ROUTE) {
      const authorization = new Headers(init?.headers).get("Authorization");
      if (!authorization) return fixtureQuote(String(init?.body)).response;
      const credential = Credential.deserialize(authorization);
      const receiptValue = {
        method: "tempo",
        intent: "session",
        timestamp: new Date().toISOString(),
        reference: DEMO_TX,
        challengeId: credential.challenge.id,
        channelId: DEMO_CHANNEL,
        acceptedCumulative: "10000",
        spent: "5000",
        txHash: DEMO_TX,
        status: "success" as const,
      };
      const receipt = Receipt.serialize(receiptValue);
      return Response.json(
        {
          id: "demo-response",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Machine payments let software pay for a service as it uses it. The service returns an HTTP 402 quote, and the client authorizes payment with a wallet. The router then delivers inference and settles the actual charge.\n\nThis is a simulated answer. Switch to live mode to send your own prompt to a configured router.",
                },
              ],
            },
          ],
          usage: { input_tokens: 18, output_tokens: 55 },
        },
        { headers: { "Payment-Receipt": receipt } },
      );
    }
    throw new Error("Demo mode cannot access this route.");
  };
}
