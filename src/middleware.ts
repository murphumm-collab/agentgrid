import { NextRequest, NextResponse } from "next/server";

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
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const isWrite = !["GET", "HEAD", "OPTIONS"].includes(request.method);
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
