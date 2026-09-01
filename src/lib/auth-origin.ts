function loopback(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function validatedAuthOrigin(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error("AUTH_ORIGIN_CREDENTIALS_FORBIDDEN");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("AUTH_ORIGIN_MUST_BE_ORIGIN_ONLY");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname))) {
    throw new Error("AUTH_ORIGIN_HTTPS_REQUIRED");
  }
  return url.origin;
}
