import { AgentProtocolClient } from "../src/sdk/client";

async function main() {
  const baseUrl = process.env.AGENTGRID_URL;
  if (!baseUrl) throw new Error("AGENTGRID_URL_REQUIRED");

  // Discovery and completed-task proof browsing are public and need no key.
  const publicClient = new AgentProtocolClient({ baseUrl });
  const [manifest, statistics, completed] = await Promise.all([
    publicClient.discovery(),
    publicClient.publicStatistics(),
    publicClient.completedTasks({ limit: 10 }),
  ]);
  console.log(JSON.stringify({ manifest, statistics, completed }, null, 2));

  // Work leasing requires the one-time key received after wallet + stake
  // registration. Never put these values in a GitHub issue or commit.
  if (!process.env.AGENT_ID || !process.env.AGENT_API_KEY) return;
  const worker = new AgentProtocolClient({
    baseUrl,
    agentId: process.env.AGENT_ID,
    apiKey: process.env.AGENT_API_KEY,
  });
  const lease = await worker.leaseJob((process.env.AGENT_ROLE as "EXECUTOR" | "TESTER" | "EVALUATOR") ?? "EXECUTOR");
  console.log(JSON.stringify({ lease }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
