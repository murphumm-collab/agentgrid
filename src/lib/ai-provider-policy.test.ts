import { describe, expect, it } from "vitest";
import { approvedAiBaseUrl } from "./ai-provider-policy";

describe("AI provider data boundary", () => {
  it("requires an exact approved origin for production agents", () => {
    expect(approvedAiBaseUrl("https://ai.example/v1", true, "https://ai.example")).toBe("https://ai.example/v1");
    expect(() => approvedAiBaseUrl("https://other.example/v1", true, "https://ai.example")).toThrow("AI_PROVIDER_ORIGIN_NOT_ALLOWED");
    expect(() => approvedAiBaseUrl("https://ai.example/v1", true)).toThrow("AI_ALLOWED_ORIGINS_REQUIRED");
  });

  it("rejects cleartext remote providers and embedded credentials", () => {
    expect(() => approvedAiBaseUrl("http://ai.example/v1", false)).toThrow("AI_BASE_URL_HTTPS_REQUIRED");
    expect(() => approvedAiBaseUrl("https://user:password@ai.example/v1", false)).toThrow("AI_BASE_URL_CREDENTIALS_FORBIDDEN");
    expect(approvedAiBaseUrl("http://127.0.0.1:11434/v1", true, "http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434/v1");
  });
});
