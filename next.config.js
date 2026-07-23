/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma + playwright-core should stay external to the server bundle
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "prisma", "playwright-core"],
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
