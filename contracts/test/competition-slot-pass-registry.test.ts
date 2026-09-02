import ganache from "ganache";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPublicClient, createWalletClient, custom, defineChain, keccak256,
  stringToHex, type Abi, type Address, type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { compileContracts, type ContractArtifact } from "../scripts/compiler";

const mnemonic = "test test test test test test test test test test test junk";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const chain = defineChain({
  id: 31_341,
  name: "AgentGrid Competition Slot Pass Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

const authorizationTypes = {
  CompetitionSlotAuthorization: [
    { name: "publisher", type: "address" },
    { name: "taskRegistry", type: "address" },
    { name: "specHash", type: "bytes32" },
    { name: "authorizationId", type: "bytes32" },
    { name: "paymentReceiptHash", type: "bytes32" },
    { name: "asset", type: "bytes32" },
    { name: "amountAtomic", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "paidSlots", type: "uint8" },
    { name: "totalSlots", type: "uint8" },
  ],
} as const;

type Wallet = ReturnType<typeof createWalletClient>;
type Authorization = {
  publisher: Address;
  taskRegistry: Address;
  specHash: Hex;
  authorizationId: Hex;
  paymentReceiptHash: Hex;
  asset: Hex;
  amountAtomic: bigint;
  issuedAt: bigint;
  expiresAt: bigint;
  paidSlots: number;
  totalSlots: number;
};

describe("CompetitionSlotPassRegistry", () => {
  let artifacts: Record<string, ContractArtifact>;
  let provider: ReturnType<typeof ganache.provider>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let owner: Wallet;
  let issuer: Wallet;
  let publisher: Wallet;
  let taskRegistry: Wallet;
  let outsider: Wallet;
  let registry: Address;
  let now: bigint;

  beforeAll(() => { artifacts = compileContracts(); });

  beforeEach(async () => {
    provider = ganache.provider({
      logging: { quiet: true }, chain: { chainId: chain.id },
      wallet: { mnemonic, totalAccounts: 8, defaultBalance: 1_000 },
    });
    const transport = custom(provider as never);
    publicClient = createPublicClient({ chain, transport });
    owner = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 0 }), chain, transport });
    issuer = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 1 }), chain, transport });
    publisher = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 2 }), chain, transport });
    taskRegistry = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 3 }), chain, transport });
    outsider = createWalletClient({ account: mnemonicToAccount(mnemonic, { addressIndex: 4 }), chain, transport });
    registry = await deploy(owner, "CompetitionSlotPassRegistry", [taskRegistry.account!.address, issuer.account!.address, owner.account!.address]);
    now = (await publicClient.getBlock()).timestamp;
  });

  async function deploy(wallet: Wallet, name: string, args: readonly unknown[]) {
    const artifact = artifacts[name];
    const hash = await wallet.deployContract({ abi: artifact.abi as Abi, bytecode: artifact.bytecode, args } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`Missing deployment address for ${name}`);
    return receipt.contractAddress;
  }

  async function write(wallet: Wallet, functionName: string, args: readonly unknown[] = []) {
    const hash = await wallet.writeContract({
      address: registry, abi: artifacts.CompetitionSlotPassRegistry.abi as Abi, functionName, args,
    } as never);
    return publicClient.waitForTransactionReceipt({ hash });
  }

  async function read(functionName: string, args: readonly unknown[] = []) {
    return publicClient.readContract({
      address: registry, abi: artifacts.CompetitionSlotPassRegistry.abi as Abi, functionName, args,
    } as never);
  }

  function authorization(overrides: Partial<Authorization> = {}): Authorization {
    const paidSlots = overrides.paidSlots ?? 3;
    return {
      publisher: publisher.account!.address,
      taskRegistry: taskRegistry.account!.address,
      specHash: keccak256(stringToHex("competition-spec")),
      authorizationId: keccak256(stringToHex("authorization-1")),
      paymentReceiptHash: keccak256(stringToHex("payment-receipt-1")),
      asset: keccak256(stringToHex("USDT")),
      amountAtomic: 30_000_000n,
      issuedAt: now,
      expiresAt: now + 3_600n,
      paidSlots,
      totalSlots: paidSlots + 2,
      ...overrides,
    };
  }

  async function signature(input: Authorization, signer = issuer) {
    return signer.signTypedData({
      account: signer.account!,
      domain: { name: "AgentGrid Competition Slot Pass", version: "1", chainId: chain.id, verifyingContract: registry },
      types: authorizationTypes,
      primaryType: "CompetitionSlotAuthorization",
      message: input,
    });
  }

  async function register(input: Authorization, signer = issuer) {
    return write(outsider, "registerAuthorization", [input, await signature(input, signer)]);
  }

  function consumeArgs(input: Authorization) {
    return [
      input.authorizationId, input.publisher, input.specHash, input.paymentReceiptHash,
      input.asset, input.amountAtomic, input.paidSlots, input.totalSlots,
    ] as const;
  }

  it("registers an issuer-signed pass and lets only the TaskRegistry consume the exact terms once", async () => {
    const input = authorization();
    await register(input);
    const stored = await read("getAuthorization", [input.authorizationId]) as {
      publisher: Address; specHash: Hex; paymentReceiptHash: Hex; paidSlots: number; totalSlots: number; consumed: boolean;
    };
    expect(stored).toMatchObject({
      publisher: input.publisher, specHash: input.specHash, paymentReceiptHash: input.paymentReceiptHash,
      paidSlots: 3, totalSlots: 5, consumed: false,
    });
    expect(await read("receiptAuthorizationId", [input.paymentReceiptHash])).toBe(input.authorizationId);

    await expect(write(outsider, "consume", consumeArgs(input))).rejects.toThrow();
    await expect(write(taskRegistry, "consume", [...consumeArgs(input).slice(0, 5), input.amountAtomic + 1n, input.paidSlots, input.totalSlots])).rejects.toThrow();
    await write(taskRegistry, "consume", consumeArgs(input));
    expect((await read("getAuthorization", [input.authorizationId]) as { consumed: boolean }).consumed).toBe(true);
    await expect(write(taskRegistry, "consume", consumeArgs(input))).rejects.toThrow();
  });

  it("rejects authorization-id, payment-receipt and signature replay or tampering", async () => {
    const input = authorization();
    await register(input);
    await expect(register(input)).rejects.toThrow();

    const sameReceipt = authorization({ authorizationId: keccak256(stringToHex("authorization-2")) });
    await expect(register(sameReceipt)).rejects.toThrow();

    const tampered = authorization({
      authorizationId: keccak256(stringToHex("authorization-3")),
      paymentReceiptHash: keccak256(stringToHex("payment-receipt-3")),
    });
    const signed = await signature(tampered);
    await expect(write(outsider, "registerAuthorization", [{ ...tampered, amountAtomic: tampered.amountAtomic + 1n }, signed])).rejects.toThrow();
    await expect(register(tampered, outsider)).rejects.toThrow();
  });

  it("accepts only the three governed settlement assets", async () => {
    expect(await read("ASSET_USDT")).toBe(keccak256(stringToHex("USDT")));
    expect(await read("ASSET_USDC")).toBe(keccak256(stringToHex("USDC")));
    expect(await read("ASSET_BNB")).toBe(keccak256(stringToHex("BNB")));
    const invalidAsset = authorization({
      authorizationId: keccak256(stringToHex("invalid-asset")),
      paymentReceiptHash: keccak256(stringToHex("invalid-asset-receipt")),
      asset: keccak256(stringToHex("ETH")),
    });
    await expect(register(invalidAsset)).rejects.toThrow();
  });

  it("enforces the fixed two included slots, one-to-thirty paid slots, expiry and issuer rotation", async () => {
    for (const invalid of [
      authorization({ paidSlots: 0, totalSlots: 2, authorizationId: keccak256(stringToHex("invalid-0")), paymentReceiptHash: keccak256(stringToHex("receipt-0")) }),
      authorization({ paidSlots: 31, totalSlots: 33, authorizationId: keccak256(stringToHex("invalid-31")), paymentReceiptHash: keccak256(stringToHex("receipt-31")) }),
      authorization({ paidSlots: 3, totalSlots: 6, authorizationId: keccak256(stringToHex("invalid-total")), paymentReceiptHash: keccak256(stringToHex("receipt-total")) }),
      authorization({ issuedAt: now + 1n, authorizationId: keccak256(stringToHex("invalid-future")), paymentReceiptHash: keccak256(stringToHex("receipt-future")) }),
    ]) await expect(register(invalid)).rejects.toThrow();

    const replacementIssuer = mnemonicToAccount(mnemonic, { addressIndex: 5 });
    await write(owner, "setIssuer", [replacementIssuer.address]);
    const stale = authorization({ authorizationId: keccak256(stringToHex("stale-issuer")), paymentReceiptHash: keccak256(stringToHex("stale-receipt")) });
    await expect(register(stale)).rejects.toThrow();

    const replacementWallet = createWalletClient({ account: replacementIssuer, chain, transport: custom(provider as never) });
    const expiring = authorization({ authorizationId: keccak256(stringToHex("expires")), paymentReceiptHash: keccak256(stringToHex("expires-receipt")), expiresAt: now + 60n });
    await register(expiring, replacementWallet);
    await provider.request({ method: "evm_setTime", params: [Number(expiring.expiresAt * 1_000n)] });
    await provider.request({ method: "evm_mine", params: [] });
    await expect(write(taskRegistry, "consume", consumeArgs(expiring))).rejects.toThrow();
  });
});
