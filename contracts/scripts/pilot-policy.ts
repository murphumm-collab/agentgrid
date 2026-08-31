import { isIP } from "node:net";
import type { Address } from "viem";

export const bscTestnetGenesisHash = "0x6d3c66c5357ec91d5c43af47e234a939b22557cbb552dc45bebbceeed90fbe34";
export const pilotRoleNames = ["publisher", "evaluator1", "evaluator2", "evaluator3", "executor", "tester", "coordinator"] as const;
export type PilotRoleName = typeof pilotRoleNames[number];

function privateIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

export function isPrivateNetworkAddress(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  return isIP(normalized) === 6 && (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:"));
}

export function validatePilotRpcUrl(raw: string) {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("PILOT_RPC_PUBLIC_HTTPS_REQUIRED");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("PILOT_RPC_LOCALHOST_FORBIDDEN");
  if (isPrivateNetworkAddress(hostname)) throw new Error("PILOT_RPC_PRIVATE_ADDRESS_FORBIDDEN");
  return url.toString();
}

export function validatePilotRoleSeparation(
  roles: Record<PilotRoleName, Address>,
  protocolAuthorities: readonly Address[],
) {
  const roleEntries = Object.entries(roles) as Array<[PilotRoleName, Address]>;
  const normalized = roleEntries.map(([, address]) => address.toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error("PILOT_ROLE_WALLETS_MUST_BE_DISTINCT");
  const authorities = new Set(protocolAuthorities.map((address) => address.toLowerCase()));
  for (const [name, address] of roleEntries) {
    if (name !== "coordinator" && authorities.has(address.toLowerCase())) throw new Error(`PILOT_${name.toUpperCase()}_CONFLICTS_WITH_PROTOCOL_AUTHORITY`);
  }
  return true;
}

export function validateBscTestnetIdentity(input: { chainId: number; genesisHash: string | null; latestTimestamp: bigint; nowSeconds?: number }) {
  if (input.chainId !== 97) throw new Error("PILOT_CHAIN_ID_MISMATCH");
  if (input.genesisHash?.toLowerCase() !== bscTestnetGenesisHash) throw new Error("PILOT_GENESIS_HASH_MISMATCH");
  const age = (input.nowSeconds ?? Math.floor(Date.now() / 1_000)) - Number(input.latestTimestamp);
  if (age < -60 || age > 300) throw new Error("PILOT_CHAIN_HEAD_STALE");
  return age;
}
