"use client";

import { createHash } from "./browser-hash";

const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export async function releasePublisherArtifact(taskId: string) {
  const response = await fetch(`/api/artifacts/tasks/${encodeURIComponent(taskId)}/release`, { method: "POST" });
  const release = await response.json() as { downloadUrl?: string; decryptionKey?: string; contentIv?: string; contentType?: string; artifactHash?: string; ciphertextHash?: string; error?: string };
  if (!response.ok || !release.downloadUrl || !release.decryptionKey || !release.contentIv) throw new Error(release.error ?? "ARTIFACT_RELEASE_FAILED");
  const encryptedResponse = await fetch(release.downloadUrl);
  if (!encryptedResponse.ok) throw new Error("ARTIFACT_DOWNLOAD_FAILED");
  const encrypted = new Uint8Array(await encryptedResponse.arrayBuffer());
  if (`sha256:${await createHash(encrypted)}` !== release.ciphertextHash) throw new Error("CIPHERTEXT_HASH_MISMATCH");
  const key = await crypto.subtle.importKey("raw", decodeBase64(release.decryptionKey), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(release.contentIv) }, key, encrypted);
  if (`sha256:${await createHash(new Uint8Array(plaintext))}` !== release.artifactHash) throw new Error("PLAINTEXT_HASH_MISMATCH");
  const url = URL.createObjectURL(new Blob([plaintext], { type: release.contentType ?? "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `agentgrid-task-${taskId}.tar.gz`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
