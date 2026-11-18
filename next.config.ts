import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@electric-sql/pglite',
    'pg',
    'firebase-admin',
    '@google-cloud/firestore',
  ],
  outputFileTracingIncludes: { '/api/*': ['./public/NotoSans-Regular.ttf'] },
  outputFileTracingExcludes: {
    '/*': [
      './avx-crm.json',
      './*service-account*.json',
      './*-firebase-adminsdk-*.json',
      './.secrets/**/*',
      './.env*',
      './.data/**/*',
      './work/**/*',
    ],
  },
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'" +
              (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'") +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
