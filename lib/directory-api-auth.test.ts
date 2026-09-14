import { afterEach, describe, expect, it } from "vitest";
import { appAccessMap } from "./app-access";
import { directoryApiKey, directoryRequestAuthorized } from "./directory-api-auth";

const originalDirectoryKey = process.env.DIRECTORY_API_KEY;
const originalVocaKey = process.env.VOCA_DIRECTORY_API_KEY;

afterEach(() => {
  if (originalDirectoryKey === undefined) delete process.env.DIRECTORY_API_KEY;
  else process.env.DIRECTORY_API_KEY = originalDirectoryKey;
  if (originalVocaKey === undefined) delete process.env.VOCA_DIRECTORY_API_KEY;
  else process.env.VOCA_DIRECTORY_API_KEY = originalVocaKey;
});

describe("application directory access", () => {
  it("exposes yussam-voca only to the approved departments", () => {
    expect(appAccessMap("yussam-voca")).toEqual({
      교수부: "user",
      교육운영팀: "user",
      경영지원: "admin",
    });
  });

  it("uses the dedicated Voca key when configured", () => {
    process.env.DIRECTORY_API_KEY = "shared-key";
    process.env.VOCA_DIRECTORY_API_KEY = "voca-key";

    expect(directoryApiKey("yussam-voca")).toBe("voca-key");
    expect(directoryRequestAuthorized("yussam-voca", "voca-key")).toBe(true);
    expect(directoryRequestAuthorized("yussam-voca", "shared-key")).toBe(false);
    expect(directoryRequestAuthorized("omr-report", "shared-key")).toBe(true);
  });

  it("falls back to the shared key when no dedicated key exists", () => {
    process.env.DIRECTORY_API_KEY = "shared-key";
    delete process.env.VOCA_DIRECTORY_API_KEY;
    expect(directoryRequestAuthorized("yussam-voca", "shared-key")).toBe(true);
  });
});