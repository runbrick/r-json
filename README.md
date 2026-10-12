# R JSON

A local, high-performance JSON Crack-style visualizer built with Rust and Tauri 2.

JSON, YAML, XML, CSV, and TOML are parsed and indexed in Rust. Graph layout, parallel search, conversion, JSON Schema, code generation, jq, and JSON Path also run in the Rust process. The webview only renders the current viewport, so large documents do not have to be copied into the UI as a DOM tree.

## Features

- Interactive graph and tree views, with pan, zoom, collapse, and four layout directions
- Live editor, validation, format, minify, and trailing-comma repair
- Conversion between JSON, YAML, XML, CSV, and TOML
- TypeScript, Rust, Go, Kotlin, and JSON Schema generation
- jq and JSON Path queries
- Parallel key, value, and path search
- Dark and light themes, drag-and-drop, SVG and PNG export
- Fully local processing

## Run

```powershell
npm install
npm run tauri dev
```

Release builds use LTO and native optimizations:

```powershell
npm run tauri build
```

The original JSON Crack interface and idea are from [AykutSarac/jsoncrack.com](https://github.com/AykutSarac/jsoncrack.com), licensed under Apache-2.0. This project is an independent Rust/Tauri implementation and does not copy that project's source.
