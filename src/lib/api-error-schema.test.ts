import { describe, expect, it } from "vitest";
import { apiErrorResponseSchema } from "./api-error-schema";

const issue = { code: "invalid_type", path: ["payload", 0], message: "Expected string" };

describe("machine API error envelope", () => {
  it("accepts only stable closed error codes and bounded validation issues", () => {
    const error = { error: "VALIDATION_ERROR", issues: [issue] };
    expect(apiErrorResponseSchema.parse(error)).toEqual(error);
    expect(() => apiErrorResponseSchema.parse({ ...error, debug: "stack" })).toThrow();
    expect(() => apiErrorResponseSchema.parse({ error: "lowercase" })).toThrow();
    expect(() => apiErrorResponseSchema.parse({ error: "A".repeat(121) })).toThrow();
    expect(() => apiErrorResponseSchema.parse({ error: "VALIDATION_ERROR", issues: Array(33).fill(issue) })).toThrow();
    expect(() => apiErrorResponseSchema.parse({ error: "VALIDATION_ERROR", issues: [{ ...issue, path: Array(33).fill("nested") }] })).toThrow();
    expect(() => apiErrorResponseSchema.parse({ error: "VALIDATION_ERROR", issues: [{ ...issue, message: "x".repeat(501) }] })).toThrow();
  });
});
