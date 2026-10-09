import { isAddress, type Address, type EIP1193Provider } from "viem";
import { ensure, NETWORKS, record, type Config } from "./router";
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
