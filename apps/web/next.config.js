/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Forward /api/* to the backend, so the browser can talk to one origin.
  // Needed for phones on the local network (docs/scanner.md): the phone
  // opens https://<your-mac-ip>:3000 and every API call goes through here,
  // instead of trying to reach "localhost:4000" — which on a phone is the
  // phone itself. Only used when NEXT_PUBLIC_API_URL is set to empty.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${process.env.BACKEND_URL ?? 'http://localhost:4000'}/api/:path*` },
    ];
  },
};

module.exports = nextConfig;
