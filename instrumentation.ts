// Next.js instrumentation hook — 서버 부팅 시 1회 실행.
// 상시 구동 환경(next start)에서 내부 스케줄러를 기동한다.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
