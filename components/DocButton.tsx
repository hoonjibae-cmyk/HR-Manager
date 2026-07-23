"use client";

import { useState } from "react";

/** POST 요청으로 PDF를 생성하고 새 탭에서 열어주는 버튼 */
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
    setLoading(true);
    try {
      let payload = body;
      if (promptPurpose) {
        const purpose = window.prompt("증명서 용도를 입력하세요", "제출용");
        if (purpose === null) {
          setLoading(false);
          return;
        }
        payload = { ...body, purpose };
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        alert("생성 실패: " + (await res.text()));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
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
