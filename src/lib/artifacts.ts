import { createDecipheriv, createHash } from "node:crypto";
import { CopyObjectCommand, CreateBucketCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { runtimeConfig } from "./env";
import { openArtifactKey } from "./artifact-crypto";

let client: S3Client | undefined;
let bucketReady: Promise<void> | undefined;

function storage() {
  const config = runtimeConfig();
  client ??= new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
  return { client, bucket: config.S3_BUCKET };
}

async function ensureBucket() {
  bucketReady ??= (async () => {
    const { client: s3, bucket } = storage();
    try { await s3.send(new HeadBucketCommand({ Bucket: bucket })); }
    catch { await s3.send(new CreateBucketCommand({ Bucket: bucket })); }
  })();
  return bucketReady;
}

export async function createArtifactUpload(input: { objectKey: string; sha256: string; sizeBytes: number; contentType: string }) {
  await ensureBucket();
  const { client: s3, bucket } = storage();
  const checksum = Buffer.from(input.sha256, "hex").toString("base64");
  const command = new PutObjectCommand({
    Bucket: bucket, Key: input.objectKey, ContentLength: input.sizeBytes, ContentType: input.contentType,
    Metadata: { sha256: input.sha256 }, ChecksumSHA256: checksum,
  });
  return {
    uploadUrl: await getSignedUrl(s3, command, { expiresIn: 900 }),
    method: "PUT" as const,
    headers: { "content-type": input.contentType, "content-length": String(input.sizeBytes) },
    expiresInSeconds: 900,
  };
}

export async function verifyArtifactObject(input: { objectKey: string; sha256: string; sizeBytes: number }) {
  const { client: s3, bucket } = storage();
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: input.objectKey, ChecksumMode: "ENABLED" }));
  if (head.ContentLength !== input.sizeBytes) throw new Error("ARTIFACT_SIZE_MISMATCH");
  if (head.Metadata?.sha256?.toLowerCase() !== input.sha256.toLowerCase()) throw new Error("ARTIFACT_HASH_METADATA_MISMATCH");
  const expectedChecksum = Buffer.from(input.sha256, "hex").toString("base64");
  if (head.ChecksumSHA256 && head.ChecksumSHA256 !== expectedChecksum) throw new Error("ARTIFACT_CONTENT_HASH_MISMATCH");
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: input.objectKey }));
  if (!object.Body) throw new Error("ARTIFACT_BODY_MISSING");
  const hash = createHash("sha256");
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) hash.update(chunk);
  if (hash.digest("hex") !== input.sha256.toLowerCase()) throw new Error("ARTIFACT_CONTENT_HASH_MISMATCH");
  return { artifactUrl: `s3://${bucket}/${input.objectKey}`, artifactHash: `sha256:${input.sha256}` };
}

export async function verifyEncryptedArtifactPlaintext(input: {
  objectKey: string; plaintextSha256: string; encryptionAlgorithm: string; contentIv: string;
  sealedKey: string; sealIv: string; sealTag: string;
}) {
  if (input.encryptionAlgorithm !== "AES-256-GCM") throw new Error("ARTIFACT_ENCRYPTION_ALGORITHM_UNSUPPORTED");
  const key = Buffer.from(openArtifactKey(input), "base64");
  const iv = Buffer.from(input.contentIv, "base64");
  if (key.length !== 32 || iv.length !== 12) throw new Error("ARTIFACT_ENCRYPTION_PARAMETERS_INVALID");
  const { client: s3, bucket } = storage();
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: input.objectKey }));
  if (!object.Body) throw new Error("ARTIFACT_BODY_MISSING");
  await verifyEncryptedPlaintextChunks(object.Body as AsyncIterable<Uint8Array>, key, iv, input.plaintextSha256);
  return true;
}

export async function verifyEncryptedPlaintextChunks(chunks: AsyncIterable<Uint8Array>, key: Buffer, iv: Buffer, expectedSha256: string) {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  const plaintextHash = createHash("sha256");
  let tail = Buffer.alloc(0);
  try {
    for await (const chunk of chunks) {
      const combined = Buffer.concat([tail, Buffer.from(chunk)]);
      if (combined.length <= 16) { tail = combined; continue; }
      const split = combined.length - 16;
      plaintextHash.update(decipher.update(combined.subarray(0, split)));
      tail = combined.subarray(split);
    }
    if (tail.length !== 16) throw new Error("ARTIFACT_CIPHERTEXT_INVALID");
    decipher.setAuthTag(tail);
    plaintextHash.update(decipher.final());
  } catch { throw new Error("ARTIFACT_DECRYPTION_VERIFICATION_FAILED"); }
  if (plaintextHash.digest("hex") !== expectedSha256.toLowerCase()) throw new Error("ARTIFACT_PLAINTEXT_HASH_MISMATCH");
  return true;
}

export async function sealArtifactObject(input: { id: string; taskId: string; objectKey: string; sha256: string; sizeBytes: number }) {
  await ensureBucket();
  const { client: s3, bucket } = storage();
  const sealedObjectKey = `sealed/tasks/${encodeURIComponent(input.taskId)}/${input.id}/${input.sha256}`;
  const copySource = `${bucket}/${input.objectKey.split("/").map(encodeURIComponent).join("/")}`;
  await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: sealedObjectKey, CopySource: copySource, MetadataDirective: "COPY" }));
  const verified = await verifyArtifactObject({ ...input, objectKey: sealedObjectKey });
  return { ...verified, objectKey: sealedObjectKey };
}

export async function createArtifactDownload(objectKey: string) {
  const { client: s3, bucket } = storage();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: objectKey }), { expiresIn: 300 });
}

export async function artifactStorageReady() {
  try {
    const { client: s3, bucket } = storage();
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch { return false; }
}

export async function uploadArtifactObject(input: { objectKey: string; sha256: string; contentType: string; bytes: Uint8Array }) {
  await ensureBucket();
  const actual = createHash("sha256").update(input.bytes).digest("hex");
  if (actual !== input.sha256.toLowerCase()) throw new Error("ARTIFACT_CONTENT_HASH_MISMATCH");
  const { client: s3, bucket } = storage();
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: input.objectKey, Body: input.bytes, ContentLength: input.bytes.byteLength, ContentType: input.contentType,
    Metadata: { sha256: input.sha256 }, ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
  }));
}
