import { readFile } from "node:fs/promises";
import { signedTaskPromotionImportSchema } from "../src/lib/task-promotion-import";
import { importSignedTaskPromotion } from "../src/lib/service";

const path = process.argv[2];
if (!path) throw new Error("USAGE: pnpm promotion:import -- /absolute/path/to/signed-promotion.json");
const input = signedTaskPromotionImportSchema.parse(JSON.parse(await readFile(path, "utf8")));
const result = await importSignedTaskPromotion(input);
process.stdout.write(`${JSON.stringify(result)}\n`);
