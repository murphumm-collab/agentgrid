import { productionReleaseReadinessReport } from "../src/lib/production-release-service";
import { closePostgresForTests } from "../src/lib/store-postgres";

async function run() {
  try {
    const report = await productionReleaseReadinessReport();
    console.log(JSON.stringify(report));
    if (!report.productionReleaseReady) process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : "PRODUCTION_RELEASE_CHECK_FAILED");
    process.exitCode = 1;
  } finally {
    try { await closePostgresForTests(); } catch {
      console.error("PRODUCTION_RELEASE_DATABASE_CLOSE_FAILED");
      process.exitCode = 1;
    }
  }
}

void run();
