import { renderWindowControls } from "./controls";
import type { PlatformTitlebar } from "./types";
import "./windows.css";

export const windowsTitlebar: PlatformTitlebar = {
  render: (host) => renderWindowControls(host, {
    minimize: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" /></svg>',
    maximize: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" /></svg>',
    restore: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5h5.5v5.5M1.5 3.5h5.5v5.5H1.5z" /></svg>',
    close: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>',
  }),
};
