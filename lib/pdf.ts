import puppeteer, { type Browser } from "puppeteer-core";
import { existsSync, readdirSync } from "fs";
import { fontFaceCss } from "./fonts";

// 서버리스(Vercel/AWS Lambda) 환경 여부
const onServerless =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.AWS_EXECUTION_ENV;

// 설치된 Chrome/Chromium/Edge 실행 파일 자동 탐색 (로컬/자체서버용)
function resolveChromium(): string | undefined {
  const env = process.env.CHROMIUM_PATH;
  if (env && existsSync(env)) return env;
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const pf = process.env["ProgramFiles"] || "C:/Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)";
  const local = process.env.LOCALAPPDATA || (home ? `${home}/AppData/Local` : "");
  const candidates = [
    // 사전 설치(개발 컨테이너) / playwright 캐시
    ...expandGlob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"),
    ...expandGlob(`${home}/.cache/ms-playwright/chromium-*/chrome-linux/chrome`),
    ...expandGlob(
      `${home}/Library/Caches/ms-playwright/chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium`
    ),
    ...expandGlob(`${local}/ms-playwright/chromium-*/chrome-win/chrome.exe`),
    // 리눅스 패키지
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // Windows
    `${pf}/Google/Chrome/Application/chrome.exe`,
    `${pf86}/Google/Chrome/Application/chrome.exe`,
    `${pf86}/Microsoft/Edge/Application/msedge.exe`,
    `${pf}/Microsoft/Edge/Application/msedge.exe`,
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return undefined;
}

function expandGlob(pattern: string): string[] {
  try {
    const parts = pattern.split("/");
    const starIdx = parts.findIndex((p) => p.includes("*"));
    if (starIdx < 0) return existsSync(pattern) ? [pattern] : [];
    const base = parts.slice(0, starIdx).join("/") || "/";
    const seg = parts[starIdx];
    const rest = parts.slice(starIdx + 1).join("/");
    const re = new RegExp("^" + seg.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$");
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
    return out.sort().reverse();
  } catch {
    return [];
  }
}

interface LaunchOpts {
  executablePath: string;
  args: string[];
  headless: boolean | "shell";
  defaultViewport?: any;
}

async function launchOptions(): Promise<LaunchOpts> {
  const baseArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--font-render-hinting=none",
  ];
  // 1) 서버리스: @sparticuz/chromium 경량 바이너리
  if (onServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return {
      executablePath: await chromium.executablePath(),
      args: [...chromium.args, "--font-render-hinting=none"],
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport,
    };
  }
  // 2) 로컬/자체서버: 설치된 Chrome/Edge/Chromium
  const local = resolveChromium();
  if (local) {
    return { executablePath: local, args: baseArgs, headless: true };
  }
  // 3) 최후 폴백: 크롬이 없는 리눅스에서도 @sparticuz/chromium 사용
  try {
    const chromium = (await import("@sparticuz/chromium")).default;
    return {
      executablePath: await chromium.executablePath(),
      args: [...chromium.args, "--font-render-hinting=none"],
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport,
    };
  } catch {
    throw new Error(
      "PDF 생성을 위한 Chromium 브라우저를 찾을 수 없습니다. " +
        "PC에 Chrome/Edge를 설치하거나, 리눅스는 `sudo apt-get install -y chromium` 후 다시 시도하세요. " +
        "(또는 .env 의 CHROMIUM_PATH 로 실행파일 경로 지정)"
    );
  }
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchOptions()
      .then((opts) =>
        puppeteer.launch({
          executablePath: opts.executablePath,
          args: opts.args,
          headless: opts.headless as any,
          defaultViewport: opts.defaultViewport ?? { width: 1200, height: 1600 },
        })
      )
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  return browserPromise;
}

export interface PdfOptions {
  landscape?: boolean;
  marginMm?: number;
}

/** 완성된 HTML(본문)을 A4 PDF(Buffer)로 렌더링. 한글 폰트 자동 임베드. */
export async function htmlToPdf(bodyHtml: string, opts: PdfOptions = {}): Promise<Buffer> {
  const margin = opts.marginMm ?? 14;
  const html = wrapHtml(bodyHtml);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 60000 });
    await page.evaluate(async () => {
      // @ts-ignore
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    });
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
    return Buffer.from(pdf);
  } finally {
    await page.close();
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
