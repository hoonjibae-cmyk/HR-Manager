"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm({
  logo,
  version,
  commit,
}: {
  logo: string | null;
  /** 서버에서 구한 `versionLabel()` — 클라이언트에서 부르면 하이드레이션이 어긋난다(lib/version.ts) */
  version: string;
  commit?: string | null;
}) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setErr("비밀번호가 올바르지 않습니다.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="text-center mb-6">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-12 w-auto max-w-[200px] object-contain mx-auto mb-3" />
          ) : null}
          <div className="text-2xl font-extrabold text-brand-700">유쌤에듀 HR</div>
          <div className="text-sm text-slate-400 mt-1">인사·급여·연차 관리 프로그램</div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">관리자 비밀번호</label>
            <input
              type="password"
              className="input"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="비밀번호"
              autoFocus
            />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? "확인 중…" : "로그인"}
          </button>
        </form>
        <p className="text-[11px] text-slate-400 mt-6 text-center">
          기본 비밀번호는 <code>.env</code>의 ADMIN_PASSWORD 입니다.
        </p>
        {/* 로그인 전에도 버전이 보여야 한다 — 배포가 올라갔는지 확인하려고 로그인부터 할 일은 없다 */}
        <p
          className="text-[11px] text-slate-400 mt-2 text-center tnum"
          title={commit ? `배포 커밋 ${commit}` : "로컬 실행 (배포 커밋 정보 없음)"}
        >
          {version}
        </p>
      </div>
    </div>
  );
}
