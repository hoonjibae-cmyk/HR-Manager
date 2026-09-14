export default function LoginForm({
  logo,
  version,
  commit,
  portalUrl,
  accessDenied,
}: {
  logo: string | null;
  version: string;
  commit?: string | null;
  portalUrl: string;
  accessDenied: boolean;
}) {
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
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 mb-5">
          HR Manager는 <strong>경영지원 재직자 전용</strong>입니다.
        </div>
        {accessDenied && (
          <p className="text-sm text-red-600 mb-4" role="alert">
            경영지원 재직 상태를 확인하지 못해 접속을 차단했습니다.
          </p>
        )}
        <a className="btn-primary w-full text-center block" href={portalUrl}>
          유쌤 워크스페이스에서 확인 후 로그인
        </a>
        <p className="text-xs text-slate-500 mt-5 text-center leading-5">
          포털의 Slack 계정과 HR 직원 명부를 다시 대조한 뒤 접속됩니다.
        </p>
        <p
          className="text-[11px] text-slate-400 mt-3 text-center tnum"
          title={commit ? `배포 커밋 ${commit}` : "로컬 실행 (배포 커밋 정보 없음)"}
        >
          {version}
        </p>
      </div>
    </div>
  );
}
