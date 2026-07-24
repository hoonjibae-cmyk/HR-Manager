import { readdirSync, existsSync, statSync } from "fs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PDF/Chromium 런타임 진단용 (문제 해결 후 제거 예정). 민감정보 없음.
export async function GET(_req: Request) {
  const info: any = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    vercel: process.env.VERCEL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    awsExecEnv: process.env.AWS_EXECUTION_ENV ?? null,
    ldLibraryPathBefore: process.env.LD_LIBRARY_PATH ?? null,
  };

  const findLib = (dir: string, name: string, depth = 2): string | null => {
    if (depth < 0 || !existsSync(dir)) return null;
    try {
      for (const e of readdirSync(dir)) {
        const p = dir + "/" + e;
        if (e === name) return p;
        try {
          if (statSync(p).isDirectory()) {
            const r = findLib(p, name, depth - 1);
            if (r) return r;
          }
        } catch {}
      }
    } catch {}
    return null;
  };

  try {
    const { searchParams } = new URL(_req.url);
    const packUrl =
      searchParams.get("pack") ||
      process.env.CHROMIUM_PACK_URL ||
      "https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar";
    info.packUrl = packUrl;

    const chromium = (await import("@sparticuz/chromium-min")).default;
    const t0 = Date.now();
    const exe = await chromium.executablePath(packUrl);
    info.executablePath = exe;
    info.executablePathMs = Date.now() - t0;
    info.exeExists = exe ? existsSync(exe) : false;
    info.ldLibraryPathAfter = process.env.LD_LIBRARY_PATH ?? null;
    info.tmp = existsSync("/tmp") ? readdirSync("/tmp").slice(0, 40) : null;
    info.libnss3 = findLib("/tmp", "libnss3.so", 3);

    // 실제 브라우저 실행 시도
    const puppeteer = (await import("puppeteer-core")).default;
    const t1 = Date.now();
    const browser = await puppeteer.launch({
      executablePath: exe,
      args: chromium.args,
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport,
    });
    info.launchMs = Date.now() - t1;
    info.launched = true;
    const page = await browser.newPage();
    await page.setContent("<b>ok</b>", { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4" });
    info.pdfBytes = pdf.length;
    await browser.close();
    info.result = "SUCCESS ✅";
  } catch (e: any) {
    info.result = "FAILED ❌";
    info.error = String(e?.message || e);
    info.stack = String(e?.stack || "").split("\n").slice(0, 6);
    info.ldLibraryPathAfter = process.env.LD_LIBRARY_PATH ?? null;
    info.tmp = existsSync("/tmp") ? readdirSync("/tmp").slice(0, 40) : null;
    info.libnss3 = findLib("/tmp", "libnss3.so", 3);
  }

  return new Response(JSON.stringify(info, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
