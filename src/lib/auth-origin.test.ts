import { describe, expect, it } from "vitest";
import { validatedAuthOrigin } from "./auth-origin";

describe("authentication origin", () => {
  it("normalizes an HTTPS origin and explicit loopback smoke origins", () => {
    expect(validatedAuthOrigin("https://agentgrid.example/")).toBe("https://agentgrid.example");
    expect(validatedAuthOrigin("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  });

  it("rejects remote cleartext, credentials, paths, queries and fragments", () => {
    for (const value of [
      "http://agentgrid.example", "https://user:secret@agentgrid.example",
      "https://agentgrid.example/app", "https://agentgrid.example/?tenant=1",
      "https://agentgrid.example/#login",
    ]) expect(() => validatedAuthOrigin(value)).toThrow();
  });
});
