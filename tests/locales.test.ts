import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveLocale,
  loadResource,
  resources,
} from "../src/shared/locales/index.ts";

describe("resolveLocale", () => {
  it("returns the matching locale for supported codes", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("zh-cn")).toBe("zh-cn");
    expect(resolveLocale("zh-tw")).toBe("zh-tw");
    expect(resolveLocale("ja")).toBe("ja");
    expect(resolveLocale("de")).toBe("de");
    expect(resolveLocale("fr")).toBe("fr");
    expect(resolveLocale("es")).toBe("es");
  });

  it("normalizes case", () => {
    expect(resolveLocale("EN")).toBe("en");
    expect(resolveLocale("ZH-CN")).toBe("zh-cn");
    expect(resolveLocale("Ja")).toBe("ja");
  });

  it("maps bare 'zh' to zh-cn", () => {
    expect(resolveLocale("zh")).toBe("zh-cn");
  });

  it("falls back to DEFAULT_LOCALE for unsupported codes", () => {
    expect(resolveLocale("ko")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("ru")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("pt-br")).toBe(DEFAULT_LOCALE);
  });

  it("falls back to DEFAULT_LOCALE for undefined", () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });
});

describe("SUPPORTED_LOCALES", () => {
  it("includes all 7 locales", () => {
    expect(SUPPORTED_LOCALES).toHaveLength(7);
    expect([...SUPPORTED_LOCALES]).toEqual([
      "en",
      "zh-cn",
      "zh-tw",
      "ja",
      "de",
      "fr",
      "es",
    ]);
  });
});

describe("resources", () => {
  it("has a translation bundle for every supported locale", () => {
    for (const code of SUPPORTED_LOCALES) {
      expect(resources[code]).toBeDefined();
      expect(resources[code]?.translation).toBeDefined();
      expect(typeof resources[code]?.translation).toBe("object");
    }
  });
});

describe("loadResource", () => {
  it("returns the correct bundle for a supported code", () => {
    const en = loadResource("en");
    expect(en).toHaveProperty("status");
    expect((en as Record<string, unknown>).status).toHaveProperty("ready");
  });

  it("returns the English bundle for an unsupported code", () => {
    const fallback = loadResource("xx");
    const en = loadResource("en");
    expect(fallback).toBe(en);
  });

  it("returns a bundle with the expected structure", () => {
    const zhCn = loadResource("zh-cn") as Record<string, Record<string, unknown>>;
    expect(zhCn).toHaveProperty("common");
    expect(zhCn).toHaveProperty("status");
    expect(zhCn).toHaveProperty("chat");
    expect(zhCn).toHaveProperty("host");
    expect(zhCn.status).toHaveProperty("ready");
  });
});
