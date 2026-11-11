# 平台标题栏

顶部业务菜单保留在 `index.html`，菜单事件由 `src/main.ts` 的 `bindMenus()` 统一绑定。窗口按钮的绘制和平台布局由 `src/titlebar/` 管理，修改某个平台无需修改其他平台的绘制文件。

| 平台 | 绘制入口 | 样式 | 窗口按钮 |
| --- | --- | --- | --- |
| Windows | `windows.ts` | `windows.css` | 自绘 SVG，调用 Tauri 最小化、最大化／还原、关闭接口 |
| macOS | `macos.ts` | `macos.css` | AppKit 原生红黄绿按钮，保留系统悬停、非激活状态及全屏交互 |
| Linux | `linux.ts` | `linux.css` | 独立的圆形按钮样式和 SVG，调用 Tauri 窗口接口 |
| 其他 | `fallback.ts` | `fallback.css` | 独立的通用 SVG 按钮 |

`index.ts` 负责选择平台；桌面环境通过 Rust 的 `window_platform` 命令获取实际编译平台，浏览器预览使用 Navigator 检测。`controls.ts` 仅共享按钮结构、可访问性标签、窗口操作与最大化状态同步。`titlebar.css` 定义公共布局，各平台 CSS 限定在自己的 `data-platform` 下。

Windows 和 Linux 使用 `src-tauri/tauri.conf.json` 的无边框窗口。macOS 自动合并 `src-tauri/tauri.macos.conf.json`，使用 `decorations: true`、`titleBarStyle: "Overlay"` 和 `hiddenTitle: true`，在系统标题栏下绘制菜单背景，并为左侧原生按钮保留空间。不要在 macOS 分支添加模拟红黄绿按钮；原生按钮的形状、位置和交互交给系统处理。

Tauri 合并平台配置时会替换整个 `app.windows` 数组，因此 macOS 配置需同时保留窗口大小、最小尺寸、居中及缩放设置。更改公共窗口参数时应同步检查此配置。

拖拽和标题栏双击行为继续由 Tauri 的 `data-tauri-drag-region` 处理。菜单按钮和窗口按钮不属于拖拽区域。浏览器预览不具备原生窗口能力，Windows／Linux／其他平台的窗口按钮处于禁用状态；macOS 原生按钮只会出现在实际桌面应用中。

验证修改时运行 `npm run build` 和 `cargo check --locked`，并在对应系统运行桌面应用，检查拖拽、双击、最小化、最大化／还原、关闭、菜单及浅深色主题。macOS 还需检查原生按钮悬停、窗口失焦及进入／退出系统全屏。
