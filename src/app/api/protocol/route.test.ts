import { afterEach, describe, expect, it } from "vitest";
import { resetRuntimeConfigForTests } from "@/lib/env";
import { GET } from "./route";

const previousMode = process.env.PROTOCOL_MODE;
const previousAdminKey = process.env.ADMIN_API_KEY;

afterEach(() => {
  if (previousMode === undefined) delete process.env.PROTOCOL_MODE;
  else process.env.PROTOCOL_MODE = previousMode;
  if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = previousAdminKey;
  resetRuntimeConfigForTests();
});

describe("internal protocol snapshot route", () => {
  it("requires Admin authentication even in Demo mode", async () => {
    process.env.PROTOCOL_MODE = "demo";
    process.env.ADMIN_API_KEY = "demo-admin-key-at-least-32-characters";
    resetRuntimeConfigForTests();
    const response = await GET(new Request("http://127.0.0.1:3000/api/protocol"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "ADMIN_AUTHENTICATION_FAILED" });
  });
});
