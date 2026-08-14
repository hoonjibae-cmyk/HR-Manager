// 구글 드라이브 저장소 — 이름 짓기와 오류 안내(순수 부분만).
//
// 실제 업로드는 서비스 계정 키가 있어야 하므로 여기서 다루지 않는다.
// 그건 설정 화면의 *구글 드라이브 연결 테스트* 가 시험 업로드까지 해서 확인한다.

import { describe, it, expect } from "vitest";
import { driveHint, employeeFolderName, driveFileName, sanitizeDriveName, escapeQuery } from "./gdrive";

describe("이름 짓기", () => {
  it("직원 폴더는 사번을 앞에 둔다 — 동명이인이 섞이지 않게", () => {
    expect(employeeFolderName({ empNo: "E001", name: "김지연" })).toBe("E001 김지연");
    expect(employeeFolderName({ empNo: null, name: "김지연" })).toBe("김지연");
  });

  // 드라이브 기본 정렬이 이름순이라, 날짜가 앞에 없으면 어느 계약의 스캔본인지 모른다
  it("파일 이름 앞에 계약 시작일을 붙인다", () => {
    expect(driveFileName("2025-10-01", "근로계약서_김지연.pdf")).toBe(
      "2025-10-01 근로계약서_김지연.pdf"
    );
  });

  it("슬래시를 지운다 — 내려받을 때 경로로 오해된다", () => {
    expect(sanitizeDriveName("계약/서.pdf")).toBe("계약_서.pdf");
  });

  it("제어문자를 털고 공백을 정리한다", () => {
    expect(sanitizeDriveName("계약서\n\n  스캔.pdf")).toBe("계약서 스캔.pdf");
  });

  it("이름이 비면 기본 이름을 준다", () => {
    expect(sanitizeDriveName("   ")).toBe("계약서스캔");
  });
});

describe("검색 질의 이스케이프", () => {
  // 이름은 직원 이름에서 오므로 따옴표가 들어갈 수 있다. 그대로 이어붙이면 질의가 깨진다
  it("작은따옴표를 escape 한다", () => {
    expect(escapeQuery("O'Brien")).toBe("O\\'Brien");
    expect(escapeQuery("a\\b")).toBe("a\\\\b");
  });
});

describe("오류 안내 — 무엇을 하면 되는지까지", () => {
  /*
   * 가장 중요한 케이스. 개인(내) 드라이브 폴더를 쓰면 **조회는 되고 업로드만** 막히는데,
   * 원문은 "storageQuotaExceeded" 라 용량이 찬 것으로 읽힌다. 실제로는 계정 종류 문제다.
   */
  it("**storageQuotaExceeded 는 '용량 부족' 이 아니라 '공유 드라이브가 필요하다' 로 풀어 적는다**", () => {
    const h = driveHint(403, "storageQuotaExceeded", "Service Accounts do not have storage quota.");
    expect(h).toContain("공유 드라이브");
    expect(h).toContain("Workspace");
    // Workspace 가 아니면 어떻게 하라는 것까지 적는다
    expect(h).toContain("DB");
    expect(h).not.toMatch(/용량이 (가득|부족)/);
  });

  it("API 미사용 설정은 켜는 자리를 알려 준다", () => {
    expect(driveHint(403, "accessNotConfigured", "Google Drive API has not been used")).toContain(
      "라이브러리"
    );
  });

  // 공유하지 않은 폴더는 '없음'(404)으로 나온다 — ID 오타로만 읽히면 영영 못 고친다
  it("404 는 ID 오타와 **공유 누락**을 함께 짚는다", () => {
    const h = driveHint(404, "notFound", "File not found");
    expect(h).toContain("공유");
    expect(h).toContain("GOOGLE_DRIVE_CONTRACT_FOLDER_ID");
  });

  it("403 은 권한 등급을 짚는다", () => {
    expect(driveHint(403, "insufficientPermissions", "")).toContain("콘텐츠 관리자");
  });

  it("모르는 오류는 원문을 그대로 보여 준다", () => {
    expect(driveHint(500, "backendError", "Internal error")).toBe("Internal error");
  });
});
