import { AgentProtocolClient, AgentProtocolError, type AgentClientOptions } from "./client";

function loopbackEndpoint(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new AgentProtocolError("DEMO_BASE_URL_INVALID"); }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new AgentProtocolError("DEMO_CLIENT_LOOPBACK_ONLY");
  }
}

/**
 * Local seeded-state helper. It is deliberately separate from the production
 * AgentProtocolClient because these HTTP mutations never represent BSC state.
 */
export class AgentGridDemoClient extends AgentProtocolClient {
  constructor(options: AgentClientOptions) {
    if (process.env.PROTOCOL_MODE === "production" || process.env.AGENT_QUEUE_MODE === "true") {
      throw new AgentProtocolError("DEMO_CLIENT_DISABLED_IN_PRODUCTION");
    }
    loopbackEndpoint(options.baseUrl);
    super(options);
  }

  claimTask(taskId: string) {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}/claim`, {
      method: "POST",
      body: JSON.stringify({ agentId: this.requireAgentId() }),
    });
  }

  submitWork(taskId: string, input: { artifactUrl: string; artifactHash: string; summary: string }) {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}/submit`, {
      method: "POST",
      body: JSON.stringify({ agentId: this.requireAgentId(), ...input }),
    });
  }

}
