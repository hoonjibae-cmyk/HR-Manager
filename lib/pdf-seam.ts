// 간인(間印)·쪽번호 — PDF 렌더러가 쓰는 순수 계산부 (puppeteer 무관, 테스트 있음)
//
// **간인이란** 계약서가 두 장을 넘어갈 때 장이 바뀌는 자리에 도장을 반씩 걸쳐 찍는 관행이다.
// 종이 가장자리를 접어 그 위에 찍으면 앞장 오른쪽 끝과 뒷장 왼쪽 끝에 도장 자락이 나뉘어 남아,
// 중간 장을 갈아 끼웠는지 알 수 있다. **법으로 정해진 의무는 아니다** —
// 근로기준법 §17 은 서면 명시·교부만 요구하고 간인 규정은 없다.
//
// 여기서는 그 모양만 옮긴다: 앞장 오른쪽 끝에 도장의 왼쪽 자락, 뒷장 왼쪽 끝에 오른쪽 자락.
// **자리를 차지하지 않게 절대배치**하는 것이 핵심이다 — 본문 흐름에 끼워 넣으면
// 2장으로 맞춰 둔 계약서가 3장으로 늘어난다.

/** A4 세로 높이(mm) */
export const A4_H_MM = 297;
/** A4 세로 폭(mm) */
export const A4_W_MM = 210;
/** 간인 도장의 지름(mm) — 본문 인감과 같은 20mm */
export const SEAM_SIZE_MM = 20;
/**
 * 한 장에 보이는 자락의 폭(mm). 접힌 자리가 도장 가운데를 먹으므로 실제로도
 * 절반(10mm)이 아니라 일부만 남는다. 절반을 그대로 얹으면 본문을 그만큼 더 덮는다.
 */
export const SEAM_VISIBLE_MM = 8;
/** 장의 세로 어디에 찍을지 (내용 높이 대비 비율) */
export const SEAM_Y_RATIO = 0.45;

/**
 * PDF 버퍼에서 장수 세기.
 * 못 세면 1 로 본다 — 간인·쪽번호를 붙이지 않는 쪽이 안전하다(없는 장에 찍히는 것보다 낫다).
 */
export function countPdfPages(pdf: Buffer | Uint8Array): number {
  const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  const m = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return m && m.length ? m.length : 1;
}

/**
 * 간인 레이어 HTML — 장 경계마다 앞·뒤 한 쌍.
 * 1장짜리면 빈 문자열(찍을 경계가 없다).
 */
export function seamLayer(pages: number, stamp: string, marginMm: number): string {
  if (pages < 2 || !stamp) return "";
  const pageH = A4_H_MM - marginMm * 2; // 한 장의 내용 높이
  const contentW = A4_W_MM - marginMm * 2; // 한 장의 내용 폭
  const y = pageH * SEAM_Y_RATIO;
  let marks = "";
  for (let k = 0; k < pages - 1; k++) {
    const front = (k * pageH + y).toFixed(2);
    const back = ((k + 1) * pageH + y).toFixed(2);
    marks +=
      `<span class="seam seam-a" style="top:${front}mm;left:${(contentW - SEAM_VISIBLE_MM).toFixed(2)}mm">` +
      `<img src="${stamp}" alt=""/></span>` +
      `<span class="seam seam-b" style="top:${back}mm"><img src="${stamp}" alt=""/></span>`;
  }
  return `<div class="seam-layer">${marks}</div>`;
}

/**
 * 쪽번호 틀 — 아래 여백에 찍는다(본문에 넣으면 마지막 줄과 겹친다).
 * 머리글/바닥글 틀은 본문과 **다른 문서**라 우리 한글 폰트가 없다 → 숫자와 '/' 만 쓴다.
 */
export const FOOTER_TEMPLATE =
  `<div style="width:100%;padding:0 14mm;font-size:7pt;color:#94a3b8;` +
  `font-family:sans-serif;text-align:right;">` +
  `<span class="pageNumber"></span> / <span class="totalPages"></span></div>`;
