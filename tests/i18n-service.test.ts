import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the vscode module before importing I18nService.
const mockConfig: Record<string, unknown> = {};
const mockEnv = { language: "en" };

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultValue: unknown) =>
        mockConfig[key] ?? defaultValue,
    }),
  },
  env: mockEnv,
}));

// Import after mock is set up.
const { I18nService } = await import("../src/services/i18n-service.ts");

describe("I18nService", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockConfig)) delete mockConfig[key];
    mockEnv.language = "en";
  });

  it("translates a known key in English", () => {
    const svc = new I18nService();
    expect(svc.t("host.dshWebNotReady")).toBe("dsh web is not ready");
  });

  it("interpolates params", () => {
    const svc = new I18nService();
    expect(svc.t("host.dshPathUpdated", { path: "/usr/bin/dsh" })).toBe(
      "dsh path updated: /usr/bin/dsh",
    );
  });

  it("falls back to the key when missing", () => {
    const svc = new I18nService();
    expect(svc.t("host.nonExistentKey")).toBe("host.nonExistentKey");
  });

  it("uses zh-cn when vscode.env.language is zh-cn", () => {
    mockEnv.language = "zh-cn";
    const svc = new I18nService();
    expect(svc.currentLocale).toBe("zh-cn");
    expect(svc.t("host.dshWebNotReady")).toBe("dsh web 尚未就绪");
  });

  it("falls back to en for unsupported languages", () => {
    mockEnv.language = "ko";
    const svc = new I18nService();
    expect(svc.currentLocale).toBe("en");
    expect(svc.t("host.dshWebNotReady")).toBe("dsh web is not ready");
  });

  it("honors the locale setting override", () => {
    mockConfig.locale = "ja";
    const svc = new I18nService();
    expect(svc.currentLocale).toBe("ja");
    // Japanese translation should contain dsh
    const translated = svc.t("host.dshWebNotReady");
    expect(translated).toContain("dsh");
  });

  it("refresh() picks up setting changes", () => {
    const svc = new I18nService();
    expect(svc.currentLocale).toBe("en");
    mockConfig.locale = "de";
    svc.refresh();
    expect(svc.currentLocale).toBe("de");
  });
});
