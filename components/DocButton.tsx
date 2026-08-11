"use client";

import { useState } from "react";
import { openPdfTab, closePdfTab, deliverPdf } from "@/lib/open-pdf";

/**
 * POST 요청으로 PDF를 만들어 새 탭에서 열어주는 버튼.
 *
 * 탭은 **누르는 순간** 연다 — `await` 뒤로 미루면 팝업 차단에 조용히 걸린다.
 * 자세한 이유는 `lib/open-pdf.ts` 머리말에 적어 뒀다.
 */
export default function DocButton({
  endpoint,
  body,
  label,
  className = "btn-outline",
  promptPurpose,
}: {
  endpoint: string;
  body: Record<string, any>;
  label: string;
  className?: string;
  promptPurpose?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  async function run() {
    let payload = body;
    // 용도 입력은 **탭을 열기 전에** 받는다. prompt 는 동기라 제스처가 유지되고,
    // 취소했을 때 빈 탭이 남지 않는다.
    if (promptPurpose) {
      const purpose = window.prompt("증명서 용도를 입력하세요", "제출용");
      if (purpose === null) return;
      payload = { ...body, purpose };
    }

    const win = openPdfTab(label); // ← fetch 보다 먼저
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        closePdfTab(win);
        alert("생성 실패: " + (await res.text()));
        return;
      }
      await deliverPdf(win, res, label);
    } catch (e: any) {
      closePdfTab(win);
      alert("생성 실패: " + (e?.message ?? "네트워크 오류"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className={className} onClick={run} disabled={loading}>
      {loading ? "생성 중…" : label}
    </button>
  );
}
