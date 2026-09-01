import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ createWalletChallenge: vi.fn() }));
const security = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  requestClientKey: vi.fn(() => "trusted-client"),
}));

vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/security", () => security);

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://grid.example/api/auth/nonce", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("wallet challenge request boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    security.enforceRateLimit.mockResolvedValue(undefined);
    auth.createWalletChallenge.mockResolvedValue({ nonce: "00".repeat(16), message: "challenge", chainId: 97 });
  });

  it("accepts only a closed checksummed-shape address request after rate limiting", async () => {
    const address = `0x${"1".repeat(40)}`;
    const response = await POST(request({ address }));
    expect(response.status).toBe(200);
    expect(security.enforceRateLimit).toHaveBeenCalledWith("auth-nonce:trusted-client", 10, 60);
    expect(auth.createWalletChallenge).toHaveBeenCalledWith(address);

    for (const invalid of [{ address, unexpected: true }, { address: 42 }, { address: "0x1234" }]) {
      auth.createWalletChallenge.mockClear();
      const rejected = await POST(request(invalid));
      expect(rejected.status).toBe(400);
      expect(auth.createWalletChallenge).not.toHaveBeenCalled();
    }
  });

  it("binds the nonce failure surface to OpenAPI 0.8.11", () => {
    const openapi = JSON.parse(readFileSync(new URL("../../../../../public/openapi.json", import.meta.url), "utf8")) as {
      info: { version: string };
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    expect(openapi.info.version).toBe("0.8.11");
    expect(Object.keys(openapi.paths["/api/auth/nonce"].post?.responses ?? {}).sort()).toEqual([
      "200", "400", "413", "415", "429", "500",
    ]);
  });
});
