// 큰 파일 조각내 올리기 — 경계 계산.
//
// 여기서 한 칸이 어긋나면 이어 붙인 파일이 **조용히 깨진다**. 열어 보기 전에는 모른다.

import { describe, it, expect } from "vitest";
import {
  CHUNK_SIZE,
  DRIVE_CHUNK_MULTIPLE,
  MAX_FILE_BYTES,
  chunkCount,
  chunkRange,
  isLastChunk,
  contentRange,
  checkFileSize,
  checkChunk,
  humanSize,
  progressLabel,
} from "./upload-chunk";

describe("조각 크기", () => {
  // 드라이브 resumable 은 마지막을 뺀 모든 조각이 256KiB 의 배수이길 요구한다
  it("**256KiB 의 배수여야 한다** — 드라이브가 그렇게 요구한다", () => {
    expect(CHUNK_SIZE % DRIVE_CHUNK_MULTIPLE).toBe(0);
  });

  it("Vercel 요청 본문 상한(4.5MB) 안쪽이다", () => {
    expect(CHUNK_SIZE).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe("조각 나누기", () => {
  it("딱 떨어지지 않는 크기도 마지막 조각으로 담는다", () => {
    const size = CHUNK_SIZE * 2 + 100;
    expect(chunkCount(size)).toBe(3);
    expect(chunkRange(2, size)).toEqual({ start: CHUNK_SIZE * 2, end: size, length: 100 });
  });

  it("딱 떨어지면 조각이 하나 더 생기지 않는다", () => {
    expect(chunkCount(CHUNK_SIZE * 2)).toBe(2);
    expect(chunkRange(1, CHUNK_SIZE * 2).end).toBe(CHUNK_SIZE * 2);
  });

  it("작은 파일은 조각 하나", () => {
    expect(chunkCount(1000)).toBe(1);
    expect(chunkRange(0, 1000)).toEqual({ start: 0, end: 1000, length: 1000 });
  });

  it("빈 파일은 조각이 없다", () => {
    expect(chunkCount(0)).toBe(0);
  });

  it("마지막 조각을 알아본다 — 서버가 여기서 마무리한다", () => {
    const size = CHUNK_SIZE * 2 + 100;
    expect(isLastChunk(0, CHUNK_SIZE, size)).toBe(false);
    expect(isLastChunk(CHUNK_SIZE, CHUNK_SIZE, size)).toBe(false);
    expect(isLastChunk(CHUNK_SIZE * 2, 100, size)).toBe(true);
    // 조각 하나짜리 파일도 그 하나가 마지막이다
    expect(isLastChunk(0, 500, 500)).toBe(true);
  });
});

describe("Content-Range — 드라이브에 넘길 값", () => {
  // 끝 위치가 **포함**이라 1을 빼야 한다. 안 빼면 구글이 조각을 겹쳐 받아 파일이 늘어난다
  it("끝 위치는 포함이라 1을 뺀다", () => {
    expect(contentRange(0, CHUNK_SIZE, 10_000_000)).toBe(`bytes 0-${CHUNK_SIZE - 1}/10000000`);
    expect(contentRange(CHUNK_SIZE, 100, CHUNK_SIZE + 100)).toBe(
      `bytes ${CHUNK_SIZE}-${CHUNK_SIZE + 99}/${CHUNK_SIZE + 100}`
    );
  });

  it("한 바이트짜리도 맞는다", () => {
    expect(contentRange(5, 1, 6)).toBe("bytes 5-5/6");
  });
});

describe("크기 검사", () => {
  it("빈 파일은 막는다", () => {
    expect(checkFileSize(0).ok).toBe(false);
  });

  it("상한 안이면 통과 (경계값 포함)", () => {
    expect(checkFileSize(MAX_FILE_BYTES).ok).toBe(true);
    expect(checkFileSize(20 * 1024 * 1024).ok).toBe(true);
  });

  it("넘으면 **어떻게 줄이는지**까지 적는다", () => {
    const r = checkFileSize(MAX_FILE_BYTES + 1, "계약서.pdf");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("계약서.pdf");
    expect(r.error).toContain("dpi");
  });

  it("4.5MB 짜리는 이제 통과한다 — 쪼개서 올리므로", () => {
    expect(checkFileSize(4.5 * 1024 * 1024).ok).toBe(true);
    expect(checkFileSize(30 * 1024 * 1024).ok).toBe(true);
  });
});

describe("조각 검사 — 어긋난 조각을 이어 붙이지 않는다", () => {
  const size = CHUNK_SIZE * 2 + 100;

  it("제자리 조각은 시작 위치를 돌려준다", () => {
    expect(checkChunk(1, CHUNK_SIZE, size)).toEqual({ ok: true, start: CHUNK_SIZE });
  });

  it("크기가 다르면 거절한다", () => {
    const r = checkChunk(0, CHUNK_SIZE - 1, size);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("조각 크기");
  });

  it("범위를 넘는 번호는 거절한다", () => {
    expect(checkChunk(3, 100, size).ok).toBe(false);
    expect(checkChunk(-1, 100, size).ok).toBe(false);
  });

  it("마지막 조각은 짧아도 맞다", () => {
    expect(checkChunk(2, 100, size).ok).toBe(true);
  });
});

describe("표시", () => {
  it("크기를 사람이 읽게", () => {
    expect(humanSize(512)).toBe("512B");
    expect(humanSize(2048)).toBe("2KB");
    expect(humanSize(1536 * 1024)).toBe("1.5MB");
  });

  // 수십 초 걸리는 업로드에 진행 표시가 없으면 멈춘 줄 알고 새로고침한다
  it("진행률을 퍼센트와 용량으로 함께 적는다", () => {
    const s = progressLabel(5 * 1024 * 1024, 20 * 1024 * 1024, "계약서.pdf");
    expect(s).toContain("계약서.pdf");
    expect(s).toContain("25%");
    expect(s).toContain("20.0MB");
  });

  it("100% 를 넘지 않는다", () => {
    expect(progressLabel(999, 100)).toContain("100%");
  });
});
