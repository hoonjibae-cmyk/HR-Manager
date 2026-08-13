"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface NotifySettingRow {
  targetDepartment: string;
  channel: string | null;
  contractEnabled: boolean;
  contractLeadDays: number;
  contractHour: number;
  contractMinute: number;
  birthdayEnabled: boolean;
  birthdayLeadDays: number;
  birthdayHour: number;
  birthdayMinute: number;
  dailyEnabled: boolean;
  dailyChannel: string | null;
  dailyHour: number;
  dailyMinute: number;
}

export interface NotifyPreview {
  contract: { count?: number; alerts?: any[] };
  birthday: { count?: number; alerts?: any[] };
  recipients: { total: number; userIds: string[]; warning: string | null };
  slack: boolean;
}

/**
 * 경영지원 알림 설정 — 계약 종료 예고 · 생일.
 *
 * **지금 조건이면 무엇이 나갈지 함께 보여 준다** — 며칠 전에 보낼지를 숫자로만 고르면
 * 그 값이 실제로 누구를 잡는지 알 수가 없어서, 저장한 뒤 두 달을 기다려야 확인이 된다.
 */
export default function HrNotifyPanel({
  setting,
  preview,
  departments,
}: {
  setting: NotifySettingRow;
  preview: NotifyPreview;
  departments: string[];
}) {
  const router = useRouter();
  const [p, setP] = useState<NotifySettingRow>(setting);
  const [pv, setPv] = useState<NotifyPreview>(preview);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const set = (k: keyof NotifySettingRow, v: any) => setP((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setErr("");
    setMsg("");
    const res = await fetch("/api/settings/notify", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    const j = await res.json().catch(() => ({}) as any);
    setBusy(false);
    if (!res.ok) return setErr(j.error || "저장하지 못했습니다.");
    if (j.setting) setP(j.setting);
    setPv(j);
    setMsg("저장했습니다.");
    router.refresh();
  }

  async function sendNow() {
    if (
      !confirm(
        "지금 바로 보냅니다.\n\n계약 종료 예고는 한 계약에 한 번만 나가므로, 여기서 보낸 건은 예정 시각에 다시 나가지 않습니다."
      )
    )
      return;
    setBusy(true);
    setErr("");
    setMsg("");
    const res = await fetch("/api/settings/notify", { method: "POST" });
    const j = await res.json().catch(() => ({}) as any);
    setBusy(false);
    if (!res.ok) return setErr(j.error || "보내지 못했습니다.");
    const n = (k: any) => (k?.ran ? `${k.count ?? 0}건` : k?.reason || k?.error || "건너뜀");
    setMsg(`계약 종료 예고 ${n(j.contract)} · 생일 ${n(j.birthday)}`);
    router.refresh();
  }

  const timeField = (
    label: string,
    hk: keyof NotifySettingRow,
    mk: keyof NotifySettingRow
  ) => (
    <label className="text-xs">
      <span className="text-slate-500">{label}</span>
      <div className="flex items-center gap-1 mt-0.5">
        <input
          type="number"
          min={0}
          max={23}
          className="input py-1 text-sm w-16"
          value={String(p[hk])}
          onChange={(e) => set(hk, Number(e.target.value))}
        />
        <span className="text-slate-400">시</span>
        <input
          type="number"
          min={0}
          max={59}
          step={5}
          className="input py-1 text-sm w-16"
          value={String(p[mk])}
          onChange={(e) => set(mk, Number(e.target.value))}
        />
        <span className="text-slate-400">분</span>
      </div>
    </label>
  );

  const contractCount = pv.contract?.count ?? 0;
  const birthdayCount = pv.birthday?.count ?? 0;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div>
          <div className="font-bold text-sm">경영지원 알림</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            계약 종료 예고 · 생일을 슬랙으로 보냅니다
          </div>
        </div>
        <button className="btn text-xs" onClick={sendNow} disabled={busy}>
          {busy ? "…" : "지금 보내기"}
        </button>
      </div>

      {/* 받는 사람 */}
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        <label className="text-xs">
          <span className="text-slate-500">받을 부서</span>
          <select
            className="input py-1 text-sm mt-0.5"
            value={p.targetDepartment}
            onChange={(e) => set("targetDepartment", e.target.value)}
          >
            {Array.from(new Set([...departments, p.targetDepartment])).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-400 block mt-0.5">
            그 부서 재직 직원에게 각각 DM 이 갑니다
          </span>
        </label>
        <label className="text-xs">
          <span className="text-slate-500">채널로 보내기 (선택)</span>
          <input
            className="input py-1 text-sm mt-0.5"
            placeholder="비워 두면 부서원에게 DM"
            value={p.channel ?? ""}
            onChange={(e) => set("channel", e.target.value)}
          />
          <span className="text-[11px] text-slate-400 block mt-0.5">
            채널 ID(C…) 를 넣으면 DM 대신 그 채널로 갑니다
          </span>
        </label>
      </div>

      {!pv.slack && (
        <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800">
          ⚠ 슬랙이 연결되어 있지 않습니다 (SLACK_BOT_TOKEN) — 알림이 나가지 않습니다.
        </div>
      )}
      {pv.recipients?.warning && (
        <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800">
          ⚠ {pv.recipients.warning}
        </div>
      )}
      {!pv.recipients?.warning && pv.slack && (
        <div className="mt-2 text-[11px] text-slate-400">
          지금 받는 사람:{" "}
          {p.channel ? (
            <b>채널 {p.channel}</b>
          ) : (
            <b>
              {p.targetDepartment} {pv.recipients?.userIds.length ?? 0}명
            </b>
          )}
        </div>
      )}

      {/* 계약 종료 예고 */}
      <div className="border-t border-slate-100 mt-3 pt-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={p.contractEnabled}
            onChange={(e) => set("contractEnabled", e.target.checked)}
          />
          계약 종료 예고
        </label>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <label className="text-xs">
            <span className="text-slate-500">며칠 전에</span>
            <div className="flex items-center gap-1 mt-0.5">
              <input
                type="number"
                min={0}
                max={365}
                className="input py-1 text-sm w-20"
                value={String(p.contractLeadDays)}
                onChange={(e) => set("contractLeadDays", Number(e.target.value))}
              />
              <span className="text-slate-400">일 전</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              기본 60일(≈2개월). 30 = 1개월, 90 = 3개월
            </span>
          </label>
          {timeField("보낼 시각", "contractHour", "contractMinute")}
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed mt-2">
          남은 기간이 이 안에 든 계약을 <b>한 번만</b> 알립니다. &apos;딱 그날&apos; 이 아니라
          &apos;창 안에 들었는데 아직 안 알린&apos; 계약을 찾으므로, 알림이 하루 밀리거나 예고
          일수를 늘려도 빠지지 않습니다. 이미 알린 계약은 다시 알리지 않습니다.
        </p>
        <div className="mt-2 text-xs">
          {contractCount > 0 ? (
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
              <b className="text-slate-700">지금 보내면 {contractCount}건</b>
              <div className="text-[11px] text-slate-500 mt-1 space-y-0.5">
                {(pv.contract.alerts ?? []).slice(0, 5).map((a: any) => (
                  <div key={a.id}>
                    D-{a.dDay} · {a.name} · {a.endDate}
                  </div>
                ))}
                {(pv.contract.alerts ?? []).length > 5 && <div>…</div>}
              </div>
            </div>
          ) : (
            <span className="text-slate-400">지금 예고할 계약이 없습니다.</span>
          )}
        </div>
      </div>

      {/* 생일 */}
      <div className="border-t border-slate-100 mt-3 pt-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={p.birthdayEnabled}
            onChange={(e) => set("birthdayEnabled", e.target.checked)}
          />
          생일 안내
        </label>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <label className="text-xs">
            <span className="text-slate-500">며칠 전에</span>
            <div className="flex items-center gap-1 mt-0.5">
              <input
                type="number"
                min={0}
                max={30}
                className="input py-1 text-sm w-20"
                value={String(p.birthdayLeadDays)}
                onChange={(e) => set("birthdayLeadDays", Number(e.target.value))}
              />
              <span className="text-slate-400">일 전 (0 = 당일)</span>
            </div>
          </label>
          {timeField("보낼 시각", "birthdayHour", "birthdayMinute")}
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed mt-2">
          지나면 뜻이 없는 알림이라 <b>그날만</b> 봅니다 — 놓친 날을 따라잡지 않습니다.
          직원 정보의 <b>생년월일</b>이 비어 있으면 그 사람은 빠집니다.
        </p>
        <div className="mt-2 text-xs">
          {birthdayCount > 0 ? (
            <span className="text-slate-700">
              지금 보내면 <b>{birthdayCount}명</b> —{" "}
              {(pv.birthday.alerts ?? []).map((a: any) => a.name).join(", ")}
            </span>
          ) : (
            <span className="text-slate-400">
              {p.birthdayLeadDays === 0 ? "오늘" : `${p.birthdayLeadDays}일 뒤`} 생일인 직원이 없습니다.
            </span>
          )}
        </div>
      </div>

      {/* 운영진 일일 안내 — 받는 곳이 위 둘과 다르다(경영지원 부서 ↔ 운영진 채널) */}
      <div className="border-t border-slate-100 mt-3 pt-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={p.dailyEnabled}
            onChange={(e) => set("dailyEnabled", e.target.checked)}
          />
          운영진 일일 안내 — 오늘 휴가 · 오늘 보강
        </label>
        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <label className="text-xs">
            <span className="text-slate-500">운영진 채널 ID</span>
            <input
              className="input py-1 text-sm mt-0.5"
              placeholder="C0AP5EWJR71"
              value={p.dailyChannel ?? ""}
              onChange={(e) => set("dailyChannel", e.target.value)}
            />
          </label>
          {timeField("보낼 시각", "dailyHour", "dailyMinute")}
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed mt-2">
          <b>휴가와 보강을 각각 따로</b> 올립니다 — 챙기는 사람도 할 일도 달라 한 통에 담으면
          스레드에서 한쪽만 이야기하기 어렵습니다. <b>낼 것이 없는 날은 보내지 않습니다</b> —
          매일 &ldquo;오늘은 없습니다&rdquo; 가 오면 정작 있는 날의 알림까지 묻힙니다.
          휴가는 연차·반차뿐 아니라 <b>대휴·병가·경조·평일 휴무</b>도 함께 냅니다(그날 자리에 없는 것은 같습니다).
          <b> 승인 대기</b>인 건은 아래에 따로 모아 표시합니다.
          {!p.dailyChannel?.trim() && (
            <span className="block text-amber-600 mt-1">
              ⚠️ 채널 ID 가 비어 있어 아무 데도 나가지 않습니다.
            </span>
          )}
        </p>
        <div className="mt-2">
          <button
            className="btn btn-outline text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg("");
              setErr("");
              try {
                const r = await fetch("/api/settings/notify?which=daily", { method: "POST" });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || "실패");
                const one = (x: any) =>
                  x?.error ? `오류(${x.error})` : x?.sent ? `${x.count}건 보냄` : (x?.reason ?? "안 보냄");
                setMsg(`오늘 휴가: ${one(j.leave)} · 오늘 보강: ${one(j.makeup)}`);
                router.refresh();
              } catch (e: any) {
                setErr(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            지금 보내기 (오늘 것)
          </button>
        </div>
      </div>

      {msg && <div className="mt-3 text-[11px] text-slate-500">{msg}</div>}
      {err && <div className="mt-3 text-[11px] text-rose-600">{err}</div>}

      <div className="flex justify-end mt-3">
        <button className="btn btn-primary text-xs" onClick={save} disabled={busy}>
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
