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

  if (!data) return <div className="text-slate-400">불러오는 중…</div>;

  return (
    <div className="space-y-6">
      {msg && <div className="pill bg-emerald-50 text-emerald-700">{msg}</div>}

      <CompanyCard company={data.company} onSave={(d: any) => save("company", d)} />
      <RatesCard rates={data.rates} onSave={(d: any) => save("rates", d)} />
      <ScheduleCard schedule={data.schedule} onSave={(d: any) => save("schedule", d)} />
      <IntegrationCard integrations={data.integrations} onTestEmail={testEmail} />
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

function ScheduleCard({ schedule, onSave }: any) {
  const [f, setF] = useState({
    enabled: schedule?.enabled ?? false, frequency: schedule?.frequency ?? "MONTHLY",
    dayOfMonth: schedule?.dayOfMonth ?? 7, dayOfWeek: schedule?.dayOfWeek ?? 1,
    hour: schedule?.hour ?? 9, minute: schedule?.minute ?? 0, targetMonthOffset: schedule?.targetMonthOffset ?? -1,
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const dow = ["일", "월", "화", "수", "목", "금", "토"];
  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-1">급여명세서 자동발송 예약</h2>
      <p className="text-xs text-slate-400 mb-4">지정한 요일·시간에 급여명세서를 직원 이메일로 자동 발송합니다. (SMTP 설정 및 스케줄러 필요)</p>
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
          <F l="매월 n일"><input type="number" className="input" value={f.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} /></F>
        ) : (
          <F l="요일">
            <select className="input" value={f.dayOfWeek} onChange={(e) => set("dayOfWeek", e.target.value)}>
              {dow.map((d, i) => <option key={i} value={i}>{d}요일</option>)}
            </select>
          </F>
        )}
        <F l="시각(시)"><input type="number" min={0} max={23} className="input" value={f.hour} onChange={(e) => set("hour", e.target.value)} /></F>
        <F l="분"><input type="number" min={0} max={59} className="input" value={f.minute} onChange={(e) => set("minute", e.target.value)} /></F>
        <F l="발송 대상 월">
          <select className="input" value={f.targetMonthOffset} onChange={(e) => set("targetMonthOffset", e.target.value)}>
            <option value={0}>당월분</option>
            <option value={-1}>전월분</option>
          </select>
        </F>
      </div>
      <div className="flex justify-end mt-4"><button className="btn-primary" onClick={() => onSave(f)}>저장</button></div>
    </div>
  );
}

function IntegrationCard({ integrations, onTestEmail }: any) {
  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-800 mb-4">외부 연동 상태</h2>
      <div className="grid sm:grid-cols-3 gap-4">
        <Status label="SMTP 이메일" ok={integrations.smtp} hint=".env의 SMTP_HOST 설정" />
        <Status label="슬랙 연동" ok={integrations.slack} hint=".env의 SLACK_BOT_TOKEN 설정" />
        <Status label="내부 스케줄러" ok={integrations.scheduler} hint="ENABLE_SCHEDULER=true" />
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn-outline" onClick={onTestEmail}>테스트 메일 발송</button>
      </div>
      <p className="text-xs text-slate-400 mt-3">연동 설정 방법은 프로젝트의 <code>docs/SETUP.md</code> 를 참고하세요.</p>
    </div>
  );
}

function Status({ label, ok, hint }: { label: string; ok: boolean; hint: string }) {
  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{label}</span>
        <span className={`pill ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
          {ok ? "연결됨" : "미설정"}
        </span>
      </div>
      <div className="text-xs text-slate-400 mt-2">{hint}</div>
    </div>
  );
}

function F({ l, children, full }: { l: string; children: React.ReactNode; full?: boolean }) {
  return <div className={full ? "md:col-span-3" : ""}><label className="label">{l}</label>{children}</div>;
}
function pct(v: number) { return (v * 100).toFixed(4).replace(/\.?0+$/, ""); }
function unpct(v: string) { return Number(v) / 100; }
