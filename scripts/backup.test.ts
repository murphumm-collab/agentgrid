import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { directPgDumpConnection, dockerPgDumpDatabase, writeBackupManifestAtomic } from "./backup";

describe("direct PostgreSQL backup connection", () => {
  it("removes the password from the process argument while preserving connection options", () => {
    const result = directPgDumpConnection("postgresql://agentgrid:p%40ssword@db.internal:5432/agentgrid?sslmode=require");
    expect(result).toEqual({
      databaseUrl: "postgresql://agentgrid@db.internal:5432/agentgrid?sslmode=require",
      password: "p@ssword",
    });
    expect(result.databaseUrl).not.toContain("p%40ssword");
  });

  it("rejects a non-PostgreSQL URL", () => {
    expect(() => directPgDumpConnection("https://example.com/database")).toThrow("DATABASE_URL_PROTOCOL_INVALID");
  });
});

describe("Docker PostgreSQL backup target", () => {
  it("allows only a narrowly scoped AgentGrid database name", () => {
    expect(dockerPgDumpDatabase("agentgrid_backup_adoption_20260831")).toBe("agentgrid_backup_adoption_20260831");
    expect(() => dockerPgDumpDatabase("postgres")).toThrow("BACKUP_POSTGRES_DATABASE_INVALID");
    expect(() => dockerPgDumpDatabase("agentgrid;DROP DATABASE agentgrid")).toThrow("BACKUP_POSTGRES_DATABASE_INVALID");
  });
});

describe("backup manifest commit", () => {
  it("atomically replaces the owner-only manifest after verification", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "agentgrid-backup-manifest-"));
    try {
      const filename = path.join(folder, "manifest.json");
      await writeFile(filename, "old", { mode: 0o600 });
      const manifest = {
        createdAt: "2026-08-31T00:00:00.000Z",
        postgres: { file: "postgres.dump", bytes: 2048, sha256: "1".repeat(64) },
      };
      await writeBackupManifestAtomic(folder, manifest);
      expect(JSON.parse(await readFile(filename, "utf8"))).toEqual(manifest);
      expect((await stat(filename)).mode & 0o777).toBe(0o600);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
