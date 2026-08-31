import { runBackup } from "./backup";

const intervalSeconds = Number(process.env.BACKUP_INTERVAL_SECONDS ?? 86_400);
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 3_600) throw new Error("BACKUP_INTERVAL_SECONDS_MUST_BE_AT_LEAST_3600");
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main() {
  while (!stopping) {
    try { await runBackup(); } catch (error) { console.error(error instanceof Error ? error.message : error); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1_000));
  }
}
void main();
