import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Pool } from "pg";

const exec = promisify(execFile);

type Service = {
  environment?: Record<string, string>;
  secrets?: Array<{ source: string; target: string }>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function secretSources(service: Service) {
  return new Set((service.secrets ?? []).map((item) => item.source));
}

async function main() {
  const authOrigin = process.env.AUTH_ORIGIN ?? "http://127.0.0.1:3000";
  const { stdout } = await exec("docker", ["compose", "--profile", "agents", "--profile", "ops", "-f", "docker-compose.production.yml", "config", "--format", "json"], {
    cwd: process.cwd(), env: { ...process.env, AUTH_ORIGIN: authOrigin, EVALUATOR_AGENT_ID: process.env.EVALUATOR_AGENT_ID ?? "production-evaluator" }, maxBuffer: 4 * 1024 * 1024,
  });
  const config = JSON.parse(stdout) as { services: Record<string, Service>; secrets: Record<string, { external?: boolean }> };
  const forbiddenDirect = [
    "DATABASE_URL", "AUTH_SECRET", "ARTIFACT_MASTER_KEY", "ADMIN_API_KEY", "ALERT_WEBHOOK_SECRET", "TRUSTED_PROXY_SHARED_SECRET",
    "S3_ACCESS_KEY", "S3_SECRET_KEY", "PROTOCOL_OPERATOR_PRIVATE_KEY", "AGENT_API_KEY", "AGENT_WALLET_PRIVATE_KEY",
    "BACKUP_S3_ACCESS_KEY", "BACKUP_S3_SECRET_KEY", "SPEC_ASSISTANT_AI_API_KEY", "DEPLOYER_PRIVATE_KEY", "POSTGRES_PASSWORD", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD",
  ];
  for (const [name, service] of Object.entries(config.services)) {
    for (const key of forbiddenDirect) assert(!(key in (service.environment ?? {})), `PLAINTEXT_SECRET_ENV_${name}_${key}`);
    if (service.environment?.PROTOCOL_MODE === "production") {
      assert(service.environment.REQUIRE_FILE_SECRETS === "true", `FILE_SECRET_POLICY_DISABLED_${name}`);
      assert(service.environment.DATABASE_URL_FILE === "/run/secrets/database_url", `DATABASE_URL_FILE_MISSING_${name}`);
      assert(service.environment.AUTH_SECRET_FILE === "/run/secrets/auth_secret", `AUTH_SECRET_FILE_MISSING_${name}`);
      assert(service.environment.AUTH_ORIGIN === authOrigin, `AUTH_ORIGIN_MISSING_${name}`);
      const sources = secretSources(service);
      assert(sources.has("database_url") && sources.has("auth_secret"), `BASE_SECRET_MOUNTS_MISSING_${name}`);
    }
  }

  const requiredMounts: Record<string, string[]> = {
    web: ["s3_access_key", "s3_secret_key", "artifact_master_key", "admin_api_key", "alert_webhook_secret", "trusted_proxy_shared_secret", "spec_assistant_ai_api_key"],
    monitor: ["alert_webhook_secret"],
    coordinator: ["protocol_operator_private_key"],
    "team-formation": ["protocol_operator_private_key"],
    "evaluation-expiry": ["protocol_operator_private_key"],
    "task-evaluator": ["evaluator_agent_api_key", "evaluator_agent_wallet_private_key"],
    postgres: ["postgres_password"],
    minio: ["s3_access_key", "s3_secret_key"],
    backup: ["backup_s3_access_key", "backup_s3_secret_key"],
  };
  for (const [serviceName, sources] of Object.entries(requiredMounts)) {
    const service = config.services[serviceName];
    assert(service, `SERVICE_MISSING_${serviceName}`);
    const mounted = secretSources(service);
    for (const source of sources) assert(mounted.has(source), `SECRET_MOUNT_MISSING_${serviceName}_${source}`);
  }
  assert(config.services.postgres.environment?.POSTGRES_PASSWORD_FILE === "/run/secrets/postgres_password", "POSTGRES_PASSWORD_FILE_MISSING");
  assert(config.services.minio.environment?.MINIO_ROOT_USER_FILE === "/run/secrets/s3_access_key", "MINIO_ROOT_USER_FILE_MISSING");
  assert(config.services.minio.environment?.MINIO_ROOT_PASSWORD_FILE === "/run/secrets/s3_secret_key", "MINIO_ROOT_PASSWORD_FILE_MISSING");
  assert(config.services.web.environment?.ARTIFACT_MASTER_KEY_FILE === "/run/secrets/artifact_master_key", "ARTIFACT_MASTER_KEY_FILE_MISSING");
  assert(config.services.web.environment?.TRUSTED_PROXY_SHARED_SECRET_FILE === "/run/secrets/trusted_proxy_shared_secret", "TRUSTED_PROXY_SHARED_SECRET_FILE_MISSING");
  assert(config.services.web.environment?.SPEC_ASSISTANT_AI_API_KEY_FILE === "/run/secrets/spec_assistant_ai_api_key", "SPEC_ASSISTANT_AI_API_KEY_FILE_MISSING");
  assert(config.services.monitor.environment?.ALERT_WEBHOOK_SECRET_FILE === "/run/secrets/alert_webhook_secret", "MONITOR_ALERT_SECRET_FILE_MISSING");
  assert(config.services["task-evaluator"].environment?.AGENT_WALLET_PRIVATE_KEY_FILE === "/run/secrets/evaluator_agent_wallet_private_key", "EVALUATOR_WALLET_FILE_MISSING");
  assert(config.services.backup.environment?.BACKUP_S3_ACCESS_KEY_FILE === "/run/secrets/backup_s3_access_key", "BACKUP_S3_ACCESS_KEY_FILE_MISSING");
  assert(config.services.backup.environment?.BACKUP_S3_SECRET_KEY_FILE === "/run/secrets/backup_s3_secret_key", "BACKUP_S3_SECRET_KEY_FILE_MISSING");
  for (const [name, secret] of Object.entries(config.secrets)) assert(secret.external === true, `SECRET_NOT_EXTERNAL_${name}`);

  const baseDatabaseUrl = process.env.SECRET_SMOKE_DATABASE_URL ?? "postgresql://agentgrid:local-agentgrid-password@127.0.0.1:5432/agentgrid";
  const suffix = randomBytes(8).toString("hex");
  const schema = `secret_smoke_${suffix}`;
  const role = `secret_smoke_role_${suffix}`;
  const rolePassword = `runtime-file-backed-db-${randomBytes(24).toString("base64url")}`;
  const admin = new Pool({ connectionString: baseDatabaseUrl, max: 1 });
  const folder = await mkdtemp(path.join(tmpdir(), "agentgrid-runtime-secrets-"));
  const databaseFile = path.join(folder, "database_url");
  const authFile = path.join(folder, "auth_secret");
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${rolePassword}'`);
    await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${role}`);
    const isolated = new URL(baseDatabaseUrl);
    isolated.username = role;
    isolated.password = rolePassword;
    isolated.searchParams.set("options", `-c search_path=${schema}`);
    await writeFile(databaseFile, `${isolated.toString()}\n`, { mode: 0o400 });
    await writeFile(authFile, "runtime-file-backed-auth-secret-at-least-32-characters\n", { mode: 0o400 });
    await Promise.all([chmod(databaseFile, 0o400), chmod(authFile, 0o400)]);
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      PROTOCOL_MODE: "production",
      AUTH_ORIGIN: "http://127.0.0.1:3000",
      REQUIRE_FILE_SECRETS: "true",
      DATABASE_URL_FILE: databaseFile,
      AUTH_SECRET_FILE: authFile,
    };
    delete childEnvironment.DATABASE_URL;
    delete childEnvironment.AUTH_SECRET;
    await exec(process.execPath, [path.join(process.cwd(), "dist-workers", "migrate.js")], {
      cwd: process.cwd(), env: childEnvironment, maxBuffer: 1024 * 1024,
    });
    const migrated = await admin.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema=$1",
      [schema],
    );
    assert(Number(migrated.rows[0]?.count) >= 14, "FILE_SECRET_WORKER_MIGRATION_INCOMPLETE");
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    await rm(folder, { recursive: true, force: true });
  }
  console.log(JSON.stringify({
    composeExpanded: true,
    servicesChecked: Object.keys(config.services).length,
    plaintextSecretEnvironmentRejected: true,
    fileSecretPolicyEnabled: true,
    externalSecrets: Object.keys(config.secrets).length,
    roleSpecificMountsVerified: true,
    bundledWorkerFileSecrets: true,
  }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
