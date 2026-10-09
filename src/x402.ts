import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, custom } from "viem";
import { assertWallet, type ConnectedWallet } from "./discovery";
import {
  BASE,
  ensure,
  record,
  sameAddress,
  type Config,
  type X402Quote,
} from "./router";

/**
 * Signs an x402 `exact` EIP-3009 USDC transfer authorization with
 * eth_signTypedData_v4, which standard browser wallets such as MetaMask
 * support. Nothing is broadcast: the router's facilitator settles it.
 */
export async function signX402(
  wallet: ConnectedWallet,
  quote: X402Quote,
  config: Config,
) {
  const chain = BASE[config.network];
  await assertWallet(wallet, config, chain.id);
  ensure(
    Date.now() < quote.expires,
    "Quote expired. Request a new unpaid quote.",
  );
  const signer = createWalletClient({
    account: wallet.address,
    transport: custom(wallet.provider, { retryCount: 0 }),
  });
  const client = new x402Client();
  client.register(
    quote.offer.network,
    new ExactEvmScheme({
      address: wallet.address,
      async signTypedData(message) {
        await assertWallet(wallet, config, chain.id);
        return signer.signTypedData({
          account: wallet.address,
          ...(message as any),
        });
      },
    }),
  );
  const payment = await client.createPaymentPayload({
    ...quote.required,
    accepts: [quote.offer],
  });
  const auth = record(record(payment.payload).authorization);
  ensure(
    sameAddress(auth.from, wallet.address) &&
      sameAddress(auth.to, quote.offer.payTo) &&
      auth.value === quote.amount,
    "The wallet signed different payment terms. No paid request was sent.",
  );
  await assertWallet(wallet, config, chain.id);
  ensure(
    Date.now() < quote.expires,
    "Quote expired while signing. No paid request was sent.",
  );
  return encodePaymentSignatureHeader(payment);
}
