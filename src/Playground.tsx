import {
  displayAmount,
  NETWORKS,
  type Config,
  type Model,
  type Quote,
  type Recovery,
  type Result,
} from "./router";
export type Phase =
  | "idle"
  | "quoting"
  | "quoted"
  | "signing"
  | "running"
  | "done"
  | "uncertain";
export type PlaygroundProps = {
  config: Config;
  demo: boolean;
  models: Model[];
  model: string;
  prompt: string;
  wallet?: string;
  walletNames: { id: string; name: string }[];
  selectedWallet: string;
  phase: Phase;
  quote?: Quote;
  result?: Result;
  recovery?: Recovery;
  purchase?: string;
  message?: string;
  busy: boolean;
  seconds: number;
  canReset: boolean;
  onModel: (value: string) => void;
  onPrompt: (value: string) => void;
  onSelectWallet: (value: string) => void;
  onConnect: () => void;
  onQuote: () => void;
  onPay: () => void;
  onRecover: () => void;
  onReset: () => void;
  onExport: () => void;
  onReload: () => void;
  onDownload: () => void;
};
export function Playground(p: PlaygroundProps) {
  const network = NETWORKS[p.config.network];
  const locked = p.phase !== "idle",
    quoted = p.phase === "quoted";
  const steps = [
    {
      label: "Request a quote",
      note: "HTTP 402 · no charge",
      done: !!p.quote || !!p.purchase,
    },
    {
      label: "Approve in your wallet",
      note: "MPP · funded session",
      done: ["running", "done"].includes(p.phase),
    },
    {
      label: "Receive your answer",
      note: "Actual usage · remainder released",
      done: !!p.result,
    },
  ];
  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="xgate MPP playground">
          <span className="gate" aria-hidden="true">
            ↗
          </span>
          xgate<span className="slash">/</span>
          <span className="wordmark-sub">examples</span>
        </a>
        <a
          href="https://github.com/daydreamsai/402-router"
          target="_blank"
          rel="noreferrer"
        >
          Router source <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main>
        <div className="eyebrow">
          <span className="square" /> MACHINE PAYMENTS PROTOCOL{" "}
          <span className="edition">EXAMPLE 001</span>
        </div>
        <div className="hero">
          <h1>
            One prompt.
            <br />
            <span>One payment.</span>
          </h1>
          <p>
            Connect a wallet. Choose a model. <br />
            Buy inference through the router, <br />
            without a provider API key.
          </p>
        </div>
        <div className={"mode-bar " + (p.demo ? "demo" : "")}>
          <span>
            <span className="status-dot" />
            {p.demo
              ? "DEMO · simulated wallet, quote, and answer. No funds move."
              : `${network.label} · ${network.asset} · live router`}
          </span>
          <span className="mode-detail">
            {p.demo ? "Run npm run dev for live mode" : "MPP session v2"}
          </span>
        </div>
        {p.message && (
          <div className="notice" role="alert">
            {p.message}
          </div>
        )}
        <div className="workspace">
          <div className="request-column">
            <section
              className="panel composer"
              aria-labelledby="request-heading"
            >
              <div className="panel-heading">
                <h2 id="request-heading">
                  <span className="index">01</span>Your request
                </h2>
                <span className="micro">OPENAI RESPONSES</span>
              </div>
              <div className="form-fields">
                <label htmlFor="model">
                  Model <span>From the router’s qualified catalog</span>
                </label>
                <select
                  id="model"
                  value={p.model}
                  onChange={(e) => p.onModel(e.target.value)}
                  disabled={locked || p.models.length === 0}
                >
                  <option value="" disabled>
                    {p.models.length ? "Choose a model" : "No models loaded"}
                  </option>
                  {p.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
                {!p.models.length && (
                  <button
                    className="text-button"
                    onClick={p.onReload}
                    disabled={p.busy}
                  >
                    Reload catalog ↻
                  </button>
                )}
                <label htmlFor="prompt" className="prompt-label">
                  Prompt <span>{p.prompt.length.toLocaleString()} / 8,000</span>
                </label>
                <textarea
                  id="prompt"
                  maxLength={8000}
                  value={p.prompt}
                  onChange={(e) => p.onPrompt(e.target.value)}
                  disabled={locked}
                  placeholder="What would you like to ask?"
                />
                <div className="composer-foot">
                  <span>Up to 1,024 output tokens</span>
                  <span>Non-streaming</span>
                </div>
                <button
                  className="primary quote-button"
                  onClick={p.onQuote}
                  disabled={p.busy || locked || !p.model || !p.prompt.trim()}
                >
                  {p.phase === "quoting"
                    ? "Getting quote…"
                    : "Get payment quote"}
                  <span aria-hidden="true">↗</span>
                </button>
                <p className="caption">
                  Quoting is free. Review the ceiling before approving.
                </p>
              </div>
            </section>
            <section
              className="panel result-panel"
              aria-labelledby="result-heading"
              aria-busy={p.phase === "running"}
            >
              <div className="panel-heading">
                <h2 id="result-heading">
                  <span className="index">03</span>Response
                </h2>
                {p.result && (
                  <button className="text-button" onClick={p.onDownload}>
                    Save answer ↓
                  </button>
                )}
                <span className="micro">
                  {p.result
                    ? p.demo
                      ? "SIMULATED"
                      : "RECEIVED"
                    : "LIVE DELIVERY"}
                </span>
              </div>
              {p.result ? (
                <div className="answer">
                  <p>{p.result.text}</p>
                  <div className="answer-meta">
                    <span>
                      Charged{" "}
                      <strong>
                        {displayAmount(p.result.spent)} {network.asset}
                      </strong>
                    </span>
                    {!p.demo && (
                      <a
                        href={`${network.explorer}/tx/${p.result.transaction}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Settlement ↗
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="empty-result">
                  <span className="empty-symbol" aria-hidden="true">
                    [ ↗ ]
                  </span>
                  <h3>
                    {p.phase === "running"
                      ? "Inference is running"
                      : p.phase === "uncertain"
                        ? "Check your purchase status"
                        : "Your answer arrives here"}
                  </h3>
                  <p>
                    {p.phase === "running"
                      ? "The router is processing your request and finalizing payment. Keep this tab open."
                      : p.phase === "uncertain"
                        ? "The outcome is unresolved. A status check will not run inference or charge again."
                        : "Once you approve the quote, the router runs inference and returns the live response."}
                  </p>
                </div>
              )}
            </section>
          </div>
          <aside className="payment-column">
            <section
              className="panel payment-panel"
              aria-labelledby="payment-heading"
            >
              <div className="panel-heading">
                <h2 id="payment-heading">
                  <span className="index">02</span>Payment
                </h2>
                <span className="micro">{network.asset}</span>
              </div>
              <div className="payment-content">
                <div className="wallet-block">
                  <span className="field-label">WALLET</span>
                  {p.wallet ? (
                    <div className="connected">
                      <span className="status-dot" />
                      {p.wallet.slice(0, 8)}…{p.wallet.slice(-6)}
                      <span>Connected</span>
                    </div>
                  ) : (
                    <>
                      <p>
                        Connect a Tempo-compatible browser wallet to approve
                        your payment.
                      </p>
                      {p.walletNames.length > 1 && (
                        <select
                          aria-label="Browser wallet"
                          value={p.selectedWallet}
                          onChange={(e) => p.onSelectWallet(e.target.value)}
                          disabled={p.busy}
                        >
                          {p.walletNames.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        className="secondary full"
                        onClick={p.onConnect}
                        disabled={p.busy}
                      >
                        {p.demo ? "Connect demo wallet" : "Connect wallet"}
                        <span aria-hidden="true">＋</span>
                      </button>
                    </>
                  )}
                </div>
                <div className="amount-block">
                  <span className="field-label">MAXIMUM HOLD</span>
                  <div className="amount">
                    {p.quote ? displayAmount(p.quote.amount) : "—"}
                    <span>{network.asset}</span>
                  </div>
                  <p>
                    {p.quote
                      ? "Only actual usage is charged. Unused funds are released after settlement."
                      : `Per-request limit: ${p.config.maxAmount} ${network.asset}. Your quote sets the exact ceiling.`}
                  </p>
                </div>
                {p.quote && (
                  <dl className="quote-terms">
                    <div>
                      <dt>Network</dt>
                      <dd>{network.label}</dd>
                    </div>
                    <div>
                      <dt>Recipient</dt>
                      <dd className="address">{p.quote.recipient}</dd>
                    </div>
                    <div>
                      <dt>Quote expires</dt>
                      <dd>{p.seconds > 0 ? `in ${p.seconds}s` : "Expired"}</dd>
                    </div>
                  </dl>
                )}
                <button
                  className="primary full"
                  disabled={!quoted || !p.wallet || p.busy || p.seconds <= 0}
                  onClick={p.onPay}
                >
                  {p.phase === "signing"
                    ? "Check your wallet…"
                    : p.phase === "running"
                      ? "Running inference…"
                      : p.result
                        ? "Payment complete ✓"
                        : "Approve & run"}
                  <span aria-hidden="true">→</span>
                </button>
                {quoted && (
                  <p className="caption">
                    Approval signs a hold up to the displayed ceiling. This
                    action can spend funds.
                  </p>
                )}
                <ol className="steps">
                  {steps.map((step, i) => (
                    <li
                      key={step.label}
                      className={step.done ? "complete" : ""}
                    >
                      <span className="step-number">
                        {step.done ? "✓" : `0${i + 1}`}
                      </span>
                      <div>
                        <strong>{step.label}</strong>
                        <small>{step.note}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
            <section className="privacy-note">
              <span className="field-label">ANONYMOUS · LIVE ONLY</span>
              <p>
                The router shields your wallet identity from the model provider.
                The provider sees your prompt under its own policies. Payment
                metadata is retained.
              </p>
              <p>
                Answers are not stored by the router. A completed request can be
                charged even if delivery is lost. Save answers you want to keep.
              </p>
            </section>
          </aside>
        </div>
        {p.purchase && (
          <section className="recovery panel">
            <div>
              <h2>Purchase status</h2>
              <p className="purchase-id">{p.purchase}</p>
              {p.recovery ? (
                <dl className="recovery-data">
                  <div>
                    <dt>Inference</dt>
                    <dd>{p.recovery.inference}</dd>
                  </div>
                  <div>
                    <dt>Payment</dt>
                    <dd>{p.recovery.payment}</dd>
                  </div>
                  <div>
                    <dt>Delivery</dt>
                    <dd>{p.recovery.delivery}</dd>
                  </div>
                  {p.recovery.charged !== undefined && (
                    <div>
                      <dt>Charged</dt>
                      <dd>
                        {displayAmount(p.recovery.charged)} {network.asset}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="caption">
                  Financial metadata only. A lost answer cannot be retrieved.
                </p>
              )}
            </div>
            <div className="recovery-actions">
              <button
                className="secondary"
                onClick={p.onRecover}
                disabled={p.busy}
              >
                Check status ↻
              </button>
              <button className="text-button" onClick={p.onExport}>
                Save recovery record ↓
              </button>
            </div>
          </section>
        )}
        {p.canReset && (
          <div className="new-request">
            <button className="secondary" onClick={p.onReset}>
              New request →
            </button>
            <span>
              Clears this answer and the saved purchase from this tab.
            </span>
          </div>
        )}
        <details className="under-hood">
          <summary>
            How the example works <span>VIEW THE FLOW ＋</span>
          </summary>
          <div className="flow-grid">
            <div>
              <strong>01 / Quote</strong>
              <p>
                The unchanged request receives HTTP 402 and a Tempo session
                challenge.
              </p>
            </div>
            <div>
              <strong>02 / Authorize</strong>
              <p>
                mppx signs a sponsored session opening and ceiling voucher in
                your browser wallet.
              </p>
            </div>
            <div>
              <strong>03 / Execute</strong>
              <p>
                One paid POST sends the original body, credential, quote
                binding, and private status token.
              </p>
            </div>
          </div>
        </details>
      </main>
      <footer>
        <span>xgate / MPP router example</span>
        <span className="origin">
          {p.demo ? "Fixture mode · no network requests" : p.config.origin}
        </span>
        <a href="https://mpp.dev" target="_blank" rel="noreferrer">
          About MPP ↗
        </a>
      </footer>
    </div>
  );
}
