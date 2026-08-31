import fs from "node:fs";
import { AgentProtocolClient } from "../src/sdk/client";
import { requiredConfigValue, requiredSecret } from "../src/lib/secrets";

function required(name: string) {
  return name === "AGENT_API_KEY" ? requiredSecret(name) : requiredConfigValue(name);
}

async function main() {
  const [taskId, evidencePath, selectionProof] = process.argv.slice(2);
  if (!taskId || !evidencePath || !selectionProof) {
    throw new Error("Usage: pnpm agent:tester <taskId> <evidence.json> <selectionProof>");
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  const protocol = new AgentProtocolClient({
    baseUrl: required("PROTOCOL_URL"),
    agentId: required("AGENT_ID"),
    apiKey: required("AGENT_API_KEY"),
  });
  await protocol.submitTest(taskId, evidence, selectionProof);
  console.log(JSON.stringify({ taskId, status: "TEST_EVIDENCE_SUBMITTED" }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
