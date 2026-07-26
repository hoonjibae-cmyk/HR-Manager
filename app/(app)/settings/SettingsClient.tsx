"use client";

import { useEffect, useState } from "react";

export default function SettingsClient() {
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setData);
  }, []);

  async function save(section: string, payload: any) {
    setMsg("");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, data: payload }),
    });
    if (res.ok) {
      setMsg(`${section} 저장 완료`);
      setTimeout(() => setMsg(""), 2500);
    } else setMsg("저장 실패");
  }

  async function testEmail() {
    const to = prompt("테스트 메일을 받을 주소를 입력하세요");
    if (!to) return;
    const res = await fetch("/api/email/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
    const j = await res.json().catch(() => ({}));
    alert(res.ok ? "테스트 메일 발송 성공" : `실패: ${j.error || "SMTP 설정 확인"}`);
  }

  async function postLauncher() {
    const channel = prompt(
      "휴가신청 버튼을 게시할 슬랙 채널 ID를 입력하세요.\n(비워두면 승인 채널에 게시 · 봇을 먼저 채널에 초대해야 합니다)",
      ""
    );
    if (channel === null) return;
    const res = await fetch("/api/slack/launcher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channel.trim() }),
    });
    const j = await res.json().catch(() => ({}));
    alert(
      res.ok
        ? `게시 완료 (채널 ${j.channel})${j.pinned ? " · 상단 고정됨" : ""}`
        : `실패: ${j.error || ""}`
    );
  }

  if (!data) return <div className="text-slate-400">불러오는 중…</div>;

  return (
    <div className="space-y-6">
      {msg && <div className="pill bg-emerald-50 text-emerald-700">{msg}</div>}

      <CompanyCard company={data.company} onSave={(d: any) => save("company", d)} />
      <RatesCard rates={data.rates} onSave={(d: any) => save("rates", d)} />
      <ScheduleCard
        schedule={data.schedule}
        status={data.scheduleStatus}
        onSave={async (d: any) => {
          await save("schedule", d);
          const fresh = await fetch("/api/settings").then((r) => r.json());
          setData(fresh);
        }}
      />
      <EmailLogCard logs={data.emailLogs ?? []} />
      <IntegrationCard integrations={data.integrations} onTestEmail={testEmail} onPostLauncher={postLauncher} />
    </div>
  );
}

function CompanyCard({ company, onSave }: any) {
  const [f, setF] = useState({
    name: company?.name ?? "", ceo: company?.ceo ?? "", bizNo: company?.bizNo ?? "",
    phone: company?.phone ?? "", address: company?.address ?? "", payday: company?.payday ?? 7,
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-4">회사 정보</h2>
      <div className="grid md:grid-cols-3 gap-4">
        <F l="회사명"><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></F>
        <F l="대표자"><input className="input" value={f.ceo} onChange={(e) => set("ceo", e.target.value)} /></F>
        <F l="사업자등록번호"><input className="input" value={f.bizNo} onChange={(e) => set("bizNo", e.target.value)} /></F>
        <F l="전화번호"><input className="input" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></F>
        <F l="급여 지급일(익월 n일)"><input type="number" className="input" value={f.payday} onChange={(e) => set("payday", e.target.value)} /></F>
        <F l="회사주소" full><input className="input" value={f.address} onChange={(e) => set("address", e.target.value)} /></F>
      </div>
      <div className="flex justify-end mt-4"><button className="btn-primary" onClick={() => onSave(f)}>저장</button></div>
    </div>
  );
}

function RatesCard({ rates, onSave }: any) {
  const [f, setF] = useState({
    nationalPension: pct(rates?.nationalPension ?? 0.045), employment: pct(rates?.employment ?? 0.009),
    health: pct(rates?.health ?? 0.03545), longTermCare: pct(rates?.longTermCare ?? 0.1295),
    localIncomeTaxRate: pct(rates?.localIncomeTaxRate ?? 0.1), businessIncomeTax: pct(rates?.businessIncomeTax ?? 0.03),
    pensionBaseMin: rates?.pensionBaseMin ?? 390000, pensionBaseMax: rates?.pensionBaseMax ?? 6170000,
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-1">4대보험 · 세율 (근로자 부담분)</h2>
      <p className="text-xs text-slate-400 mb-4">% 단위로 입력하세요. 예: 국민연금 4.5</p>
      <div className="grid md:grid-cols-4 gap-4">
        <F l="국민연금 (%)"><input className="input" value={f.nationalPension} onChange={(e) => set("nationalPension", e.target.value)} /></F>
        <F l="건강보험 (%)"><input className="input" value={f.health} onChange={(e) => set("health", e.target.value)} /></F>
        <F l="장기요양 (건강보험료의 %)"><input className="input" value={f.longTermCare} onChange={(e) => set("longTermCare", e.target.value)} /></F>
        <F l="고용보험 (%)"><input className="input" value={f.employment} onChange={(e) => set("employment", e.target.value)} /></F>
        <F l="지방소득세 (소득세의 %)"><input className="input" value={f.localIncomeTaxRate} onChange={(e) => set("localIncomeTaxRate", e.target.value)} /></F>
        <F l="사업소득 원천징수 (%)"><input className="input" value={f.businessIncomeTax} onChange={(e) => set("businessIncomeTax", e.target.value)} /></F>
        <F l="연금 기준소득 하한"><input type="number" className="input" value={f.pensionBaseMin} onChange={(e) => set("pensionBaseMin", e.target.value)} /></F>
        <F l="연금 기준소득 상한"><input type="number" className="input" value={f.pensionBaseMax} onChange={(e) => set("pensionBaseMax", e.target.value)} /></F>
      </div>
      <div className="flex justify-end mt-4">
        <button className="btn-primary" onClick={() => onSave({
          nationalPension: unpct(f.nationalPension), employment: unpct(f.employment), health: unpct(f.health),
          longTermCare: unpct(f.longTermCare), localIncomeTaxRate: unpct(f.localIncomeTaxRate),
          businessIncomeTax: unpct(f.businessIncomeTax), pensionBaseMin: f.pensionBaseMin, pensionBaseMax: f.pensionBaseMax,
        })}>저장</button>
      </div>
    </div>
  );
}

function ScheduleCard({ schedule, status, onSave }: any) {
  const [f, setF] = useState({
    enabled: schedule?.enabled ?? false, frequency: schedule?.frequency ?? "MONTHLY",
    dayOfMonth: schedule?.dayOfMonth ?? 7, dayOfWeek: schedule?.dayOfWeek ?? 1,
    hour: schedule?.hour ?? 9, minute: schedule?.minute ?? 0, targetMonthOffset: schedule?.targetMonthOffset ?? -1,
  });
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const dow = ["일", "월", "화", "수", "목", "금", "토"];
  const serverless = status?.serverless;

  const loadPreview = async () => {
    const r = await fetch("/api/email/preview").then((x) => x.json()).catch(() => null);
    setPreview(r);
    return r;
  };
  useEffect(() => {
    loadPreview();
  }, []);

  async function run(mode: "dry" | "force") {
    const pv = preview ?? (await loadPreview());
    if (!pv?.year) return alert("발송 대상을 확인할 수 없습니다.");
    if (mode === "force") {
      if (
        !confirm(
          `${pv.year}년 ${pv.month}월분 명세서를 ${pv.targetCount}명에게 지금 발송합니다.\n` +
            `발송된 기록은 잠기며(발송완료) 이후 수정·재계산할 수 없습니다. 진행할까요?`
        )
      )
        return;
    }
    setBusy(mode);
    const res = await fetch("/api/email/schedule-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 미리보기와 동일한 대상 월을 명시적으로 전달
      body: JSON.stringify({ force: true, dryRun: mode === "dry", year: pv.year, month: pv.month }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) return alert("실행 실패: " + (j.error || ""));
    if (mode === "dry")
      alert(
        `모의 실행 결과\n대상: ${j.year}년 ${j.month}월분\n급여기록 ${j.total ?? 0}건 (미발송 ${j.pending ?? 0}건)\n\n실제 발송은 하지 않았습니다.`
      );
    else
      alert(
        `발송 완료\n${j.year}년 ${j.month}월분 · 성공 ${j.sent ?? 0}건 / 실패 ${j.failed ?? 0}건` +
          (j.skippedSent ? `\n(이미 발송되어 제외 ${j.skippedSent}건)` : "")
      );
    await loadPreview();
  }

  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-1">급여명세서 자동발송 예약</h2>
      <p className="text-xs text-slate-400 mb-4">
        지정한 날짜·요일에 급여명세서 PDF를 직원 이메일로 자동 발송합니다. 이미 발송된 기록은 제외되어 중복 발송되지 않습니다.
      </p>

      {/* 예약 상태 */}
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <StatBox k="상태" v={f.enabled ? "사용 중" : "중지"} ok={f.enabled} />
        <StatBox k="다음 발송 예정" v={status?.nextRunLabel ?? (f.enabled ? "저장 후 계산" : "-")} />
        <StatBox k="마지막 발송" v={status?.lastRunLabel ?? "기록 없음"} />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input type="checkbox" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} className="w-4 h-4" />
        <span className="text-sm font-medium">자동발송 사용</span>
      </div>
      <div className="grid md:grid-cols-4 gap-4">
        <F l="주기">
          <select className="input" value={f.frequency} onChange={(e) => set("frequency", e.target.value)}>
            <option value="MONTHLY">매월</option>
            <option value="WEEKLY">매주</option>
          </select>
        </F>
        {f.frequency === "MONTHLY" ? (
          <F l="매월 n일 (말일 초과 시 말일)"><input type="number" min={1} max={31} className="input" value={f.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} /></F>
        ) : (
          <F l="요일">
            <select className="input" value={f.dayOfWeek} onChange={(e) => set("dayOfWeek", e.target.value)}>
              {dow.map((d, i) => <option key={i} value={i}>{d}요일</option>)}
            </select>
          </F>
        )}
        <F l="발송 시각 (KST, 정시)">
          <select className="input" value={f.hour} onChange={(e) => set("hour", e.target.value)}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </F>
        <F l="발송 대상 월">
          <select className="input" value={f.targetMonthOffset} onChange={(e) => set("targetMonthOffset", e.target.value)}>
            <option value={0}>당월분</option>
            <option value={-1}>전월분</option>
          </select>
        </F>
      </div>

      <div className="mt-3 text-[11px] text-slate-500 bg-slate-50 rounded-lg p-3 space-y-1">
        <div>
          · 지급일이 <b>익월 7일</b>이라면 <b>매월 7일 · 전월분</b>으로 설정하세요. (7월 급여 → 8월 7일 발송)
        </div>
        <div>· 위에 지정한 <b>시각(KST 정시)</b> 에 발송됩니다. 서버가 매시 정각에 점검합니다.</div>
        <div>· 급여 기록이 아직 없으면 발송 직전에 자동으로 급여를 산정합니다. 이메일 주소가 없는 직원은 제외되고 실패로 기록됩니다.</div>
      </div>

      {/* 발송 대상 미리보기 */}
      {preview && (
        <div className="mt-3 border border-brand-100 bg-brand-50/40 rounded-lg p-3 text-xs">
          <div className="font-semibold text-brand-800 mb-1">
            발송 대상 미리보기 — {preview.year}년 {preview.month}월분
          </div>
          <div className="text-slate-600">
            발송 대상 <b>{preview.targetCount}명</b> · 이미 발송 {preview.alreadySentCount}건 · 급여기록 {preview.total}건
            {preview.totalNet > 0 && <> · 실지급 합계 {Number(preview.totalNet).toLocaleString()}원</>}
          </div>
          {preview.noEmailNames?.length > 0 && (
            <div className="text-amber-700 mt-1">⚠️ 이메일 미등록: {preview.noEmailNames.join(", ")}</div>
          )}
          {!preview.smtpReady && <div className="text-red-600 mt-1">⚠️ SMTP 미설정 — 발송할 수 없습니다.</div>}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 mt-4">
        <button className="btn-ghost" disabled={!!busy} onClick={() => loadPreview()}>
          대상 새로고침
        </button>
        <button className="btn-outline" disabled={!!busy} onClick={() => run("dry")}>
          {busy === "dry" ? "실행 중…" : "모의 실행"}
        </button>
        <button className="btn-outline" disabled={!!busy} onClick={() => run("force")}>
          {busy === "force" ? "발송 중…" : "지금 발송"}
        </button>
        {/* 정시 발송 — 분은 항상 0 으로 저장 */}
        <button className="btn-primary" onClick={() => onSave({ ...f, minute: 0 })}>저장</button>
      </div>
    </div>
  );
}

function StatBox({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="border border-slate-200 rounded-xl px-3 py-2">
      <div className="text-[11px] text-slate-400">{k}</div>
      <div className={`text-sm font-semibold tnum ${ok ? "text-emerald-600" : "text-slate-700"}`}>{v}</div>
    </div>
  );
}

function EmailLogCard({ logs }: { logs: any[] }) {
  if (!logs.length) return null;
  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-3">최근 발송 이력</h2>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="text-left py-1">일시</th>
              <th className="text-left">받는 사람</th>
              <th className="text-left">제목</th>
              <th className="text-left">상태</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-1 tnum text-slate-500">{l.at}</td>
                <td className="truncate max-w-[160px]">{l.to}</td>
                <td className="truncate max-w-[260px] text-slate-600">{l.subject}</td>
                <td>
                  <span className={`pill ${l.status === "SENT" ? "bg-emerald-50 text-emerald-700" : l.status === "FAILED" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}`}>
                    {l.status === "SENT" ? "발송" : l.status === "FAILED" ? "실패" : "대기"}
                  </span>
                  {l.error && <span className="text-red-400 ml-1">{l.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IntegrationCard({ integrations: g, onTestEmail, onPostLauncher }: any) {
  const envHint = g.serverless
    ? "Vercel → Settings → Environment Variables 에 추가 후 재배포"
    : ".env 파일에 추가 후 서버 재시작";

  const slackHint = g.slack
    ? g.slackChannel
      ? "연차 신청·승인, 발송 알림 사용 가능"
      : "SLACK_APPROVAL_CHANNEL 미설정 — 승인 채널 지정 필요"
    : !g.slackToken && !g.slackSecret
    ? "SLACK_BOT_TOKEN · SLACK_SIGNING_SECRET 필요 (선택 기능)"
    : `${!g.slackToken ? "SLACK_BOT_TOKEN" : "SLACK_SIGNING_SECRET"} 누락`;

  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-1">외부 연동 상태</h2>
      <p className="text-xs text-slate-400 mb-4">{envHint}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Status
          label="SMTP 이메일"
          ok={g.smtp}
          required
          hint={
            g.smtp
              ? `${g.smtpHost}${g.smtpUser ? ` · ${g.smtpUser}` : ""}`
              : "SMTP_HOST · SMTP_USER · SMTP_PASS 필요 — 설정 전에는 명세서 발송 불가"
          }
        />
        <Status label="슬랙 연동" ok={g.slack} hint={slackHint} />
        <Status
          label="구글 캘린더"
          ok={g.gcal}
          hint={
            g.gcal
              ? "승인된 휴가가 캘린더에 자동 등록·취소 시 삭제됩니다"
              : "GOOGLE_CLIENT_EMAIL · GOOGLE_PRIVATE_KEY · GOOGLE_CALENDAR_ID 필요 (선택)"
          }
        />
        <Status
          label="예약 발송 실행"
          ok={g.scheduler}
          hint={
            g.serverless
              ? `Vercel Cron · 매시 정각${g.cronSecret ? " · CRON_SECRET 설정됨" : ""}`
              : g.scheduler
              ? "내부 스케줄러 구동 중 (60초 주기)"
              : "ENABLE_SCHEDULER=true 필요"
          }
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-outline" onClick={onTestEmail}>테스트 메일 발송</button>
        {g.slack && (
          <button className="btn-outline" onClick={onPostLauncher}>
            슬랙 채널에 휴가신청 버튼 게시
          </button>
        )}
      </div>
      {!g.smtp && (
        <p className="text-xs text-amber-700 mt-3">
          ⚠️ SMTP가 설정되지 않아 <b>급여명세서 발송(수동·예약 모두)이 동작하지 않습니다.</b> 설정 방법은{" "}
          <code>docs/SETUP.md</code> 를 참고하세요.
        </p>
      )}
      <p className="text-xs text-slate-400 mt-3">
        연동 설정 방법은 프로젝트의 <code>docs/SETUP.md</code> 를 참고하세요.
      </p>
    </div>
  );
}

function Status({ label, ok, hint, required }: { label: string; ok: boolean; hint: string; required?: boolean }) {
  return (
    <div className={`border rounded-xl p-4 ${!ok && required ? "border-amber-300 bg-amber-50/40" : "border-slate-200"}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">
          {label}
          {required && <span className="text-[10px] text-amber-600 ml-1">필수</span>}
        </span>
        <span className={`pill ${ok ? "bg-emerald-50 text-emerald-700" : required ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}>
          {ok ? "연결됨" : "미설정"}
        </span>
      </div>
      <div className="text-xs text-slate-400 mt-2 break-all">{hint}</div>
    </div>
  );
}

function F({ l, children, full }: { l: string; children: React.ReactNode; full?: boolean }) {
  return <div className={full ? "md:col-span-3" : ""}><label className="label">{l}</label>{children}</div>;
}
function pct(v: number) { return (v * 100).toFixed(4).replace(/\.?0+$/, ""); }
function unpct(v: string) { return Number(v) / 100; }
