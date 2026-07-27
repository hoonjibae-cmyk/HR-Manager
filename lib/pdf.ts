import puppeteer, { type Browser } from "puppeteer-core";
import { existsSync, readdirSync } from "fs";
import { fontFaceCss } from "./fonts";

// 서버리스(Vercel/AWS Lambda) 환경 여부
const onServerless =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.AWS_EXECUTION_ENV;

// @sparticuz/chromium 은 AWS_EXECUTION_ENV / AWS_LAMBDA_JS_RUNTIME 에 "20.x" 가
// 있어야만 NSS 라이브러리(libnss3 등, al2023.tar.br)를 추출하고 LD_LIBRARY_PATH 를
// /tmp/al2023/lib 로 설정한다. Vercel 은 이 변수를 설정하지 않아 chromium 이
// libnss3 를 찾지 못하므로, @sparticuz/chromium import 이전에 직접 설정한다.
if (
  onServerless &&
  !process.env.AWS_EXECUTION_ENV &&
  !process.env.AWS_LAMBDA_JS_RUNTIME
) {
  process.env.AWS_LAMBDA_JS_RUNTIME = "nodejs20.x";
}

// 서버리스에서는 @sparticuz/chromium(full) 이 NSS 라이브러리(libnss3 등)를 함께
// 번들하고 LD_LIBRARY_PATH 를 설정한다. 패키지 bin 파일은 next.config 의
// outputFileTracingIncludes 로 함수 번들에 포함시킨다.

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
  // 1) 서버리스(Vercel): 번들된 @sparticuz/chromium 사용 (NSS 라이브러리 포함)
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

async function launchBrowser(): Promise<Browser> {
  const opts = await launchOptions();
  return puppeteer.launch({
    executablePath: opts.executablePath,
    args: opts.args,
    headless: opts.headless as any,
    defaultViewport: opts.defaultViewport ?? { width: 1200, height: 1600 },
  });
}

// 비서버리스(로컬/VPS, 상시 프로세스)에서만 브라우저를 캐시·재사용한다.
// 서버리스(Vercel)에서는 컨테이너 freeze/thaw 로 캐시된 브라우저가 죽어 hang 이
// 발생하므로 매 호출마다 새로 띄우고 닫는다.
let browserPromise: Promise<Browser> | null = null;

async function getCachedBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.connected) return b;
    } catch {}
    browserPromise = null;
  }
  browserPromise = launchBrowser().catch((e) => {
    browserPromise = null;
    throw e;
  });
  return browserPromise;
}

export interface PdfOptions {
  landscape?: boolean;
  marginMm?: number;
}

/** 내부 렌더러: 완성된 본문 HTML 을 A4 PDF(Buffer)로 렌더링. */
async function renderPdf(innerBody: string, opts: PdfOptions = {}): Promise<Buffer> {
  const margin = opts.marginMm ?? 15;
  const html = wrapHtml(innerBody);
  const browser = onServerless ? await launchBrowser() : await getCachedBrowser();
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(45000);
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 45000 });
    // 폰트 로드 대기(최대 8초). 소프트웨어 렌더링에서 무한 대기 방지.
    await Promise.race([
      page.evaluate(async () => {
        // @ts-ignore
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
      }),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
    const pdf = await page.pdf({
      format: "A4",
      landscape: !!opts.landscape,
      printBackground: true,
      timeout: 45000,
      margin: {
        top: `${margin}mm`,
        bottom: `${margin}mm`,
        left: `${margin}mm`,
        right: `${margin}mm`,
      },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
    if (onServerless) await browser.close().catch(() => {});
  }
}

/** 단일 문서(본문)를 A4 PDF 로 렌더링. 서명란은 페이지 하단에 자동 정렬. */
export async function htmlToPdf(bodyHtml: string, opts: PdfOptions = {}): Promise<Buffer> {
  return renderPdf(`<section class="doc-page">${bodyHtml}</section>`, opts);
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
  return renderPdf(joined);
}

function wrapHtml(body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<style>
${fontFaceCss()}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;font-family:'NanumGothic',sans-serif;color:#1a1a1a;font-size:10pt;line-height:1.55;}
/* 각 문서를 한 페이지 높이의 세로 flex 로 만들어 서명란을 하단에 정렬 */
.doc-page{display:flex;flex-direction:column;min-height:262mm;}
.doc-body{flex:0 0 auto;}
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
.doc-title{font-weight:800;font-size:19pt;text-align:center;letter-spacing:0.5em;margin:2px 0 4px;padding-right:0.5em;}
.doc-sub{text-align:center;color:#64748b;font-size:9.5pt;margin-bottom:14px;}
.company-head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1f45f5;padding-bottom:6px;margin-bottom:14px;}
.company-head .cbrand{display:flex;align-items:center;gap:10px;}
/* 로고는 높이만 고정하고 가로는 비율대로 — 어떤 png 를 넣어도 머리글이 흐트러지지 않는다 */
.company-head .clogo{height:30px;width:auto;max-width:150px;object-fit:contain;}
.company-head .cname{font-size:15pt;font-weight:800;letter-spacing:-0.01em;}
.company-head .cmeta{font-size:8.5pt;color:#64748b;line-height:1.55;margin-top:2px;}
.company-head .doc-tag{font-size:8.5pt;color:#94a3b8;text-align:right;}
.muted{color:#64748b;}
table.kv{width:100%;border-collapse:collapse;margin:7px 0;}
table.kv th,table.kv td{border:1px solid #cbd5e1;padding:5px 8px;font-size:9.8pt;vertical-align:middle;}
table.kv th{background:#f5f8ff;text-align:center;white-space:nowrap;width:118px;font-weight:700;color:#334155;}
/* 근로시간표: 요일 7열 균등 폭 */
table.kv.sched{table-layout:fixed;}
.clause{margin:8px 0;}
.clause h3{font-size:11pt;margin:11px 0 3px;font-weight:800;color:#1f2d5a;}
.clause p{margin:3px 0;}
.clause .sub{margin-left:15px;text-indent:-15px;}
.agree-line{margin-top:14px;}
.doc-foot{margin-top:auto;padding-top:12px;}
.sign-area{padding-top:2px;page-break-inside:avoid;}
.sign-duo{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
/* 갑/을 박스 등고 정렬 — 그리드 아이템을 세로 flex 로 만들어 박스가 남은 높이를 채움 */
.sign-duo>div{display:flex;flex-direction:column;}
.sign-duo .sign-box{flex:1 1 auto;}
.sign-box{border:1px solid #cbd5e1;border-radius:8px;padding:9px 13px;margin-top:5px;page-break-inside:avoid;}
.sign-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;}
.sign-grid.one{grid-template-columns:1fr;}
.sign-grid .full{grid-column:1 / -1;}
.sign-grid .f{font-size:9.6pt;}
.sign-grid .lbl{color:#64748b;margin-right:6px;}
.sign-grid .fill{border-bottom:1px solid #94a3b8;padding:0 6px;}
.sign-party{font-weight:800;color:#1f2d5a;margin:8px 0 2px;font-size:10pt;}
.sign-row{display:flex;justify-content:space-between;margin:8px 0;}
.seal{color:#c0392b;font-weight:700;}
.date-center{text-align:center;margin:14px 0 6px;font-size:11pt;letter-spacing:0.05em;}
table.pay{width:100%;border-collapse:collapse;margin-top:8px;}
table.pay th,table.pay td{border:1px solid #cbd5e1;padding:6px 9px;font-size:9.6pt;}
table.pay th{background:#f5f8ff;font-weight:700;color:#334155;}
table.pay td.num{text-align:right;font-variant-numeric:tabular-nums;}
table.pay tr.total td{background:#eef4ff;font-weight:800;}
.list-num{margin:5px 0;padding-left:20px;text-indent:-20px;}
.small{font-size:8.8pt;color:#64748b;}
.fill{display:inline-block;border-bottom:1px solid #94a3b8;padding:0 6px;min-height:1em;}
.inline-sign{text-align:right;color:#334155;margin:1px 0 5px;font-size:9.4pt;}
.hosub{margin:3px 0 3px 32px;text-indent:-16px;padding-left:16px;}
.footnote{font-size:8.8pt;color:#475569;margin:2px 0 2px 15px;}
.handover{margin-top:10px;border-top:1px dashed #cbd5e1;padding-top:8px;font-size:9.6pt;page-break-inside:avoid;break-inside:avoid;}
/* 자필 따라쓰기 안내 글씨 — 연한 회색으로 출력해 펜으로 덧쓸 수 있게 함 */
.trace{color:#b1b7c1;font-weight:400;}
.badge{display:inline-block;padding:1px 8px;border:1px solid #1f45f5;border-radius:10px;color:#1f45f5;font-size:9pt;}
/* 인센티브 산정 내역서 — 학생 명단 2단 배치 */
.roster-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;}
table.pay.roster{margin-top:0;table-layout:fixed;}
table.pay.roster th,table.pay.roster td{padding:1.5px 3px;font-size:7.4pt;line-height:1.25;}
table.pay.roster td.c{text-align:center;}
table.pay.roster td.sm{font-size:6.9pt;color:#475569;overflow:hidden;white-space:nowrap;}
table.pay.roster tr.dim td{color:#94a3b8;}
table.pay.roster th:nth-child(1),table.pay.roster th:nth-child(2){width:26px;}
table.pay.roster th:nth-child(5),table.pay.roster th:nth-child(6){width:26px;}
table.pay.roster th:nth-child(7){width:30px;}
table.pay.roster th:nth-child(8){width:52px;}
/* 연결된 조항+서명줄 등이 페이지 경계에서 분리되지 않도록 묶음 처리 */
.avoid{page-break-inside:avoid;break-inside:avoid;}
.clause h3{page-break-after:avoid;break-after:avoid;}
table.kv{page-break-inside:avoid;break-inside:avoid;}
/* 계약서 전용 축소 레이아웃 — 본문 밀도를 높여 2페이지 이내로 구성 */
.doc-page > .compact{display:flex;flex-direction:column;flex:1 0 auto;}
.compact{font-size:8.8pt;line-height:1.42;}
.compact .doc-title{font-size:14.5pt;margin:0 0 2px;}
.compact .doc-sub{font-size:8.6pt;margin-bottom:8px;}
.compact .company-head{margin-bottom:8px;padding-bottom:4px;}
.compact .company-head .clogo{height:24px;max-width:120px;}
.compact .company-head .cname{font-size:12.5pt;}
.compact .company-head .cmeta{font-size:8pt;line-height:1.45;}
.compact .clause{margin:4px 0;}
.compact .clause h3{font-size:9.6pt;margin:7px 0 2px;}
/* 주의: margin 쇼트핸드 금지 — .clause .sub 의 margin-left(내어쓰기)를 덮어써
   첫 글자가 페이지 밖으로 클리핑된다. 상하 마진만 지정할 것. */
.compact .clause p{margin-top:1.5px;margin-bottom:1.5px;}
.compact table.kv{margin:4px 0;}
.compact table.kv th,.compact table.kv td{padding:2.5px 6px;font-size:8.4pt;}
.compact table.kv th{width:92px;}
.compact .inline-sign{font-size:8.4pt;margin:0 0 2px;}
.compact .hosub{margin:1.5px 0 1.5px 28px;}
.compact .footnote{font-size:7.9pt;margin:1px 0 1px 13px;}
.compact .muted{font-size:8.2pt;}
.compact .date-center{margin:8px 0 4px;font-size:9.5pt;}
.compact .doc-foot{padding-top:6px;}
.compact .sign-duo{gap:8px;}
.compact .sign-box{padding:6px 11px;margin-top:3px;}
.compact .sign-grid{gap:3px 14px;}
.compact .sign-grid .f{font-size:8.4pt;}
.compact .sign-party{margin:4px 0 1px;font-size:8.8pt;}
.compact .handover{margin-top:7px;padding-top:5px;font-size:8.6pt;}
.compact .small{font-size:7.8pt;}
`;
