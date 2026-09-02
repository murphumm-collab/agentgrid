import { createPublicClient, formatEther, getAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { compileContracts } from "./compiler";
import { configuredSecret } from "../../src/lib/secrets";
import { publicBscRpcTransport } from "./pilot-policy";

async function main() {
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-dataseed.bnbchain.org";
  const client = createPublicClient({ chain: bscTestnet, transport: publicBscRpcTransport(rpcUrl) });
  const chainId = await client.getChainId();
  if (chainId !== bscTestnet.id) throw new Error(`WRONG_CHAIN_${chainId}`);
  const artifacts = compileContracts();
  const required = ["TestToken", "StakeCreditManager", "AgentRegistry", "RewardVault", "TaskRegistry", "CompetitionSlotPassRegistry", "VerificationPanel", "VerificationArbitrationCourt", "DisputeResolver", "ProtocolEconomics"];
  for (const name of required) if (!artifacts[name]?.bytecode || artifacts[name].bytecode === "0x") throw new Error(`MISSING_BYTECODE_${name}`);
  const blockers: string[] = [];
  const rawArbitrators = (process.env.ARBITRATOR_ADDRESSES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  let arbitrators: string[] = [];
  try { arbitrators = rawArbitrators.map((value) => getAddress(value)); } catch { blockers.push("ARBITRATOR_ADDRESS_INVALID"); }
  if (arbitrators.length < 3) blockers.push("THREE_ARBITRATORS_REQUIRED");
  if (new Set(arbitrators.map((value) => value.toLowerCase())).size !== arbitrators.length) blockers.push("ARBITRATORS_MUST_BE_DISTINCT");
  const quorum = Number(process.env.ARBITRATOR_QUORUM ?? 2);
  if (!Number.isInteger(quorum) || quorum < 2 || quorum > arbitrators.length) blockers.push("ARBITRATOR_QUORUM_INVALID");
  const deployerSecret = configuredSecret("DEPLOYER_PRIVATE_KEY");
  const key = deployerSecret.value;
  if (!key || key.includes("REPLACE")) blockers.push("DEPLOYER_PRIVATE_KEY_MISSING");
  else if (process.env.REQUIRE_FILE_SECRETS === "true" && deployerSecret.source !== "file") blockers.push("DEPLOYER_PRIVATE_KEY_FILE_REQUIRED");
  let protocolOwner: string | undefined;
  try { protocolOwner = getAddress(process.env.PROTOCOL_OWNER_ADDRESS ?? ""); } catch { blockers.push("PROTOCOL_OWNER_ADDRESS_REQUIRED"); }
  let coordinator: string | undefined;
  try { coordinator = getAddress(process.env.PROTOCOL_COORDINATOR_ADDRESS ?? ""); } catch { blockers.push("PROTOCOL_COORDINATOR_ADDRESS_REQUIRED"); }
  if (protocolOwner && coordinator && protocolOwner.toLowerCase() === coordinator.toLowerCase()) blockers.push("OWNER_AND_COORDINATOR_MUST_DIFFER");
  try {
    if (getAddress(process.env.COMPETITION_SLOT_PASS_ISSUER_ADDRESS ?? "") === "0x0000000000000000000000000000000000000000") throw new Error();
  } catch { blockers.push("COMPETITION_SLOT_PASS_ISSUER_ADDRESS_REQUIRED"); }
  if (protocolOwner && coordinator && arbitrators.some((address) => [protocolOwner!, coordinator!].some((role) => role.toLowerCase() === address.toLowerCase()))) {
    blockers.push("ARBITRATORS_MUST_DIFFER_FROM_OWNER_AND_COORDINATOR");
  }
  if (process.env.PROTOCOL_RESERVE_ADDRESS) {
    try { getAddress(process.env.PROTOCOL_RESERVE_ADDRESS); } catch { blockers.push("PROTOCOL_RESERVE_ADDRESS_INVALID"); }
  }
  for (const name of ["PROTOCOL_DAO_TREASURY_ADDRESS", "PROTOCOL_SECURITY_RESERVE_ADDRESS"] as const) {
    try { getAddress(process.env[name] ?? ""); } catch { blockers.push(`${name}_REQUIRED`); }
  }
  let minimumBalance = parseEther("0.1");
  try { minimumBalance = parseEther(process.env.DEPLOYER_MIN_TBNB ?? "0.1"); } catch { blockers.push("DEPLOYER_MIN_TBNB_INVALID"); }
  if (blockers.length) {
    console.log(JSON.stringify({ rpc: true, chainId, contractsCompiled: required, broadcastReady: false, blockers }));
    process.exitCode = 2;
    return;
  }
  let account;
  try { account = privateKeyToAccount(key as `0x${string}`); } catch {
    console.log(JSON.stringify({ rpc: true, chainId, contractsCompiled: required, broadcastReady: false, blockers: ["DEPLOYER_PRIVATE_KEY_INVALID"] }));
    process.exitCode = 2;
    return;
  }
  const balance = await client.getBalance({ address: account.address });
  const funded = balance >= minimumBalance;
  console.log(JSON.stringify({
    rpc: true, chainId, contractsCompiled: required, deployer: account.address,
    balanceTbnb: formatEther(balance), minimumBalanceTbnb: formatEther(minimumBalance),
    broadcastReady: funded, blockers: funded ? [] : ["DEPLOYER_TBNB_UNDERFUNDED"],
  }));
  if (!funded) process.exitCode = 2;
}
void main().catch((error) => {
  console.error(error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : "DEPLOYMENT_PREFLIGHT_FAILED");
  process.exitCode = 1;
});
