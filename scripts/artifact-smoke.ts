import { createHash, randomUUID } from "node:crypto";
import { createArtifactUpload, sealArtifactObject, verifyArtifactObject } from "../src/lib/artifacts";

async function main() {
  const content = Buffer.from("AgentGrid immutable artifact smoke test\n");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const objectKey = `smoke/${randomUUID()}`;
  const upload = await createArtifactUpload({ objectKey, sha256, sizeBytes: content.length, contentType: "text/plain" });
  const response = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: content });
  if (!response.ok) throw new Error(`ARTIFACT_UPLOAD_FAILED_${response.status}_${await response.text()}`);
  const verified = await verifyArtifactObject({ objectKey, sha256, sizeBytes: content.length });
  const sealed = await sealArtifactObject({ id: randomUUID(), taskId: "smoke", objectKey, sha256, sizeBytes: content.length });
  const overwrite = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: Buffer.alloc(content.length, 2) });
  if (!overwrite.ok) throw new Error(`SOURCE_OVERWRITE_FAILED_${overwrite.status}`);
  await verifyArtifactObject({ objectKey: sealed.objectKey, sha256, sizeBytes: content.length });
  const rejectedKey = `smoke/${randomUUID()}`;
  const rejectedUpload = await createArtifactUpload({ objectKey: rejectedKey, sha256, sizeBytes: content.length, contentType: "text/plain" });
  const invalidResponse = await fetch(rejectedUpload.uploadUrl, { method: "PUT", headers: rejectedUpload.headers, body: Buffer.alloc(content.length, 1) });
  if (!invalidResponse.ok) throw new Error(`INVALID_ARTIFACT_UPLOAD_UNEXPECTEDLY_FAILED_${invalidResponse.status}`);
  let invalidChecksumRejected = false;
  try { await verifyArtifactObject({ objectKey: rejectedKey, sha256, sizeBytes: content.length }); }
  catch (error) { invalidChecksumRejected = error instanceof Error && error.message === "ARTIFACT_CONTENT_HASH_MISMATCH"; }
  if (!invalidChecksumRejected) throw new Error("INVALID_ARTIFACT_CHECKSUM_WAS_ACCEPTED");
  console.log(JSON.stringify({ uploaded: true, hashVerified: true, sealedCopyImmutable: true, invalidChecksumRejected: true, ...verified, sealedObjectKey: sealed.objectKey }));
}

void main();
