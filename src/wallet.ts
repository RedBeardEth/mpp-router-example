import { Mppx, tempo } from "mppx/client";
import { Credential } from "mppx";
import {
  createClient,
  createPublicClient,
  custom,
  fromRlp,
  http,
  type EIP1193Provider,
} from "viem";
import { tempo as mainnet, tempoModerato } from "viem/chains";
import { assertWallet, type ConnectedWallet } from "./discovery";
import {
  displayAmount,
  ensure,
  ESCROW,
  NETWORKS,
  record,
  type Config,
  type MppQuote,
} from "./router";
// Signing pulls in the MPP client and chain definitions, so the app loads this
// module only when a payment is approved. Discovery stays in ./discovery.
export {
  assertWallet,
  connectWallet,
  discoverWallets,
  type BrowserWallet,
  type ConnectedWallet,
} from "./discovery";
export function assertDirectCredential(
  authorization: string,
  wallet: ConnectedWallet,
) {
  const payload = record(Credential.deserialize(authorization).payload);
  ensure(
    typeof payload.transaction === "string" &&
      payload.transaction.startsWith("0x78"),
    "The wallet must sign a sponsored Tempo transaction.",
  );
  const fields = fromRlp(
    ("0x" + payload.transaction.slice(4)) as `0x${string}`,
    "hex",
  );
  ensure(
    Array.isArray(fields) &&
      fields.length === 14 &&
      Array.isArray(fields[5]) &&
      fields[5].length === 0 &&
      fields[10] === "0x" &&
      typeof fields[11] === "string" &&
      fields[11].toLowerCase() === wallet.address.toLowerCase() &&
      Array.isArray(fields[12]) &&
      fields[12].length === 0 &&
      typeof fields[13] === "string" &&
      fields[13].length === 132 &&
      /^0x[\da-f]{130}$/i.test(payload.signature),
    "This router requires direct secp256k1 signatures. Passkeys, access keys, and delegated accounts are unsupported. No paid request was sent.",
  );
}
export async function signQuote(
  wallet: ConnectedWallet,
  quote: MppQuote,
  config: Config,
) {
  await assertWallet(wallet, config);
  ensure(
    Date.now() < quote.expires,
    "Quote expired. Request a new unpaid quote.",
  );
  const chain = config.network === "mainnet" ? mainnet : tempoModerato;
  const rpc = createPublicClient({
    chain,
    transport: http(NETWORKS[config.network].rpc, {
      retryCount: 0,
      timeout: 15000,
    }),
  });
  ensure((await rpc.getChainId()) === chain.id, "RPC chain mismatch.");
  const client = createClient({
    account: wallet.address,
    chain,
    transport: custom(
      {
        async request(args) {
          if (
            ["eth_signTransaction", "eth_signTypedData_v4"].includes(
              args.method,
            )
          ) {
            await assertWallet(wallet, config);
            // These methods sign only. No wallet send/broadcast method is used.
            return wallet.provider.request(
              args as Parameters<EIP1193Provider["request"]>[0],
            );
          }
          ensure(
            [
              "eth_chainId",
              "eth_fillTransaction",
              "eth_getBlockByNumber",
              "eth_getTransactionCount",
              "eth_maxPriorityFeePerGas",
              "eth_estimateGas",
              "eth_gasPrice",
              "eth_call",
            ].includes(args.method),
            "Unexpected wallet RPC operation.",
          );
          return rpc.request(args as Parameters<typeof rpc.request>[0]);
        },
      },
      { retryCount: 0 },
    ),
  });
  // A new method instance deliberately creates a fresh channel for this purchase.
  const mppx = Mppx.create({
    polyfill: false,
    methods: [
      tempo.session({
        account: wallet.address,
        getClient: ({ chainId }) => {
          ensure(
            chainId === undefined || chainId === chain.id,
            "Signing chain mismatch.",
          );
          return client;
        },
        escrow: ESCROW,
        maxDeposit: displayAmount(quote.amount),
        autoSwap: false,
      }),
    ],
  });
  const prepared = await mppx.preparePayment(
    new Response(null, {
      status: 402,
      headers: { "WWW-Authenticate": quote.header },
    }),
  );
  const authorization = await prepared.createCredential({
    depositRaw: quote.amount,
    autoSwap: false,
  });
  await assertWallet(wallet, config);
  assertDirectCredential(authorization, wallet);
  ensure(
    Date.now() < quote.expires,
    "Quote expired while signing. No paid request was sent.",
  );
  return authorization;
}
