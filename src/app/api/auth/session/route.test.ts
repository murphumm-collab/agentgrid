import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ readWalletSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ readWalletSession: auth.readWalletSession }));

import { GET } from "./route";

describe("wallet session route and machine contract", () => {
  beforeEach(() => auth.readWalletSession.mockReset());

  it("returns an exact private nullable projection without requiring an existing session", async () => {
    auth.readWalletSession.mockResolvedValueOnce(null);
    const loggedOut = await GET();
    expect(loggedOut.status).toBe(200);
    await expect(loggedOut.json()).resolves.toEqual({ session: null });
    expect(loggedOut.headers.get("cache-control")).toBe("private, no-store");
    expect(loggedOut.headers.get("vary")).toBe("Cookie");

    auth.readWalletSession.mockResolvedValueOnce({ address: "0x1111111111111111111111111111111111111111", chainId: 97 });
    await expect((await GET()).json()).resolves.toEqual({
      session: { address: "0x1111111111111111111111111111111111111111", chainId: 97 },
    });
  });

  it("documents required, optional and absent wallet authentication exactly", () => {
    const openapi = JSON.parse(readFileSync(`${process.cwd()}/public/openapi.json`, "utf8")) as {
      paths: Record<string, Record<string, { security?: Array<Record<string, unknown>>; responses: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> }>>;
    };
    expect(openapi.paths["/api/agents"].post.security).toEqual([{ WalletSession: [] }]);
    expect(openapi.paths["/api/task-spec-assistant"].post.security).toEqual([{ WalletSession: [] }]);
    expect(openapi.paths["/api/auth/session"].get.security).toBeUndefined();
    expect(openapi.paths["/api/auth/logout"].post.security).toBeUndefined();
    expect(openapi.paths["/api/auth/session"].get.responses["200"].content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/WalletSessionResult");
    expect(openapi.paths["/api/auth/logout"].post.responses["200"].content?.["application/json"]?.schema?.$ref)
      .toBe("#/components/schemas/LogoutResult");
  });
});
