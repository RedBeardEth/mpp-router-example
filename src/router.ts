import { Challenge, Credential, Receipt } from "mppx";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
} from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";

export const ESCROW = "0x4d50500000000000000000000000000000000000" as const;
/** Paid routes by qualified operation. The model catalog decides which applies. */
export const OPERATIONS = {
  responses: "/providers/openai/v1/responses",
  messages: "/providers/anthropic/v1/messages",
} as const;
export type Operation = keyof typeof OPERATIONS;
export const ROUTE = OPERATIONS.responses;
/** x402 exact uses a standard typed-data signature; MPP sessions sign a Tempo transaction. */
export type Rail = "x402" | "mpp";
export type Chain = {
  id: number;
  label: string;
  asset: string;
  token: string;
  rpc: string;
  explorer: string;
  native: { name: string; symbol: string; decimals: number };
};
export const NETWORKS = {
  testnet: {
    id: 42431,
    label: "Tempo Moderato",
    asset: "pathUSD",
    token: "0x20c0000000000000000000000000000000000000",
    rpc: "https://rpc.moderato.tempo.xyz",
    explorer: "https://explore.moderato.tempo.xyz",
    native: { name: "USD", symbol: "USD", decimals: 18 },
  },
  mainnet: {
    id: 4217,
    label: "Tempo",
    asset: "USDC.e",
    token: "0x20c000000000000000000000b9537d11c60e8b50",
    rpc: "https://rpc.tempo.xyz",
    explorer: "https://explore.tempo.xyz",
    native: { name: "USD", symbol: "USD", decimals: 18 },
  },
} as const satisfies Record<string, Chain>;
export const BASE = {
  testnet: {
    id: 84532,
    label: "Base Sepolia",
    asset: "USDC",
    token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    native: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  mainnet: {
    id: 8453,
    label: "Base",
    asset: "USDC",
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
    native: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
} as const satisfies Record<string, Chain>;
export const chainFor = (rail: Rail, network: Config["network"]): Chain =>
  rail === "x402" ? BASE[network] : NETWORKS[network];
export type Config = {
  origin: string;
  recipient: string;
  network: keyof typeof NETWORKS;
  maxAmount: string;
};
export type Model = { id: string; operation: Operation };
type QuoteBase = {
  purchase: string;
  binding: string;
  token: string;
  body: string;
  operation: Operation;
  amount: string;
  recipient: Address;
  issued: number;
  expires: number;
  model: string;
};
export type MppQuote = QuoteBase & {
  rail: "mpp";
  challenge: ReturnType<typeof Challenge.deserialize>;
  header: string;
};
export type X402Quote = QuoteBase & {
  rail: "x402";
  required: PaymentRequired;
  offer: PaymentRequirements;
};
export type Quote = MppQuote | X402Quote;
export type Checkpoint = {
  version: 1;
  origin: string;
  network: Config["network"];
  purchase: string;
  token: string;
  amount: string;
  attempted: boolean;
};
export type Result = {
  text: string;
  raw: unknown;
  spent: string;
  transaction: string;
  explorer: string;
  channel?: string;
  usage?: { input: number; output: number };
};
export type Recovery = {
  inference: string;
  payment: string;
  delivery: string;
  terminal: boolean;
  charged?: string;
  transaction?: string;
};
export const displayAmount = (value: string) => formatUnits(BigInt(value), 6);
export const record = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid router response.");
  return value as Record<string, any>;
};
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function atomic(value: unknown): string {
  ensure(
    typeof value === "string" && /^(0|[1-9][0-9]{0,28})$/.test(value),
    "Invalid payment amount.",
  );
  ensure(BigInt(value) < 2n ** 96n, "Payment amount is out of range.");
  return value;
}
export function sameAddress(a: unknown, b: string) {
  return (
    typeof a === "string" &&
    isAddress(a, { strict: false }) &&
    a.toLowerCase() === b.toLowerCase()
  );
}
/** Key-order independent JSON, for comparing an offer with its signed copy. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
export function validateConfig(config: Config) {
  const url = new URL(config.origin);
  ensure(
    url.origin === config.origin && !url.username && !url.password,
    "Configure a router origin without a path or credentials.",
  );
  ensure(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)),
    "Use HTTPS or a local router.",
  );
  ensure(config.network in NETWORKS, "Select a supported network.");
  ensure(
    isAddress(config.recipient, { strict: false }) &&
      !/^0x0{40}$/i.test(config.recipient),
    "Set ROUTER_RECIPIENT in .env.local to the router’s verified payment recipient.",
  );
  ensure(
    /^\d+(\.\d{1,6})?$/.test(config.maxAmount) &&
      parseUnits(config.maxAmount, 6) > 0n,
    "The spending limit must be a positive token amount with at most six decimals.",
  );
}
/** Checks shared by every payment rail: identity, privacy and execution terms. */
function readTerms(
  response: Response,
  value: unknown,
  body: string,
  config: Config,
  operation: Operation,
) {
  validateConfig(config);
  ensure(
    response.status === 402,
    `Expected a payment quote; router returned HTTP ${response.status}.`,
  );
  const data = record(value);
  ensure(
    typeof data.purchase_id === "string" &&
      /^[\w:.-]{1,128}$/.test(data.purchase_id),
    "Invalid purchase identity.",
  );
  const binding = response.headers.get("x-quote-binding"),
    token = response.headers.get("x-status-token");
  ensure(
    binding &&
      /^0x[\da-f]{64}$/.test(binding) &&
      data.quote_binding === binding,
    "Missing or mismatched quote binding.",
  );
  ensure(
    token && /^0x[\da-f]{64}$/.test(token),
    "Missing private status token.",
  );
  const privacy = record(data.privacy);
  ensure(
    privacy.revision === "anonymous-volatile-v1" &&
      privacy.mode === "anonymous" &&
      privacy.router_content_retention === "none" &&
      privacy.result_replay_available === false &&
      privacy.delivery === "live_response_only",
    "The router did not offer Anonymous live-only delivery.",
  );
  const model = record(JSON.parse(body)).model;
  ensure(
    data.execution_profile?.model === model &&
      data.qualified_profile?.model === model &&
      data.qualified_profile?.operation === operation &&
      data.qualified_profile?.privacy_revision === privacy.revision,
    "Missing matching qualification for this model and route.",
  );
  return {
    purchase: data.purchase_id as string,
    binding,
    token,
    model: model as string,
    ceiling: data.execution_profile?.quote_ceiling as unknown,
  };
}
function withinLimit(amount: string, config: Config) {
  ensure(
    BigInt(amount) > 0n && BigInt(amount) <= parseUnits(config.maxAmount, 6),
    "The quote exceeds your spending limit.",
  );
}
export function readQuote(
  response: Response,
  value: unknown,
  body: string,
  config: Config,
  now = Date.now(),
  operation: Operation = "responses",
): MppQuote {
  const terms = readTerms(response, value, body, config, operation),
    network = NETWORKS[config.network];
  const header = response.headers.get("www-authenticate");
  ensure(
    header,
    "No MPP offer. Enable tempo-mpp on the router and forward WWW-Authenticate.",
  );
  const matches = Challenge.deserializeList(header).filter(
    (c) => c.method === "tempo" && c.intent === "session",
  );
  ensure(matches.length === 1, "Expected exactly one Tempo session offer.");
  const challenge = matches[0],
    offer = record(challenge.request),
    details = record(offer.methodDetails);
  ensure(
    details.chainId === network.id && details.sessionProtocol === "v2",
    "The quote uses a different network or session protocol.",
  );
  ensure(
    sameAddress(offer.currency, network.token),
    "The quote uses an unexpected token.",
  );
  ensure(
    sameAddress(offer.recipient, config.recipient) &&
      sameAddress(details.escrowContract, ESCROW),
    "Recipient or escrow does not match this app’s configuration.",
  );
  ensure(
    details.feePayer === true && offer.unitType === "request",
    "This example requires a sponsored, per-request session.",
  );
  ensure(
    details.operator === undefined ||
      sameAddress(
        details.operator,
        "0x0000000000000000000000000000000000000000",
      ),
    "Unexpected session operator.",
  );
  ensure(
    !details.channelId && !details.sessionSnapshot,
    "This example opens one fresh channel per purchase.",
  );
  const amount = atomic(offer.amount);
  withinLimit(amount, config);
  ensure(
    offer.suggestedDeposit === amount,
    "The suggested deposit differs from the quote ceiling.",
  );
  ensure(
    terms.ceiling === amount,
    "Execution terms do not match the request and ceiling.",
  );
  ensure(typeof challenge.expires === "string", "The quote has no expiry.");
  const expires = Date.parse(challenge.expires);
  ensure(
    Number.isFinite(expires) && expires > now,
    "The quote has expired. Request a new unpaid quote.",
  );
  ensure(
    typeof challenge.opaque === "string",
    "The quote has no resource binding.",
  );
  const opaque = record(
    JSON.parse(atob(challenge.opaque.replace(/-/g, "+").replace(/_/g, "/"))),
  );
  ensure(
    opaque.resource === config.origin + OPERATIONS[operation] &&
      opaque.purchase === terms.purchase,
    "The quote belongs to another resource or purchase.",
  );
  return {
    rail: "mpp",
    purchase: terms.purchase,
    binding: terms.binding,
    token: terms.token,
    body,
    operation,
    challenge,
    header: Challenge.serialize(challenge),
    amount,
    recipient: offer.recipient,
    issued: now,
    expires,
    model: terms.model,
  };
}
/** Selects the single Base x402 `exact` (EIP-3009 USDC) offer and checks it. */
export function readX402Quote(
  response: Response,
  value: unknown,
  body: string,
  config: Config,
  now = Date.now(),
  operation: Operation = "responses",
): X402Quote {
  const terms = readTerms(response, value, body, config, operation),
    chain = BASE[config.network];
  const header = response.headers.get("payment-required");
  ensure(header, "No x402 offer. The router did not send PAYMENT-REQUIRED.");
  let required: PaymentRequired;
  try {
    required = decodePaymentRequiredHeader(header);
  } catch {
    throw new Error("The router sent an unreadable x402 offer.");
  }
  ensure(required.x402Version === 2, "Unsupported x402 version.");
  ensure(
    required.resource?.url === config.origin + OPERATIONS[operation],
    "The quote belongs to another resource.",
  );
  const offers = required.accepts.filter(
    (o) => o.scheme === "exact" && o.network === `eip155:${chain.id}`,
  );
  ensure(offers.length === 1, `Expected exactly one ${chain.label} offer.`);
  const offer = offers[0],
    extra = record(offer.extra);
  ensure(
    sameAddress(offer.asset, chain.token),
    "The quote uses an unexpected token.",
  );
  ensure(
    sameAddress(offer.payTo, config.recipient),
    "Recipient does not match this app’s configuration.",
  );
  ensure(
    extra.assetTransferMethod === "eip3009" &&
      extra.name === "USDC" &&
      extra.version === "2",
    "This example signs only EIP-3009 USDC transfer authorizations.",
  );
  ensure(
    extra.purchaseId === terms.purchase,
    "The quote belongs to another purchase.",
  );
  const amount = atomic(offer.amount);
  withinLimit(amount, config);
  ensure(
    terms.ceiling === amount,
    "Execution terms do not match the request and price.",
  );
  ensure(
    Number.isInteger(offer.maxTimeoutSeconds) &&
      offer.maxTimeoutSeconds > 0 &&
      offer.maxTimeoutSeconds <= 120,
    "The quote has an unexpected payment window.",
  );
  return {
    rail: "x402",
    purchase: terms.purchase,
    binding: terms.binding,
    token: terms.token,
    body,
    operation,
    required,
    offer,
    amount,
    recipient: offer.payTo as Address,
    issued: now,
    // The signed authorization is valid for maxTimeoutSeconds from signing.
    expires: now + offer.maxTimeoutSeconds * 1000,
    model: terms.model,
  };
}

export function makeBody(
  model: string,
  prompt: string,
  operation: Operation = "responses",
) {
  ensure(
    prompt.trim().length > 0 && prompt.length <= 8000,
    "Enter a prompt of at most 8,000 characters.",
  );
  if (operation === "messages")
    return JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
  return JSON.stringify({
    model,
    input: prompt,
    max_output_tokens: 1024,
    ...(model === "gpt-5-mini" ? { reasoning: { effort: "minimal" } } : {}),
    stream: false,
    store: false,
  });
}
export async function readJson(
  response: Response,
  limit = 16 * 1024 * 1024,
): Promise<unknown> {
  ensure(response.body, "The router returned an empty response.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      ensure(
        size <= limit,
        "The response exceeds this example’s size limit. Check purchase status.",
      );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(
      "The router returned an unreadable response. Check purchase status if submitted.",
    );
  }
}
/** Text from a native Responses or Messages body; empty if it is status metadata. */
function answerText(data: Record<string, any>, operation: Operation) {
  if (operation === "messages")
    return data.type === "message" && Array.isArray(data.content)
      ? data.content
          .filter((c: any) => c.type === "text" && typeof c.text === "string")
          .map((c: any) => c.text)
          .join("\n")
      : "";
  return Array.isArray(data.output)
    ? data.output
        .flatMap((item: any) =>
          Array.isArray(item.content)
            ? item.content
                .filter(
                  (c: any) =>
                    c.type === "output_text" && typeof c.text === "string",
                )
                .map((c: any) => c.text)
            : [],
        )
        .join("\n")
    : "";
}
export function checkpoint(
  quote: Quote,
  config: Config,
  attempted = false,
): Checkpoint {
  return {
    version: 1,
    origin: config.origin,
    network: config.network,
    purchase: quote.purchase,
    token: quote.token,
    amount: quote.amount,
    attempted,
  };
}
export const CHECKPOINT_KEY = "mpp-router-example.purchase.v1";
export function saveCheckpoint(storage: Storage, value: Checkpoint) {
  storage.setItem(
    CHECKPOINT_KEY +
      (value.origin === "https://demo.router.invalid" ? ".demo" : ""),
    JSON.stringify(value),
  );
}
export function loadCheckpoint(
  storage: Storage,
  config: Config,
): Checkpoint | null {
  const raw = storage.getItem(
    CHECKPOINT_KEY +
      (config.origin === "https://demo.router.invalid" ? ".demo" : ""),
  );
  if (!raw) return null;
  const c = record(JSON.parse(raw));
  ensure(
    c.version === 1 &&
      c.origin === config.origin &&
      c.network === config.network &&
      typeof c.attempted === "boolean" &&
      /^[\w:.-]{1,128}$/.test(c.purchase) &&
      /^0x[\da-f]{64}$/.test(c.token),
    "A saved purchase belongs to another configuration or is invalid. Restore its original configuration to check it.",
  );
  atomic(c.amount);
  return c as Checkpoint;
}

/** Explicit fetches only: no automatic 402 handler, retries, or redirect following. */
export class RouterClient {
  private submitted = new Set<string>();
  constructor(
    readonly config: Config,
    // Wrapped so the browser's fetch is never called with the client as `this`.
    private transport: typeof fetch = (input, init) => fetch(input, init),
  ) {}
  private request(path: string, init: RequestInit = {}, timeout = 20000) {
    return this.transport("/router" + path, {
      ...init,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  }
  async models(): Promise<Model[]> {
    const response = await this.request("/v1/models");
    ensure(
      response.ok,
      `Router discovery unavailable (HTTP ${response.status}).`,
    );
    const data = record(await readJson(response, 1024 * 1024));
    ensure(Array.isArray(data.data), "Invalid model catalog.");
    return data.data.flatMap((m: any) => {
      const operations = Array.isArray(m.qualified_operations)
        ? m.qualified_operations
        : [];
      const operation = (["responses", "messages"] as const).find((o) =>
        operations.includes(o),
      );
      return typeof m.id === "string" &&
        operation &&
        m.privacy?.revision === "anonymous-volatile-v1"
        ? [{ id: m.id, operation }]
        : [];
    });
  }
  async quote(
    body: string,
    operation: Operation = "responses",
    rail: Rail = "mpp",
  ): Promise<Quote> {
    validateConfig(this.config);
    const response = await this.request(OPERATIONS[operation], {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });
    const value = await readJson(response, 1024 * 1024);
    return rail === "x402"
      ? readX402Quote(response, value, body, this.config, Date.now(), operation)
      : readQuote(response, value, body, this.config, Date.now(), operation);
  }
  async submit(
    quote: Quote,
    authorization: string,
    beforeSend: () => void = () => {},
  ): Promise<Result> {
    ensure(
      !this.submitted.has(quote.purchase),
      "This purchase was already submitted. Check its status.",
    );
    ensure(
      Date.now() < quote.expires,
      "The quote expired before submission. No paid request was sent.",
    );
    let channel: string | undefined, payer: string | undefined;
    if (quote.rail === "mpp") {
      const credential = Credential.deserialize(authorization),
        payload = record(credential.payload);
      ensure(
        Challenge.serialize(credential.challenge) === quote.header &&
          payload.action === "open" &&
          payload.type === "transaction" &&
          payload.cumulativeAmount === quote.amount &&
          /^0x[\da-f]{64}$/i.test(payload.channelId) &&
          /^0x78[\da-f]+$/i.test(payload.transaction),
        "The wallet returned an incompatible payment credential.",
      );
      channel = payload.channelId;
    } else {
      let payment;
      try {
        payment = decodePaymentSignatureHeader(authorization);
      } catch {
        throw new Error("The wallet returned an unreadable x402 payment.");
      }
      const auth = record(record(payment.payload).authorization);
      ensure(
        payment.x402Version === 2 &&
          canonical(payment.accepted) === canonical(quote.offer) &&
          auth.value === quote.amount &&
          sameAddress(auth.to, quote.offer.payTo) &&
          isAddress(auth.from, { strict: false }),
        "The wallet returned an incompatible payment credential.",
      );
      payer = auth.from;
    }
    beforeSend();
    this.submitted.add(quote.purchase); // Set before I/O; ambiguous outcomes never enable another POST.
    const response = await this.request(
      OPERATIONS[quote.operation],
      {
        method: "POST",
        body: quote.body,
        headers: {
          "Content-Type": "application/json",
          ...(quote.rail === "mpp"
            ? { Authorization: authorization }
            : { "PAYMENT-SIGNATURE": authorization }),
          "X-Quote-Binding": quote.binding,
          "X-Status-Token": quote.token,
        },
      },
      130000,
    );
    const raw = await readJson(response);
    ensure(
      response.status === 200,
      `Paid request returned HTTP ${response.status}. Check status; do not pay again.`,
    );
    const data = record(raw);
    const text = answerText(data, quote.operation);
    ensure(
      text,
      "The router returned purchase metadata, not a live answer. Check status.",
    );
    const usage = data.usage;
    const result = {
      text,
      raw,
      usage:
        Number.isSafeInteger(usage?.input_tokens) &&
        Number.isSafeInteger(usage?.output_tokens)
          ? { input: usage.input_tokens, output: usage.output_tokens }
          : undefined,
    };
    if (quote.rail === "mpp") {
      const header = response.headers.get("payment-receipt");
      ensure(header, "The response has no MPP receipt. Check status.");
      const receipt = record(Receipt.deserialize(header));
      ensure(
        receipt.status === "success" &&
          receipt.method === "tempo" &&
          receipt.intent === "session" &&
          receipt.challengeId === quote.challenge.id &&
          receipt.channelId?.toLowerCase() === channel!.toLowerCase() &&
          receipt.acceptedCumulative === quote.amount &&
          BigInt(atomic(receipt.spent)) <= BigInt(quote.amount) &&
          /^0x[\da-f]{64}$/i.test(receipt.txHash),
        "The MPP receipt does not match this purchase. Check status.",
      );
      return {
        ...result,
        spent: receipt.spent,
        transaction: receipt.txHash,
        explorer: `${NETWORKS[this.config.network].explorer}/tx/${receipt.txHash}`,
        channel: receipt.channelId,
      };
    }
    const header = response.headers.get("payment-response");
    ensure(header, "The response has no x402 receipt. Check status.");
    let settled;
    try {
      settled = decodePaymentResponseHeader(header);
    } catch {
      throw new Error("The x402 receipt is unreadable. Check status.");
    }
    const spent = atomic(settled.amount ?? quote.amount);
    ensure(
      settled.success === true &&
        settled.network === quote.offer.network &&
        (settled.payer === undefined || sameAddress(settled.payer, payer!)) &&
        spent === quote.amount &&
        /^0x[\da-f]{64}$/i.test(settled.transaction),
      "The x402 receipt does not match this purchase. Check status.",
    );
    return {
      ...result,
      spent,
      transaction: settled.transaction,
      explorer: `${BASE[this.config.network].explorer}/tx/${settled.transaction}`,
    };
  }
  async recover(saved: Checkpoint): Promise<Recovery> {
    ensure(
      saved.origin === this.config.origin &&
        saved.network === this.config.network,
      "Restore the original router configuration to recover this purchase.",
    );
    const path = "/v1/purchases/" + encodeURIComponent(saved.purchase),
      headers = { "X-Status-Token": saved.token };
    const statusResponse = await this.request(path, { headers });
    ensure(
      [200, 202].includes(statusResponse.status),
      `Status unavailable (HTTP ${statusResponse.status}). Keep your recovery record.`,
    );
    const status = record(await readJson(statusResponse, 65536));
    ensure(
      status.purchase_id === saved.purchase &&
        status.result_replay_available === false,
      "Invalid purchase status.",
    );
    const terminal = ["verified", "zero_charge", "collection_failed"].includes(
      status.payment,
    );
    const result: Recovery = {
      inference: String(status.inference),
      payment: String(status.payment),
      delivery: String(status.delivery),
      terminal,
    };
    const receiptResponse = await this.request(path + "/receipt", { headers });
    if (receiptResponse.status === 202) return result;
    ensure(
      receiptResponse.ok,
      `Receipt unavailable (HTTP ${receiptResponse.status}). Keep your recovery record.`,
    );
    const receipt = record(await readJson(receiptResponse, 65536));
    ensure(
      receipt.purchase_id === saved.purchase &&
        receipt.status === "verified" &&
        ["tempo-mpp", "base-direct"].includes(receipt.payment_profile) &&
        BigInt(atomic(receipt.charged_atomic)) <= BigInt(saved.amount),
      "The receipt does not match this purchase.",
    );
    return {
      ...result,
      charged: receipt.charged_atomic,
      transaction: receipt.settlement_reference,
    };
  }
}
