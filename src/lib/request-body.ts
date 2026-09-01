export const defaultJsonBodyLimit = 64 * 1024;
export const evidenceJsonBodyLimit = 256 * 1024;
export const maximumBinaryBodyLimit = 10 * 1024 * 1024;

function jsonMediaType(value: string | null) {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
}

async function readBodyBytes(request: Request, limit: number, maximumLimit: number, emptyBodyError: string) {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) throw new Error("REQUEST_BODY_LIMIT_INVALID");
  const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") throw new Error("CONTENT_ENCODING_UNSUPPORTED");
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new Error("CONTENT_LENGTH_INVALID");
    if (Number(declaredLength) > limit) throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  if (!request.body) throw new Error(emptyBodyError);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel("REQUEST_BODY_TOO_LARGE");
        throw new Error("REQUEST_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes === 0) throw new Error(emptyBodyError);
  const payload = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.byteLength; }
  return payload;
}

export async function readBinaryBody(request: Request, limit: number, exactBytes?: number): Promise<Uint8Array> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/octet-stream") throw new Error("BINARY_CONTENT_TYPE_REQUIRED");
  if (exactBytes !== undefined && (!Number.isInteger(exactBytes) || exactBytes < 1 || exactBytes > limit)) {
    throw new Error("BINARY_EXACT_LENGTH_INVALID");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new Error("CONTENT_LENGTH_INVALID");
    if (Number(declaredLength) > limit) throw new Error("REQUEST_BODY_TOO_LARGE");
    if (Number(declaredLength) > 0 && exactBytes !== undefined && Number(declaredLength) !== exactBytes) {
      throw new Error("BINARY_CONTENT_LENGTH_MISMATCH");
    }
  }
  const payload = await readBodyBytes(request, limit, maximumBinaryBodyLimit, "BINARY_BODY_REQUIRED");
  if (exactBytes !== undefined && payload.byteLength !== exactBytes) throw new Error("BINARY_CONTENT_LENGTH_MISMATCH");
  return payload;
}

export async function readJsonBody<T = unknown>(request: Request, limit = defaultJsonBodyLimit): Promise<T> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1024 * 1024) throw new Error("JSON_BODY_LIMIT_INVALID");
  if (!jsonMediaType(request.headers.get("content-type"))) throw new Error("JSON_CONTENT_TYPE_REQUIRED");
  const payload = await readBodyBytes(request, limit, 1024 * 1024, "INVALID_JSON_BODY");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(payload); }
  catch { throw new Error("JSON_BODY_INVALID_UTF8"); }
  try { return JSON.parse(text) as T; }
  catch { throw new Error("INVALID_JSON_BODY"); }
}
