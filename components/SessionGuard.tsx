"use client";

import { useEffect, useState } from "react";
import { isSessionApi, isSessionExpiry, sessionExpiredBody } from "@/lib/session-expired";

/**
 * 로그인 만료 안내 — 앱 화면 어디서 버튼을 누르든 401 이 오면 같은 안내를 띄운다.
 *
 * 이미 그려진 화면은 세션이 끊겨도 멀쩡해 보이고 **버튼만 실패**한다. 그때 각 화면이
 * 「업로드 실패: unauthorized」 처럼 원문을 띄워 무엇을 해야 할지 알 수 없었다(2026-11).
 * 버튼마다 따로 고치지 않고, 같은 출처 /api/ 의 401 을 여기 한곳에서 잡는다(lib/session-expired.ts):
 *  - 응답 본문을 알아듣는 문구로 바꿔 넘긴다 — 각 화면의 실패 알림이 그 문구를 그대로 보여 준다.
 *  - 화면 위에 다시 로그인 안내를 띄운다.
 *
 * **로그인 화면으로 강제로 보내지 않는다** — 입력해 둔 값(급여 변동입력 등)이 날아간다. 새 탭에서
 * 다시 로그인하면 쿠키는 탭끼리 함께 쓰므로, 이 화면으로 돌아와 같은 버튼을 다시 누르면 된다.
 * 그 뒤 API 가 401 이 아닌 답을 주면 안내를 거둔다.
 */
export default function SessionGuard() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const original = window.fetch;
    const guarded: typeof window.fetch = async (input, init) => {
      const res = await original(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (isSessionExpiry(url, res.status, window.location.href)) {
        setExpired(true);
        const { body, contentType } = sessionExpiredBody(
          await res.clone().text().catch(() => ""),
          res.headers.get("content-type")
        );
        return new Response(body, { status: 401, statusText: "Unauthorized", headers: { "content-type": contentType } });
      }
      // 다시 로그인한 뒤 같은 화면에서 성공하면 안내를 거둔다
      if (res.ok && isSessionApi(url, window.location.href)) setExpired(false);
      return res;
    };
    window.fetch = guarded;
    return () => {
      if (window.fetch === guarded) window.fetch = original;
    };
  }, []);

  if (!expired) return null;
  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[60] border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm"
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2">
        {/* 최소 폭을 줘야 휴대폰에서 버튼이 아래 줄로 내려간다(아니면 글이 한 뼘 폭으로 세로로 선다) */}
        <div className="min-w-[16rem] flex-1 break-keep">
          <b>로그인이 만료되었습니다.</b> 방금 누른 작업은 처리되지 않았습니다. 새 탭에서 다시 로그인한 뒤
          이 화면으로 돌아와 같은 버튼을 다시 누르세요 — 입력해 둔 값은 그대로 남아 있습니다.
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a className="btn-primary py-1.5 text-xs" href="/login?expired=1" target="_blank" rel="noopener">
            새 탭에서 다시 로그인
          </a>
          <button type="button" className="btn-outline py-1.5 text-xs" onClick={() => setExpired(false)}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
