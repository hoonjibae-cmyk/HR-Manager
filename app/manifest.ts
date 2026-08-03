import type { MetadataRoute } from "next";

/**
 * PWA 매니페스트 — 휴대폰에서 '홈 화면에 추가' 하면 앱처럼 열린다.
 * 관리자가 이동 중에 명세서 발송·연차 반영을 확인하는 일이 잦아 주소창 없는 전체화면으로 띄운다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "유쌤에듀 HR 관리",
    short_name: "유쌤에듀 HR",
    description: "주식회사 유쌤에듀 인사·급여·연차·보강 관리 프로그램",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#eef4ff",
    theme_color: "#1733e1",
    lang: "ko",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // 안드로이드는 아이콘을 원형 등으로 잘라 쓰므로 여백을 둔 판을 따로 준다
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
