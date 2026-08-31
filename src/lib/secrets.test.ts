import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configuredSecret, enforceProductionFileSecrets, requiredSecret } from "./secrets";

const folders: string[] = [];
function secretFile(name: string, value: string, mode = 0o400) {
  const folder = mkdtempSync(path.join(tmpdir(), "agentgrid-secret-test-"));
  folders.push(folder);
  const filename = path.join(folder, name);
  writeFileSync(filename, value, { mode });
  chmodSync(filename, mode);
  return filename;
}

describe("file-backed production secrets", () => {
  afterEach(() => { while (folders.length) rmSync(folders.pop()!, { recursive: true, force: true }); });

  it("reads an absolute, non-writable file and removes one terminal newline", () => {
    const filename = secretFile("auth", "a-secure-value\n");
    expect(configuredSecret("AUTH_SECRET", { AUTH_SECRET_FILE: filename })).toEqual({ value: "a-secure-value", source: "file", file: filename });
  });

  it("rejects ambiguous, relative, and writable-by-others sources", () => {
    const filename = secretFile("auth", "a-secure-value", 0o620);
    expect(() => configuredSecret("AUTH_SECRET", { AUTH_SECRET: "direct", AUTH_SECRET_FILE: filename })).toThrow("AUTH_SECRET_SECRET_SOURCE_CONFLICT");
    expect(() => configuredSecret("AUTH_SECRET", { AUTH_SECRET_FILE: "relative-secret" })).toThrow("AUTH_SECRET_SECRET_FILE_MUST_BE_ABSOLUTE");
    expect(() => configuredSecret("AUTH_SECRET", { AUTH_SECRET_FILE: filename })).toThrow("AUTH_SECRET_SECRET_FILE_WRITABLE_BY_OTHERS");
  });

  it("requires file sources when the production policy is enabled", () => {
    expect(() => requiredSecret("AGENT_API_KEY", { AGENT_API_KEY: "direct", REQUIRE_FILE_SECRETS: "true" })).toThrow("AGENT_API_KEY_FILE_REQUIRED");
    const filename = secretFile("agent-key", "amp_secure_agent_key");
    expect(requiredSecret("AGENT_API_KEY", { AGENT_API_KEY_FILE: filename, REQUIRE_FILE_SECRETS: "true" })).toBe("amp_secure_agent_key");
  });

  it("rejects missing or placeholder core production secrets", () => {
    const environment: Record<string, string> = { REQUIRE_FILE_SECRETS: "true" };
    for (const name of ["DATABASE_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY", "ARTIFACT_MASTER_KEY", "ADMIN_API_KEY", "ALERT_WEBHOOK_SECRET", "SPEC_ASSISTANT_AI_API_KEY", "AUTH_SECRET"]) {
      environment[`${name}_FILE`] = secretFile(name.toLowerCase(), `${name.toLowerCase()}-secure-production-value`);
    }
    const required = ["DATABASE_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY", "ARTIFACT_MASTER_KEY", "ADMIN_API_KEY", "ALERT_WEBHOOK_SECRET", "SPEC_ASSISTANT_AI_API_KEY", "AUTH_SECRET"];
    expect(enforceProductionFileSecrets(environment, required)).toBe(true);
    environment.AUTH_SECRET_FILE = secretFile("placeholder", "replace-with-production-secret");
    expect(() => enforceProductionFileSecrets(environment, required)).toThrow("AUTH_SECRET_PLACEHOLDER_FORBIDDEN");
    delete environment.DATABASE_URL_FILE;
    expect(() => enforceProductionFileSecrets(environment, required)).toThrow("DATABASE_URL_FILE_REQUIRED");
  });
});
