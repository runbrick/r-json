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
</div>

JSON, YAML, XML, CSV, and TOML are parsed and indexed in Rust. Graph layout, parallel search, conversion, JSON Schema, code generation, jq, JSONPath, and JMESPath also run in the Rust process. The webview only renders the current viewport, so large documents do not have to be copied into the UI as a DOM tree.

## Features

- Interactive **tree** and **graph** views, with pan, zoom, collapse, and four layout directions
- Live editor with validation, format, minify, escape / unescape, and trailing-comma repair
- Convert between **JSON**, **YAML**, **XML**, **CSV**, and **TOML**
- Generate **TypeScript**, **Rust**, **Go**, **Kotlin**, and **JSON Schema**
- Query with **jq**, **JSONPath**, and **JMESPath**
- Parallel key, value, and path search
- Dark / light themes, drag-and-drop, fullscreen, SVG and PNG export
- Fully local processing — nothing leaves your machine

## Getting Started

```powershell
npm install
npm run tauri dev
```

Release builds use LTO and native optimizations:

```powershell
npm run tauri build
```

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
