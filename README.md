<div align="center">
  <img src="doc/logo-1024.png" alt="R JSON" width="128" />
  <h1>R JSON</h1>
  <p>
    <strong>A local, high-performance JSON visualizer built with Rust and Tauri 2.</strong>
  </p>
  <p>
    Parse, inspect, convert, query, and generate code from JSON — entirely on your machine.
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
    English | <a href="README.zh-CN.md">中文</a>
  </p>
  <p>
    <img src="doc/01.png" alt="R JSON tree view" width="820" />
  </p>
  <p>
    <img src="doc/02.png" alt="R JSON graph view" width="820" />
  </p>
</div>

JSON, YAML, XML, CSV, and TOML are parsed and indexed in Rust. Graph layout, parallel search, conversion, JSON Schema, code generation, jq, JSONPath, and JMESPath also run in the Rust process. The webview only renders the current viewport, so large documents do not have to be copied into the UI as a DOM tree.

## Features

- Interactive **tree** and **graph** views, with pan, zoom, collapse, and four layout directions
- Side-by-side **JSON comparison**
- Live editor with validation, format, minify, escape / unescape, and trailing-comma repair
- Convert between **JSON**, **YAML**, **XML**, **CSV**, and **TOML**
- Generate **TypeScript**, **Rust**, **Go**, **Kotlin**, and **JSON Schema**
- Query with **jq**, **JSONPath**, and **JMESPath**
- Parallel key, value, and path search
- Dark / light themes, drag-and-drop, fullscreen, SVG and PNG export
- Fully local processing — nothing leaves your machine

## Download and install

Grab the latest installer from [GitHub Releases](https://github.com/runbrick/r-json/releases/latest):

| Platform | Package |
| --- | --- |
| Windows | `.exe` (NSIS) or `.msi` |
| macOS | `.dmg` (Apple Silicon and Intel) |
| Linux | `.deb`, `.rpm`, or `.AppImage` |

After installing, launch **R JSON**. The app stays on your machine; documents are never uploaded.

## Usage

1. Open a file with **文件 → 打开** (`Ctrl+O`), drag a file onto the window, or paste with **文件 → 从剪贴板导入**.
2. Supported formats: JSON, YAML, XML, CSV, and TOML.
3. Edit on the left. Use **美化**, **压缩**, **转义**, **反转义**, or **压缩转义**. **工具 → 修复 JSON** repairs trailing commas and similar issues.
4. Inspect on the right:
   - **树形**: expand and collapse nodes
   - **图形**: pan, zoom, and follow links
   - **对比**: open or paste a second JSON document and compare
5. Search with **JMESPath** or **JSONPath** in the toolbar. Switch the query language from the dropdown.
6. Convert or generate from **工具**: YAML / XML / CSV / TOML, or TypeScript / Rust / Go / Kotlin / JSON Schema.
7. Validate against a schema with **Schema**. Generate a schema from the current JSON, then run the check.
8. Export the current view as **SVG** or **PNG** from the status bar. Toggle the editor, theme, and fullscreen there as well.

## Updates

Installed copies check [GitHub Releases](https://github.com/runbrick/r-json/releases) for a newer version. Each release includes the changelog for that version; the same notes appear in **帮助 → 检查更新**. You can also wait a few seconds after launch — the app checks automatically.

## Run from source

You need [Node.js](https://nodejs.org/) (LTS) and [Rust](https://rustup.rs/).

```powershell
git clone https://github.com/runbrick/r-json.git
cd r-json
npm install
npm run tauri dev
```

On Linux, install the WebKitGTK and related packages that Tauri requires before the first run.

## Acknowledgements

R JSON stands on the shoulders of these open-source projects:

| Project | Role |
| --- | --- |
| [Tauri](https://github.com/tauri-apps/tauri) | Desktop shell that hosts the app with a native window and a Rust backend |
| [Rust](https://www.rust-lang.org/) | Parsing, indexing, layout, search, conversion, codegen, and queries |
| [serde](https://github.com/serde-rs/serde) / [serde_json](https://github.com/serde-rs/json) | JSON serialization and the in-memory document model |
| [serde_yaml](https://github.com/dtolnay/serde-yaml) | YAML import and export |
| [toml](https://github.com/toml-rs/toml) | TOML import and export |
| [quick-xml](https://github.com/tafia/quick-xml) | XML conversion |
| [csv](https://github.com/BurntSushi/rust-csv) | CSV conversion |
| [jaq](https://github.com/01mf02/jaq) | jq-compatible queries |
| [rayon](https://github.com/rayon-rs/rayon) | Parallel search |
| [CodeMirror](https://github.com/codemirror/dev) | JSON editor in the webview |
| [Vite](https://github.com/vitejs/vite) | Frontend toolchain |
| [JSON Crack](https://github.com/AykutSarac/jsoncrack.com) | Original interface and idea (Apache-2.0) |

JSON Crack's interface and idea are from [AykutSarac/jsoncrack.com](https://github.com/AykutSarac/jsoncrack.com), licensed under Apache-2.0. This project is an independent Rust/Tauri implementation and does not copy that project's source.

## License

R JSON is licensed under the [Apache License 2.0](LICENSE).
