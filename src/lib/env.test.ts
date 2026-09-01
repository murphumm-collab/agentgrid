import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chainDeploymentAddresses, resetRuntimeConfigForTests, runtimeConfig } from "./env";

const previous = { ...process.env };
const folders: string[] = [];

describe("production environment", () => {
  afterEach(() => {
    process.env = { ...previous };
    resetRuntimeConfigForTests();
    while (folders.length) rmSync(folders.pop()!, { recursive: true, force: true });
  });

  it("refuses production mode without durable state and a session secret", () => {
    process.env.PROTOCOL_MODE = "production";
    process.env.AUTH_ORIGIN = "https://agentgrid.example";
    delete process.env.DATABASE_URL;
    delete process.env.AUTH_SECRET;
    resetRuntimeConfigForTests();
    expect(() => runtimeConfig()).toThrow("DATABASE_URL_REQUIRED_IN_PRODUCTION");
  });

  it("accepts an explicit production configuration", () => {
    process.env.PROTOCOL_MODE = "production";
    process.env.AUTH_ORIGIN = "https://agentgrid.example/";
    process.env.DATABASE_URL = "postgresql://agentgrid:secret@127.0.0.1:5432/agentgrid";
    process.env.AUTH_SECRET = "production-secret-with-more-than-thirty-two-characters";
    resetRuntimeConfigForTests();
    expect(runtimeConfig()).toMatchObject({ PROTOCOL_MODE: "production", AUTH_ORIGIN: "https://agentgrid.example" });
  });

  it("requires one explicit canonical production authentication origin", () => {
    process.env.PROTOCOL_MODE = "production";
    process.env.DATABASE_URL = "postgresql://agentgrid:secret@127.0.0.1:5432/agentgrid";
    process.env.AUTH_SECRET = "production-secret-with-more-than-thirty-two-characters";
    delete process.env.AUTH_ORIGIN;
    resetRuntimeConfigForTests();
    expect(() => runtimeConfig()).toThrow("AUTH_ORIGIN_REQUIRED_IN_PRODUCTION");
    process.env.AUTH_ORIGIN = "https://agentgrid.example/app";
    resetRuntimeConfigForTests();
    expect(() => runtimeConfig()).toThrow("AUTH_ORIGIN_MUST_BE_ORIGIN_ONLY");
  });

  it("pins production to BSC Testnet and a protected RPC transport", () => {
    process.env.PROTOCOL_MODE = "production";
    process.env.AUTH_ORIGIN = "https://agentgrid.example";
    process.env.DATABASE_URL = "postgresql://agentgrid:secret@127.0.0.1:5432/agentgrid";
    process.env.AUTH_SECRET = "production-secret-with-more-than-thirty-two-characters";
    process.env.BSC_CHAIN_ID = "56";
    resetRuntimeConfigForTests();
    expect(() => runtimeConfig()).toThrow("BSC_TESTNET_CHAIN_ID_REQUIRED_IN_PRODUCTION");
    process.env.BSC_CHAIN_ID = "97";
    process.env.BSC_TESTNET_RPC_URL = "http://rpc.example";
    resetRuntimeConfigForTests();
    expect(() => runtimeConfig()).toThrow("BSC_RPC_HTTPS_REQUIRED");
  });

  it("enables public showcase mode only when explicitly requested", () => {
    process.env.PROTOCOL_MODE = "demo";
    process.env.PUBLIC_SHOWCASE_MODE = "true";
    resetRuntimeConfigForTests();
    expect(runtimeConfig().PUBLIC_SHOWCASE_MODE).toBe(true);
    process.env.PUBLIC_SHOWCASE_MODE = "false";
    resetRuntimeConfigForTests();
    expect(runtimeConfig().PUBLIC_SHOWCASE_MODE).toBe(false);
  });

  it("rejects malformed artifact rotation keys", () => {
    process.env.ARTIFACT_PREVIOUS_MASTER_KEYS = "not-a-key";
    resetRuntimeConfigForTests();
    expect(() => runtimeConfig()).toThrow();
  });

  it("requires every verification, dispute and economics contract for nine-contract deployment readiness", () => {
    process.env.PROTOCOL_MODE = "demo";
    process.env.TOKEN_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.STAKE_MANAGER_ADDRESS = "0x2222222222222222222222222222222222222222";
    process.env.AGENT_REGISTRY_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.TASK_REGISTRY_ADDRESS = "0x4444444444444444444444444444444444444444";
    process.env.REWARD_VAULT_ADDRESS = "0x5555555555555555555555555555555555555555";
    delete process.env.VERIFICATION_PANEL_ADDRESS;
    delete process.env.VERIFICATION_ARBITRATION_COURT_ADDRESS;
    delete process.env.DISPUTE_RESOLVER_ADDRESS;
    delete process.env.PROTOCOL_ECONOMICS_ADDRESS;
    resetRuntimeConfigForTests();
    expect(() => chainDeploymentAddresses()).toThrow("DISPUTE_RESOLVER_ADDRESS_REQUIRED");

    process.env.DISPUTE_RESOLVER_ADDRESS = "0x6666666666666666666666666666666666666666";
    resetRuntimeConfigForTests();
    expect(() => chainDeploymentAddresses()).toThrow("VERIFICATION_PANEL_ADDRESS_REQUIRED");

    process.env.VERIFICATION_PANEL_ADDRESS = "0x7777777777777777777777777777777777777777";
    resetRuntimeConfigForTests();
    expect(() => chainDeploymentAddresses()).toThrow("VERIFICATION_ARBITRATION_COURT_ADDRESS_REQUIRED");

    process.env.VERIFICATION_ARBITRATION_COURT_ADDRESS = "0x8888888888888888888888888888888888888888";
    resetRuntimeConfigForTests();
    expect(() => chainDeploymentAddresses()).toThrow("PROTOCOL_ECONOMICS_ADDRESS_REQUIRED");

    process.env.PROTOCOL_ECONOMICS_ADDRESS = "0x9999999999999999999999999999999999999999";
    resetRuntimeConfigForTests();
    expect(chainDeploymentAddresses().disputeResolver).toBe(process.env.DISPUTE_RESOLVER_ADDRESS);
  });

  it("loads core production values from read-only files without copying them into process.env", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "agentgrid-env-test-"));
    folders.push(folder);
    const values: Record<string, string> = {
      DATABASE_URL: "postgresql://agentgrid:secret@database.internal:5432/agentgrid",
      S3_ACCESS_KEY: "production-storage-access",
      S3_SECRET_KEY: "production-storage-secret",
      ARTIFACT_MASTER_KEY: "77".repeat(32),
      ADMIN_API_KEY: "production-admin-api-key-at-least-32-characters",
      ALERT_WEBHOOK_SECRET: "production-alert-secret-at-least-32-characters",
      AUTH_SECRET: "production-session-secret-at-least-32-characters",
    };
    process.env.PROTOCOL_MODE = "production";
    process.env.AUTH_ORIGIN = "https://agentgrid.example";
    process.env.REQUIRE_FILE_SECRETS = "true";
    for (const [name, value] of Object.entries(values)) {
      const filename = path.join(folder, name.toLowerCase());
      writeFileSync(filename, `${value}\n`, { mode: 0o400 });
      chmodSync(filename, 0o400);
      process.env[`${name}_FILE`] = filename;
      delete process.env[name];
    }
    resetRuntimeConfigForTests();
    const config = runtimeConfig();
    expect(config.DATABASE_URL).toBe(values.DATABASE_URL);
    expect(config.ARTIFACT_MASTER_KEY).toBe(values.ARTIFACT_MASTER_KEY);
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.AUTH_SECRET).toBeUndefined();
  });
});
