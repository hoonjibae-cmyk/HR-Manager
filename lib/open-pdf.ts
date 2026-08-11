/**
 * 만들어진 PDF 를 새 탭에 띄우는 브라우저 쪽 도우미.
 *
 * ⚠️ **`window.open` 은 클릭과 같은 실행 흐름에서 불러야 한다.**
 * `await` 를 하나라도 거친 뒤에 부르면 사용자 제스처가 풀려 **팝업 차단에 조용히 걸린다** —
 * 오류도 안 뜨고 탭도 안 열려서 "눌러도 아무 일이 없다" 가 된다.
 * 크롬은 클릭 후 **약 5초까지만** 봐주므로(transient user activation)
 * **빨리 끝나는 문서는 열리고 오래 걸리는 것만 안 열린다** — 이게 고약하다.
 * 실제로 재직증명서(1장)는 멀쩡한데 신규입사 패키지(서류 4종·12장, 서버리스 크로미움
 * 콜드스타트)만 안 열렸다. 겪었다.
 *
 * 그래서 순서를 뒤집는다: **누르는 순간 빈 탭을 먼저 띄우고**(안내문을 그려 둔다)
 * PDF 가 만들어지면 그 탭을 옮긴다. 그래도 막혔으면(브라우저 설정으로 팝업을 아예 끈 경우)
 * **내려받기로 떨어뜨린다** — 어느 쪽이든 사용자는 결과를 손에 쥔다.
 *
 * 쓰는 법 (fetch 보다 **먼저** openPdfTab 을 부를 것):
 * ```ts
 * const win = openPdfTab("신규입사 패키지");
 * const res = await fetch(...);
 * if (!res.ok) { closePdfTab(win); alert(...); return; }
 * await deliverPdf(win, res, "신규입사 패키지");
 * ```
 */

/** 클릭 직후에 부른다. 안내문을 그린 빈 탭을 돌려준다(팝업이 막혔으면 null). */
export function openPdfTab(label: string): Window | null {
  const win = window.open("", "_blank");
  if (!win) return null;
  win.document.write(loadingHtml(label));
  win.document.close();
  return win;
}

/** 실패했을 때 열어 둔 빈 탭을 닫는다 — 안내문만 남으면 계속 기다리게 된다 */
export function closePdfTab(win: Window | null): void {
  try {
    win?.close();
  } catch {
    /* 이미 닫혔거나 접근 불가 — 무시 */
  }
}

/** 받은 PDF 응답을 그 탭에 띄운다. 탭이 없으면 내려받기로 떨어뜨린다. */
export async function deliverPdf(
  win: Window | null,
  res: Response,
  label: string
): Promise<void> {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  if (win && !win.closed) {
    win.location.href = url;
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameOf(res) ?? `${label}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // 새 탭이 다 읽고 난 뒤에 거둔다 — 너무 일찍 거두면 빈 화면이 된다
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}

/** Content-Disposition 의 파일명 — 내려받기로 떨어질 때 쓴다 */
export function filenameOf(res: Response): string | null {
  const cd = res.headers.get("Content-Disposition");
  if (!cd) return null;
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) ?? /filename="?([^";]+)"?/i.exec(cd);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * 빈 탭에 그려 두는 안내문.
 * ⚠ Tailwind 클래스를 쓰지 않는다 — 이 HTML 은 **다른 문서**(새 탭)라 앱의 CSS 가 닿지 않고,
 * `content` 가 `lib/` 를 훑지도 않아 클래스가 생성조차 되지 않는다. 인라인 스타일로 적는다.
 */
export function loadingHtml(label: string): string {
  const t = escapeHtml(label);
  return (
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${t}</title></head>` +
    `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;` +
    `font:15px/1.6 system-ui,-apple-system,'Malgun Gothic',sans-serif;color:#475569">` +
    `<div style="text-align:center">` +
    `<div style="font-weight:700;color:#1e293b">${t}</div>` +
    `<div style="margin-top:6px">문서를 만들고 있습니다… 잠시만 기다려 주세요.</div>` +
    `<div style="margin-top:4px;font-size:13px;color:#94a3b8">서류가 여러 장이면 30초쯤 걸릴 수 있습니다.</div>` +
    `</div></body></html>`
  );
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!
  );
}
