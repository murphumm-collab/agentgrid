import { readFile } from "node:fs/promises";
import { paidCapacityImportSchema } from "../src/lib/paid-capacity-import";
import { importSignedPrioritySchedulingEntitlement } from "../src/lib/paid-capacity-service";

const path = process.argv[2];
if (!path) throw new Error("USAGE: pnpm capacity:import -- /absolute/path/to/signed-capacity.json");
const input = paidCapacityImportSchema.parse(JSON.parse(await readFile(path, "utf8")));
const result = await importSignedPrioritySchedulingEntitlement(input);
process.stdout.write(`${JSON.stringify(result)}\n`);
