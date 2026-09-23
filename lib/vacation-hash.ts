// 제출 원문 지문 — 서버 전용(crypto). lib/vacation.ts 는 관리자 화면에서도 쓰여 여기로 뗐다.
import { createHash } from "crypto";
import type { SubmissionSnapshot } from "./vacation";

/** 무결성 점검용 지문 — 법적 효력·위변조 방지 보증이 아니다 */
export function snapshotHash(s: SubmissionSnapshot): string {
  return createHash("sha256").update(canonicalJson(s)).digest("hex");
}

export function canonicalJson(v: any): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

