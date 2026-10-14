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
- 实时编辑器：校验、美化、压缩、转义 / 反转义、修复尾逗号
- **JSON**、**YAML**、**XML**、**CSV**、**TOML** 互相转换
- 生成 **TypeScript**、**Rust**、**Go**、**Kotlin** 与 **JSON Schema**
- 支持 **jq**、**JSONPath**、**JMESPath** 查询
- 按键名、值、路径并行搜索
- 深色 / 浅色主题、拖放打开、全屏、导出 SVG 与 PNG
- 全部在本地处理，数据不会离开本机

## 运行

```powershell
npm install
npm run tauri dev
```

发布构建会启用 LTO 与原生优化：

```powershell
npm run tauri build
```

## 自动更新与 GitHub 发版

已安装的应用会检查 [GitHub Releases](https://github.com/runbrick/r-json/releases) 是否有新版本，下载签名后的安装包、校验后自动安装。

### 一次性准备

1. 如果还没有更新签名密钥，先生成一对：

```powershell
npm run tauri signer generate -- -w "$HOME\.tauri\r-json.key"
```

2. 打开 GitHub 仓库 **Settings → Secrets and variables → Actions**，添加：

| Secret | 值 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `r-json.key` 的完整内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 密钥密码；没有密码就留空 |

私钥务必另外备份。私钥丢了，已经装过的旧版本就没法再收到签名更新。

3. 在 **Settings → Actions → General → Workflow permissions** 里打开 **Read and write permissions**，这样工作流才能创建 Release。

公钥已经写在 `src-tauri/tauri.conf.json` 里。私钥不要提交到 git。

仓库需要是公开的，否则应用无法匿名下载 `latest.json`。

### 发布一个新版本

版本号以 `package.json` 为准。`tauri.conf.json` 会读取它，`npm version` 还会同步 `src-tauri/Cargo.toml`。

```powershell
npm version 0.2.0
git push origin master
git push origin v0.2.0
```

也可以用 `npm version patch`、`npm version minor` 或 `npm version major`。这条命令会改 `package.json`、同步 Cargo 文件、提交，并打上 `v*` tag。

推送 `v*` tag 会触发 `.github/workflows/release.yml`。它会构建 Windows / macOS / Linux 安装包，签名更新文件，创建 GitHub Release，并上传 `latest.json`。

工作流跑完后：

1. 打开 Release 页面，确认安装包和 `latest.json` 都在附件里。
2. 安装旧版本，然后用 **帮助 → 检查更新**，或启动几秒后等待自动检查。

也可以在 **Actions** 页手动运行 **Publish**。版本号仍然以 `package.json` 为准。

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
