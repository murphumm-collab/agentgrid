"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Clock3, Droplets, ExternalLink, Fuel, ShieldCheck } from "lucide-react";
import { formatEther } from "viem";
import { requestTestnetTokens } from "@/lib/chain-actions";
import type { Locale } from "@/lib/i18n";
import { ActionNotice, type ActionResult } from "./action-notice";

function cooldownMessage(locale: Locale, message: string) {
  const prefix = "FAUCET_COOLDOWN_ACTIVE:";
  if (!message.startsWith(prefix)) return message;
  const availableAt = Number(message.slice(prefix.length)) * 1000;
  const time = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(availableAt);
  return locale === "zh" ? `当前钱包仍在冷却中，可再次领取时间：${time}` : `This wallet is cooling down. Next claim: ${time}`;
}

export function TestnetFaucet({ locale, production, demoOwner }: { locale: Locale; production: boolean; demoOwner: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [transactionHash, setTransactionHash] = useState<string>();
  const [balance, setBalance] = useState<string>();
  const [nextClaimAt, setNextClaimAt] = useState<number>();
  const inFlight = useRef(false);

  async function claim() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setResult(null);
    setTransactionHash(undefined);
    try {
      if (production) {
        const claimed = await requestTestnetTokens();
        setTransactionHash(claimed.hash);
        setBalance(`${Number(formatEther(claimed.balanceAfter)).toLocaleString(undefined, { maximumFractionDigits: 2 })} tAGT`);
        setNextClaimAt(Number(claimed.nextClaimAt) * 1000);
      } else {
        const response = await fetch("/api/faucet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: demoOwner, amount: 10_000 }),
        });
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "FAUCET_REQUEST_FAILED");
      }
      setResult({ tone: "success", message: production
        ? (locale === "zh" ? "已领取 10,000 tAGT。" : "10,000 tAGT claimed.")
        : (locale === "zh" ? "已增加 10,000 本地演示额度。" : "10,000 local demo credits added.") });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.split("\n")[0] : "FAUCET_REQUEST_FAILED";
      setResult({ tone: "error", message: cooldownMessage(locale, message) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="faucet-layout">
      <section className="card card-pad faucet-claim-card">
        <div className="section-head"><div><div className="eyebrow">{production ? "BSC TESTNET · CHAIN ID 97" : "LOCAL DEMO · OFF-CHAIN"}</div><h2 className="section-title">{production ? (locale === "zh" ? "领取测试 tAGT" : "Claim test tAGT") : (locale === "zh" ? "领取本地演示额度" : "Claim local demo credits")}</h2></div><span className="stat-icon"><Droplets size={18} /></span></div>
        <div className="faucet-amount"><strong>10,000</strong><span>{production ? "tAGT" : (locale === "zh" ? "演示额度" : "credits")}</span></div>
        <p className="lead">{production
          ? (locale === "zh" ? "每个钱包每24小时可直接从测试合约领取一次。Token 只用于 AgentGrid 测试任务、质押和仲裁，没有货币价值。" : "Each wallet may claim once every 24 hours directly from the test contract. The token is only for AgentGrid test tasks, staking and arbitration and has no monetary value.")
          : (locale === "zh" ? "本地演示额度只存在于开发账本，每个演示地址累计最多50,000；它不是链上tAGT，也不能转账或兑换。" : "Local demo credits exist only in the development ledger and are capped at 50,000 per demo identity. They are not on-chain tAGT and cannot be transferred or exchanged.")}</p>
        <button type="button" className="button button-primary faucet-button" disabled={busy} aria-busy={busy} onClick={() => void claim()}>
          <Droplets size={16} />{busy
            ? (production ? (locale === "zh" ? "等待链上确认…" : "Waiting for confirmation…") : (locale === "zh" ? "正在写入演示账本…" : "Updating demo ledger…"))
            : (production ? (locale === "zh" ? "连接钱包并领取" : "Connect wallet and claim") : (locale === "zh" ? "领取演示额度" : "Claim demo credits"))}
        </button>
        {balance && <div className="faucet-balance"><CheckCircle2 size={15} />{locale === "zh" ? "领取后余额" : "Balance after claim"}: <strong>{balance}</strong></div>}
        {nextClaimAt && <div className="faucet-balance"><Clock3 size={15} />{locale === "zh" ? "下次可领取" : "Next claim"}: <strong>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(nextClaimAt)}</strong></div>}
        {result && <ActionNotice tone={result.tone} style={{ marginTop: 14 }}>{result.message}</ActionNotice>}
        {transactionHash && <a className="faucet-explorer-link" href={`https://testnet.bscscan.com/tx/${transactionHash}`} target="_blank" rel="noreferrer">{locale === "zh" ? "在 BscScan 查看交易" : "View transaction on BscScan"}<ExternalLink size={13} /></a>}
      </section>
      <aside className="card card-pad faucet-rules-card">
        <div className="eyebrow">{locale === "zh" ? "领取规则" : "Claim rules"}</div>
        <div className="faucet-rule"><Clock3 size={17} /><div><strong>{production ? (locale === "zh" ? "24小时冷却" : "24-hour cooldown") : (locale === "zh" ? "累计额度上限" : "Cumulative demo limit")}</strong><p>{production ? (locale === "zh" ? "冷却由链上合约执行，刷新页面或切换浏览器无法绕过。" : "The contract enforces cooldown; refreshing or changing browsers cannot bypass it.") : (locale === "zh" ? "演示身份累计最多领取50,000额度，不模拟链上冷却。" : "A demo identity may receive at most 50,000 credits; this does not simulate on-chain cooldown.")}</p></div></div>
        <div className="faucet-rule"><ShieldCheck size={17} /><div><strong>{production ? (locale === "zh" ? "只发给调用者" : "Caller only") : (locale === "zh" ? "仅本地账本" : "Local ledger only")}</strong><p>{production ? (locale === "zh" ? "页面不接受代领地址，也不会要求或保存钱包私钥。" : "The page accepts no recipient override and never requests or stores a wallet private key.") : (locale === "zh" ? "演示领取不会调用钱包或发送区块链交易。" : "Demo claims do not access a wallet or send a blockchain transaction.")}</p></div></div>
        <div className="faucet-rule"><Fuel size={17} /><div><strong>{production ? (locale === "zh" ? "需要少量 tBNB" : "A small tBNB balance is required") : (locale === "zh" ? "无需Gas" : "No gas required")}</strong><p>{production ? (locale === "zh" ? "tBNB 用于支付交易Gas，需要从独立的BSC Testnet BNB水龙头获取。" : "tBNB pays transaction gas and must come from an independent BSC Testnet BNB faucet.") : (locale === "zh" ? "切换到测试网部署后，链上领取才需要tBNB。" : "After switching to a testnet deployment, on-chain claims require tBNB.")}</p></div></div>
      </aside>
    </div>
  );
}
