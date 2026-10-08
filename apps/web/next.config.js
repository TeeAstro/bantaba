// Security review (Phase 21b): headers on every page. The page may talk
// to itself and to the API (NEXT_PUBLIC_API_URL), load Google Fonts, and
// show images from the API or the image bucket (any https). It can't be
// put inside another site's frame (clickjacking). Next.js needs inline
// scripts to start the page (and eval while developing).
const api = process.env.NEXT_PUBLIC_API_URL || '';
const dev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src 'self' data: blob: https:${api ? ` ${api}` : ''}${dev ? ' http:' : ''}`,
  `connect-src 'self'${api ? ` ${api}` : ''}${dev ? ' ws: http://localhost:4000' : ''}`,
  "media-src 'self' blob:",
  // Phase 26: the small map showing where a venue is pinned.
  "frame-src https://www.openstreetmap.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The scanner needs the camera; hosts pinning a venue ("I'm there now")
  // need the location (Phase 26); nothing needs the microphone.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
  ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The Docker image (Dockerfile) runs a small standalone server.
  ...(process.env.BUILD_STANDALONE ? { output: 'standalone' } : {}),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Forward /api/* to the backend, so the browser can talk to one origin.
  // Needed for phones on the local network (docs/scanner.md): the phone
  // opens https://<your-mac-ip>:3000 and every API call goes through here,
  // instead of trying to reach "localhost:4000" — which on a phone is the
  // phone itself. Only used when NEXT_PUBLIC_API_URL is set to empty.
  async rewrites() {
    // Not used on the live site (the pages call NEXT_PUBLIC_API_URL).
    if (!dev && !process.env.BACKEND_URL) return [];
    return [
      { source: '/api/:path*', destination: `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/api/:path*` },
    ];
  },
};

module.exports = nextConfig;
