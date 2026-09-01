"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { ActionNotice, type ActionResult } from "./action-notice";

export function CodeExample({ code, copyLabel, copiedLabel, copyFailedLabel }: { code: string; copyLabel: string; copiedLabel: string; copyFailedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const inFlight = useRef(false);

  async function copy() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setResult(null);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setResult({ tone: "success", message: copiedLabel });
      window.setTimeout(() => { setCopied(false); setResult(null); }, 1_500);
    } catch {
      setResult({ tone: "error", message: copyFailedLabel });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="code-example">
      <button className="code-copy" type="button" onClick={() => void copy()} disabled={busy} aria-busy={busy} aria-label={copied ? copiedLabel : copyLabel}>
        {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? copiedLabel : copyLabel}
      </button>
      <pre className="code-block"><code>{code}</code></pre>
      {result && <ActionNotice tone={result.tone} style={{ marginTop: 10 }}>{result.message}</ActionNotice>}
    </div>
  );
}
