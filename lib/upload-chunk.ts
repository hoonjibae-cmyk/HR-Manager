/**
 * **큰 파일을 조각내어 올리기** — 순수 함수(DB·네트워크 무관).
 *
 * 왜 필요한가: **Vercel 서버리스 함수의 요청 본문 상한이 4.5MB** 다. 600dpi 컬러로 스캔한
 * 계약서는 그것을 쉽게 넘고, 넘으면 함수에 닿기도 전에 플랫폼이 잘라 화면에 아무 단서도
 * 남지 않는다. 그래서 **브라우저에서 조각내 여러 번 보내고 서버가 이어 붙인다** —
 * 조각 하나하나는 상한 안쪽이라 몇 MB 짜리든 통과한다.
 *
 * ⚠ **스캔본을 다시 압축해 줄이는 방법은 쓰지 않는다.** 서명·날인된 원본은 분쟁 때 근거가
 * 되는 문서라 앱이 임의로 화질을 낮추면 그건 더 이상 원본이 아니다. 크기는 쪼개서 해결한다.
 */

/**
 * 조각 크기 — **256KiB 의 배수여야 한다.**
 *
 * 구글 드라이브의 resumable 업로드가 마지막 조각을 뺀 모든 조각에 그 규칙을 요구한다.
 * 3MiB = 12 × 256KiB 라 규칙을 지키면서 Vercel 상한(4.5MB) 안쪽에 넉넉히 들어간다.
 */
export const CHUNK_SIZE = 3 * 1024 * 1024;

/** 드라이브 resumable 규칙 — 조각 크기는 이 값의 배수여야 한다 */
export const DRIVE_CHUNK_MULTIPLE = 256 * 1024;

/**
 * 한 파일의 최대 크기.
 *
 * 쪼개 올리므로 플랫폼 상한과는 무관해졌지만 **상한 자체는 남겨 둔다** — 실수로 고른
 * 동영상 한 편이 DB·드라이브에 그대로 들어가면 알아채기 전에 용량을 먹는다.
 * 600dpi 컬러 다장 스캔도 대개 이 안에 든다.
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function chunkCount(size: number): number {
  if (size <= 0) return 0;
  return Math.ceil(size / CHUNK_SIZE);
}

/** `index` 번째 조각의 범위 (end 는 미포함) */
export function chunkRange(index: number, size: number): { start: number; end: number; length: number } {
  const start = Math.min(index * CHUNK_SIZE, size);
  const end = Math.min(start + CHUNK_SIZE, size);
  return { start, end, length: Math.max(0, end - start) };
}

/** 이 조각이 파일의 끝인가 — 서버가 여기서 마무리 처리를 한다 */
export function isLastChunk(start: number, length: number, total: number): boolean {
  return start + length >= total && total > 0;
}

/**
 * 드라이브 resumable 업로드의 `Content-Range` 헤더.
 * 형식은 `bytes 0-3145727/12345678` — 끝 위치는 **포함**이라 1을 뺀다.
 */
export function contentRange(start: number, length: number, total: number): string {
  if (length <= 0) return `bytes */${total}`;
  return `bytes ${start}-${start + length - 1}/${total}`;
}

export interface SizeCheck {
  ok: boolean;
  error?: string;
}

/** 올리기 전에 크기부터 본다 — 40MB 를 다 보내고 나서 거절하면 시간만 버린다 */
export function checkFileSize(size: number, name = ""): SizeCheck {
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "빈 파일입니다." };
  if (size > MAX_FILE_BYTES)
    return {
      ok: false,
      error:
        `${name ? `${name} — ` : ""}파일이 너무 큽니다 (${humanSize(size)} · 최대 ${humanSize(MAX_FILE_BYTES)}). ` +
        `스캔 해상도를 300dpi 로 낮추거나 흑백으로 다시 스캔해 주세요.`,
    };
  return { ok: true };
}

/** 조각이 제자리에 맞는지 — 어긋난 조각을 이어 붙이면 파일이 조용히 깨진다 */
export function checkChunk(
  index: number,
  length: number,
  total: number
): { ok: boolean; error?: string; start?: number } {
  if (!Number.isInteger(index) || index < 0) return { ok: false, error: "조각 번호가 올바르지 않습니다." };
  const { start, length: want } = chunkRange(index, total);
  if (start >= total && total > 0) return { ok: false, error: "조각 번호가 파일 크기를 넘습니다." };
  if (length !== want)
    return { ok: false, error: `조각 크기가 맞지 않습니다 (받은 ${length}B · 예상 ${want}B).` };
  return { ok: true, start };
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 올리는 중 화면에 뜨는 글.
 *
 * 큰 파일은 수십 초가 걸린다 — **진행 상황을 안 보여 주면 멈춘 줄 알고 새로고침**하고,
 * 그러면 올라가던 것이 통째로 날아간다.
 */
export function progressLabel(sentBytes: number, total: number, fileName?: string): string {
  const pct = total > 0 ? Math.min(100, Math.floor((sentBytes / total) * 100)) : 0;
  const head = fileName ? `${fileName} ` : "";
  return `${head}올리는 중… ${pct}% (${humanSize(sentBytes)} / ${humanSize(total)})`;
}
