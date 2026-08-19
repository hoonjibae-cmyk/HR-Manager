/**
 * **명세서 발송 대상 가리기** — 순수 함수(DB·SMTP 무관).
 *
 * 발송은 되돌릴 수 없다. 직원 메일함에 들어간 명세서는 회수할 방법이 없고, 잘못 나가면
 * 남의 급여를 본 사람이 생긴다. 그래서 **누구에게 나가는가** 를 화면과 서버가 각자 판단하지
 * 않고 이 함수 하나로 가린다 — 따로 두면 확인창은 "3명" 이라 적고 실제로는 2명에게 나가거나,
 * 더 나쁘게는 화면에 안 뜬 사람에게 나간다.
 *
 * 가르는 갈래는 셋이다.
 *  - `targets`     — 실제로 나갈 사람
 *  - `noEmail`     — 메일 주소가 없어 못 나가는 사람 (**빠뜨리면 안 되므로 세어서 보여준다**)
 *  - `alreadySent` — 이미 발송(SENT)돼 잠긴 사람. 잠금 해제를 거쳐야 다시 나간다.
 */

export interface SendCandidate {
  /** PayrollRecord.id */
  id: number;
  name: string;
  email: string | null;
  /** PayrollRecord.status */
  status: string;
}

export interface SendPlan {
  targets: SendCandidate[];
  noEmail: SendCandidate[];
  alreadySent: SendCandidate[];
}

/**
 * 발송 대상 계획.
 *
 * `selectedIds` 가 **없으면(`null`/`undefined`) 그 달 전체**, 있으면 **고른 것만** 본다.
 * ⚠ **빈 배열은 '전체' 가 아니라 '아무도 안 고름' 이다** — 명단 화면 필터(`[]` = 전체)와
 * 반대인데, 여기서 빈 배열을 전체로 읽으면 아무도 안 고르고 누른 실수가 **전 직원 발송**이 된다.
 */
export function planPayslipSend(
  rows: SendCandidate[],
  selectedIds?: number[] | null
): SendPlan {
  const pick = selectedIds == null ? rows : rows.filter((r) => selectedIds.includes(r.id));
  const plan: SendPlan = { targets: [], noEmail: [], alreadySent: [] };
  for (const r of pick) {
    if (r.status === "SENT") plan.alreadySent.push(r);
    else if (!r.email || !r.email.trim()) plan.noEmail.push(r);
    else plan.targets.push(r);
  }
  return plan;
}

/** 확인창에 이름을 몇 명까지 늘어놓을지 — 넘치면 창이 화면 밖으로 나간다 */
const NAME_LIMIT = 15;

const nameList = (rows: SendCandidate[], withEmail = false): string => {
  const head = rows
    .slice(0, NAME_LIMIT)
    .map((r) => (withEmail ? `  · ${r.name} <${r.email}>` : `  · ${r.name}`))
    .join("\n");
  const rest = rows.length - NAME_LIMIT;
  return rest > 0 ? `${head}\n  … 외 ${rest}명` : head;
};

/**
 * 발송 확인창 문안.
 *
 * **받는 사람의 이름과 메일 주소를 그대로 늘어놓는다** — 선택 발송은 대개 정정본을 다시
 * 보내는 상황이라, 누구에게 가는지 눈으로 확인하고 눌러야 한다. 인원수만 적으면
 * 엉뚱한 행을 고른 것을 누를 때까지 모른다.
 *
 * 보낼 사람이 없으면 `null` 을 돌려준다 — 부르는 쪽이 확인창 대신 안내를 띄운다.
 */
export function sendConfirmText(
  plan: SendPlan,
  year: number,
  month: number,
  opts: { selective: boolean }
): string | null {
  if (!plan.targets.length) return null;

  const head = opts.selective
    ? `고른 ${plan.targets.length}명에게 ${year}년 ${month}월 급여명세서를 발송합니다.`
    : `${year}년 ${month}월 급여명세서를 ${plan.targets.length}명에게 발송합니다.`;

  const parts = [head, "", "받는 사람", nameList(plan.targets, true)];

  if (plan.noEmail.length)
    parts.push(
      "",
      `⚠ 메일 주소가 없어 발송되지 않는 ${plan.noEmail.length}명`,
      nameList(plan.noEmail),
      "  → 직원 정보에 메일 주소를 넣은 뒤 다시 보내세요."
    );

  if (plan.alreadySent.length)
    parts.push(
      "",
      `이미 발송돼 제외되는 ${plan.alreadySent.length}명`,
      nameList(plan.alreadySent),
      "  → 다시 보내려면 «🔓 발송 잠금 해제» 를 먼저 거쳐야 합니다."
    );

  parts.push(
    "",
    "발송된 기록은 자동으로 잠겨(발송완료) 재계산·공제 수정이 되지 않습니다.",
    "직원이 받은 메일은 되돌릴 수 없어 정정본을 다시 보내게 되므로, 보내기 전에 확인하는 편이 낫습니다."
  );

  return parts.join("\n");
}

/** 보낼 사람이 하나도 없을 때의 안내 — 왜 없는지까지 적는다 */
export function nothingToSendNotice(plan: SendPlan, opts: { selective: boolean }): string {
  const why: string[] = [];
  if (plan.alreadySent.length) why.push(`이미 발송됨 ${plan.alreadySent.length}명`);
  if (plan.noEmail.length) why.push(`메일 주소 없음 ${plan.noEmail.length}명`);
  if (!why.length)
    return opts.selective
      ? "발송할 직원을 먼저 고르세요."
      : "이 달에 발송할 급여 기록이 없습니다.";
  return `보낼 수 있는 대상이 없습니다 — ${why.join(" · ")}.`;
}
