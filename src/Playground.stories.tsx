import { Playground, type PlaygroundProps } from "./Playground";
const noop = () => {};
const args: PlaygroundProps = {
  config: {
    origin: "http://127.0.0.1:38080",
    recipient: "",
    network: "testnet",
    maxAmount: "0.10",
  },
  demo: true,
  models: [{ id: "gpt-5-mini", operation: "responses" }],
  model: "gpt-5-mini",
  prompt: "Explain machine payments in three short sentences.",
  phase: "idle",
  walletNames: [],
  selectedWallet: "",
  busy: false,
  seconds: 60,
  canReset: false,
  onModel: noop,
  onPrompt: noop,
  onSelectWallet: noop,
  onConnect: noop,
  onQuote: noop,
  onPay: noop,
  onRecover: noop,
  onReset: noop,
  onExport: noop,
  onReload: noop,
  onDownload: noop,
};
export default { title: "Playground", component: Playground, args };
export const Initial = {};
export const Unavailable = {
  args: {
    models: [],
    model: "",
    message:
      "Router discovery unavailable (HTTP 503). Start your configured router and reload the catalog.",
  },
};
export const Running = {
  args: {
    phase: "running",
    busy: true,
    wallet: "0x1111111111111111111111111111111111111111",
  },
};
export const DeliveryUnknown = {
  args: {
    phase: "uncertain",
    purchase: "example-purchase",
    message:
      "Connection lost. Check the original purchase status before making another request.",
  },
};
export const Answer = {
  args: {
    phase: "done",
    canReset: true,
    result: {
      text: "Machine payments let software pay for a service as it uses it. The service returns an HTTP 402 quote, and the client authorizes payment with a wallet. The router then delivers inference and settles the actual charge.",
      raw: {},
      spent: "5000",
      transaction: "0x" + "a".repeat(64),
      channel: "0x" + "b".repeat(64),
      explorer: "https://explore.moderato.tempo.xyz/tx/0x" + "a".repeat(64),
    },
  },
};
