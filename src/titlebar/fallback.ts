import { renderWindowControls } from "./controls";
import type { PlatformTitlebar } from "./types";
import "./fallback.css";

export const fallbackTitlebar: PlatformTitlebar = {
  render: (host) => renderWindowControls(host, {
    minimize: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>',
    maximize: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1" /></svg>',
    restore: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M3 6h7v7H3z" /></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10m0-10L3 13" /></svg>',
  }),
};
