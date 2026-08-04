import { describe, it, expect } from "vitest";
import { countPdfPages, seamLayer, SEAM_VISIBLE_MM, A4_H_MM } from "./pdf-seam";

const STAMP = "data:image/png;base64,iVBORw0KGgo=";
const MARGIN = 15;
const PAGE_H = A4_H_MM - MARGIN * 2; // 267mm

const tops = (html: string) =>
  Array.from(html.matchAll(/top:([\d.]+)mm/g)).map((m) => Number(m[1]));

describe("countPdfPages", () => {
  it("페이지 객체 수를 센다", () => {
    const fake = Buffer.from("<< /Type /Page /X >> << /Type /Page /Y >> << /Type /Pages >>");
    expect(countPdfPages(fake)).toBe(2);
  });
  it("못 세면 1 로 본다 — 없는 장에 간인을 찍는 것보다 안 찍는 쪽이 안전하다", () => {
    expect(countPdfPages(Buffer.from("깨진 파일"))).toBe(1);
  });
});

describe("간인 배치", () => {
  it("1장짜리에는 찍지 않는다 — 넘어갈 장이 없다", () => {
    expect(seamLayer(1, STAMP, MARGIN)).toBe("");
    expect(seamLayer(0, STAMP, MARGIN)).toBe("");
  });

  it("인감이 없으면 아무것도 만들지 않는다", () => {
    expect(seamLayer(3, "", MARGIN)).toBe("");
  });

  it("2장이면 경계 한 곳에 앞·뒤 한 쌍", () => {
    const html = seamLayer(2, STAMP, MARGIN);
    expect((html.match(/class="seam seam-a"/g) ?? []).length).toBe(1);
    expect((html.match(/class="seam seam-b"/g) ?? []).length).toBe(1);
  });

  it("장이 늘면 경계마다 한 쌍씩 (3장 → 2쌍)", () => {
    const html = seamLayer(3, STAMP, MARGIN);
    expect((html.match(/class="seam seam-a"/g) ?? []).length).toBe(2);
    expect((html.match(/class="seam seam-b"/g) ?? []).length).toBe(2);
  });

  it("앞장 자락과 뒷장 자락은 정확히 한 장 높이만큼 떨어져 같은 자리에 온다", () => {
    // 두 장을 겹쳐 접었을 때 자락이 맞물리려면 세로 위치가 같아야 한다
    const [front, back] = tops(seamLayer(2, STAMP, MARGIN));
    expect(back - front).toBeCloseTo(PAGE_H, 1);
  });

  it("3장이면 가운데 장이 앞 경계의 뒷자락과 뒤 경계의 앞자락을 함께 받는다", () => {
    const [f1, b1, f2, b2] = tops(seamLayer(3, STAMP, MARGIN));
    expect(b1).toBeCloseTo(f2, 1); // 둘 다 2장째의 같은 높이
    expect(f1).toBeCloseTo(PAGE_H * 0.45, 1);
    expect(b2).toBeCloseTo(PAGE_H * 2 + PAGE_H * 0.45, 1);
  });

  it("앞장은 오른쪽 끝, 뒷장은 왼쪽 끝 — 접으면 두 자락이 맞물린다", () => {
    const html = seamLayer(2, STAMP, MARGIN);
    const contentW = 210 - MARGIN * 2; // 180mm
    expect(html).toContain(`left:${(contentW - SEAM_VISIBLE_MM).toFixed(2)}mm`);
    // 뒷장은 left 를 지정하지 않고 CSS(.seam-b{left:0})가 왼쪽 끝에 붙인다
    expect(html).toMatch(/class="seam seam-b" style="top:[\d.]+mm">/);
  });

  it("여백이 넓어지면 장 높이가 줄어 위치도 따라 줄어든다", () => {
    const [f] = tops(seamLayer(2, STAMP, 25));
    expect(f).toBeCloseTo((A4_H_MM - 50) * 0.45, 1);
  });

  it("본문 흐름을 밀지 않게 절대배치 레이어로 감싼다", () => {
    expect(seamLayer(2, STAMP, MARGIN)).toMatch(/^<div class="seam-layer">/);
  });
});
