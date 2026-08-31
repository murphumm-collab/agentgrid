"use client";

export async function encryptBrowserArtifact(bytes: Uint8Array) {
  const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("");
  const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
  const plaintextSha256 = hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const contentIv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: contentIv }, key, bytes as BufferSource));
  const sha256 = hex(await crypto.subtle.digest("SHA-256", ciphertext as BufferSource));
  return { ciphertext, sha256, plaintextSha256, encryptionAlgorithm: "AES-256-GCM" as const, contentIv: base64(contentIv), encryptionKey: base64(rawKey) };
}
