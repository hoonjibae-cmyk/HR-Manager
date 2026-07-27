"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * 화면 오류 안내.
 * 운영 빌드에서는 보안상 실제 예외 메시지가 전달되지 않으므로(digest 만 옴),
 * 이 프로그램에서 실제로 겪은 원인을 점검 순서대로 보여준다.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] 화면 오류:", error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto py-10">
      <div className="card p-6">
        <h1 className="text-lg font-bold text-slate-800">화면을 표시하지 못했습니다</h1>
        <p className="text-sm text-slate-500 mt-1">
          서버에서 오류가 발생했습니다. 아래 순서로 확인해 주세요.
        </p>

        <ol className="mt-4 space-y-3 text-sm text-slate-700">
          <li>
            <b>1. DB 스키마가 코드보다 오래되지 않았는지</b>
            <p className="text-slate-500 mt-0.5">
              가장 흔한 원인입니다. 코드에 새 항목이 추가됐는데 DB에 반영되지 않으면
              해당 표를 읽는 모든 화면이 실패합니다.
            </p>
            <pre className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mt-1 text-xs overflow-x-auto">
              git pull{"\n"}npx prisma db push
            </pre>
            <p className="text-slate-400 text-xs mt-1">
              실행 후 이 화면을 새로고침하면 됩니다. (재배포 불필요)
            </p>
          </li>
          <li>
            <b>2. 데이터베이스 연결</b>
            <p className="text-slate-500 mt-0.5">
              Supabase 프로젝트가 일시 중지되지 않았는지, <code>DATABASE_URL</code> 이
              유효한지 확인합니다.
            </p>
          </li>
          <li>
            <b>3. 실제 오류 메시지 확인</b>
            <p className="text-slate-500 mt-0.5">
              Vercel → 프로젝트 → <b>Logs</b> 에서 아래 코드로 검색하면 원인이 나옵니다.
            </p>
            {error.digest && (
              <code className="inline-block bg-slate-100 rounded px-2 py-1 mt-1 text-xs">
                {error.digest}
              </code>
            )}
          </li>
        </ol>

        <div className="flex gap-2 mt-6">
          <button className="btn-primary" onClick={reset}>
            다시 시도
          </button>
          <Link href="/dashboard" className="btn-ghost">
            대시보드로
          </Link>
        </div>
      </div>
    </div>
  );
}
