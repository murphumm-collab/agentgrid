import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

export async function writeNewEvidenceFile(filename: string, value: unknown, errorPrefix = "EVIDENCE") {
  const output = path.resolve(filename);
  const parent = await fs.lstat(path.dirname(output));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`${errorPrefix}_DIRECTORY_INVALID`);
  const handle = await fs.open(output, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
  finally { await handle.close(); }
  return output;
}
