import { emptyDatabase } from "../src/lib/store";
import { closePostgresForTests, migratePostgres } from "../src/lib/store-postgres";
import { runtimeConfig } from "../src/lib/env";

async function main() {
  if (runtimeConfig().PROTOCOL_MODE !== "production") throw new Error("Set PROTOCOL_MODE=production before running migrations");
  await migratePostgres(emptyDatabase());
  console.log("AgentGrid PostgreSQL schema is ready.");
  await closePostgresForTests();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
