export type DesktopPlatform = "windows" | "macos" | "linux" | "other";

export interface WindowControls {
  minimize: HTMLButtonElement;
  maximize: HTMLButtonElement;
  close: HTMLButtonElement;
}

export interface PlatformTitlebar {
  render(host: HTMLElement): WindowControls | null;
}
