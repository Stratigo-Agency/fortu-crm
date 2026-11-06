// Security headers for every response (next.config.ts). Kept in a plain module so a test can read them.
//
// The Content-Security-Policy has no nonce on purpose: the app uses Cache Components (partial prerendering), and
// Next.js says a nonce needs every page rendered per request ("Partial Prerendering is incompatible with
// nonce-based CSP", docs/01-app/02-guides/content-security-policy.md). So scripts and styles may be inline, and
// everything else is locked down: only our own origin loads scripts, fonts, images and connections, nothing can
// frame the app, no plugins, no <base> tricks, and forms post to us (or to Google, for "Masuk dengan Google").

export type Header = { key: string; value: string };

const GOOGLE_SIGN_IN = "https://accounts.google.com";

export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    // Next.js puts inline scripts in the page (flight data, bootstrap). React needs eval only in development.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'", // Inter is self-hosted by next/font
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Chrome also applies form-action to the redirect that follows a form post, and sign-in redirects to Google.
    `form-action 'self' ${GOOGLE_SIGN_IN}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders({ dev, production }: { dev: boolean; production: boolean }): Header[] {
  const headers: Header[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) },
    { key: "X-Frame-Options", value: "DENY" }, // older browsers; frame-ancestors covers the rest
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()",
    },
  ];
  // Browsers ignore HSTS on plain http, so it is safe to send from a production build run on localhost.
  if (production) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  return headers;
}
