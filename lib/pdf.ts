import { chromium, type Browser } from "playwright-core";
import { existsSync } from "fs";
import { fontFaceCss } from "./fonts";

// Chromium 실행 파일 자동 탐색
function resolveChromium(): string | undefined {
  const env = process.env.CHROMIUM_PATH;
  if (env && existsSync(env)) return env;
  const candidates = [
    // 이 환경(사전 설치)
    ...expandGlob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"),
    ...expandGlob("/opt/pw-browsers/chromium-*/chrome-linux/headless_shell"),
    // 일반적인 리눅스 경로
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return undefined; // playwright 기본값 사용 시도
}

function expandGlob(pattern: string): string[] {
  // 간단한 * 글롭 (동기)
  try {
    const parts = pattern.split("/");
    const starIdx = parts.findIndex((p) => p.includes("*"));
    if (starIdx < 0) return existsSync(pattern) ? [pattern] : [];
    const base = parts.slice(0, starIdx).join("/") || "/";
    const seg = parts[starIdx];
    const rest = parts.slice(starIdx + 1).join("/");
    const re = new RegExp("^" + seg.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$");
    const { readdirSync } = require("fs") as typeof import("fs");
    let entries: string[] = [];
    try {
      entries = readdirSync(base);
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      if (re.test(e)) {
        const full = base + "/" + e + (rest ? "/" + rest : "");
        if (existsSync(full)) out.push(full);
      }
    }
    return out.sort().reverse(); // 최신 버전 우선
  } catch {
    return [];
  }
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = resolveChromium();
    browserPromise = chromium.launch({
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
      ],
    });
  }
  return browserPromise;
}

export interface PdfOptions {
  landscape?: boolean;
  marginMm?: number;
  headerFooter?: boolean;
}

/**
 * 완성된 HTML(본문)을 A4 PDF(Buffer)로 렌더링.
 * 한글 폰트는 자동 임베드된다.
 */
export async function htmlToPdf(
  bodyHtml: string,
  opts: PdfOptions = {}
): Promise<Buffer> {
  const margin = opts.marginMm ?? 14;
  const html = wrapHtml(bodyHtml);
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    // 폰트 로드 보장
    await page.evaluate(() => (document as any).fonts?.ready);
    const pdf = await page.pdf({
      format: "A4",
      landscape: !!opts.landscape,
      printBackground: true,
      margin: {
        top: `${margin}mm`,
        bottom: `${margin}mm`,
        left: `${margin}mm`,
        right: `${margin}mm`,
      },
    });
    return pdf;
  } finally {
    await page.close();
    await context.close();
  }
}

/** 여러 문서(HTML 본문)를 페이지 구분하여 하나의 PDF 로 병합 */
export async function htmlPagesToPdf(bodies: string[]): Promise<Buffer> {
  const joined = bodies
    .map(
      (b, i) =>
        `<section class="doc-page"${
          i > 0 ? ' style="page-break-before:always"' : ""
        }>${b}</section>`
    )
    .join("\n");
  return htmlToPdf(joined);
}

function wrapHtml(body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<style>
${fontFaceCss()}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;font-family:'NanumGothic',sans-serif;color:#111;font-size:10.5pt;line-height:1.5;}
.doc-page{padding:0;}
h1,h2,h3{font-family:'NanumGothic',sans-serif;}
${DOC_CSS}
</style></head><body>${body}</body></html>`;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

// 문서 공통 스타일
export const DOC_CSS = `
.doc-title{font-family:'NanumMyeongjo',serif;font-weight:700;font-size:22pt;text-align:center;letter-spacing:0.4em;margin:6px 0 18px;}
.doc-sub{text-align:center;color:#444;margin-bottom:16px;}
.company-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1f45f5;padding-bottom:8px;margin-bottom:14px;}
.company-head .cname{font-size:14pt;font-weight:800;}
.muted{color:#666;}
table.kv{width:100%;border-collapse:collapse;margin:8px 0;}
table.kv th,table.kv td{border:1px solid #999;padding:6px 8px;font-size:10pt;vertical-align:middle;}
table.kv th{background:#f1f5ff;text-align:center;white-space:nowrap;width:120px;font-weight:700;}
.clause{margin:10px 0;}
.clause h3{font-size:11pt;margin:12px 0 4px;font-weight:700;}
.clause p{margin:3px 0;}
.clause .sub{margin-left:14px;text-indent:-14px;}
.sign-area{margin-top:26px;}
.sign-row{display:flex;justify-content:space-between;margin:8px 0;}
.sign-line{border-bottom:1px solid #333;min-width:160px;display:inline-block;}
.seal{color:#c0392b;font-weight:700;}
.date-center{text-align:center;margin:22px 0;font-size:11pt;}
table.pay{width:100%;border-collapse:collapse;margin-top:8px;}
table.pay th,table.pay td{border:1px solid #999;padding:5px 8px;font-size:9.5pt;}
table.pay th{background:#f1f5ff;font-weight:700;}
table.pay td.num{text-align:right;font-variant-numeric:tabular-nums;}
table.pay tr.total td{background:#eef4ff;font-weight:800;}
.list-num{margin:4px 0;padding-left:20px;text-indent:-20px;}
.small{font-size:9pt;color:#555;}
.badge{display:inline-block;padding:1px 8px;border:1px solid #1f45f5;border-radius:10px;color:#1f45f5;font-size:9pt;}
`;
