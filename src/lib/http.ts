import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isProductionMode } from "./env";

export function apiError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const expected = /^[A-Z][A-Z0-9_]*$/.test(rawMessage);
  let production = process.env.PROTOCOL_MODE === "production";
  try { production = isProductionMode(); } catch { /* configuration errors must still produce a safe response */ }
  const message = production && !(error instanceof ZodError) && !expected ? "INTERNAL_ERROR" : rawMessage;
  const status = error instanceof ZodError
    ? 400
    : ["INVALID_JSON_BODY", "JSON_BODY_INVALID_UTF8", "CONTENT_LENGTH_INVALID"].includes(message)
      ? 400
    : message === "REQUEST_BODY_TOO_LARGE"
      ? 413
    : ["JSON_CONTENT_TYPE_REQUIRED", "BINARY_CONTENT_TYPE_REQUIRED", "CONTENT_ENCODING_UNSUPPORTED"].includes(message)
      ? 415
    : message === "INTERNAL_ERROR"
      ? 500
    : message === "RATE_LIMIT_EXCEEDED"
      ? 429
      : message.includes("AUTHENTICATION_REQUIRED") || message.includes("AUTHENTICATION_FAILED") || message.includes("AUTH_SIGNATURE")
        ? 401
        : message.includes("SCOPE_DENIED") || message.includes("IDENTITY_MISMATCH") || message.endsWith("_DENIED") || message === "INVALID_REQUEST_ORIGIN"
          ? 403
          : message.endsWith("NOT_FOUND")
            ? 404
            : 409;
  return NextResponse.json(
    { error: message, issues: error instanceof ZodError ? error.issues : undefined },
    { status },
  );
}
