import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { verifyLocalBackup } from "./backup-restore";

it("rejects truncated, corrupted, writable and symlinked backup dumps before restore", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "backup-fault-"));
  const dump = path.join(root, "postgres.dump");
  const bytes = Buffer.alloc(2048, 42);
  try {
    await writeFile(dump, bytes, { mode: 0o600 });
    await writeFile(path.join(root, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), postgres: { file: "postgres.dump", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } }), { mode: 0o600 });
    await expect(verifyLocalBackup(root)).resolves.toHaveProperty("dumpPath", dump);
    await writeFile(dump, bytes.subarray(0, 1024));
    await expect(verifyLocalBackup(root)).rejects.toThrow("BACKUP_SIZE_MISMATCH");
    await writeFile(dump, Buffer.alloc(2048, 43));
    await expect(verifyLocalBackup(root)).rejects.toThrow("BACKUP_CHECKSUM_MISMATCH");
    await writeFile(dump, bytes);
    await chmod(dump, 0o666);
    await expect(verifyLocalBackup(root)).rejects.toThrow("BACKUP_DUMP_WRITABLE_BY_OTHERS");
    await rm(dump);
    await writeFile(path.join(root, "other.dump"), bytes, { mode: 0o600 });
    await symlink(path.join(root, "other.dump"), dump);
    await expect(verifyLocalBackup(root)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
