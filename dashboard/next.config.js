/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native Node.js module used by lib/db.ts.
  // It must not be bundled by webpack — tell Next.js to treat it as external.
  // Note: 'serverComponentsExternalPackages' was renamed to 'serverExternalPackages'
  // in Next.js 14.1. Both are supported in 14.2.x but this uses the non-deprecated form.
  serverExternalPackages: ['better-sqlite3'],
  // Suppress build warnings for packages that declare they are server-only
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ensure better-sqlite3 is not bundled
      config.externals = [...(config.externals || []), 'better-sqlite3']
    }
    return config
  },
}

module.exports = nextConfig
