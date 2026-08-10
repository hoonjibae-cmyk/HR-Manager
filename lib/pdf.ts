import puppeteer, { type Browser } from "puppeteer-core";
import { existsSync, readdirSync } from "fs";
import { fontFaceCss, footerFontCss } from "./fonts";
import { countPdfPages, seamLayer, footerTemplate } from "./pdf-seam";

// 서버리스(Vercel/AWS Lambda) 환경 여부
const onServerless =
  !!process.env.VERCEL ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.AWS_EXECUTION_ENV;

// @sparticuz/chromium(123) 은 환경변수에 **문자열 "20.x" 가 들어 있을 때만**
// Amazon Linux 2023 용 NSS 라이브러리(libnss3 등, al2023.tar.br)를 풀고
// LD_LIBRARY_PATH 를 /tmp/al2023/lib 로 잡는다. 없으면 옛 AL2 쪽을 풀어
// chromium 이 libnss3 를 찾지 못하고 죽는다.
//
// Vercel 은 AL2023 위에서 돌면서도 이 변수들을 채워 주지 않으므로 직접 넣는다.
// **여기 적힌 "20.x" 는 런타임 Node 버전이 아니라 라이브러리 묶음을 고르는 스위치**다 —
// Node 24 로 올려도 바탕은 여전히 AL2023 이라 이 값을 그대로 둔다.
// 비어 있을 때만이 아니라 **항상** 넣는 이유: Vercel 이 나중에
// AWS_EXECUTION_ENV=AWS_Lambda_nodejs24.x 를 채우기 시작하면 예전 조건에서는
// 이 줄이 건너뛰어져 AL2 묶음만 풀리고 PDF 가 통째로 죽는다.
if (onServerless && !process.env.AWS_LAMBDA_JS_RUNTIME?.includes("20.x")) {
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
  /**
   * **간인(間印)** — 장이 넘어가는 자리마다 법인 인감을 반씩 걸쳐 찍는다(data URI).
   * 앞장 오른쪽 끝에 도장의 왼쪽 절반, 뒷장 왼쪽 끝에 오른쪽 절반이 찍혀,
   * 두 장을 나란히 놓으면 도장 하나가 이어진다 — 종이를 접어 찍던 그 모양이다.
   * **2장 이상일 때만** 붙으므로 장수를 먼저 세야 한다(아래 2회 렌더).
   */
  seamStamp?: string | null;
  /** 쪽번호 `1 / 3` 을 아래 여백에 찍는다. 1장짜리면 저절로 생략된다 */
  paginate?: boolean;
  /**
   * **각 장 이니셜란** — 아래 여백에 `갑 (서명) ____  을 (서명) ____` 줄을 넣는다.
   * 장마다 서명을 받으면 민사소송법 §358 의 진정성립 추정이 그 장에 직접 붙는다.
   * 쪽번호와 같은 줄에 그려지고, 간인과 마찬가지로 **2장 이상일 때만** 나온다.
   */
  initials?: boolean;
}

/**
 * 완성된 본문 HTML 을 A4 PDF 로 렌더링.
 *
 * 간인·쪽번호를 붙이려면 **장수를 알아야** 하는데 렌더 전에는 알 수 없다.
 * 그래서 먼저 한 번 뽑아 장수를 세고, 2장 이상일 때만 다시 뽑는다. 1장이면 그대로 쓴다.
 */
async function renderPdf(innerBody: string, opts: PdfOptions = {}): Promise<Buffer> {
  return withBrowser((b) => renderDoc(b, innerBody, opts));
}

/**
 * 문서 하나를 뽑는다 (브라우저는 밖에서 받는다).
 *
 * **마지막 장에는 이니셜란을 넣지 않는다** — 그 장에는 이미 양자 서명란이 통째로 있어서
 * 같은 자리에 약식 서명을 또 받을 이유가 없다. 넣고 뺀 두 벌을 뽑아 장별로 골라 붙인다.
 */
async function renderDoc(browser: Browser, innerBody: string, opts: PdfOptions): Promise<Buffer> {
  const wantsCount = !!opts.seamStamp || !!opts.paginate || !!opts.initials;
  if (!wantsCount) return renderOnce(browser, innerBody, opts, 0);

  const first = await renderOnce(browser, innerBody, opts, 0);
  const pages = countPdfPages(first);
  if (pages < 2) return first; // 1장짜리엔 간인도 쪽번호도 이니셜란도 필요 없다

  const marked = await renderOnce(browser, innerBody, opts, pages);
  if (!opts.initials) return marked;

  // 마지막 장만 이니셜란 없는 판으로 갈아 끼운다
  const plainLast = await renderOnce(browser, innerBody, opts, pages, false);
  return pickPages([
    { pdf: marked, pages: range(0, pages - 1) },
    { pdf: plainLast, pages: [pages - 1] },
  ]);
}

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(to - from, 0) }, (_, i) => from + i);

/**
 * 실제 렌더 1회. `pages`>0 이면 그 장수에 맞춰 간인·쪽번호를 얹는다.
 * `withInitials` 로 이 렌더에만 이니셜란을 켜고 끈다 — 마지막 장(서명란이 있는 장)을
 * 빼기 위해 같은 문서를 두 번 뽑아 골라 쓰기 때문이다.
 */
async function renderOnce(
  browser: Browser,
  innerBody: string,
  opts: PdfOptions,
  pages: number,
  withInitials = !!opts.initials
): Promise<Buffer> {
  const margin = opts.marginMm ?? 15;
  const seam = pages > 1 && opts.seamStamp ? seamLayer(pages, opts.seamStamp, margin) : "";
  const html = wrapHtml(seam + innerBody);
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
    const footer = pages > 1 && (!!opts.paginate || withInitials);
    const pdf = await page.pdf({
      format: "A4",
      landscape: !!opts.landscape,
      printBackground: true,
      timeout: 45000,
      displayHeaderFooter: footer,
      headerTemplate: "<span></span>",
      footerTemplate: footer
        ? footerTemplate({ fontCss: footerFontCss(), initials: withInitials })
        : "<span></span>",
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
  }
}

/**
 * 브라우저를 한 번만 띄워 여러 번 렌더한다.
 * 서버리스에서는 렌더마다 새로 띄우면(2~3초씩) 문서 수만큼 곱해져 시간·메모리가 감당이 안 된다.
 */
async function withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  const browser = onServerless ? await launchBrowser() : await getCachedBrowser();
  try {
    return await fn(browser);
  } finally {
    if (onServerless) await browser.close().catch(() => {});
  }
}

/** 단일 문서(본문)를 A4 PDF 로 렌더링. 서명란은 페이지 하단에 자동 정렬. */
export async function htmlToPdf(bodyHtml: string, opts: PdfOptions = {}): Promise<Buffer> {
  return renderPdf(`<section class="doc-page">${bodyHtml}</section>`, opts);
}

/** 여러 문서(HTML 본문)를 페이지 구분하여 하나의 PDF 로 병합 — 조판 옵션은 전체에 공통 적용 */
export async function htmlPagesToPdf(bodies: string[], opts: PdfOptions = {}): Promise<Buffer> {
  return renderPdf(joinBodies(bodies), opts);
}

function joinBodies(bodies: string[]): string {
  return bodies
    .map(
      (b, i) =>
        `<section class="doc-page"${
          i > 0 ? ' style="page-break-before:always"' : ""
        }>${b}</section>`
    )
    .join("\n");
}

/**
 * 문서 묶음 하나 — **한 건의 서류**로 취급되는 단위.
 *
 * 쪽번호·이니셜란·간인은 모두 '한 건의 서류' 안에서만 뜻이 있다. 서로 다른 서류를 한 파일로
 * 묶는다고 해서 통째로 이어 번호를 매기면 안 된다(신규입사 패키지의 12장짜리 `1/12`).
 * 그래서 묶음마다 따로 렌더하고 마지막에 PDF 로 합친다.
 */
export interface DocGroup {
  /** 이 서류의 본문. 보통 1개이고, 본문+별지처럼 한 건으로 묶이는 것만 여러 개다 */
  bodies: string[];
  /** 이 서류에만 적용할 조판. 생략하면 바닥글이 아예 없다(1장짜리 서약서·동의서) */
  opts?: PdfOptions;
}

/**
 * 서류 묶음들을 각각 렌더해 하나의 PDF 로 합친다.
 * 브라우저는 한 번만 띄운다 — 서버리스에서 묶음마다 새로 띄우면 감당이 안 된다.
 */
export async function docGroupsToPdf(groups: DocGroup[]): Promise<Buffer> {
  const live = groups.filter((g) => g.bodies.length);
  if (!live.length) throw new Error("빈 문서 묶음");
  if (live.length === 1) return renderPdf(joinBodies(live[0].bodies), live[0].opts ?? {});

  const parts = await withBrowser(async (b) => {
    const out: Buffer[] = [];
    for (const g of live) out.push(await renderDoc(b, joinBodies(g.bodies), g.opts ?? {}));
    return out;
  });
  return mergePdfs(parts);
}

/* --------------------------- PDF 합치기 --------------------------- */

/** 여러 PDF 를 순서대로 이어 붙인다 */
export async function mergePdfs(parts: Buffer[]): Promise<Buffer> {
  if (parts.length === 1) return parts[0];
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(new Uint8Array(part));
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const pg of pages) out.addPage(pg);
  }
  return Buffer.from(await out.save());
}

/** 여러 PDF 에서 지정한 장(0-based)만 골라 순서대로 이어 붙인다 */
async function pickPages(picks: Array<{ pdf: Buffer; pages: number[] }>): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const { pdf, pages } of picks) {
    if (!pages.length) continue;
    const src = await PDFDocument.load(new Uint8Array(pdf));
    const copied = await out.copyPages(src, pages);
    for (const pg of copied) out.addPage(pg);
  }
  return Buffer.from(await out.save());
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
/* 번호 항목(1. 2. 3.) 아래로 한 단 들어가는 하위 항목(가. 나. 다. / · ). 부모 본문 시작선에
   맞춰 들여쓰고 그 안에서 다시 매달린 들여쓰기를 준다 — 안 그러면 부모와 같은 줄에서 시작해
   몇 번 항목에 딸린 것인지 읽히지 않는다. */
.clause .sub-item{margin-left:36px;text-indent:-16px;}
.agree-line{margin-top:14px;}
/* 서명란은 쪼개지지도, 혼자 다음 장으로 넘어가지도 않게 한다.
   break-before:avoid 가 바로 앞 블록을 함께 끌고 넘어가므로 '서명란만 덩그러니 2페이지' 가 안 된다. */
.doc-foot{margin-top:auto;padding-top:12px;page-break-inside:avoid;break-inside:avoid;page-break-before:avoid;break-before:avoid;}
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
/* 법인 인감 — 앵커가 0×0 이라 줄 높이를 밀지 않는다. 실물 도장처럼 이름 위에 살짝 겹쳐 찍힌다.
   자리를 차지하면 2페이지로 맞춰 둔 계약서가 3페이지로 늘어난다. */
.stamp-anchor{position:relative;display:inline-block;width:0;height:0;vertical-align:baseline;}
.stamp-anchor .stamp-img{position:absolute;left:-3mm;top:0;transform:translateY(-55%);
  width:20mm;height:20mm;object-fit:contain;}
/* 증명서 발급인 블록 — 상호와 대표이사 사이에 걸치게 위로 올린다.
   기본값(-55%)이면 도장이 아래로 흘러 바로 밑의 주소·전화 잔글씨를 덮는다. */
.doc-foot .stamp-anchor .stamp-img{left:1mm;transform:translateY(-78%);}
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
/* 매출 기준 명단(사업소득·매출비율 인센티브) — 7·8열이 회차가 아니라 금액이라 더 넓다.
   8열 제목(「② 사업소득」)이 두 줄로 접히지 않을 만큼은 줘야 한다 */
table.pay.roster.rev th:nth-child(7){width:50px;}
table.pay.roster.rev th:nth-child(8){width:60px;}
table.pay.roster.rev th{white-space:nowrap;}
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
.compact .stamp-anchor .stamp-img{width:17mm;height:17mm;}
/* 간인 — 장 경계마다 도장을 반씩. 절반만 보이게 잘라 두 장을 나란히 놓으면 하나로 이어진다.
   본문 흐름 밖(절대배치)이라 장수를 늘리지 않는다. */
.seam-layer{position:absolute;top:0;left:0;width:0;height:0;}
/* 보이는 폭은 8mm — 종이 가장자리를 접어 찍으면 접힌 자리가 도장의 가운데를 먹으므로
   실제로도 양쪽에 초승달처럼 일부만 남는다. 절반(10mm)을 그대로 얹으면 본문을 그만큼 더 덮는다. */
.seam{position:absolute;display:block;width:8mm;height:20mm;overflow:hidden;}
.seam img{position:absolute;top:0;width:20mm;height:20mm;object-fit:contain;}
.seam-a img{left:0;}      /* 앞장 오른쪽 끝 — 도장의 왼쪽 자락 */
.seam-b{left:0;}          /* 뒷장 왼쪽 끝 */
.seam-b img{left:-12mm;}  /* — 오른쪽 자락 */
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
