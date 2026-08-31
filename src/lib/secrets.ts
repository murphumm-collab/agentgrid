import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export const runtimeSecretNames = [
  "DATABASE_URL",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "ARTIFACT_MASTER_KEY",
  "ARTIFACT_PREVIOUS_MASTER_KEYS",
  "ADMIN_API_KEY",
  "ALERT_WEBHOOK_SECRET",
  "TRUSTED_PROXY_SHARED_SECRET",
  "AUTH_SECRET",
] as const;

export const productionBaselineFileSecrets = [
  "DATABASE_URL",
  "AUTH_SECRET",
] as const;

export const productionReadyFileSecrets = [
  "DATABASE_URL",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "ARTIFACT_MASTER_KEY",
  "ADMIN_API_KEY",
  "ALERT_WEBHOOK_SECRET",
  "AUTH_SECRET",
] as const;

type Environment = Record<string, string | undefined>;

function configured(environment: Environment, name: string) {
  const direct = environment[name]?.trim() ? environment[name] : undefined;
  const file = environment[`${name}_FILE`]?.trim() ? environment[`${name}_FILE`]!.trim() : undefined;
  if (direct && file) throw new Error(`${name}_SECRET_SOURCE_CONFLICT`);
  return { direct, file };
}

function readSecretFile(name: string, filename: string) {
  if (!path.isAbsolute(filename)) throw new Error(`${name}_SECRET_FILE_MUST_BE_ABSOLUTE`);
  const stat = statSync(filename);
  if (!stat.isFile()) throw new Error(`${name}_SECRET_FILE_NOT_REGULAR`);
  if (stat.size < 1 || stat.size > 64 * 1024) throw new Error(`${name}_SECRET_FILE_SIZE_INVALID`);
  if ((stat.mode & 0o022) !== 0) throw new Error(`${name}_SECRET_FILE_WRITABLE_BY_OTHERS`);
  const raw = readFileSync(filename, "utf8");
  if (raw.includes("\0")) throw new Error(`${name}_SECRET_FILE_CONTAINS_NUL`);
  const value = raw.replace(/\r?\n$/, "");
  if (!value) throw new Error(`${name}_SECRET_FILE_EMPTY`);
  return value;
}

export function configuredSecret(name: string, environment: Environment = process.env) {
  const source = configured(environment, name);
  if (source.file) return { value: readSecretFile(name, source.file), source: "file" as const, file: source.file };
  if (source.direct) return { value: source.direct, source: "environment" as const };
  return { value: undefined, source: "missing" as const };
}

export function requiredSecret(name: string, environment: Environment = process.env) {
  const secret = configuredSecret(name, environment);
  if (!secret.value) throw new Error(`${name}_REQUIRED`);
  if (environment.REQUIRE_FILE_SECRETS === "true" && secret.source !== "file") throw new Error(`${name}_FILE_REQUIRED`);
  return secret.value;
}

export function requiredConfigValue(name: string, environment: Environment = process.env) {
  const value = configuredSecret(name, environment).value;
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

export function resolvedRuntimeSecretEnvironment(environment: Environment = process.env) {
  return Object.fromEntries(runtimeSecretNames.flatMap((name) => {
    const secret = configuredSecret(name, environment);
    return secret.value ? [[name, secret.value]] : [];
  }));
}

function placeholder(value: string) {
  return /(?:replace|change[-_ ]?me|local-agentgrid|example-secret|not-for-production)/i.test(value);
}

export function enforceProductionFileSecrets(
  environment: Environment = process.env,
  requiredNames: readonly string[] = productionBaselineFileSecrets,
) {
  for (const name of requiredNames) {
    const secret = configuredSecret(name, environment);
    if (!secret.value || secret.source !== "file") throw new Error(`${name}_FILE_REQUIRED`);
    if (placeholder(secret.value)) throw new Error(`${name}_PLACEHOLDER_FORBIDDEN`);
  }
  for (const name of runtimeSecretNames) {
    const secret = configuredSecret(name, environment);
    if (!secret.value) continue;
    if (secret.source !== "file") throw new Error(`${name}_FILE_REQUIRED`);
    if (placeholder(secret.value)) throw new Error(`${name}_PLACEHOLDER_FORBIDDEN`);
  }
  return true;
}
