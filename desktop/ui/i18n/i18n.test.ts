import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  dictionaries,
  getLanguage,
  setLanguage,
  subscribe,
  t,
} from "./index";
import { enUS } from "./en-US";
import { zhCN } from "./zh-CN";

beforeEach(() => {
  window.localStorage.clear();
  setLanguage("zh-CN");
});

afterEach(() => {
  window.localStorage.clear();
  setLanguage("en-US");
});

describe("language store", () => {
  it("ships Chinese by default", async () => {
    vi.resetModules();
    const fresh = await import("./index");
    expect(DEFAULT_LANGUAGE).toBe("zh-CN");
    expect(fresh.getLanguage()).toBe("zh-CN");
  });

  it("switches immediately and notifies subscribers", () => {
    setLanguage("en-US");
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    // A switch changes the store synchronously: no reload, no async tick.
    setLanguage("zh-CN");
    expect(getLanguage()).toBe("zh-CN");
    expect(t("settings.title")).toBe("设置");
    expect(listener).toHaveBeenCalledTimes(1);
    setLanguage("en-US");
    expect(getLanguage()).toBe("en-US");
    expect(t("settings.title")).toBe("Settings");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("persists the choice and reads it back on the next load", async () => {
    setLanguage("en-US");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en-US");
    vi.resetModules();
    const fresh = await import("./index");
    expect(fresh.getLanguage()).toBe("en-US");
  });

  it("falls back to Chinese for an unusable stored value", async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr-FR");
    vi.resetModules();
    const fresh = await import("./index");
    expect(fresh.getLanguage()).toBe("zh-CN");
  });

  it("survives a read-only profile", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("read-only");
    });
    expect(() => setLanguage("zh-CN")).not.toThrow();
    expect(getLanguage()).toBe("zh-CN");
    setItem.mockRestore();
  });

  it("keeps the document language in step", () => {
    setLanguage("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    setLanguage("en-US");
    expect(document.documentElement.lang).toBe("en-US");
  });
});

describe("translation", () => {
  it("has exactly the same keys in both dictionaries", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(enUS).sort());
  });

  it("interpolates named variables", () => {
    expect(t("count.turns", { n: 3 })).toBe("3 轮");
    setLanguage("en-US");
    expect(t("count.turns", { n: 3 })).toBe("3 turns");
    expect(t("hero.lastResponse", { n: 1, ago: "just now" })).toBe("last 1 response · just now");
  });

  it("leaves unknown placeholders alone", () => {
    setLanguage("en-US");
    expect(t("hero.vsMedian", { percent: "+4%" })).toBe("+4% vs your 24 h median");
  });

  it("falls back to English when Chinese lacks a key", () => {
    enUS["test.onlyEnglish"] = "Only English";
    try {
      setLanguage("zh-CN");
      expect(t("test.onlyEnglish")).toBe("Only English");
    } finally {
      delete enUS["test.onlyEnglish"];
    }
  });

  it("returns the key itself when neither dictionary has it", () => {
    expect(t("test.missing.key")).toBe("test.missing.key");
  });

  it("uses the glossary wording", () => {
    expect(t("trend.responseSpeed")).toBe("响应吞吐率");
    expect(t("trend.turnSpeed")).toBe("整轮吞吐率");
    expect(t("trend.firstToken")).toBe("首 Token");
    expect(t("status.localOnly")).toBe("仅本地使用");
    expect(t("settings.sources")).toBe("数据源");
  });
});
