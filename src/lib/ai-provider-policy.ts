export function approvedAiBaseUrl(rawUrl: string, productionQueue: boolean, configuredOrigins?: string) {
  const destination = new URL(rawUrl);
  if (destination.username || destination.password) throw new Error("AI_BASE_URL_CREDENTIALS_FORBIDDEN");
  const local = destination.hostname === "localhost" || destination.hostname === "127.0.0.1" || destination.hostname === "::1";
  if (destination.protocol !== "https:" && !(local && destination.protocol === "http:")) throw new Error("AI_BASE_URL_HTTPS_REQUIRED");
  if (productionQueue) {
    const allowed = new Set((configuredOrigins ?? "").split(",").map((value) => value.trim()).filter(Boolean).map((value) => new URL(value).origin));
    if (!allowed.size) throw new Error("AI_ALLOWED_ORIGINS_REQUIRED");
    if (!allowed.has(destination.origin)) throw new Error("AI_PROVIDER_ORIGIN_NOT_ALLOWED");
  }
  return destination.toString().replace(/\/$/, "");
}
