import { pilotQualificationReport } from "../src/lib/pilot-qualification-service";
import { closePostgresForTests } from "../src/lib/store-postgres";

async function main() {
  const report = await pilotQualificationReport();
  console.log(JSON.stringify(report));
  if (!report.launchEvidenceReady) process.exitCode = 2;
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : "PILOT_QUALIFICATION_CHECK_FAILED");
    process.exitCode = 1;
  } finally {
    try { await closePostgresForTests(); } catch {
      console.error("PILOT_QUALIFICATION_DATABASE_CLOSE_FAILED");
      process.exitCode = 1;
    }
  }
}

void run();
