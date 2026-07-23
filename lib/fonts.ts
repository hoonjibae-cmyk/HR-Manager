import { readFileSync } from "fs";
import { join } from "path";

// 한글 폰트(woff2)를 base64 로 임베드하여 어디서 렌더링해도 한글이 정상 출력되도록 함.
let cachedCss: string | null = null;

function b64(file: string): string {
  const p = join(process.cwd(), "assets", "fonts", file);
  return readFileSync(p).toString("base64");
}

/** 문서용 @font-face CSS (base64 임베드). 최초 1회 로드 후 캐시. */
export function fontFaceCss(): string {
  if (cachedCss) return cachedCss;
  const faces = [
    ["NanumGothic", 400, "NanumGothic-Regular.woff2"],
    ["NanumGothic", 700, "NanumGothic-Bold.woff2"],
    ["NanumGothic", 800, "NanumGothic-ExtraBold.woff2"],
    ["NanumMyeongjo", 400, "NanumMyeongjo-Regular.woff2"],
    ["NanumMyeongjo", 700, "NanumMyeongjo-Bold.woff2"],
  ] as const;
  cachedCss = faces
    .map(
      ([family, weight, file]) => `@font-face{
  font-family:'${family}';
  font-style:normal;
  font-weight:${weight};
  src:url(data:font/woff2;base64,${b64(file)}) format('woff2');
}`
    )
    .join("\n");
  return cachedCss;
}
