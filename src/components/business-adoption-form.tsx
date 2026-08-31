"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Loader2, ShieldCheck } from "lucide-react";
import { createWalletClient, custom, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import { businessAdoptionMessage, type BusinessAdoptionReport } from "@/lib/business-adoption";
import { browserWalletProvider } from "@/lib/browser-wallet";
import type { Locale } from "@/lib/i18n";

type ReleaseChallenge = {
  chainId: number;
  release: { id: string; taskId: string; publisher: string; artifactHash: string; createdAt: string };
  adoption?: unknown;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function responseBody(response: Response) {
  return response.json() as Promise<{ error?: string } & ReleaseChallenge>;
}

export function BusinessAdoptionForm({ taskId, publisher, locale }: { taskId: string; publisher: string; locale: Locale }) {
  const router = useRouter();
  const [workflowType, setWorkflowType] = useState<BusinessAdoptionReport["workflowType"]>("PRODUCTION_DEPLOYED");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function submit() {
    setBusy(true);
    setMessage(undefined);
    try {
      const challengeResponse = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/business-adoption`, { cache: "no-store", credentials: "same-origin" });
      const challenge = await responseBody(challengeResponse);
      if (!challengeResponse.ok) throw new Error(challenge.error ?? "BUSINESS_ADOPTION_CHALLENGE_FAILED");
      if (challenge.adoption) { router.refresh(); return; }
      if (!challenge.release) throw new Error("ARTIFACT_RELEASE_REQUIRED");

      const provider = browserWalletProvider();
      const wallet = createWalletClient({ chain: bscTestnet, transport: custom(provider) });
      const [account] = await wallet.requestAddresses();
      if (!account) throw new Error("WALLET_NOT_CONNECTED");
      if (account.toLowerCase() !== publisher.toLowerCase()) throw new Error("PUBLISHER_IDENTITY_MISMATCH");
      if (await wallet.getChainId() !== bscTestnet.id) {
        try { await wallet.switchChain({ id: bscTestnet.id }); }
        catch {
          await wallet.addChain({ chain: bscTestnet });
          await wallet.switchChain({ id: bscTestnet.id });
        }
      }

      const report: BusinessAdoptionReport = {
        version: 1,
        chainId: challenge.chainId,
        taskId,
        publisher: account as Address,
        releaseId: challenge.release.id,
        artifactHash: challenge.release.artifactHash,
        releasedAt: new Date(challenge.release.createdAt).toISOString(),
        workflowType,
        workflowEvidenceHash: await sha256(evidenceReference.trim()),
        adoptedAt: new Date().toISOString(),
      };
      const commitment = businessAdoptionMessage(report);
      const signature = await wallet.signMessage({ account, message: commitment.message });
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/business-adoption`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ report, signature }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(body.error ?? "BUSINESS_ADOPTION_FAILED");
      setMessage(locale === "zh" ? "业务采用证明已记录，且不能覆盖。" : "Business adoption attestation recorded immutably.");
      router.refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "BUSINESS_ADOPTION_FAILED";
      setMessage(code === "ARTIFACT_RELEASE_REQUIRED"
        ? (locale === "zh" ? "请先下载并核验已验收交付物，再确认业务采用。" : "Download and verify the accepted delivery before attesting adoption.")
        : code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="notice"><BriefcaseBusiness size={15} style={{ verticalAlign: "middle", marginRight: 8 }} />
        {locale === "zh" ? "确认成果已经进入真实业务。协议只保存业务证据的 SHA-256，不保存工单、部署地址或客户信息原文。" : "Confirm that the result entered a real workflow. Only the SHA-256 of your deployment, ticket, or customer evidence is stored."}
      </div>
      <label className="field">
        <span>{locale === "zh" ? "采用场景" : "Adoption workflow"}</span>
        <select className="select" value={workflowType} onChange={(event) => setWorkflowType(event.target.value as BusinessAdoptionReport["workflowType"])}>
          <option value="PRODUCTION_DEPLOYED">{locale === "zh" ? "已部署到生产" : "Deployed to production"}</option>
          <option value="INTERNAL_WORKFLOW">{locale === "zh" ? "已进入内部流程" : "Active in an internal workflow"}</option>
          <option value="CUSTOMER_DELIVERED">{locale === "zh" ? "已交付客户" : "Delivered to a customer"}</option>
          <option value="RESEARCH_DECISION">{locale === "zh" ? "已用于研究或决策" : "Used for research or a decision"}</option>
        </select>
      </label>
      <label className="field">
        <span>{locale === "zh" ? "业务证据引用" : "Business evidence reference"}</span>
        <input className="input" value={evidenceReference} maxLength={500} onChange={(event) => setEvidenceReference(event.target.value)} placeholder={locale === "zh" ? "部署 URL、工单号、PR、客户交付 ID 或审计日志 ID" : "Deployment URL, ticket, PR, customer delivery ID, or audit-log ID"} />
      </label>
      <button className="button button-primary" disabled={busy || evidenceReference.trim().length < 3} onClick={() => void submit()}>
        {busy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
        {locale === "zh" ? "钱包签名确认业务采用" : "Sign business adoption"}
      </button>
      {message && <div className={`notice ${message.includes("已记录") || message.includes("recorded") ? "success" : "error"}`}>{message}</div>}
    </div>
  );
}
