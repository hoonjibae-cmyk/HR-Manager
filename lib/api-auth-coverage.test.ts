import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? routeFiles(path)
      : entry.name === "route.ts"
        ? [path]
        : [];
  });
}

const dedicatedAuth = new Set([
  "app/api/auth/login/route.ts",
  "app/api/auth/logout/route.ts",
  "app/api/auth/portal/route.ts",
  "app/api/cron/route.ts",
  "app/api/directory/app-users/route.ts",
  "app/api/directory/teachers/route.ts",
  "app/api/slack/command/route.ts",
  "app/api/slack/events/route.ts",
  "app/api/slack/interactivity/route.ts",
  "app/api/slack/notify/route.ts",
]);

describe("HR API authentication coverage", () => {
  it("protects every non-integration API route with the current HR user check", () => {
    const root = process.cwd();
    const missing = routeFiles(join(root, "app", "api"))
      .map((file) => relative(root, file).replaceAll("\\", "/"))
      .filter((file) => !dedicatedAuth.has(file))
      .filter((file) => !readFileSync(join(root, file), "utf8").includes("isAuthed("));
    expect(missing).toEqual([]);
  });
});
