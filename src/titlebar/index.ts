import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { bindWindowControls } from "./controls";
import { fallbackTitlebar } from "./fallback";
import { linuxTitlebar } from "./linux";
import { macosTitlebar } from "./macos";
import { initializeMacosMenu } from "./macos-menu";
import type { DesktopPlatform, PlatformTitlebar } from "./types";
import { windowsTitlebar } from "./windows";
import "./titlebar.css";

const titlebars: Record<DesktopPlatform, PlatformTitlebar> = {
  windows: windowsTitlebar,
  macos: macosTitlebar,
  linux: linuxTitlebar,
  other: fallbackTitlebar,
};

function browserPlatform(): DesktopPlatform {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  if (platform.startsWith("win") || userAgent.includes("windows")) return "windows";
  if (platform.includes("mac") || /macintosh|mac os|iphone|ipad/.test(userAgent)) return "macos";
  if (platform.includes("linux") || userAgent.includes("linux")) return "linux";
  return "other";
}

export async function initializeTitlebar() {
  // The desktop platform must agree with the native window configuration.
  // Navigator detection is only used for the browser preview.
  const desktop = isTauri();
  const platform = desktop ? await invoke<DesktopPlatform>("window_platform") : browserPlatform();
  document.documentElement.dataset.platform = platform;
  const host = document.querySelector<HTMLElement>("#window-controls")!;
  const controls = (titlebars[platform] ?? fallbackTitlebar).render(host);
  if (desktop && platform === "macos") await initializeMacosMenu();
  if (!controls) return;
  if (desktop) {
    await bindWindowControls(controls, getCurrentWindow());
  } else {
    // Browser previews have no desktop window to control.
    Object.values(controls).forEach((button) => { button.disabled = true; });
  }
}
