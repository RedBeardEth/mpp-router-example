import { useEffect, useState } from "react";
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
  onDismiss?: () => void;
};
const short = (value: string, head = 6, tail = 4) =>
  value.length > head + tail + 1
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value;
const TERMINAL_OK = ["verified", "zero_charge"];
export function Playground(p: PlaygroundProps) {
  const network = NETWORKS[p.config.network];
  const locked = p.phase !== "idle",
    quoted = p.phase === "quoted",
    approvable = quoted || p.phase === "signing",
    expired = quoted && p.seconds <= 0;
  const lifetime = p.quote
    ? Math.max(1, Math.round((p.quote.expires - p.quote.issued) / 1000))
    : 1;
  const remaining = Math.min(1, p.seconds / lifetime);
  const steps = [
    {
      label: "Request a quote",
      note: "HTTP 402 · no charge",
      done: !!p.quote || !!p.purchase,
    },
    {
      label: "Approve in your wallet",
      note: "MPP · funded session",
      done: ["running", "done", "uncertain"].includes(p.phase),
    },
    {
      label: "Receive your answer",
      note: "Actual usage · remainder released",
      done: !!p.result,
    },
  ];
  const current = steps.findIndex((step) => !step.done);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (text: string) =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => {});
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
          className="topbar-link"
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
        <div className={"mode-bar " + (p.demo ? "demo" : "live")}>
          <span>
            <span className="status-dot" />
            {p.demo
              ? "DEMO · simulated wallet, quote, and answer. No funds move."
              : `${network.label} · ${network.asset} · live router`}
          </span>
          <span className="mode-detail">
            {p.demo ? (
              <>
                Run <code>npm run dev</code> for live mode
              </>
            ) : (
              "MPP session v2"
            )}
          </span>
        </div>
        {p.message && (
          <div className="notice" role="alert">
            <span className="notice-icon" aria-hidden="true">
              !
            </span>
            <p>{p.message}</p>
            {p.onDismiss && (
              <button
                className="notice-close"
                onClick={p.onDismiss}
                aria-label="Dismiss message"
              >
                ×
              </button>
            )}
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
                <div className="select-wrap">
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
                </div>
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
                  <span className="chip">≤ 1,024 output tokens</span>
                  <span className="chip">Non-streaming</span>
                  <span className="chip">store: false</span>
                </div>
                <button
                  className="primary quote-button"
                  onClick={p.onQuote}
                  disabled={
                    p.busy ||
                    (locked && !expired) ||
                    !p.model ||
                    !p.prompt.trim()
                  }
                >
                  {p.phase === "quoting"
                    ? "Getting quote…"
                    : expired
                      ? "Get a new quote"
                      : "Get payment quote"}
                  <span aria-hidden="true">
                    {p.phase === "quoting" ? <span className="spinner" /> : "↗"}
                  </span>
                </button>
                <p className="caption">
                  {expired
                    ? "That quote expired without payment. Request a fresh one."
                    : "Quoting is free. Review the ceiling before approving."}
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
                <div className="heading-actions">
                  {p.result && (
                    <>
                      <button
                        className="text-button"
                        onClick={() => p.result && copy(p.result.text)}
                      >
                        {copied ? "Copied ✓" : "Copy"}
                      </button>
                      <button className="text-button" onClick={p.onDownload}>
                        Save answer ↓
                      </button>
                    </>
                  )}
                  <span className="micro">
                    {p.result
                      ? p.demo
                        ? "SIMULATED"
                        : "RECEIVED"
                      : "LIVE DELIVERY"}
                  </span>
                </div>
              </div>
              {p.result ? (
                <div className="answer">
                  <p className="answer-text">{p.result.text}</p>
                  <div className="answer-meta">
                    <span className="charge">
                      Charged{" "}
                      <strong>
                        {displayAmount(p.result.spent)} {network.asset}
                      </strong>
                      {p.quote && (
                        <span className="muted">
                          {" "}
                          of {displayAmount(p.quote.amount)} held · rest
                          released
                        </span>
                      )}
                    </span>
                    {p.result.usage && (
                      <span className="muted">
                        {p.result.usage.input.toLocaleString()} in ·{" "}
                        {p.result.usage.output.toLocaleString()} out tokens
                      </span>
                    )}
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
              ) : p.phase === "running" ? (
                <div className="running-result">
                  <div className="progress" aria-hidden="true" />
                  <div className="skeleton" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <h3>Inference is running</h3>
                  <p>
                    The router is processing your request and finalizing
                    payment. Keep this tab open.
                  </p>
                </div>
              ) : (
                <div
                  className={
                    "empty-result" + (p.phase === "uncertain" ? " warn" : "")
                  }
                >
                  <span className="empty-symbol" aria-hidden="true">
                    {p.phase === "uncertain" ? "[ ? ]" : "[ ↗ ]"}
                  </span>
                  <h3>
                    {p.phase === "uncertain"
                      ? "Check your purchase status"
                      : "Your answer arrives here"}
                  </h3>
                  <p>
                    {p.phase === "uncertain"
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
                    <div className="connected" title={p.wallet}>
                      <span className="status-dot" />
                      <span className="mono">{short(p.wallet)}</span>
                      <span className="badge ok">Connected</span>
                    </div>
                  ) : (
                    <>
                      <p>
                        Connect a Tempo-compatible browser wallet to approve
                        your payment.
                      </p>
                      {p.walletNames.length > 1 && (
                        <div className="select-wrap">
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
                        </div>
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
                  <div className={"amount" + (p.quote ? "" : " pending")}>
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
                      <dd className="mono" title={p.quote.recipient}>
                        {short(p.quote.recipient, 8, 6)}
                      </dd>
                    </div>
                    {approvable && (
                      <div className="expiry">
                        <dt>Quote expires</dt>
                        <dd className={p.seconds <= 10 ? "urgent" : ""}>
                          {p.seconds > 0 ? `in ${p.seconds}s` : "Expired"}
                        </dd>
                        <span
                          className="meter"
                          aria-hidden="true"
                          style={{ transform: `scaleX(${remaining})` }}
                        />
                      </div>
                    )}
                  </dl>
                )}
                <button
                  className={"primary full" + (p.result ? " complete" : "")}
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
                  {!p.result && (
                    <span aria-hidden="true">
                      {p.phase === "signing" || p.phase === "running" ? (
                        <span className="spinner" />
                      ) : (
                        "→"
                      )}
                    </span>
                  )}
                </button>
                {quoted && !expired && (
                  <p className="caption">
                    {p.wallet
                      ? "Approval signs a hold up to the displayed ceiling. This action can spend funds."
                      : "Connect a wallet above to approve this quote."}
                  </p>
                )}
                <ol className="steps">
                  {steps.map((step, i) => (
                    <li
                      key={step.label}
                      className={
                        step.done
                          ? "complete"
                          : i === current && p.phase !== "idle"
                            ? p.phase === "uncertain"
                              ? "active warn"
                              : "active"
                            : ""
                      }
                      aria-current={i === current ? "step" : undefined}
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
              <p className="purchase-id mono">{p.purchase}</p>
              {p.recovery ? (
                <dl className="recovery-data">
                  <div>
                    <dt>Inference</dt>
                    <dd>{p.recovery.inference}</dd>
                  </div>
                  <div>
                    <dt>Payment</dt>
                    <dd
                      className={
                        "badge " +
                        (TERMINAL_OK.includes(p.recovery.payment)
                          ? "ok"
                          : p.recovery.terminal
                            ? "bad"
                            : "pending")
                      }
                    >
                      {p.recovery.payment}
                    </dd>
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
            How the example works <span>VIEW THE FLOW</span>
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
