"use client";

import { createHash } from "./browser-hash";
import { readBoundedResponseBytes } from "./outbound-response";

const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export async function downloadPublisherCiphertext(downloadUrl: string, sizeBytes: number) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 16 || sizeBytes > 100 * 1024 * 1024) throw new Error("ARTIFACT_DOWNLOAD_SIZE_INVALID");
  const response = await fetch(downloadUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("ARTIFACT_DOWNLOAD_FAILED");
  const encrypted = await readBoundedResponseBytes(response, sizeBytes, {
    missingBody: "ARTIFACT_DOWNLOAD_EMPTY",
    tooLarge: "ARTIFACT_DOWNLOAD_TOO_LARGE",
    invalidContentLength: "ARTIFACT_DOWNLOAD_INVALID_CONTENT_LENGTH",
  });
  if (encrypted.byteLength !== sizeBytes) throw new Error("ARTIFACT_DOWNLOAD_SIZE_MISMATCH");
  return encrypted;
}

export async function releasePublisherArtifact(taskId: string) {
  const response = await fetch(`/api/artifacts/tasks/${encodeURIComponent(taskId)}/release`, { method: "POST" });
  const release = await response.json() as { downloadUrl?: string; decryptionKey?: string; contentIv?: string; contentType?: string; artifactHash?: string; ciphertextHash?: string; sizeBytes?: number; error?: string };
  if (!response.ok || !release.downloadUrl || !release.decryptionKey || !release.contentIv || !release.artifactHash || !release.ciphertextHash || !release.sizeBytes) throw new Error(release.error ?? "ARTIFACT_RELEASE_FAILED");
  const encrypted = await downloadPublisherCiphertext(release.downloadUrl, release.sizeBytes);
  if (`sha256:${await createHash(encrypted)}` !== release.ciphertextHash) throw new Error("CIPHERTEXT_HASH_MISMATCH");
  const key = await crypto.subtle.importKey("raw", decodeBase64(release.decryptionKey), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(release.contentIv) }, key, encrypted);
  if (`sha256:${await createHash(new Uint8Array(plaintext))}` !== release.artifactHash) throw new Error("PLAINTEXT_HASH_MISMATCH");
  const url = URL.createObjectURL(new Blob([plaintext], { type: release.contentType ?? "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `agentgrid-task-${taskId}.tar.gz`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
