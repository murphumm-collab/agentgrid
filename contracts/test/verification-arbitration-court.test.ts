import ganache from "ganache";
import { readFileSync } from "node:fs";
import path from "node:path";
import solc from "solc";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient, createWalletClient, custom, defineChain, keccak256,
  parseEther, stringToHex, type Abi, type Address,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { compileContracts, type ContractArtifact } from "../scripts/compiler";

const mnemonic = "test test test test test test test test test test test junk";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });
const chain = defineChain({
  id: 31_339,
  name: "AgentGrid Arbitration Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});
type Wallet = ReturnType<typeof createWalletClient>;

describe("VerificationArbitrationCourt penalty and recovery", () => {
  let artifacts: Record<string, ContractArtifact>;
  let provider: ReturnType<typeof ganache.provider>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let owner: Wallet;
  let challenger: Wallet;
  let validator: Wallet;
  let arbitrators: Wallet[];
  let token: Address;
  let panel: Address;
  let registry: Address;
  let court: Address;

  beforeAll(() => {
    artifacts = compileContracts();
    const fixtureName = "ArbitrationHarnesses.sol";
    const input = {
      language: "Solidity",
      sources: { [fixtureName]: { content: readFileSync(path.resolve(process.cwd(), "contracts/test/fixtures", fixtureName), "utf8") } },
      settings: { optimizer: { enabled: true, runs: 1 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const fatal = (output.errors ?? []).filter((entry: { severity: string }) => entry.severity === "error");
    if (fatal.length) throw new Error(fatal.map((entry: { formattedMessage: string }) => entry.formattedMessage).join("\n"));
    for (const name of ["ArbitrationPanelHarness", "ArbitrationRegistryHarness"]) {
      const fixture = output.contracts[fixtureName][name];
      artifacts[name] = {
        abi: fixture.abi, bytecode: `0x${fixture.evm.bytecode.object}`,
        deployedBytecode: `0x${fixture.evm.deployedBytecode.object}`, immutableReferences: [],
      };
    }
  });

  beforeEach(async () => {
    provider = ganache.provider({
      logging: { quiet: true }, chain: { chainId: chain.id },
      wallet: { mnemonic, totalAccounts: 10, defaultBalance: 1_000 },
    });
    const transport = custom(provider as never);
    publicClient = createPublicClient({ chain, transport });
    const wallet = (addressIndex: number) => createWalletClient({
      account: mnemonicToAccount(mnemonic, { addressIndex }), chain, transport,
    });
    owner = wallet(0);
    challenger = wallet(1);
    validator = wallet(2);
    arbitrators = [wallet(3), wallet(4), wallet(5)];
    token = await deploy(owner, "TestToken", [owner.account!.address]);
    panel = await deploy(owner, "ArbitrationPanelHarness", []);
    registry = await deploy(owner, "ArbitrationRegistryHarness", []);
    court = await deploy(owner, "VerificationArbitrationCourt", [
      token, panel, registry, wallet(9).account!.address,
      arbitrators.map((candidate) => candidate.account!.address),
    ]);
    await write(owner, panel, "ArbitrationPanelHarness", "setCourt", [court]);
    await write(owner, registry, "ArbitrationRegistryHarness", "setEligible", [challenger.account!.address, true]);

    for (const participant of [challenger, validator, ...arbitrators]) {
      await write(participant, token, "TestToken", "faucet");
      await write(participant, token, "TestToken", "approve", [court, parseEther("1000")]);
    }
    await write(challenger, court, "VerificationArbitrationCourt", "deposit", [parseEther("1000")]);
    await write(validator, court, "VerificationArbitrationCourt", "deposit", [parseEther("100")]);
    for (const arbitrator of arbitrators) {
      await write(arbitrator, court, "VerificationArbitrationCourt", "deposit", [parseEther("500")]);
    }
  });

  async function deploy(wallet: Wallet, name: string, args: readonly unknown[]) {
    const artifact = artifacts[name];
    const hash = await wallet.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode, args } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Missing deployment address for ${name}`);
    return receipt.contractAddress;
  }

  async function write(wallet: Wallet, address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    const hash = await wallet.writeContract({ address, abi: artifacts[name].abi as Abi, functionName, args } as never);
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function read(address: Address, name: string, functionName: string, args: readonly unknown[] = []) {
    return publicClient.readContract({ address, abi: artifacts[name].abi as Abi, functionName, args } as never);
  }

  async function rejectChallenge(taskId: bigint, expectedStake: bigint) {
    await write(owner, panel, "ArbitrationPanelHarness", "seedChallengeable", [taskId, validator.account!.address, Number(taskId)]);
    await write(challenger, court, "VerificationArbitrationCourt", "openChallenge", [
      taskId, validator.account!.address, keccak256(stringToHex(`false-challenge-${taskId}`)),
    ]);
    await expect(write(challenger, court, "VerificationArbitrationCourt", "withdraw", [1n])).rejects.toThrow();
    const resolution = keccak256(stringToHex(`rejected-resolution-${taskId}`));
    await write(arbitrators[0], court, "VerificationArbitrationCourt", "vote", [taskId, false, resolution]);
    await write(arbitrators[1], court, "VerificationArbitrationCourt", "vote", [taskId, false, resolution]);
    expect(await read(court, "VerificationArbitrationCourt", "stake", [challenger.account!.address])).toBe(expectedStake);
    expect(await read(court, "VerificationArbitrationCourt", "lockedStake", [challenger.account!.address])).toBe(0n);
  }

  it("slashes repeated false challenges by 5%, 15%, then 30% of each frozen stake snapshot", async () => {
    await rejectChallenge(1n, parseEther("950"));
    await rejectChallenge(2n, parseEther("807.5"));
    await rejectChallenge(3n, parseEther("565.25"));
    expect(await read(court, "VerificationArbitrationCourt", "falseChallengeCount", [challenger.account!.address])).toBe(3);
  });

  it("expires a no-quorum case after three days and unlocks every participant without a verdict", async () => {
    await write(owner, panel, "ArbitrationPanelHarness", "seedChallengeable", [9n, validator.account!.address, 1]);
    await write(challenger, court, "VerificationArbitrationCourt", "openChallenge", [
      9n, validator.account!.address, keccak256(stringToHex("no-quorum-challenge")),
    ]);
    await write(arbitrators[0], court, "VerificationArbitrationCourt", "vote", [
      9n, true, keccak256(stringToHex("single-vote-is-not-a-verdict")),
    ]);
    expect(await read(court, "VerificationArbitrationCourt", "lockedStake", [arbitrators[0].account!.address])).toBe(parseEther("500"));
    await provider.request({ method: "evm_increaseTime", params: [3 * 24 * 60 * 60 + 1] });
    await provider.request({ method: "evm_mine", params: [] });
    await write(owner, court, "VerificationArbitrationCourt", "expireChallenge", [9n]);
    expect(await read(court, "VerificationArbitrationCourt", "lockedStake", [challenger.account!.address])).toBe(0n);
    expect(await read(court, "VerificationArbitrationCourt", "lockedStake", [validator.account!.address])).toBe(0n);
    expect(await read(court, "VerificationArbitrationCourt", "lockedStake", [arbitrators[0].account!.address])).toBe(0n);
    expect(await read(court, "VerificationArbitrationCourt", "falseChallengeCount", [challenger.account!.address])).toBe(0);
    expect((await read(panel, "ArbitrationPanelHarness", "getPanel", [9n]) as { status: number }).status).toBe(3);
  });

  it("rehabilitates a banned role only after two arbitrators match the exact resolution", async () => {
    await write(owner, registry, "ArbitrationRegistryHarness", "setQuality", [challenger.account!.address, 2, 0, true]);
    const evidenceHash = keccak256(stringToHex("isolated-rehabilitation-task-proof"));
    await write(challenger, court, "VerificationArbitrationCourt", "openRehabilitationAppeal", [2, evidenceHash]);
    await expect(write(challenger, court, "VerificationArbitrationCourt", "withdraw", [1n])).rejects.toThrow();
    const acceptedResolution = keccak256(stringToHex("rehabilitation-evidence-upheld"));
    await write(arbitrators[0], court, "VerificationArbitrationCourt", "voteRehabilitationAppeal", [
      challenger.account!.address, 2, true, acceptedResolution,
    ]);
    await write(arbitrators[1], court, "VerificationArbitrationCourt", "voteRehabilitationAppeal", [
      challenger.account!.address, 2, true, keccak256(stringToHex("conflicting-rehabilitation-reason")),
    ]);
    expect((await read(registry, "ArbitrationRegistryHarness", "qualityOf", [challenger.account!.address, 2]) as { banned: boolean }).banned).toBe(true);
    await write(arbitrators[2], court, "VerificationArbitrationCourt", "voteRehabilitationAppeal", [
      challenger.account!.address, 2, true, acceptedResolution,
    ]);
    expect(await read(registry, "ArbitrationRegistryHarness", "qualityOf", [challenger.account!.address, 2])).toMatchObject({
      scoreBps: 2_500, severeFaults: 2, cooldownUntil: 0n, banned: false,
    });
    expect(await read(registry, "ArbitrationRegistryHarness", "rehabilitationEvidence", [challenger.account!.address, 2])).not.toBe(`0x${"0".repeat(64)}`);
    expect(await read(court, "VerificationArbitrationCourt", "stake", [challenger.account!.address])).toBe(parseEther("1000"));
    expect(await read(court, "VerificationArbitrationCourt", "lockedStake", [challenger.account!.address])).toBe(0n);
  });

  it("slashes a rejected rehabilitation appeal and expires a later no-quorum appeal without another penalty", async () => {
    await write(owner, registry, "ArbitrationRegistryHarness", "setQuality", [challenger.account!.address, 1, 1, false]);
    await write(challenger, court, "VerificationArbitrationCourt", "openRehabilitationAppeal", [
      1, keccak256(stringToHex("unsupported-rehabilitation-claim")),
    ]);
    const rejectedResolution = keccak256(stringToHex("claim-does-not-prove-rehabilitation"));
    await write(arbitrators[0], court, "VerificationArbitrationCourt", "voteRehabilitationAppeal", [challenger.account!.address, 1, false, rejectedResolution]);
    await write(arbitrators[1], court, "VerificationArbitrationCourt", "voteRehabilitationAppeal", [challenger.account!.address, 1, false, rejectedResolution]);
    expect(await read(court, "VerificationArbitrationCourt", "stake", [challenger.account!.address])).toBe(parseEther("950"));
    expect(await read(court, "VerificationArbitrationCourt", "falseRehabilitationAppealCount", [challenger.account!.address])).toBe(1);

    await write(challenger, court, "VerificationArbitrationCourt", "openRehabilitationAppeal", [
      1, keccak256(stringToHex("second-rehabilitation-claim")),
    ]);
    await write(arbitrators[0], court, "VerificationArbitrationCourt", "voteRehabilitationAppeal", [
      challenger.account!.address, 1, true, keccak256(stringToHex("only-one-vote")),
    ]);
    await provider.request({ method: "evm_increaseTime", params: [3 * 24 * 60 * 60 + 1] });
    await provider.request({ method: "evm_mine", params: [] });
    await write(owner, court, "VerificationArbitrationCourt", "expireRehabilitationAppeal", [challenger.account!.address, 1]);
    expect(await read(court, "VerificationArbitrationCourt", "stake", [challenger.account!.address])).toBe(parseEther("950"));
    expect(await read(court, "VerificationArbitrationCourt", "lockedStake", [challenger.account!.address])).toBe(0n);
    expect(await read(court, "VerificationArbitrationCourt", "lockedStake", [arbitrators[0].account!.address])).toBe(0n);
    expect(await read(court, "VerificationArbitrationCourt", "falseRehabilitationAppealCount", [challenger.account!.address])).toBe(1);
  });
});
