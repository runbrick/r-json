import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

type ValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";
type Direction = "RIGHT" | "LEFT" | "DOWN" | "UP";

interface FieldRow {
  key: string;
  value: string;
  kind: ValueKind;
}

interface GraphNode {
  id: number;
  key: string | null;
  kind: ValueKind;
  preview: string;
  childCount: number;
  path: string;
  collapsed: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: FieldRow[];
}

interface GraphEdge {
  from: number;
  to: number;
  label: string;
}

interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodes: number;
  truncated: boolean;
  bounds: { width: number; height: number };
}

interface TreeNode {
  id: number;
  key: string | null;
  kind: ValueKind;
  preview: string;
  childCount: number;
  path: string;
  children: TreeNode[];
  truncatedChildren: boolean;
}

interface LoadedDocument {
  format: string;
  pretty: string;
  stats: {
    bytes: number;
    nodes: number;
    depth: number;
    parseMs: number;
    layoutMs: number;
  };
  graph: GraphPayload;
  tree: TreeNode[];
  error: string | null;
}

interface SearchHit {
  nodeId: number;
  path: string;
  key: string | null;
  preview: string;
}

const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
const nodesLayer = document.querySelector<HTMLElement>("#nodes")!;
const edges = document.querySelector<SVGSVGElement>("#edges")!;
const viewport = document.querySelector<HTMLElement>("#viewport")!;
const canvasPane = document.querySelector<HTMLElement>("#canvas-pane")!;
const treePane = document.querySelector<HTMLElement>("#tree")!;
const stats = document.querySelector<HTMLElement>("#stats")!;
const validity = document.querySelector<HTMLElement>("#validity")!;
const fileLabel = document.querySelector<HTMLElement>("#file-label")!;
const emptyState = document.querySelector<HTMLElement>("#empty")!;
const searchResults = document.querySelector<HTMLElement>("#search-results")!;
const modal = document.querySelector<HTMLElement>("#modal")!;
const modalTitle = document.querySelector<HTMLElement>("#modal-title")!;
const modalBody = document.querySelector<HTMLElement>("#modal-body")!;

const camera = { x: 40, y: 30, scale: 1 };
let graph: GraphPayload | null = null;
let selectedId: number | null = null;
let fileName = "Untitled.json";
let liveTimer = 0;
let searchTimer = 0;
let currentView: "graph" | "tree" = "graph";
let selectedPath = "$";

const SAMPLE = `{
  "project": "R JSON",
  "inspiredBy": "JSON Crack",
  "local": true,
  "users": [
    { "id": 1, "name": "Ada", "active": true, "score": 98.5 },
    { "id": 2, "name": "Lin", "active": false, "score": null }
  ],
  "features": {
    "graph": true,
    "search": "parallel",
    "formats": ["json", "yaml", "xml", "csv", "toml"]
  }
}`;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function applyCamera() {
  viewport.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
}

function showError(message: string) {
  validity.textContent = "● Invalid";
  validity.classList.add("error");
  validity.title = message;
}

function showValid(documentState: LoadedDocument) {
  validity.textContent = "● Valid";
  validity.classList.remove("error");
  validity.title = "";
  const size = (documentState.stats.bytes / 1024).toFixed(1);
  stats.textContent = `${documentState.stats.nodes.toLocaleString()} nodes · depth ${documentState.stats.depth} · ${size} KB · parse ${documentState.stats.parseMs} ms`;
  if (documentState.graph.truncated) {
    stats.textContent += " · graph truncated for responsiveness";
  }
}

async function loadContents(contents: string, name = fileName) {
  fileName = name;
  fileLabel.textContent = name;
  document.title = `${name} | R JSON`;
  try {
    const loaded = await invoke<LoadedDocument>("load_document", { contents, fileName: name });
    editor.value = loaded.pretty;
    graph = loaded.graph;
    emptyState.classList.add("hidden");
    renderGraph();
    renderTree(loaded.tree);
    showValid(loaded);
    centerView();
  } catch (error) {
    showError(String(error));
  }
}

function renderGraph() {
  if (!graph) return;
  nodesLayer.replaceChildren();
  const nodeLookup = new Map(graph.nodes.map((node) => [node.id, node]));
  edges.setAttribute("width", String(graph.bounds.width));
  edges.setAttribute("height", String(graph.bounds.height));
  edges.style.width = `${graph.bounds.width}px`;
  edges.style.height = `${graph.bounds.height}px`;
  edges.innerHTML = graph.edges
    .map((edge) => {
      const from = nodeLookup.get(edge.from);
      const to = nodeLookup.get(edge.to);
      if (!from || !to) return "";
      const startX = from.x + from.width;
      const startY = from.y + from.height / 2;
      const endX = to.x;
      const endY = to.y + 18;
      const curve = Math.max(36, (endX - startX) / 2);
      return `<path d="M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}" />`;
    })
    .join("");

  const fragment = document.createDocumentFragment();
  for (const node of graph.nodes) {
    const card = document.createElement("article");
    card.className = `node${node.id === selectedId ? " selected" : ""}`;
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.width = `${node.width}px`;
    card.style.height = `${node.height}px`;
    const title = node.key ?? "$";
    const rows = node.rows
      .map((row) => `<div class="node-row"><span class="key">${escapeHtml(row.key)}</span><span class="${escapeHtml(row.kind)}">${escapeHtml(row.value)}</span></div>`)
      .join("");
    card.innerHTML = `<header><button class="collapse">${node.collapsed ? "+" : "–"}</button><span>${escapeHtml(title)}</span><span class="preview">${escapeHtml(node.preview)}</span></header>${rows}`;
    card.addEventListener("click", () => selectNode(node.id));
    card.querySelector("button")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      graph = await invoke<GraphPayload>("toggle_node", { nodeId: node.id });
      renderGraph();
    });
    fragment.append(card);
  }
  nodesLayer.append(fragment);
}

function renderTree(nodes: TreeNode[]) {
  treePane.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const node of nodes) fragment.append(renderTreeNode(node));
  treePane.append(fragment);
}

function renderTreeNode(node: TreeNode): HTMLElement {
  const details = document.createElement("details");
  details.open = node.children.length > 0 && node.children.length < 40;
  const summary = document.createElement("button");
  summary.className = "tree-row";
  summary.innerHTML = `<strong class="key">${escapeHtml(node.key ?? "$")}</strong> <span class="${node.kind}">${escapeHtml(node.preview)}</span>`;
  summary.addEventListener("click", () => selectNode(node.id));
  details.append(summary);
  if (node.children.length) {
    const children = document.createElement("div");
    children.className = "tree-children";
    for (const child of node.children) children.append(renderTreeNode(child));
    if (node.truncatedChildren) {
      const note = document.createElement("small");
      note.textContent = `${node.childCount - node.children.length} more children`;
      children.append(note);
    }
    details.append(children);
  }
  return details;
}

async function selectNode(nodeId: number) {
  selectedId = nodeId;
  document.querySelectorAll(".node").forEach((node) => node.classList.remove("selected"));
  renderGraph();
  const detail = await invoke<{ path: string; json: string }>("node_detail", { nodeId });
  selectedPath = detail.path;
  openModal(detail.path, detail.json);
}

function toJmesPath(path: string): string {
  return path
    .replace(/^\$\.?/, "")
    .replace(/\["([^"]+)"\]/g, ".$1")
    .replace(/^\./, "");
}

async function copyText(value: string, label: string) {
  await navigator.clipboard.writeText(value);
  const status = byId("modal-status");
  status.textContent = `${label} copied`;
  window.setTimeout(() => {
    if (status.textContent === `${label} copied`) status.textContent = "";
  }, 1400);
}

function centerView() {
  if (!graph || graph.nodes.length === 0) return;
  const first = graph.nodes[0];
  camera.x = 48 - first.x * camera.scale;
  camera.y = 36 - first.y * camera.scale;
  applyCamera();
}

function openModal(title: string, body: string) {
  modalTitle.textContent = title;
  modalBody.textContent = body;
  modal.classList.remove("hidden");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]!));
}

function scheduleLiveParse() {
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => {
    void loadContents(editor.value, fileName);
  }, 180);
}

async function openFile() {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".json,.jsonc,.yaml,.yml,.xml,.csv,.tsv,.toml,.txt";
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) return;
    await loadContents(await file.text(), file.name);
  };
  picker.click();
}

async function saveFile() {
  const path = await save({ defaultPath: fileName, filters: [{ name: "Data", extensions: ["json", "yaml", "xml", "csv", "toml", "txt"] }] });
  if (!path) return;
  await writeTextFile(path, editor.value);
}

async function runTool(action: string) {
  if (action === "format") editor.value = await invoke<string>("format_document");
  if (action === "minify") editor.value = await invoke<string>("minify_document");
  if (action === "repair") {
    editor.value = editor.value.replace(/,\s*([}\]])/g, "$1");
    await loadContents(editor.value, fileName);
  }
}

async function convert(format: string) {
  openModal(format.toUpperCase(), await invoke<string>("convert_document", { format }));
}

async function generate(language: string) {
  const generated = await invoke<string>("generate_code", { language, rootName: "Root" });
  openModal(language, generated);
}

async function search(query: string) {
  if (!query.trim()) {
    searchResults.classList.add("hidden");
    return;
  }
  const hits = await invoke<SearchHit[]>("search_document", { query });
  searchResults.classList.remove("hidden");
  searchResults.replaceChildren();
  for (const hit of hits.slice(0, 80)) {
    const button = document.createElement("button");
    button.innerHTML = `<strong>${escapeHtml(hit.key ?? hit.path)}</strong><small>${escapeHtml(hit.path)} · ${escapeHtml(hit.preview)}</small>`;
    button.onclick = () => {
      selectedId = hit.nodeId;
      renderGraph();
      const node = graph?.nodes.find((item) => item.id === hit.nodeId);
      if (node) {
        camera.x = canvasPane.clientWidth / 2 - node.x * camera.scale;
        camera.y = canvasPane.clientHeight / 2 - node.y * camera.scale;
        applyCamera();
      }
      searchResults.classList.add("hidden");
    };
    searchResults.append(button);
  }
}

function exportSvg() {
  if (!graph) return;
  const serialized = new XMLSerializer().serializeToString(edges);
  const blob = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${graph.bounds.width}" height="${graph.bounds.height}">${serialized}</svg>`], { type: "image/svg+xml" });
  downloadBlob(blob, "graph.svg");
}

async function exportPng() {
  if (!graph) return;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(graph.bounds.width * 2, 8000);
  canvas.height = Math.min(graph.bounds.height * 2, 8000);
  const context = canvas.getContext("2d");
  if (!context) return;
  const background = getComputedStyle(document.documentElement).getPropertyValue("--bg");
  context.scale(2, 2);
  context.fillStyle = background || "#141414";
  context.fillRect(0, 0, graph.bounds.width, graph.bounds.height);
  context.strokeStyle = "#6d6e78";
  for (const edgeElement of edges.querySelectorAll("path")) {
    context.stroke(new Path2D(edgeElement.getAttribute("d") ?? ""));
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  if (blob) downloadBlob(blob, "graph.png");
}

function downloadBlob(blob: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindTitlebar() {
  const appWindow = getCurrentWindow();
  const maximizeIcon = byId("maximize-icon");
  const restoreIcon = byId("restore-icon");
  const maximizeButton = byId("window-maximize");

  const syncMaximized = async () => {
    const maximized = await appWindow.isMaximized();
    document.documentElement.classList.toggle("maximized", maximized);
    maximizeIcon.classList.toggle("hidden", maximized);
    restoreIcon.classList.toggle("hidden", !maximized);
    maximizeButton.title = maximized ? "Restore" : "Maximize";
    maximizeButton.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
  };

  byId("window-minimize").onclick = () => void appWindow.minimize();
  maximizeButton.onclick = () => void appWindow.toggleMaximize().then(syncMaximized);
  byId("window-close").onclick = () => void appWindow.close();
  void appWindow.onResized(() => void syncMaximized());
  void syncMaximized();

  const menus = Array.from(document.querySelectorAll<HTMLElement>(".menu"));
  let menuMode = false;

  const closeMenus = () => {
    menuMode = false;
    menus.forEach((menu) => menu.classList.remove("open"));
  };

  const openMenu = (menu: HTMLElement) => {
    menus.forEach((item) => item.classList.toggle("open", item === menu));
  };

  menus.forEach((menu) => {
    const trigger = menu.querySelector<HTMLButtonElement>(".menu-trigger");
    if (!trigger) return;
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (menu.classList.contains("open") && menuMode) {
        closeMenus();
        return;
      }
      menuMode = true;
      openMenu(menu);
    });
    trigger.addEventListener("mouseenter", () => {
      if (menuMode) openMenu(menu);
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest(".menubar")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });
  document.querySelectorAll(".menu-panel button").forEach((button) => {
    button.addEventListener("click", () => closeMenus());
  });
}

function bindInterface() {
  byId("new-file").onclick = () => void loadContents(SAMPLE, "Untitled.json");
  byId("open-file").onclick = () => void openFile();
  byId("save-file").onclick = () => void saveFile();
  byId("import-url").onclick = async () => loadContents(await navigator.clipboard.readText(), "Clipboard.json");
  byId("center-view").onclick = centerView;
  byId("expand-all").onclick = async () => {
    graph = await invoke("expand_all", { expanded: true });
    renderGraph();
  };
  byId("collapse-all").onclick = async () => {
    graph = await invoke("expand_all", { expanded: false });
    renderGraph();
  };
  byId("theme-toggle").onclick = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
  };
  byId("fullscreen").onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  byId("toggle-editor").onclick = () => byId("workspace").classList.toggle("editor-open");
  byId("toggle-query").onclick = () => byId("query-dock").classList.toggle("hidden");
  byId("export-svg").onclick = exportSvg;
  byId("export-png").onclick = () => void exportPng();
  byId("modal-close").onclick = () => modal.classList.add("hidden");
  byId("copy-result").onclick = () => void copyText(modalBody.textContent ?? "", "JSON");
  byId("copy-jsonpath").onclick = () => void copyText(selectedPath, "JSONPath");
  byId("copy-jmespath").onclick = () => void copyText(toJmesPath(selectedPath), "JMESPath");
  byId<HTMLButtonElement>("run-query").onclick = async () => {
    const mode = byId<HTMLSelectElement>("query-mode").value;
    const expression = byId<HTMLInputElement>("query-input").value;
    const command = mode === "jq" ? "query_jq" : mode === "jmes" ? "query_jmes" : "query_path";
    const payload = mode === "jq" ? { program: expression } : { expression };
    try {
      const result = await invoke<{ values: unknown[]; count: number }>(command, payload);
      byId("query-output").textContent = JSON.stringify(result.values, null, 2);
    } catch (error) {
      byId("query-output").textContent = String(error);
    }
  };

  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.onclick = () => {
      currentView = button.dataset.view as "graph" | "tree";
      treePane.classList.toggle("open", currentView === "tree");
      viewport.classList.toggle("hidden", currentView === "tree");
    };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-direction]").forEach((button) => {
    button.onclick = async () => {
      graph = await invoke("set_layout", { direction: button.dataset.direction as Direction });
      renderGraph();
    };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
    button.onclick = () => void runTool(button.dataset.tool!);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-convert]").forEach((button) => {
    button.onclick = () => void convert(button.dataset.convert!);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-generate]").forEach((button) => {
    button.onclick = () => void generate(button.dataset.generate!);
  });

  editor.addEventListener("input", scheduleLiveParse);
  byId<HTMLInputElement>("search").addEventListener("input", (event) => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void search((event.target as HTMLInputElement).value), 80);
  });

  canvasPane.addEventListener("wheel", (event) => {
    event.preventDefault();
    const nextScale = Math.min(2.4, Math.max(0.12, camera.scale * (event.deltaY < 0 ? 1.08 : 0.92)));
    camera.x -= (event.offsetX - camera.x) * (nextScale / camera.scale - 1);
    camera.y -= (event.offsetY - camera.y) * (nextScale / camera.scale - 1);
    camera.scale = nextScale;
    applyCamera();
  }, { passive: false });

  let dragging = false;
  let dragX = 0;
  let dragY = 0;
  canvasPane.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest(".node, .query-dock, button, input")) return;
    dragging = true;
    dragX = event.clientX;
    dragY = event.clientY;
  });
  window.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    camera.x += event.clientX - dragX;
    camera.y += event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    applyCamera();
  });
  window.addEventListener("pointerup", () => { dragging = false; });

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === "o") { event.preventDefault(); void openFile(); }
    if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); void saveFile(); }
    if (event.ctrlKey && event.key.toLowerCase() === "n") { event.preventDefault(); void loadContents(SAMPLE); }
    if (event.ctrlKey && event.key.toLowerCase() === "f") { event.preventDefault(); byId<HTMLInputElement>("search").focus(); }
    if (event.key === "Escape") modal.classList.add("hidden");
  });

  const overlay = byId("drop-overlay");
  void getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "enter" || event.payload.type === "over") {
      overlay.classList.add("active");
      return;
    }
    overlay.classList.remove("active");
    if (event.payload.type !== "drop") return;
    const path = event.payload.paths[0];
    if (!path) return;
    void invoke<{ fileName: string; contents: string }>("read_dropped_file", { path })
      .then((file) => loadContents(file.contents, file.fileName))
      .catch((error: unknown) => showError(String(error)));
  });
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest(".search-wrap")) searchResults.classList.add("hidden");
  });
}

bindTitlebar();
bindInterface();
applyCamera();
void loadContents(SAMPLE);
