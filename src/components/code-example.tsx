"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CodeExample({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div className="code-example">
      <button className="code-copy" type="button" onClick={copy} aria-label={copied ? copiedLabel : copyLabel}>
        {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? copiedLabel : copyLabel}
      </button>
      <pre className="code-block"><code>{code}</code></pre>
    </div>
  );
}
