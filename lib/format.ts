// 표시용 포맷 유틸

export function won(n: number | null | undefined): string {
  if (n == null || isNaN(n as number)) return "0";
  return Math.round(n).toLocaleString("ko-KR");
}

export function wonUnit(n: number | null | undefined): string {
  return won(n) + "원";
}

export function ymd(d: Date | string | null | undefined, sep = "."): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${sep}${m}${sep}${day}`;
}

export function ymdKo(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
}

/** 주민번호 마스킹 (뒤 6자리 가림) */
export function maskRRN(rrn: string | null | undefined): string {
  if (!rrn) return "";
  const clean = rrn.replace(/\s/g, "");
  if (clean.length >= 8 && clean.includes("-")) {
    const [a, b] = clean.split("-");
    return `${a}-${b[0]}******`;
  }
  return clean;
}

/** 숫자를 한글 금액으로 (예: 1,234,000 → 일백이십삼만사천) — 간단버전 */
export function wonToKorean(n: number): string {
  if (!n) return "영";
  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const smallUnit = ["", "십", "백", "천"];
  const bigUnit = ["", "만", "억", "조"];
  let result = "";
  let num = Math.floor(Math.abs(n));
  let groupIdx = 0;
  while (num > 0) {
    const group = num % 10000;
    if (group > 0) {
      let groupStr = "";
      let g = group;
      let unitIdx = 0;
      while (g > 0) {
        const d = g % 10;
        if (d > 0) groupStr = digits[d] + smallUnit[unitIdx] + groupStr;
        g = Math.floor(g / 10);
        unitIdx++;
      }
      result = groupStr + bigUnit[groupIdx] + result;
    }
    num = Math.floor(num / 10000);
    groupIdx++;
  }
  return result;
}
