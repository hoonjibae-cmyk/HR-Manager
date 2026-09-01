"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 슬랙 워크스페이스 사용자와 직원 카드를 일괄 연결 */
export default function SlackLinkButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await fetch("/api/slack/link-employees", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return alert("연결 실패: " + (j.error || ""));

    const lines = [
      `슬랙 사용자 ${j.slackUsers}명 조회`,
      `새로 연결: ${j.linkedCount}명${j.linkedCount ? "\n  · " + j.linked.map((l: any) => `${l.name} ← ${l.slackName} (${l.via})`).join("\n  · ") : ""}`,
      `기존 연결 유지: ${j.alreadyLinked}명`,
    ];
    // 슬랙 계정이 삭제돼 연동을 푼 사람 — 조용히 풀면 왜 '미연동' 이 됐는지 모른다
    if (j.unlinked?.length)
      lines.push(
        `연동 해제(슬랙 계정 삭제됨): ${j.unlinked
          .map((u: any) => `${u.name}${u.active ? "" : " (퇴직)"}`)
          .join(", ")}`
      );
    if (!j.emailVisible)
      lines.push(
        "\n⚠️ 슬랙 이메일을 읽지 못했습니다 (users:read.email 권한 미부여).\n이름만으로 매칭했습니다."
      );
    if (j.stillUnlinked?.length)
      lines.push(`\n미연결 직원(${j.stillUnlinked.length}): ${j.stillUnlinked.join(", ")}`);
    if (j.unmatchedSlack?.length)
      lines.push(`매칭 안 된 슬랙 계정: ${j.unmatchedSlack.join(", ")}`);
    alert(lines.join("\n"));
    router.refresh();
  }

  return (
    <button className="btn-outline" onClick={run} disabled={busy}>
      {busy ? "연결 중…" : "슬랙 계정 일괄 연결"}
    </button>
  );
}
