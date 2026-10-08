import { describe, it, expect, vi } from "vitest";
import { Challenge, Credential, Receipt } from "mppx";
import {
  checkpoint,
  loadCheckpoint,
  makeBody,
  readJson,
  readQuote,
  RouterClient,
  saveCheckpoint,
  type Config,
} from "../src/router";
import {
  createDemoTransport,
  DEMO_CONFIG,
  demoCredential,
  fixtureQuote,
} from "../src/demo";
const body = makeBody("gpt-5-mini", "Test prompt");
const quoted = () => {
  const f = fixtureQuote(body);
  return readQuote(f.response, f.value, body, DEMO_CONFIG);
};

describe("quote trust boundary", () => {
  it("accepts the router’s funded Anonymous session profile", () => {
    expect(quoted().amount).toBe("10000");
  });
  it.each([
    ["chain", (c: any) => (c.request.methodDetails.chainId = 4217)],
    ["token", (c: any) => (c.request.currency = "0x" + "12".repeat(20))],
    ["recipient", (c: any) => (c.request.recipient = "0x" + "12".repeat(20))],
    [
      "escrow",
      (c: any) =>
        (c.request.methodDetails.escrowContract = "0x" + "12".repeat(20)),
    ],
    ["unsponsored", (c: any) => (c.request.methodDetails.feePayer = false)],
    ["expired", (c: any) => (c.expires = "2000-01-01T00:00:00.000Z")],
    ["ceiling", (c: any) => (c.request.amount = "100001")],
    ["oversized deposit", (c: any) => (c.request.suggestedDeposit = "100000")],
    [
      "resource",
      (c: any) =>
        (c.opaque = btoa(
          JSON.stringify({
            purchase: "other",
            resource: "https://other.invalid",
          }),
        )),
    ],
    [
      "operator",
      (c: any) => (c.request.methodDetails.operator = "0x" + "12".repeat(20)),
    ],
  ])("rejects unexpected %s before wallet use", (_, change) => {
    const f = fixtureQuote(body);
    change(f.challenge);
    f.response.headers.set(
      "WWW-Authenticate",
      Challenge.serialize(f.challenge),
    );
    expect(() => readQuote(f.response, f.value, body, DEMO_CONFIG)).toThrow();
  });
  it("rejects missing privacy disclosure and mismatched quote binding", () => {
    const f = fixtureQuote(body);
    expect(() =>
      readQuote(f.response, { ...f.value, privacy: {} }, body, DEMO_CONFIG),
    ).toThrow(/Anonymous/);
    expect(() =>
      readQuote(
        f.response,
        { ...f.value, quote_binding: "wrong" },
        body,
        DEMO_CONFIG,
      ),
    ).toThrow(/binding/);
  });
  it("requires an explicitly configured recipient", () => {
    const f = fixtureQuote(body);
    expect(() =>
      readQuote(f.response, f.value, body, { ...DEMO_CONFIG, recipient: "" }),
    ).toThrow(/ROUTER_RECIPIENT/);
  });
});

describe("purchase lifecycle", () => {
  it("preserves exact request bytes and both private headers; never submits twice", async () => {
    const transport = vi.fn(createDemoTransport()),
      client = new RouterClient(DEMO_CONFIG, transport);
    const exact = '{ "model": "gpt-5-mini", "input": "original spacing" }';
    const q = await client.quote(exact),
      beforeSend = vi.fn();
    const result = await client.submit(q, demoCredential(q), beforeSend);
    expect(result.spent).toBe("5000");
    expect(beforeSend).toHaveBeenCalledOnce();
    const sent = transport.mock.calls[1][1]!;
    expect(sent.body).toBe(exact);
    expect(sent.redirect).toBe("error");
    expect(sent.credentials).toBe("omit");
    expect(new Headers(sent.headers).get("X-Quote-Binding")).toBe(q.binding);
    expect(new Headers(sent.headers).get("X-Status-Token")).toBe(q.token);
    await expect(client.submit(q, demoCredential(q))).rejects.toThrow(
      /already submitted/,
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("does not retry after a lost paid response; recovery only uses GETs", async () => {
    const demo = createDemoTransport();
    let paid = 0;
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (new Headers(init?.headers).has("Authorization")) {
        paid++;
        throw new TypeError("Connection lost");
      }
      return demo(input, init);
    });
    const client = new RouterClient(DEMO_CONFIG, transport),
      q = await client.quote(body);
    await expect(client.submit(q, demoCredential(q))).rejects.toThrow();
    await expect(client.submit(q, demoCredential(q))).rejects.toThrow(
      /already/,
    );
    const state = await client.recover(checkpoint(q, DEMO_CONFIG, true));
    expect(state.terminal).toBe(true);
    expect(paid).toBe(1);
    expect(
      transport.mock.calls
        .slice(2)
        .every(
          ([, init]) =>
            !init?.method &&
            !init?.body &&
            !new Headers(init?.headers).has("Authorization"),
        ),
    ).toBe(true);
  });
  it("blocks submission if saving the recovery record fails", async () => {
    const transport = vi.fn(createDemoTransport()),
      client = new RouterClient(DEMO_CONFIG, transport),
      q = await client.quote(body);
    await expect(
      client.submit(q, demoCredential(q), () => {
        throw Error("storage unavailable");
      }),
    ).rejects.toThrow(/storage/);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("does not persist prompts or payment credentials", () => {
    const q = quoted(),
      store = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      key: (i) => [...store.keys()][i] ?? null,
      removeItem: (k) => {
        store.delete(k);
      },
      setItem: (k, v) => {
        store.set(k, v);
      },
      getItem: (k) => store.get(k) ?? null,
    };
    saveCheckpoint(storage, checkpoint(q, DEMO_CONFIG, true));
    expect(loadCheckpoint(storage, DEMO_CONFIG)?.attempted).toBe(true);
    const json = [...store.values()][0];
    expect(json).not.toContain("Test prompt");
    expect(json).not.toContain("Authorization");
    expect(json).not.toContain(q.binding);
  });
  it("rejects wrong-channel and over-ceiling receipts", async () => {
    for (const patch of [
      { channelId: "0x" + "55".repeat(32) },
      { spent: "10001" },
    ]) {
      const demo = createDemoTransport(),
        client = new RouterClient(DEMO_CONFIG, async (input, init) => {
          const response = await demo(input, init);
          const header = response.headers.get("Payment-Receipt");
          if (header)
            response.headers.set(
              "Payment-Receipt",
              Receipt.serialize({ ...Receipt.deserialize(header), ...patch }),
            );
          return response;
        });
      const q = await client.quote(body);
      await expect(client.submit(q, demoCredential(q))).rejects.toThrow(
        /receipt/,
      );
    }
  });
  it("rejects changed credentials without making a paid POST", async () => {
    const transport = vi.fn(createDemoTransport()),
      client = new RouterClient(DEMO_CONFIG, transport),
      q = await client.quote(body);
    const credential = Credential.deserialize(demoCredential(q));
    credential.challenge.id = "different";
    await expect(
      client.submit(q, Credential.serialize(credential)),
    ).rejects.toThrow(/credential/);
    expect(transport).toHaveBeenCalledOnce();
  });
  it("keeps pending payment unknown and does not invent a zero charge", async () => {
    const q = quoted(),
      client = new RouterClient(DEMO_CONFIG, async (input) =>
        String(input).endsWith("/receipt")
          ? Response.json({}, { status: 202 })
          : Response.json(
              {
                purchase_id: q.purchase,
                inference: "completion_committed",
                payment: "capture_pending",
                delivery: "detached",
                result_replay_available: false,
              },
              { status: 202 },
            ),
      );
    const recovered = await client.recover(checkpoint(q, DEMO_CONFIG, true));
    expect(recovered.terminal).toBe(false);
    expect(recovered.charged).toBeUndefined();
  });
  it("cancels a response body that exceeds its bound", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(10));
        },
        cancel,
      }),
    );
    await expect(readJson(response, 4)).rejects.toThrow(/size limit/);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
