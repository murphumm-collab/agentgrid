import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const recordedTransactionSchema = z.object({
  hash: hashSchema,
  blockNumber: z.string().regex(/^\d+$/).optional(),
  gasUsed: z.string().regex(/^\d+$/).optional(),
  status: z.enum(["success", "reverted"]).optional(),
  contractAddress: addressSchema.optional(),
}).strict();

export const deploymentRunStateSchema = z.object({
  version: z.literal(1),
  scope: z.literal("bsc-testnet-contract-deployment"),
  runId: z.string().uuid(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
  configurationSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  startBlock: z.string().regex(/^\d+$/).optional(),
  contracts: z.record(z.string(), addressSchema),
  transactions: z.record(z.string(), recordedTransactionSchema),
}).strict();

export type DeploymentRunState = z.infer<typeof deploymentRunStateSchema>;

export function deploymentConfigurationSha256(configuration: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(configuration)).digest("hex")}`;
}

export function deploymentRunStatePath(cwd = process.cwd(), requested = process.env.DEPLOYMENT_RUN_FILE) {
  const root = path.resolve(cwd, "contracts", "deployments");
  const filename = requested ? path.resolve(requested) : path.join(root, "bsc-testnet.pending.json");
  if (!filename.startsWith(`${root}${path.sep}`) || !filename.endsWith(".pending.json")) {
    throw new Error("DEPLOYMENT_RUN_FILE_OUTSIDE_EVIDENCE_DIRECTORY");
  }
  return filename;
}

export function newDeploymentRunState(configurationSha256: string): DeploymentRunState {
  return {
    version: 1,
    scope: "bsc-testnet-contract-deployment",
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    configurationSha256,
    contracts: {},
    transactions: {},
  };
}

export function readDeploymentRunState(filename: string) {
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > 1024 * 1024) throw new Error("DEPLOYMENT_RUN_STATE_SIZE_INVALID");
    if ((stat.mode & 0o077) !== 0) throw new Error("DEPLOYMENT_RUN_STATE_PERMISSIONS_INVALID");
    return deploymentRunStateSchema.parse(JSON.parse(fs.readFileSync(descriptor, "utf8")));
  } finally {
    fs.closeSync(descriptor);
  }
}

export function saveDeploymentRunState(filename: string, state: DeploymentRunState) {
  const parsed = deploymentRunStateSchema.parse(state);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, filename);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
