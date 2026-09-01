import { NextRequest, NextResponse } from "next/server";

function isLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

function isSameOriginDemoBrowserWrite(request: NextRequest, origin: string) {
  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host")?.trim() || requestUrl.host;
    const target = new URL(`${requestUrl.protocol}//${host}`);
    const browser = new URL(origin);
    return isLoopbackHost(target.hostname) && isLoopbackHost(browser.hostname) && browser.origin === target.origin;
  } catch {
    return false;
  }
}

function policy(nonce: string) {
  const scripts = process.env.NODE_ENV === "development"
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src https://verify.walletconnect.com https://verify.walletconnect.org",
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const showcase = process.env.PUBLIC_SHOWCASE_MODE === "true";
  const requestHost = request.headers.get("host")?.trim() || request.nextUrl.host;
  let demoHostIsLoopback = false;
  try { demoHostIsLoopback = isLoopbackHost(new URL(`${request.nextUrl.protocol}//${requestHost}`).hostname); }
  catch { /* Invalid Host values are rejected below. */ }
  if (process.env.PROTOCOL_MODE !== "production" && !showcase && !demoHostIsLoopback) {
    return NextResponse.json({ error: "INVALID_DEMO_HOST" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const origin = request.headers.get("origin");
  if (process.env.PROTOCOL_MODE !== "production" && isApi && isWrite
    && origin && !isSameOriginDemoBrowserWrite(request, origin)) {
    return NextResponse.json({ error: "INVALID_REQUEST_ORIGIN" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (showcase && isApi && isWrite && request.nextUrl.pathname !== "/api/locale") {
    return NextResponse.json({ error: "PUBLIC_SHOWCASE_READ_ONLY" }, {
      status: 403,
      headers: { "Cache-Control": "no-store", "X-AgentGrid-Showcase": "read-only", "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  const nonce = btoa(crypto.randomUUID());
  const contentSecurityPolicy = policy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  // Every API response is non-cacheable by default. The deliberately public,
  // projection-only API namespace owns its explicit short-lived cache policy in
  // each route. This keeps nonces, API keys, signed URLs and authenticated data
  // out of browser, proxy and CDN caches even when a route forgets a header.
  if (isApi && !request.nextUrl.pathname.startsWith("/api/public/")) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }
  if (showcase) {
    response.headers.set("X-AgentGrid-Showcase", "read-only");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
