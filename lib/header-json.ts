// 응답 헤더에 실어 보낸 JSON 풀기 — 헤더는 ASCII 만 실을 수 있어 서버가 base64 로 감싸 보낸다
// (`Buffer.from(JSON.stringify(v), "utf8").toString("base64")` — 급여 화면의 내려받기 경고 `X-Export-Warnings`).
//
// ⚠ **`atob()` 만으로 풀면 한글이 깨진다.** atob 은 바이트를 한 글자씩(Latin-1) 돌려주므로 UTF-8 로 3바이트인
// 한글 한 글자가 'ê°' 같은 글자 셋으로 나온다. 이체 파일·세무사무소 제출자료를 받을 때 뜨는 경고창의
// **직원 이름이 통째로 못 읽는 글자**로 나갔다(실제로 겪었다 — v1.62 에서 발견. '계좌가 없어 빠진 1건: ê°ì…').
// 경고의 알맹이가 '누가' 인데 그 이름이 안 읽히면 경고가 있으나 마나다. 바이트로 되돌려 UTF-8 로 읽는다.

/** base64 로 감싼 UTF-8 JSON → 값. 브라우저·Node 어디서나 같은 결과를 낸다 */
export function decodeHeaderJson<T = any>(raw: string): T {
  const bin = atob(raw.trim());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8").decode(bytes)) as T;
}
