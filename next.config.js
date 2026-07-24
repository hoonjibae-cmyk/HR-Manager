/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma + playwright-core should stay external to the server bundle
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      "prisma",
      "puppeteer-core",
      "@sparticuz/chromium",
    ],
    instrumentationHook: true,
    // 서버리스 함수 번들에 Chromium 바이너리가 확실히 포함되도록 강제
    outputFileTracingIncludes: {
      "/api/documents/newhire": ["./node_modules/@sparticuz/chromium/**"],
      "/api/documents/contract": ["./node_modules/@sparticuz/chromium/**"],
      "/api/documents/cert": ["./node_modules/@sparticuz/chromium/**"],
      "/api/documents/payslip": ["./node_modules/@sparticuz/chromium/**"],
      "/api/email/send": ["./node_modules/@sparticuz/chromium/**"],
      "/api/cron": ["./node_modules/@sparticuz/chromium/**"],
    },
  },
};

module.exports = nextConfig;
