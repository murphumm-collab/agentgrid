import { timingSafeEqual } from "node:crypto";
import { runtimeConfig } from "./env";

export function requireAdmin(request: Request) {
  const configured = runtimeConfig().ADMIN_API_KEY;
  if (!configured) throw new Error("ADMIN_API_KEY_NOT_CONFIGURED");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(configured);
  const candidate = Buffer.from(supplied);
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) throw new Error("ADMIN_AUTHENTICATION_FAILED");
}
