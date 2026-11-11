import { renderWindowControls } from "./controls";
import type { PlatformTitlebar } from "./types";
import "./linux.css";

export const linuxTitlebar: PlatformTitlebar = {
  render: (host) => renderWindowControls(host, {
    minimize: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg>',
    maximize: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" /></svg>',
    restore: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4h6v6M4 6h6v6H4z" /></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>',
  }),
};
