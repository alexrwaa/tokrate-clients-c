// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { LANGUAGE_STORAGE_KEY, setLanguage } from "../i18n";
import { createPreviewBridge } from "../store/preview";
import { AppStore } from "../store/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.localStorage.clear();
  setLanguage("en-US");
});

describe("the language setting", () => {
  it("renders Chinese by default and switches to English on the spot", async () => {
    setLanguage("zh-CN");
    const store = new AppStore(createPreviewBridge({ scenario: "default", view: "settings" }), {});
    await act(async () => {
      root.render(<App store={store} kind="flyout" />);
      await store.refresh();
    });
    await act(async () => store.openSettings());

    // Chinese is live: the settings heading and the language row are in Chinese.
    expect(host.textContent).toContain("设置");
    expect(host.textContent).toContain("语言");
    expect(host.textContent).toContain("简体中文");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("zh-CN");

    // The English option applies without a reload.
    const english = [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")].find(
      (button) => button.textContent === "English",
    );
    expect(english).toBeDefined();
    await act(async () => english!.click());

    expect(host.textContent).toContain("Settings");
    expect(host.textContent).toContain("Language");
    expect(host.textContent).not.toContain("设置");
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en-US");
  });
});
