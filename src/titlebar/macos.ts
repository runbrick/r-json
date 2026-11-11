import type { PlatformTitlebar } from "./types";
import "./macos.css";

export const macosTitlebar: PlatformTitlebar = {
  render(host) {
    // AppKit draws and handles the real traffic lights, including hover, focus,
    // Option-click and the system fullscreen menu. See tauri.macos.conf.json.
    host.replaceChildren();
    return null;
  },
};
