import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiErrorResponseSchema } from "./api-error-schema";

function validationIssues(error: ZodError) {
  return error.issues.slice(0, 32).map((issue) => ({
    code: issue.code.slice(0, 64),
    path: issue.path.slice(0, 32).map((segment) => typeof segment === "number" && segment >= 0 ? segment : String(segment).slice(0, 120)),
    message: (issue.message || "Invalid value").slice(0, 500),
  }));
}

export function apiError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const expected = error instanceof Error && rawMessage.length <= 120 && /^[A-Z][A-Z0-9_]*$/.test(rawMessage);
  const message = error instanceof ZodError ? "VALIDATION_ERROR" : expected ? rawMessage : "INTERNAL_ERROR";
  const status = error instanceof ZodError
    ? 400
    : ["INVALID_JSON_BODY", "JSON_BODY_INVALID_UTF8", "CONTENT_LENGTH_INVALID", "BINARY_BODY_REQUIRED", "QUERY_PARAMETER_DUPLICATE", "COMPLETED_TASK_CURSOR_INVALID"].includes(message)
      ? 400
    : message === "REQUEST_BODY_TOO_LARGE"
      ? 413
    : ["JSON_CONTENT_TYPE_REQUIRED", "BINARY_CONTENT_TYPE_REQUIRED", "CONTENT_ENCODING_UNSUPPORTED"].includes(message)
      ? 415
    : message === "INTERNAL_ERROR"
      ? 500
    : message === "RATE_LIMIT_EXCEEDED"
      ? 429
      : message.includes("AUTHENTICATION_REQUIRED") || message.includes("AUTHENTICATION_FAILED")
        || ["AUTH_CHALLENGE_INVALID_OR_EXPIRED", "AUTH_MESSAGE_MISMATCH", "AUTH_SIGNATURE_INVALID"].includes(message)
        ? 401
        : message.includes("SCOPE_DENIED") || message.includes("IDENTITY_MISMATCH") || message.endsWith("_DENIED") || message === "INVALID_REQUEST_ORIGIN"
          ? 403
          : message.endsWith("NOT_FOUND")
            ? 404
            : message === "BINARY_CONTENT_LENGTH_MISMATCH"
              ? 409
            : 409;
  const body = apiErrorResponseSchema.parse({
    error: message,
    ...(error instanceof ZodError ? { issues: validationIssues(error) } : {}),
  });
  return NextResponse.json(
    body,
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
}
