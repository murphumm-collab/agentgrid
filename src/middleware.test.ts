import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const previous = process.env.PUBLIC_SHOWCASE_MODE;

afterEach(() => {
  if (previous === undefined) delete process.env.PUBLIC_SHOWCASE_MODE;
  else process.env.PUBLIC_SHOWCASE_MODE = previous;
});

describe("public showcase middleware", () => {
  it("blocks API writes while preserving read requests and locale switching", () => {
    process.env.PUBLIC_SHOWCASE_MODE = "true";
    const denied = middleware(new NextRequest("https://preview.example/api/tasks", { method: "POST" }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("x-agentgrid-showcase")).toBe("read-only");
    expect(denied.headers.get("cache-control")).toBe("no-store");

    const readable = middleware(new NextRequest("https://preview.example/api/tasks", { method: "GET" }));
    expect(readable.status).toBe(200);
    expect(readable.headers.get("x-agentgrid-showcase")).toBe("read-only");

    const locale = middleware(new NextRequest("https://preview.example/api/locale", { method: "POST" }));
    expect(locale.status).toBe(200);
  });

  it("does not block normal-mode API writes", () => {
    delete process.env.PUBLIC_SHOWCASE_MODE;
    expect(middleware(new NextRequest("https://app.example/api/tasks", { method: "POST" })).status).toBe(200);
  });
});
