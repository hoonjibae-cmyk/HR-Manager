/**
 * **계약서 서명본 스캔 첨부** — 순수 함수(DB·네트워크 무관).
 *
 * 시스템이 만드는 계약서(`genContract`)와 **다른 물건**이다. 그쪽은 지금 조건으로 새로 뽑는
 * 서식이고, 이쪽은 실제로 **서명·날인해 주고받은 원본**이라 분쟁이 생겼을 때 증거가 되는 파일이다.
 * 조건을 나중에 고치면 발급본은 따라 바뀌지만 스캔본은 그대로여야 한다 — 그래서 따로 담는다.
 *
 * 파일을 **DB 에 담는 이유**: 서버리스에는 쓸 수 있는 파일 경로가 없다(로고·인감과 같은 사정).
 * 다만 로고·인감처럼 data URI 문자열로 넣지 않고 **bytea(Bytes)** 로 넣는다 — base64 는 덩치가
 * 1/3 늘고, 스캔본은 장당 수백 KB 라 그 차이가 그대로 DB 용량이 된다.
 */

/**
 * 한 파일의 최대 크기.
 *
 * ⚠ **Vercel 서버리스 함수의 요청 본문 상한이 4.5MB** 라 그보다 크면 앱에 닿지도 못하고
 * 플랫폼이 잘라 버린다(무슨 일이 났는지 화면에 안 남는다). 그래서 **우리가 먼저 막고**
 * 무엇을 하면 되는지 적어 준다. 넉넉히 4MB 로 둔다.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** 받아 주는 형식 — 브라우저가 그대로 열어 볼 수 있는 것만 */
export const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];

export interface UploadCheck {
  ok: boolean;
  /** 실제로 저장할 형식 — **확장자가 아니라 파일 앞머리로 가린 것** */
  mime?: AllowedMime;
  error?: string;
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  sig.every((v, i) => b[at + i] === v);

/** ASCII 문자열이 그 위치에 있는가 */
const hasAscii = (b: Uint8Array, s: string, at: number) =>
  startsWith(b, [...s].map((c) => c.charCodeAt(0)), at);

/**
 * **파일 앞머리(매직 넘버)로 형식을 가린다** — 확장자·브라우저가 보낸 Content-Type 을 믿지 않는다.
 *
 * 서버가 저장한 형식 그대로 `Content-Type` 을 붙여 돌려주므로, 확장자만 보고 받아 두면
 * 엉뚱한 파일을 브라우저에 `application/pdf` 라고 건네주게 된다. 앞머리는 위조가 가능하지만,
 * 적어도 **실수로 잘못 올린 파일**은 여기서 걸린다.
 */
export function sniffMime(bytes: Uint8Array): AllowedMime | "heic" | null {
  if (bytes.length < 12) return null;
  if (hasAscii(bytes, "%PDF-", 0)) return "application/pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasAscii(bytes, "RIFF", 0) && hasAscii(bytes, "WEBP", 8)) return "image/webp";
  // 아이폰 기본 촬영 형식 — 브라우저가 못 여는 곳이 많아 따로 가려내 안내한다
  if (hasAscii(bytes, "ftyp", 4) && (hasAscii(bytes, "heic", 8) || hasAscii(bytes, "heif", 8)))
    return "heic";
  return null;
}

/**
 * 올려도 되는 파일인가.
 *
 * **거절할 때는 무엇을 하면 되는지 함께 적는다** — "형식이 올바르지 않습니다" 만 뜨면
 * 담당자가 할 수 있는 일이 없다. 스캔본은 사무기기에서 나오는 파일이라
 * 형식·크기를 바꾸는 방법을 모르는 쪽이 보통이다.
 */
export function checkUpload(bytes: Uint8Array, name = ""): UploadCheck {
  if (!bytes.length) return { ok: false, error: "빈 파일입니다." };
  if (bytes.length > MAX_UPLOAD_BYTES)
    return {
      ok: false,
      error:
        `파일이 너무 큽니다 (${formatSize(bytes.length)} · 최대 ${formatSize(MAX_UPLOAD_BYTES)}). ` +
        `스캔 해상도를 200~300dpi 로 낮추거나 흑백으로 다시 스캔하면 대개 줄어듭니다. ` +
        `여러 장이면 나눠서 올려도 됩니다.`,
    };

  const kind = sniffMime(bytes);
  if (kind === "heic")
    return {
      ok: false,
      error:
        "HEIC 사진은 브라우저에서 열리지 않는 곳이 많아 받지 않습니다. " +
        "아이폰이라면 사진 앱에서 내보낼 때 JPEG 를 고르거나, 파일 앱에서 PDF 로 만들어 올려 주세요.",
    };
  if (!kind)
    return {
      ok: false,
      error: `PDF · JPG · PNG · WEBP 만 올릴 수 있습니다${name ? ` (${name})` : ""}.`,
    };
  return { ok: true, mime: kind };
}

/** 사람이 읽는 크기 — 표에 나란히 서므로 자릿수를 한 자리로 맞춘다 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 목록 아이콘 — PDF 와 사진을 눈으로 가른다 */
export function fileIcon(mime: string): string {
  return mime === "application/pdf" ? "📄" : "🖼";
}

export function isPdf(mime: string): boolean {
  return mime === "application/pdf";
}

/** 저장한 형식에 맞는 확장자 — 올린 이름이 엉뚱해도 내려받을 때는 맞게 붙는다 */
export function extensionOf(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

/**
 * 저장할 파일 이름.
 *
 * 경로 구분자와 제어문자를 털어 낸다 — 이름이 그대로 `Content-Disposition` 에 실리므로
 * 줄바꿈이 들어가면 헤더가 쪼개진다(응답 헤더 주입). 한글은 그대로 둔다(그쪽이 읽기 좋고,
 * 내보낼 때 RFC 5987 로 감싼다).
 */
export function safeName(raw: string, mime: string): string {
  const base = String(raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]/g, "_")
    .trim()
    .slice(0, 120);
  if (!base) return `계약서스캔.${extensionOf(mime)}`;
  return /\.[A-Za-z0-9]{1,5}$/.test(base) ? base : `${base}.${extensionOf(mime)}`;
}

/**
 * `Content-Disposition` 헤더 값.
 *
 * 한글 이름은 ASCII 로 못 적으므로 **`filename*` (RFC 5987)** 으로 싣고, 못 읽는 옛
 * 브라우저를 위해 ASCII 로 눌러쓴 `filename` 도 함께 준다. 둘 중 하나만 두면
 * 이름이 깨지거나(앞) 아예 안 붙는다(뒤).
 */
export function contentDisposition(name: string, mime: string, download = false): string {
  const safe = safeName(name, mime);
  const ascii = safe.replace(/[^\u0020-\u007e]/g, "_").replace(/"/g, "'");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

/** 첨부 요약 한 줄 — 카드에 "스캔본 2건 · 1.4MB" 로 적는다 */
export function attachmentSummary(files: Array<{ size: number }>): string | null {
  if (!files.length) return null;
  const total = files.reduce((a, f) => a + f.size, 0);
  return `스캔본 ${files.length}건 · ${formatSize(total)}`;
}
