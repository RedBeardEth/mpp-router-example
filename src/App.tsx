import { useEffect, useRef, useState } from "react";
import { Playground, type Phase } from "./Playground";
import {
  CHECKPOINT_KEY,
  RouterClient,
  checkpoint,
  loadCheckpoint,
  makeBody,
  saveCheckpoint,
  type Checkpoint,
  type Config,
  type Model,
  type Quote,
  type Recovery,
  type Result,
} from "./router";
import {
  connectWallet,
  discoverWallets,
  type BrowserWallet,
  type ConnectedWallet,
} from "./discovery";

type Demo = typeof import("./demo");
export function App({ config, demo }: { config: Config; demo?: Demo }) {
  const [client] = useState(
    () => new RouterClient(config, demo?.createDemoTransport()),
  );
  const [models, setModels] = useState<Model[]>([]),
    [model, setModel] = useState("");
  const [prompt, setPrompt] = useState(
    "Explain machine payments in three short sentences.",
  );
  const [wallets, setWallets] = useState<BrowserWallet[]>([]),
    [selectedWallet, setSelectedWallet] = useState("");
  const [wallet, setWallet] = useState<ConnectedWallet>(),
    [demoConnected, setDemoConnected] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle"),
    [quote, setQuote] = useState<Quote>();
  const [result, setResult] = useState<Result>(),
    [recovery, setRecovery] = useState<Recovery>();
  const [saved, setSaved] = useState<Checkpoint>(),
    [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false),
    [seconds, setSeconds] = useState(0);
  const lock = useRef(false),
    initialized = useRef(false);
  async function perform(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Action failed. Check the original purchase status if submitted.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    const catalog = await client.models();
    setModels(catalog);
    setModel(
      catalog.find((m) => m.id === "gpt-5-mini")?.id ?? catalog[0]?.id ?? "",
    );
    if (!catalog.length)
      throw new Error(
        "The router has no qualified Responses models. Check router readiness and catalog configuration.",
      );
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const previous = loadCheckpoint(sessionStorage, config);
      if (previous?.attempted) {
        setSaved(previous);
        setPhase("uncertain");
      } else sessionStorage.removeItem(CHECKPOINT_KEY + (demo ? ".demo" : ""));
    } catch (error) {
      setPhase("uncertain");
      setMessage(
        error instanceof Error
          ? error.message
          : "Recovery storage is unavailable.",
      );
    }
    void reload().catch((e) => setMessage(e.message));
  }, []);
  useEffect(
    () =>
      demo
        ? undefined
        : discoverWallets((w) => {
            setWallets((current) =>
              current.some((x) => x.id === w.id) ? current : [...current, w],
            );
            setSelectedWallet((current) => current || w.id);
          }),
    [demo],
  );
  // The countdown only matters while the quote can still be approved.
  const approvable = phase === "quoted" || phase === "signing";
  useEffect(() => {
    if (!quote) {
      setSeconds(0);
      return;
    }
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((quote.expires - Date.now()) / 1000)));
    update();
    if (!approvable) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [quote, approvable]);
  useEffect(() => {
    if (!wallet) return;
    const changed = () => {
      setWallet(undefined);
      setMessage(
        "Wallet changed or disconnected. Reconnect to approve an unpaid quote; submitted purchases can still be checked.",
      );
    };
    wallet.provider.on("accountsChanged", changed);
    wallet.provider.on("chainChanged", changed);
    wallet.provider.on("disconnect", changed);
    return () => {
      wallet.provider.removeListener("accountsChanged", changed);
      wallet.provider.removeListener("chainChanged", changed);
      wallet.provider.removeListener("disconnect", changed);
    };
  }, [wallet]);
  const connect = () =>
    perform(async () => {
      if (demo) {
        setDemoConnected(true);
        return;
      }
      const selected = wallets.find((w) => w.id === selectedWallet);
      if (!selected)
        throw new Error(
          "No browser wallet detected. Use a secp256k1 wallet supporting Tempo eth_signTransaction and typed-data signing. See the README compatibility notes, or try npm run demo.",
        );
      try {
        setWallet(await connectWallet(selected, config));
        void import("./wallet").catch(() => {}); // Warm the signing chunk.
      } catch {
        throw new Error(
          "Wallet connection was declined or the wallet could not switch to the configured Tempo network.",
        );
      }
    });
  const getQuote = () =>
    perform(async () => {
      // An expired, unpaid quote can be replaced; anything later cannot.
      if (phase !== "idle" && !(phase === "quoted" && seconds <= 0)) return;
      setQuote(undefined);
      setPhase("quoting");
      try {
        const q = await client.quote(makeBody(model, prompt));
        setQuote(q);
        setPhase("quoted");
      } catch (e) {
        setPhase("idle");
        throw e;
      }
    });
  const pay = () =>
    perform(async () => {
      if (!quote || (!wallet && !demoConnected) || phase !== "quoted") return;
      const record = checkpoint(quote, config);
      saveCheckpoint(sessionStorage, record);
      setSaved(record);
      setPhase("signing");
      let submitted = false;
      try {
        let authorization: string;
        if (demo) authorization = demo.demoCredential(quote);
        else {
          const { signQuote } = await import("./wallet");
          try {
            authorization = await signQuote(wallet!, quote, config);
          } catch (error) {
            // Show the wallet's own reason; the generic text alone hides it.
            const e = error as { shortMessage?: unknown; message?: unknown };
            const reason = String(e?.shortMessage ?? e?.message ?? "").slice(
              0,
              240,
            );
            throw new Error(
              "Signing was declined or unsupported, the wallet changed, or the quote expired. No paid request was sent. This router requires a direct secp256k1 Tempo wallet; see README." +
                (reason ? ` Wallet said: ${reason}` : ""),
            );
          }
        }
        const answer = await client.submit(quote, authorization, () => {
          const next = { ...record, attempted: true };
          saveCheckpoint(sessionStorage, next);
          setSaved(next);
          submitted = true;
          setPhase("running");
        });
        setResult(answer);
        setPhase("done");
      } catch (e) {
        setPhase(submitted ? "uncertain" : "quoted");
        throw e;
      }
    });
  const recover = () =>
    perform(async () => {
      if (saved) setRecovery(await client.recover(saved));
    });
  const reset = () => {
    if (lock.current || (saved?.attempted && !result && !recovery?.terminal))
      return;
    sessionStorage.removeItem(CHECKPOINT_KEY + (demo ? ".demo" : ""));
    setSaved(undefined);
    setQuote(undefined);
    setResult(undefined);
    setRecovery(undefined);
    setMessage(undefined);
    setPhase("idle");
  };
  function download(filename: string, value: unknown) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Playground
      config={config}
      demo={!!demo}
      models={models}
      model={model}
      prompt={prompt}
      wallet={demoConnected ? demo?.DEMO_WALLET : wallet?.address}
      walletNames={wallets}
      selectedWallet={selectedWallet}
      phase={phase}
      quote={quote}
      result={result}
      recovery={recovery}
      purchase={saved?.attempted ? saved.purchase : undefined}
      message={message}
      busy={busy}
      seconds={seconds}
      canReset={
        !busy && (phase === "quoted" || !!result || !!recovery?.terminal)
      }
      onModel={setModel}
      onPrompt={setPrompt}
      onSelectWallet={setSelectedWallet}
      onConnect={connect}
      onQuote={getQuote}
      onPay={pay}
      onRecover={recover}
      onReset={reset}
      onExport={() =>
        saved && download("private-purchase-recovery.json", saved)
      }
      onReload={() => perform(reload)}
      onDismiss={() => setMessage(undefined)}
      onDownload={() =>
        result && download("inference-response.json", result.raw)
      }
    />
  );
}
