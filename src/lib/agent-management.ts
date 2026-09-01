import type { Agent } from "./types";

export interface ManagedAgentCredentialView {
  id: string;
  name: string;
  owner: string;
  revokedAt?: string | null;
}

export function ownedAgentCredentialView(
  agents: readonly Agent[],
  sessionOwner: string | null | undefined,
): ManagedAgentCredentialView[] {
  if (!sessionOwner) return [];
  const owner = sessionOwner.toLowerCase();
  return agents
    .filter((agent) => agent.owner.toLowerCase() === owner)
    .map(({ id, name, owner: agentOwner, revokedAt }) => ({ id, name, owner: agentOwner, revokedAt }));
}

export function assertWalletSessionAccount(account: string, sessionOwner?: string) {
  if (sessionOwner && account.toLowerCase() !== sessionOwner.toLowerCase()) {
    throw new Error("WALLET_SESSION_ACCOUNT_MISMATCH");
  }
}

export function agentRegistrationRequiresTransaction(
  current: { positionId: bigint; capabilities: number; active: boolean },
  desired: { positionId: bigint; capabilities: number },
) {
  return current.positionId !== desired.positionId
    || current.capabilities !== desired.capabilities
    || !current.active;
}
