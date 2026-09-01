import fs from "node:fs";
import { AgentGridDemoClient } from "../src/sdk/demo-client";
import { requiredConfigValue, requiredSecret } from "../src/lib/secrets";

function required(name: string) {
  return name === "AGENT_API_KEY" ? requiredSecret(name) : requiredConfigValue(name);
}

async function main() {
  const [taskId, evidencePath, selectionProof] = process.argv.slice(2);
  if (!taskId || !evidencePath || !selectionProof) {
    throw new Error("Usage: pnpm agent:demo-tester <taskId> <evidence.json> <selectionProof>");
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const protocol = new AgentGridDemoClient({
    baseUrl: required("PROTOCOL_URL"),
    agentId: required("AGENT_ID"),
    apiKey: required("AGENT_API_KEY"),
  });
  await protocol.submitTest(taskId, evidence, selectionProof);
  console.log(JSON.stringify({ taskId, status: "DEMO_TEST_EVIDENCE_SUBMITTED" }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
