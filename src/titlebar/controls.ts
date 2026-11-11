import type { Window } from "@tauri-apps/api/window";
import type { WindowControls } from "./types";

interface ControlIcons {
  minimize: string;
  maximize: string;
  restore: string;
  close: string;
}

// Only button semantics and window actions are shared. Each platform owns its icons and CSS.
export function renderWindowControls(host: HTMLElement, icons: ControlIcons): WindowControls {
  host.innerHTML = `
    <button class="window-button window-minimize" type="button" title="最小化" aria-label="最小化">${icons.minimize}</button>
    <button class="window-button window-maximize" type="button" title="最大化" aria-label="最大化">
      <span class="maximize-icon">${icons.maximize}</span>
      <span class="restore-icon" hidden>${icons.restore}</span>
    </button>
    <button class="window-button window-close" type="button" title="关闭" aria-label="关闭">${icons.close}</button>
  `;
  return {
    minimize: host.querySelector<HTMLButtonElement>(".window-minimize")!,
    maximize: host.querySelector<HTMLButtonElement>(".window-maximize")!,
    close: host.querySelector<HTMLButtonElement>(".window-close")!,
  };
}

export async function bindWindowControls(controls: WindowControls, appWindow: Window) {
  const reportError = (error: unknown) => console.error("Window control failed:", error);
  const syncMaximized = async () => {
    const maximized = await appWindow.isMaximized();
    document.documentElement.classList.toggle("maximized", maximized);
    controls.maximize.querySelector<HTMLElement>(".maximize-icon")!.hidden = maximized;
    controls.maximize.querySelector<HTMLElement>(".restore-icon")!.hidden = !maximized;
    const label = maximized ? "还原" : "最大化";
    controls.maximize.title = label;
    controls.maximize.setAttribute("aria-label", label);
  };

  controls.minimize.onclick = () => void appWindow.minimize().catch(reportError);
  controls.maximize.onclick = () => void appWindow.toggleMaximize().then(syncMaximized).catch(reportError);
  controls.close.onclick = () => void appWindow.close().catch(reportError);

  const unlisten = await appWindow.onResized(() => void syncMaximized().catch(reportError));
  window.addEventListener("pagehide", () => unlisten(), { once: true });
  await syncMaximized();
}
