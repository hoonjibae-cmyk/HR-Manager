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
    // @sparticuz/chromium 의 bin(브라우저 + NSS 라이브러리 tar)을 함수 번들에 포함
    outputFileTracingIncludes: {
      "/api/documents/newhire": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/documents/contract": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/documents/cert": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/documents/payslip": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/email/send": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/cron": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/debug/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
    },
  },
};

module.exports = nextConfig;
