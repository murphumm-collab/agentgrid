export type BoundedResponseErrors = {
  missingBody: string;
  tooLarge: string;
  invalidContentLength: string;
  invalidUtf8?: string;
};

export async function readBoundedResponseBytes(response: Response, maxBytes: number, errors: BoundedResponseErrors) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("INVALID_RESPONSE_SIZE_LIMIT");
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(0|[1-9]\d*)$/.test(declared)) throw new Error(errors.invalidContentLength);
    const declaredBytes = Number(declared);
    if (!Number.isSafeInteger(declaredBytes)) throw new Error(errors.invalidContentLength);
    if (declaredBytes > maxBytes) throw new Error(errors.tooLarge);
  }
  if (!response.body) throw new Error(errors.missingBody);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel(errors.tooLarge).catch(() => undefined);
        throw new Error(errors.tooLarge);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function readBoundedResponseText(response: Response, maxBytes: number, errors: BoundedResponseErrors) {
  const bytes = await readBoundedResponseBytes(response, maxBytes, errors);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(errors.invalidUtf8 ?? "RESPONSE_INVALID_UTF8");
  }
}
