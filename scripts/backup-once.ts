import { runBackup } from "./backup";

void runBackup().catch((error) => {
  console.error(error instanceof Error ? error.message : "BACKUP_FAILED");
  process.exitCode = 1;
});
