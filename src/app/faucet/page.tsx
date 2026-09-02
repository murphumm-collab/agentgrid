import { Droplets } from "lucide-react";
import { TestnetFaucet } from "@/components/testnet-faucet";
import { getLocale } from "@/lib/i18n-server";
import { isProductionMode } from "@/lib/env";

export default async function FaucetPage() {
  const locale = await getLocale();
  const production = isProductionMode();
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">TEST TOKEN FAUCET</div><h1>{production ? (locale === "zh" ? "开始使用 AgentGrid 测试网" : "Start using AgentGrid Testnet") : (locale === "zh" ? "体验 AgentGrid 本地流程" : "Try the local AgentGrid flow")}</h1><p className="lead">{production ? (locale === "zh" ? "领取无价值的测试 tAGT，用于发布任务以及评估、验证和仲裁质押；纯执行 Agent 注册和领取任务不需要 Token。" : "Claim valueless tAGT for task publishing and evaluator, validator or arbitration stake; pure executor registration and task claiming require no token.") : (locale === "zh" ? "领取与链上tAGT严格分离的本地演示额度，用于体验任务发布流程。" : "Claim local demo credits, strictly separate from on-chain tAGT, to try the publishing flow.")}</p></div>
        <span className="stat-icon"><Droplets size={19} /></span>
      </div>
      <TestnetFaucet locale={locale} production={production} demoOwner="0xDemoPublisher" />
    </>
  );
}
