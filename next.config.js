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
    // @sparticuz/chromium 의 bin(브라우저 + NSS 라이브러리 tar)을 함수 번들에 포함.
    // **PDF 를 실제로 뽑는 라우트만** 적는다 — 아래 excludes 와 짝이다.
    outputFileTracingIncludes: {
      "/api/documents/newhire": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/documents/contract": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/documents/cert": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/documents/payslip": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/email/send": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/email/schedule-run": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/cron": ["./node_modules/@sparticuz/chromium/bin/**"],
    },
    /**
     * **PDF 를 뽑지 않는데 크로미움을 지고 다니던 라우트에서 bin 을 뺀다.**
     *
     * 이 라우트들은 `lib/scheduler`·`lib/email` 을 **다른 용도로** import 한다
     * (`computeNextRun`, `sendTestEmail`, `runHrNotices` …). 그 import 하나 때문에
     * 추적기가 puppeteer → @sparticuz/chromium 까지 따라가 **60MB 짜리 브라우저 압축본이
     * 함수마다 한 벌씩** 딸려 들어갔다. 5개 라우트 × 60MB = 빌드마다 300MB 를 복사·업로드한 셈이고,
     * 그만큼 `Collecting build traces` 단계가 길어져 Build CPU 로 청구됐다.
     *
     * ⚠ **여기에 라우트를 더할 때는 그 라우트가 PDF 를 부르지 않는지 코드로 확인할 것.**
     * 잘못 빼면 번들에 브라우저가 없어 **배포 후 실제로 발급을 눌러야** 드러난다
     * (빌드는 통과한다). 판단 기준은 `lib/pdf.ts` 의 `htmlToPdf`·`docGroupsToPdf` 에
     * 실행 경로가 닿는가이지, import 문이 있는가가 아니다.
     *
     * ⚠ **`bin/**` 만 뺀다** — 패키지째 빼면 모듈 해석이 깨질 여지가 있다. 덩치는 전부 bin 에 있다.
     */
    outputFileTracingExcludes: {
      "/settings": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/settings": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/settings/notify": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/email/preview": ["./node_modules/@sparticuz/chromium/bin/**"],
      "/api/email/test": ["./node_modules/@sparticuz/chromium/bin/**"],
    },
  },
};

module.exports = nextConfig;
