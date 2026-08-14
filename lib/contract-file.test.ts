// 계약서 서명본 스캔 첨부 — 형식·크기 판정과 내려보내기 헤더.
//
// 여기서 틀리면 ① 브라우저가 못 여는 파일이 저장되거나 ② 저장한 형식과 다른 Content-Type 으로
// 나가거나 ③ 한글 파일명이 깨진다. 셋 다 올린 뒤에야 드러난다.

import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  sniffMime,
  checkUpload,
  formatSize,
  extensionOf,
  safeName,
  contentDisposition,
  attachmentSummary,
  fileIcon,
} from "./contract-file";

const bytes = (...xs: number[]) => new Uint8Array(xs);
const pad = (head: number[], len = 16) =>
  new Uint8Array([...head, ...Array(Math.max(0, len - head.length)).fill(0)]);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const PDF = pad(ascii("%PDF-1.7"));
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = pad([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...ascii("ftyp"), ...ascii("heic"), 0, 0, 0, 0]);

describe("형식 판정 — 확장자가 아니라 파일 앞머리로", () => {
  it("PDF · PNG · JPG · WEBP 를 가린다", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPG)).toBe("image/jpeg");
    expect(sniffMime(WEBP)).toBe("image/webp");
  });

  it("모르는 형식은 null", () => {
    expect(sniffMime(pad(ascii("MZ")))).toBeNull(); // 실행 파일
    expect(sniffMime(pad(ascii("PK")))).toBeNull(); // zip/xlsx
  });

  it("너무 짧으면 판정하지 않는다 (앞머리를 못 읽는다)", () => {
    expect(sniffMime(bytes(0x25, 0x50))).toBeNull();
  });

  // 이름만 pdf 로 바꿔 올리면 서버가 application/pdf 로 되돌려주게 된다
  it("**이름을 믿지 않는다** — 확장자가 pdf 여도 내용이 아니면 거절", () => {
    const r = checkUpload(pad(ascii("PK")), "근로계약서.pdf");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("PDF");
  });
});

describe("올릴 수 있는가", () => {
  it("PDF 는 받는다", () => {
    expect(checkUpload(PDF, "계약서.pdf")).toMatchObject({ ok: true, mime: "application/pdf" });
  });

  it("빈 파일은 막는다", () => {
    expect(checkUpload(new Uint8Array(0)).ok).toBe(false);
  });

  // Vercel 서버리스 요청 본문 상한이 4.5MB — 넘으면 앱에 닿지도 못하고 잘린다
  it("4MB 를 넘으면 막고 **어떻게 줄이는지** 알려 준다", () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(ascii("%PDF-1.7"));
    const r = checkUpload(big);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("dpi");
    expect(r.error).toContain("나눠서");
  });

  it("경계값(정확히 4MB)은 통과", () => {
    const at = new Uint8Array(MAX_UPLOAD_BYTES);
    at.set(ascii("%PDF-1.7"));
    expect(checkUpload(at).ok).toBe(true);
  });

  // 아이폰 기본 촬영 형식이라 실제로 자주 올라온다. 그냥 '형식 오류' 로 막으면 방법을 모른다
  it("**HEIC 는 따로 가려내 바꾸는 법을 적는다**", () => {
    const r = checkUpload(HEIC, "IMG_0001.HEIC");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("JPEG");
    expect(r.error).toContain("아이폰");
  });
});

describe("파일 이름", () => {
  it("한글 이름은 그대로 둔다", () => {
    expect(safeName("근로계약서_김지연.pdf", "application/pdf")).toBe("근로계약서_김지연.pdf");
  });

  it("확장자가 없으면 저장한 형식으로 붙인다", () => {
    expect(safeName("스캔본", "application/pdf")).toBe("스캔본.pdf");
    expect(safeName("스캔본", "image/png")).toBe("스캔본.png");
    expect(extensionOf("image/jpeg")).toBe("jpg");
  });

  it("경로 구분자를 지운다", () => {
    expect(safeName("../../etc/passwd", "application/pdf")).not.toContain("/");
  });

  // 이름이 그대로 헤더에 실리므로 줄바꿈이 들어가면 헤더가 쪼개진다
  it("**제어문자를 털어 낸다** — 응답 헤더가 쪼개지지 않게", () => {
    const v = contentDisposition("계약서\r\nX-Evil: 1.pdf", "application/pdf");
    expect(v).not.toContain("\r");
    expect(v).not.toContain("\n");
  });

  it("이름이 비면 기본 이름을 준다", () => {
    expect(safeName("   ", "application/pdf")).toBe("계약서스캔.pdf");
  });
});

describe("내려보내기 헤더", () => {
  it("한글은 filename* (RFC 5987) 로 싣고 ASCII 대체본도 함께 준다", () => {
    const v = contentDisposition("근로계약서.pdf", "application/pdf");
    expect(v).toContain("filename*=UTF-8''");
    expect(v).toContain(encodeURIComponent("근로계약서.pdf"));
    expect(v).toMatch(/filename="[\x20-\x7e]*"/);
  });

  it("기본은 inline(브라우저에서 열기), download 면 attachment", () => {
    expect(contentDisposition("a.pdf", "application/pdf")).toMatch(/^inline;/);
    expect(contentDisposition("a.pdf", "application/pdf", true)).toMatch(/^attachment;/);
  });
});

describe("표시", () => {
  it("크기는 한 자리로", () => {
    expect(formatSize(512)).toBe("512B");
    expect(formatSize(2048)).toBe("2KB");
    expect(formatSize(1536 * 1024)).toBe("1.5MB");
  });

  it("PDF 와 사진을 아이콘으로 가른다", () => {
    expect(fileIcon("application/pdf")).not.toBe(fileIcon("image/png"));
  });

  it("첨부가 없으면 요약도 없다 (빈 줄을 만들지 않는다)", () => {
    expect(attachmentSummary([])).toBeNull();
    expect(attachmentSummary([{ size: 1024 }, { size: 1024 }])).toBe("스캔본 2건 · 2KB");
  });
});
