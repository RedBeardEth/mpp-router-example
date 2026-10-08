import { Mppx, tempo } from "mppx/client";
import { Credential } from "mppx";
import {
  createClient,
  createPublicClient,
  custom,
  fromRlp,
  http,
  isAddress,
  type Address,
  type EIP1193Provider,
} from "viem";
import { tempo as mainnet, tempoModerato } from "viem/chains";
import {
  displayAmount,
  ensure,
  ESCROW,
  NETWORKS,
  record,
  type Config,
  type Quote,
} from "./router";
export type BrowserWallet = {
  id: string;
  name: string;
  provider: EIP1193Provider;
};
export type ConnectedWallet = BrowserWallet & { address: Address };

/** EIP-6963 discovery; no access request until the user clicks Connect. */
export function discoverWallets(onWallet: (wallet: BrowserWallet) => void) {
  const seen = new Set<string>();
  const announce = (event: Event) => {
    const { info, provider } = (event as CustomEvent).detail ?? {};
    if (
      typeof info?.uuid !== "string" ||
      typeof info?.name !== "string" ||
      !provider?.request ||
      seen.has(info.uuid)
    )
      return;
    seen.add(info.uuid);
    onWallet({ id: info.uuid, name: info.name.slice(0, 80), provider });
  };
  window.addEventListener("eip6963:announceProvider", announce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const legacy = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (legacy)
    onWallet({ id: "injected", name: "Browser wallet", provider: legacy });
  return () => window.removeEventListener("eip6963:announceProvider", announce);
}
export async function connectWallet(
  wallet: BrowserWallet,
  config: Config,
): Promise<ConnectedWallet> {
  const addresses = await wallet.provider.request({
    method: "eth_requestAccounts",
  });
  ensure(
    addresses[0] && isAddress(addresses[0]),
    "No wallet account selected.",
  );
  const network = NETWORKS[config.network];
  const chainId = `0x${network.id.toString(16)}`;
  try {
    await wallet.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    if (record(error).code !== 4902)
      throw new Error(
        "Switch your wallet to " + network.label + " and connect again.",
      );
    await wallet.provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: network.label,
          nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
          rpcUrls: [network.rpc],
          blockExplorerUrls: [network.explorer],
        },
      ],
    });
    await wallet.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
  const connected = { ...wallet, address: addresses[0] };
  await assertWallet(connected, config);
  return connected;
}
export async function assertWallet(wallet: ConnectedWallet, config: Config) {
  const [accounts, chain] = await Promise.all([
    wallet.provider.request({ method: "eth_accounts" }),
    wallet.provider.request({ method: "eth_chainId" }),
  ]);
  ensure(
    accounts[0]?.toLowerCase() === wallet.address.toLowerCase() &&
      Number(chain) === NETWORKS[config.network].id,
    "Wallet account or network changed. Reconnect before requesting a new quote.",
  );
}
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
  quote: Quote,
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
