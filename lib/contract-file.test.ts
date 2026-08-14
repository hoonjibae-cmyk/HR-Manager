// 계약서 서명본 스캔 첨부 — 형식 판정과 내려보내기 헤더.
// (크기 상한·조각 나누기는 upload-chunk.test.ts)
//
// 여기서 틀리면 ① 브라우저가 못 여는 파일이 저장되거나 ② 저장한 형식과 다른 Content-Type 으로
// 나가거나 ③ 한글 파일명이 깨진다. 셋 다 올린 뒤에야 드러난다.

import { describe, it, expect } from "vitest";
import {
  sniffMime,
  checkFormat,
  isViewable,
  UNKNOWN_MIME,
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
  it("**이름을 믿지 않는다** — 확장자가 pdf 여도 내용이 아니면 pdf 로 담지 않는다", () => {
    const r = checkFormat(pad(ascii("PK")), "근로계약서.pdf");
    expect(r.ok).toBe(false);
    expect(r.mime).toBeUndefined();
  });
});

describe("화면에서 열 수 있는 형식인가 (크기는 upload-chunk.ts 담당)", () => {
  it("PDF 는 열 수 있다", () => {
    expect(checkFormat(PDF, "계약서.pdf")).toMatchObject({ ok: true, mime: "application/pdf" });
  });

  it("빈 파일은 막는다", () => {
    expect(checkFormat(new Uint8Array(0)).ok).toBe(false);
  });

  /*
   * ⚠ **못 가려도 거절하지 않는다.** 인사서류는 hwp·docx 처럼 앞머리로 못 가리는 형식이
   * 흔하고, 담당자가 가진 파일이 그것뿐일 수 있다. 저장은 하되 열 때 내려받게 한다.
   */
  it("**모르는 형식도 거절하지 않는다** — 저장은 하고 내려받게 한다", () => {
    const r = checkFormat(pad(ascii("PK")), "동의서.docx");
    expect(r.ok).toBe(false); // '화면에서 못 연다' 는 뜻이지 '못 올린다' 가 아니다
    expect(r.error).toContain("내려받아");
  });

  it("HEIC 도 같은 취급 — 브라우저가 못 여니 내려받기로", () => {
    expect(checkFormat(HEIC, "IMG_0001.HEIC").ok).toBe(false);
  });

  it("inline 으로 내보낼 형식만 isViewable 이 참", () => {
    expect(isViewable("application/pdf")).toBe(true);
    expect(isViewable("image/png")).toBe(true);
    expect(isViewable(UNKNOWN_MIME)).toBe(false);
    expect(isViewable("text/html")).toBe(false);
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
    expect(safeName("   ", "application/pdf")).toBe("첨부파일.pdf");
  });

  // 모르는 형식에 확장자를 지어내면 hwp 가 .jpg 로 저장된다
  it("**모르는 형식은 확장자를 지어내지 않는다**", () => {
    expect(safeName("동의서.hwp", UNKNOWN_MIME)).toBe("동의서.hwp");
    expect(safeName("확장자없음", UNKNOWN_MIME)).toBe("확장자없음");
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

  it("PDF·사진·그 밖의 문서를 아이콘으로 가른다", () => {
    expect(fileIcon("application/pdf")).not.toBe(fileIcon("image/png"));
    expect(fileIcon(UNKNOWN_MIME)).not.toBe(fileIcon("application/pdf"));
  });

  it("첨부가 없으면 요약도 없다 (빈 줄을 만들지 않는다)", () => {
    expect(attachmentSummary([])).toBeNull();
    expect(attachmentSummary([{ size: 1024 }, { size: 1024 }])).toBe("2건 · 2KB");
  });
});
