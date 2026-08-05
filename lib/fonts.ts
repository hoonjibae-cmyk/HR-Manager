import { readFileSync } from "fs";
import { join } from "path";

// 한글 폰트(woff2)를 base64 로 임베드하여 어디서 렌더링해도 한글이 정상 출력되도록 함.
let cachedCss: string | null = null;

function b64(file: string): string {
  const p = join(process.cwd(), "assets", "fonts", file);
  return readFileSync(p).toString("base64");
}

// NanumGothic(구글 서브셋)에는 KS 심볼(①~⑳, ㉮~㉱, ㈜, ※, ₩ 등)이 없어
// 서버리스(폴백 폰트 없음)에서 빈칸으로 출력된다. Noto Sans KR 에서 해당
// 구간만 뽑은 초소형 서브셋을 같은 family 이름 + unicode-range 로 덧입힌다.
const SYMBOL_RANGE =
  "U+2460-2487,U+3200-321E,U+3260-327F,U+203B,U+20A9,U+25A0-25CF";

/**
 * 바닥글 전용 @font-face — 굵기 하나(400)만.
 *
 * puppeteer 의 머리글/바닥글 틀은 **본문과 다른 문서**라 본문에 심은 폰트가 닿지 않는다.
 * 서버리스 Chromium 에는 시스템 한글 폰트가 아예 없어(로컬은 우연히 있다) 그냥 두면
 * 바닥글의 한글이 빈칸으로 나간다. 그래서 틀 안에 폰트를 따로 심는다.
 * 본문용(`fontFaceCss`)은 굵은체·심볼까지 1MB 라 바닥글엔 과하다.
 */
let cachedFooterCss: string | null = null;
export function footerFontCss(): string {
  if (cachedFooterCss) return cachedFooterCss;
  cachedFooterCss =
    `@font-face{font-family:'NanumGothic';font-style:normal;font-weight:400;` +
    `src:url(data:font/woff2;base64,${b64("NanumGothic-Regular.woff2")}) format('woff2');}`;
  return cachedFooterCss;
}

/** 문서용 @font-face CSS (base64 임베드). 최초 1회 로드 후 캐시. */
export function fontFaceCss(): string {
  if (cachedCss) return cachedCss;
  // 서버리스 렌더링 속도를 위해 최소 폰트만 임베드 (본문/제목 모두 NanumGothic)
  const faces: Array<[string, number, string, string?]> = [
    ["NanumGothic", 400, "NanumGothic-Regular.woff2"],
    ["NanumGothic", 700, "NanumGothic-Bold.woff2"],
    // 심볼 보강 서브셋 — 반드시 본체 뒤에 선언(같은 범위는 나중 선언이 우선)
    ["NanumGothic", 400, "NotoSymbols-Regular.woff2", SYMBOL_RANGE],
    ["NanumGothic", 700, "NotoSymbols-Bold.woff2", SYMBOL_RANGE],
  ];
  cachedCss = faces
    .map(
      ([family, weight, file, range]) => `@font-face{
  font-family:'${family}';
  font-style:normal;
  font-weight:${weight};
  src:url(data:font/woff2;base64,${b64(file)}) format('woff2');${range ? `\n  unicode-range:${range};` : ""}
}`
    )
    .join("\n");
  return cachedCss;
}
