<div align="center">
  <img src="doc/logo-1024.png" alt="R JSON" width="128" />
  <h1>R JSON</h1>
  <p>
    <strong>本地、高性能的 JSON 可视化工具，基于 Rust 与 Tauri 2 构建。</strong>
  </p>
  <p>
    在本机完成 JSON 的解析、查看、转换、查询与代码生成。
  </p>
  <p>
    <img src="https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white" alt="Rust" />
    <img src="https://img.shields.io/badge/Tauri_2-24C8DB?logo=tauri&logoColor=white" alt="Tauri" />
    <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite" />
    <img src="https://img.shields.io/badge/CodeMirror-6-D97706" alt="CodeMirror" />
    <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="Apache-2.0" />
  </p>
  <p>
    <img src="https://img.shields.io/badge/JSON-000000?logo=json&logoColor=white" alt="JSON" />
    <img src="https://img.shields.io/badge/YAML-CB171E?logo=yaml&logoColor=white" alt="YAML" />
    <img src="https://img.shields.io/badge/XML-005FAD?logo=xml&logoColor=white" alt="XML" />
    <img src="https://img.shields.io/badge/CSV-217346?logo=libreoffice&logoColor=white" alt="CSV" />
    <img src="https://img.shields.io/badge/TOML-9C4121?logo=toml&logoColor=white" alt="TOML" />
  </p>
  <p>
    <a href="README.md">English</a> | 中文
  </p>
  <p>
    <img src="doc/01.png" alt="R JSON 树形视图" width="820" />
  </p>
  <p>
    <img src="doc/02.png" alt="R JSON 图形视图" width="820" />
  </p>
</div>

JSON、YAML、XML、CSV、TOML 的解析与索引都在 Rust 中完成。图布局、并行搜索、格式转换、JSON Schema、代码生成、jq、JSONPath、JMESPath 同样运行在 Rust 进程里。Webview 只渲染当前视口，大文件不必整棵拷进 DOM。

## 功能

- 交互式 **树形** 与 **图形** 视图，支持平移、缩放、折叠，以及四种布局方向
- 并排 **JSON 对比**
- 实时编辑器：校验、美化、压缩、转义 / 反转义、修复尾逗号
- **JSON**、**YAML**、**XML**、**CSV**、**TOML** 互相转换
- 生成 **TypeScript**、**Rust**、**Go**、**Kotlin** 与 **JSON Schema**
- 支持 **jq**、**JSONPath**、**JMESPath** 查询
- 按键名、值、路径并行搜索
- 深色 / 浅色主题、拖放打开、全屏、导出 SVG 与 PNG
- 全部在本地处理，数据不会离开本机

## 下载安装

到 [GitHub Releases](https://github.com/runbrick/r-json/releases/latest) 下载对应平台的安装包：

| 平台 | 安装包 |
| --- | --- |
| Windows | `.exe`（NSIS）或 `.msi` |
| macOS | `.dmg`（Apple Silicon 与 Intel） |
| Linux | `.deb`、`.rpm` 或 `.AppImage` |

安装后打开 **R JSON** 即可使用。数据全程留在本机，不会上传。

## 使用

1. **文件 → 打开**（`Ctrl+O`）打开文件，把文件拖进窗口，或用 **文件 → 从剪贴板导入**。
2. 支持 JSON、YAML、XML、CSV、TOML。
3. 左侧编辑。可用 **美化**、**压缩**、**转义**、**反转义**、**压缩转义**。**工具 → 修复 JSON** 可处理尾逗号等问题。
4. 右侧查看：
   - **树形**：展开、折叠节点
   - **图形**：平移、缩放、跟随连线
   - **对比**：打开或粘贴另一份 JSON，并排比较差异
5. 工具栏用 **JMESPath** 或 **JSONPath** 搜索，下拉框可切换查询语言。
6. **工具** 菜单可转换 YAML / XML / CSV / TOML，或生成 TypeScript / Rust / Go / Kotlin / JSON Schema。
7. **Schema** 可对照 JSON Schema 校验。也可从当前 JSON 生成 Schema 再验证。
8. 状态栏可导出当前视图为 **SVG** 或 **PNG**，并切换编辑器、主题和全屏。

## 更新

已安装的应用会检查 [GitHub Releases](https://github.com/runbrick/r-json/releases) 是否有新版本。每个版本的更新说明会写在 Release 页面，**帮助 → 检查更新** 时也能看到同一段内容。启动后等几秒也会自动检查。

## 从源码运行

需要 [Node.js](https://nodejs.org/)（LTS）和 [Rust](https://rustup.rs/)。

```powershell
git clone https://github.com/runbrick/r-json.git
cd r-json
npm install
npm run tauri dev
```

Linux 首次运行前，请先安装 Tauri 所需的 WebKitGTK 等相关依赖。

## 鸣谢

R JSON 离不开这些开源项目：

| 项目 | 用途 |
| --- | --- |
| [Tauri](https://github.com/tauri-apps/tauri) | 桌面壳：原生窗口 + Rust 后端 |
| [Rust](https://www.rust-lang.org/) | 解析、索引、布局、搜索、转换、代码生成与查询 |
| [serde](https://github.com/serde-rs/serde) / [serde_json](https://github.com/serde-rs/json) | JSON 序列化与内存文档模型 |
| [serde_yaml](https://github.com/dtolnay/serde-yaml) | YAML 导入导出 |
| [toml](https://github.com/toml-rs/toml) | TOML 导入导出 |
| [quick-xml](https://github.com/tafia/quick-xml) | XML 转换 |
| [csv](https://github.com/BurntSushi/rust-csv) | CSV 转换 |
| [jaq](https://github.com/01mf02/jaq) | 兼容 jq 的查询 |
| [rayon](https://github.com/rayon-rs/rayon) | 并行搜索 |
| [CodeMirror](https://github.com/codemirror/dev) | Webview 中的 JSON 编辑器 |
| [Vite](https://github.com/vitejs/vite) | 前端构建工具 |
| [JSON Crack](https://github.com/AykutSarac/jsoncrack.com) | 原始界面与思路（Apache-2.0） |

JSON Crack 的界面与思路来自 [AykutSarac/jsoncrack.com](https://github.com/AykutSarac/jsoncrack.com)，采用 Apache-2.0 许可。本项目是独立的 Rust / Tauri 实现，并未复制其源码。

## 许可

R JSON 使用 [Apache License 2.0](LICENSE)。
