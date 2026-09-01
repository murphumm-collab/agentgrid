import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getAddress, verifyMessage, type Address } from "viem";
import { isProductionMode, runtimeConfig } from "./env";
import { consumeAuthNonce, storeAuthNonce } from "./store-postgres";
import { walletAddressSchema, type WalletChallengeResponse } from "./auth-schema";

export const SESSION_COOKIE = "agentgrid-session";
const nonceTtlMs = 5 * 60 * 1_000;
const demoNonces = new Map<string, { address: string; chainId: number; expiresAt: number; messageHash: string }>();

function hashNonce(nonce: string) {
  return createHash("sha256").update(nonce).digest("hex");
}

function secret() {
  return new TextEncoder().encode(runtimeConfig().AUTH_SECRET ?? "agentgrid-demo-session-secret-not-for-production");
}

export function buildSignInMessage(input: { address: Address; nonce: string; issuedAt: string; expiresAt: string }) {
  const config = runtimeConfig();
  const domain = new URL(config.AUTH_ORIGIN).host;
  return `${domain} wants you to sign in with your BSC account:\n${input.address}\n\nSign in to AgentGrid. This request does not trigger a blockchain transaction.\n\nURI: ${config.AUTH_ORIGIN}\nVersion: 1\nChain ID: ${config.BSC_CHAIN_ID}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expiresAt}`;
}

export async function createWalletChallenge(rawAddress: string) {
  const address = getAddress(walletAddressSchema.parse(rawAddress));
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + nonceTtlMs);
  const nonceHash = hashNonce(nonce);
  const chainId = runtimeConfig().BSC_CHAIN_ID;
  const message = buildSignInMessage({ address, nonce, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() });
  const messageHash = hashNonce(message);
  if (isProductionMode()) await storeAuthNonce(nonceHash, messageHash, address, chainId, expiresAt);
  else demoNonces.set(nonceHash, { address: address.toLowerCase(), chainId, expiresAt: expiresAt.getTime(), messageHash });
  return { address, nonce, chainId, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), message };
}

export async function verifyWalletChallenge(input: WalletChallengeResponse) {
  const address = getAddress(walletAddressSchema.parse(input.address));
  const expectedNonceHash = hashNonce(input.nonce);
  const messageHash = hashNonce(input.message);
  const chainId = runtimeConfig().BSC_CHAIN_ID;
  const validNonce = isProductionMode()
    ? await consumeAuthNonce(expectedNonceHash, messageHash, address, chainId)
    : consumeDemoNonce(expectedNonceHash, messageHash, address, chainId);
  if (!validNonce) throw new Error("AUTH_CHALLENGE_INVALID_OR_EXPIRED");
  if (!input.message.includes(`Nonce: ${input.nonce}`) || !input.message.includes(`Chain ID: ${chainId}`)) throw new Error("AUTH_MESSAGE_MISMATCH");
  if (!await verifyMessage({ address, message: input.message, signature: input.signature })) throw new Error("AUTH_SIGNATURE_INVALID");
  const token = await new SignJWT({ address, chainId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(address.toLowerCase())
    .setIssuedAt()
    .setExpirationTime(`${runtimeConfig().SESSION_TTL_SECONDS}s`)
    .setIssuer("agentgrid")
    .setAudience("agentgrid-web")
    .sign(secret());
  return { address, chainId, token };
}

function consumeDemoNonce(nonceHash: string, messageHash: string, address: string, chainId: number) {
  const value = demoNonces.get(nonceHash);
  demoNonces.delete(nonceHash);
  return Boolean(value && value.messageHash === messageHash && value.address === address.toLowerCase() && value.chainId === chainId && value.expiresAt > Date.now());
}

export async function readWalletSession(token?: string) {
  const encoded = token ?? (await cookies()).get(SESSION_COOKIE)?.value;
  if (!encoded) return null;
  try {
    const verified = await jwtVerify(encoded, secret(), { issuer: "agentgrid", audience: "agentgrid-web" });
    return { address: getAddress(String(verified.payload.address)), chainId: Number(verified.payload.chainId) };
  } catch {
    return null;
  }
}

export async function requireWalletSession(token?: string) {
  const session = await readWalletSession(token);
  if (!session) throw new Error("WALLET_AUTHENTICATION_REQUIRED");
  if (session.chainId !== runtimeConfig().BSC_CHAIN_ID) throw new Error("WALLET_CHAIN_MISMATCH");
  return session;
}

export function assertSameOrigin(request: Request) {
  if (!isProductionMode()) return;
  const origin = request.headers.get("origin");
  if (origin !== runtimeConfig().AUTH_ORIGIN) throw new Error("INVALID_REQUEST_ORIGIN");
}

export async function requirePublisherRequest(request: Request, claimedAddress?: string) {
  assertSameOrigin(request);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const encoded = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!encoded) throw new Error("WALLET_AUTHENTICATION_REQUIRED");
  const session = await requireWalletSession(decodeURIComponent(encoded));
  if (claimedAddress && session.address.toLowerCase() !== claimedAddress.toLowerCase()) throw new Error("PUBLISHER_IDENTITY_MISMATCH");
  return session.address;
}
