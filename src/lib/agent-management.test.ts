import { describe, expect, it } from "vitest";
import type { Agent } from "./types";
import { agentRegistrationRequiresTransaction, assertWalletSessionAccount, ownedAgentCredentialView } from "./agent-management";

const agents: Agent[] = [
  {
    id: "agent-owned", name: "Owned", owner: "0xAAbb", role: "EXECUTOR", capabilities: ["typescript"],
    endpoint: "https://private-owned.example/jobs", apiKey: "plaintext", apiKeyHash: "hash", apiKeySalt: "salt",
    revokedAt: "2026-09-01T00:00:00.000Z", stake: 1_500, reputation: 90, completedTasks: 1, online: false,
  },
  {
    id: "agent-other", name: "Other", owner: "0xCCdd", role: "TESTER", capabilities: ["testing"],
    endpoint: "https://private-other.example/jobs", revokedAt: "2026-09-01T01:00:00.000Z",
    stake: 1_500, reputation: 91, completedTasks: 2, online: false,
  },
];

describe("Agent management ownership boundary", () => {
  it("serializes credential state only for the signed-in owner and strips operational fields", () => {
    expect(ownedAgentCredentialView(agents, null)).toEqual([]);
    const view = ownedAgentCredentialView(agents, "0xaaBB");
    expect(view).toEqual([{ id: "agent-owned", name: "Owned", owner: "0xAAbb", revokedAt: "2026-09-01T00:00:00.000Z" }]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("private-owned.example");
    expect(serialized).not.toContain("agent-other");
    expect(serialized).not.toContain("plaintext");
    expect(serialized).not.toContain("hash");
  });

  it("rejects a connected wallet that differs from the authenticated session before broadcast", () => {
    expect(() => assertWalletSessionAccount("0xAAbb", "0xaaBB")).not.toThrow();
    expect(() => assertWalletSessionAccount("0xCCdd", "0xAAbb")).toThrow("WALLET_SESSION_ACCOUNT_MISMATCH");
  });

  it("skips an exact active on-chain registration but broadcasts every material change", () => {
    const current = { positionId: 7n, capabilities: 11, active: true };
    expect(agentRegistrationRequiresTransaction(current, { positionId: 7n, capabilities: 11 })).toBe(false);
    expect(agentRegistrationRequiresTransaction({ ...current, active: false }, { positionId: 7n, capabilities: 11 })).toBe(true);
    expect(agentRegistrationRequiresTransaction(current, { positionId: 8n, capabilities: 11 })).toBe(true);
    expect(agentRegistrationRequiresTransaction(current, { positionId: 7n, capabilities: 15 })).toBe(true);
  });
});
