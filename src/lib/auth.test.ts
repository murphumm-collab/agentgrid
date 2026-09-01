import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletChallenge, readWalletSession, verifyWalletChallenge } from "./auth";
import { walletChallengeRequestSchema, walletChallengeResponseSchema } from "./auth-schema";
import { resetRuntimeConfigForTests } from "./env";

const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const previous = { ...process.env };

describe("wallet authentication", () => {
  beforeEach(() => {
    process.env.PROTOCOL_MODE = "demo";
    process.env.AUTH_ORIGIN = "http://localhost:3000";
    process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
    process.env.BSC_CHAIN_ID = "97";
    resetRuntimeConfigForTests();
  });

  afterEach(() => {
    process.env = { ...previous };
    resetRuntimeConfigForTests();
  });

  it("creates a one-time BSC challenge and verifies the signed session", async () => {
    const challenge = await createWalletChallenge(account.address);
    expect(challenge.chainId).toBe(97);
    expect(challenge.message).toContain("Chain ID: 97");
    const signature = await account.signMessage({ message: challenge.message });
    const verified = await verifyWalletChallenge({ address: account.address, nonce: challenge.nonce, message: challenge.message, signature });
    expect(verified.address).toBe(account.address);
    await expect(readWalletSession(verified.token)).resolves.toEqual({ address: account.address, chainId: 97 });
    await expect(verifyWalletChallenge({ address: account.address, nonce: challenge.nonce, message: challenge.message, signature })).rejects.toThrow("AUTH_CHALLENGE_INVALID_OR_EXPIRED");
  });

  it("rejects a challenge message changed after issuance", async () => {
    const challenge = await createWalletChallenge(account.address);
    const changed = `${challenge.message}\nInjected: true`;
    const signature = await account.signMessage({ message: changed });
    await expect(verifyWalletChallenge({ address: account.address, nonce: challenge.nonce, message: changed, signature })).rejects.toThrow("AUTH_CHALLENGE_INVALID_OR_EXPIRED");
  });

  it("rejects malformed and extended wallet-auth payloads at the shared schema", () => {
    expect(walletChallengeRequestSchema.safeParse({ address: account.address, unexpected: true }).success).toBe(false);
    const valid = {
      address: account.address,
      nonce: "00".repeat(16),
      message: "challenge",
      signature: `0x${"00".repeat(65)}`,
    };
    for (const payload of [
      { ...valid, nonce: 42 },
      { ...valid, message: "x".repeat(2_049) },
      { ...valid, signature: "0x1234" },
      { ...valid, unexpected: true },
    ]) expect(walletChallengeResponseSchema.safeParse(payload).success).toBe(false);
  });
});
