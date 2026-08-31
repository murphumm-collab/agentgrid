import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { runtimeConfig } from "./env";

function masterKey() {
  const key = runtimeConfig().ARTIFACT_MASTER_KEY;
  if (!key) throw new Error("ARTIFACT_MASTER_KEY_NOT_CONFIGURED");
  return Buffer.from(key, "hex");
}

function previousMasterKeys() {
  const configured = runtimeConfig().ARTIFACT_PREVIOUS_MASTER_KEYS?.trim();
  if (!configured) return [];
  return configured.split(",").map((value) => {
    const key = value.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error("INVALID_PREVIOUS_ARTIFACT_MASTER_KEY");
    return Buffer.from(key, "hex");
  });
}

function sealWithMasterKey(raw: Buffer, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
  return { sealedKey: ciphertext.toString("base64"), sealIv: iv.toString("base64"), sealTag: cipher.getAuthTag().toString("base64") };
}

function openWithMasterKey(input: { sealedKey: string; sealIv: string; sealTag: string }, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(input.sealIv, "base64"));
  decipher.setAuthTag(Buffer.from(input.sealTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(input.sealedKey, "base64")), decipher.final()]);
}

export function sealArtifactKey(rawKeyBase64: string) {
  const raw = Buffer.from(rawKeyBase64, "base64");
  if (raw.length !== 32) throw new Error("ARTIFACT_KEY_MUST_BE_256_BITS");
  return sealWithMasterKey(raw, masterKey());
}

export function openArtifactKey(input: { sealedKey: string; sealIv: string; sealTag: string }) {
  for (const key of [masterKey(), ...previousMasterKeys()]) {
    try { return openWithMasterKey(input, key).toString("base64"); }
    catch { /* Try the next configured rotation key without exposing which key failed. */ }
  }
  throw new Error("ARTIFACT_KEY_DECRYPTION_FAILED");
}

export function rewrapArtifactKey(input: { sealedKey: string; sealIv: string; sealTag: string }) {
  return sealWithMasterKey(Buffer.from(openArtifactKey(input), "base64"), masterKey());
}
