import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

type ValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";

interface FieldRow {
  key: string;
  value: string;
  kind: ValueKind;
  nodeId: number;
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

interface ValidationIssue {
  path: string;
  message: string;
}

interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}

interface FoldRange {
  start: number;
  end: number;
}

const editor = document.querySelector<HTMLTextAreaElement>("#editor")!;
const jsonEditor = document.querySelector<HTMLElement>("#json-editor")!;
const editorShell = document.querySelector<HTMLElement>("#editor-shell")!;
const schemaModal = document.querySelector<HTMLElement>("#schema-modal")!;
const schemaEditor = document.querySelector<HTMLTextAreaElement>("#schema-editor")!;
const schemaResult = document.querySelector<HTMLElement>("#schema-result")!;
const schemaStatus = document.querySelector<HTMLElement>("#schema-status")!;
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
let searchHits: SearchHit[] = [];
let searchActiveIndex = -1;
let searchRequestId = 0;
let selectedPath = "$";
let treeData: TreeNode[] = [];
let pathMode: "jmes" | "json" = "jmes";
const collapsedFolds = new Set<number>();
let foldRanges: FoldRange[] = [];
let skipLiveParse = false;
let graphReady = false;
const FOLD_EDITOR_LINE_LIMIT = 800;

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function resetWorkspace() {
  fileName = "Untitled.json";
  fileLabel.textContent = fileName;
  document.title = "R JSON";
  editor.value = "";
  graph = null;
  treeData = [];
  graphReady = false;
  selectedId = null;
  selectedPath = "$";
  hideSearchResults();
  nodesLayer.replaceChildren();
  edges.innerHTML = "";
  treePane.replaceChildren();
  emptyState.classList.remove("hidden");
  editorShell.classList.remove("fold-mode");
  collapsedFolds.clear();
  foldRanges = [];
  validity.textContent = "";
  validity.classList.remove("error");
  validity.title = "";
  stats.textContent = "未加载";
  syncGutter();
  renderJsonEditor();
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const inspectorBody = document.querySelector<HTMLElement>("#inspector-body")!;
const PAN_THRESHOLD = 4;
let panMoved = false;

function applyCamera() {
  viewport.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`;
}

function graphStageSize(): { width: number; height: number } {
  if (!graph || graph.nodes.length === 0) {
    return { width: graph?.bounds.width ?? 1200, height: graph?.bounds.height ?? 800 };
  }
  let maxX = 0;
  let maxY = 0;
  for (const node of graph.nodes) {
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return {
    width: Math.max(graph.bounds.width, maxX) + 160,
    height: Math.max(graph.bounds.height, maxY) + 160,
  };
}

function isTreeMode(): boolean {
  return byId("workspace").classList.contains("tree-mode");
}

function showError(message: string) {
  validity.textContent = "无效";
  validity.classList.add("error");
  validity.title = message;
  editorShell.classList.remove("fold-mode");
  syncGutter();
}

function syncGutter() {
  const gutter = byId("gutter");
  const lineCount = Math.max(1, editor.value.split("\n").length);
  gutter.textContent = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
}

function collectFoldRanges(text: string): FoldRange[] {
  const lines = text.split("\n");
  const stack: Array<{ start: number; opener: string }> = [];
  const ranges: FoldRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trimEnd();
    const last = trimmed.slice(-1);
    if (last === "{" || last === "[") {
      stack.push({ start: index, opener: last });
    }
    const first = trimmed.trimStart().slice(0, 1);
    if ((first === "}" || first === "]") && stack.length > 0) {
      const opened = stack.pop();
      if (opened && index > opened.start) {
        ranges.push({ start: opened.start, end: index });
      }
    }
  }
  return ranges;
}

function isLineHidden(lineIndex: number): boolean {
  return foldRanges.some((range) => collapsedFolds.has(range.start) && lineIndex > range.start && lineIndex < range.end);
}

function highlightJsonLine(line: string): string {
  return escapeHtml(line)
    .replace(/("(?:\\.|[^"\\])*")(\s*:)?/g, (_match, quoted: string, colon?: string) => {
      if (colon) return `<span class="key">${quoted}</span>${colon}`;
      return `<span class="string">${quoted}</span>`;
    })
    .replace(/\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g, `<span class="number">$1</span>`)
    .replace(/\b(true|false)\b/g, `<span class="boolean $1">$1</span>`)
    .replace(/\bnull\b/g, `<span class="null">null</span>`)
    .replace(/([{}[\],])/g, `<span class="json-punct">$1</span>`);
}

function renderJsonEditor() {
  const text = editor.value;
  const lines = text.split("\n");
  if (lines.length > FOLD_EDITOR_LINE_LIMIT) {
    editorShell.classList.remove("fold-mode");
    jsonEditor.replaceChildren();
    syncGutter();
    return;
  }
  foldRanges = collectFoldRanges(text);
  const validStarts = new Set(foldRanges.map((range) => range.start));
  for (const start of [...collapsedFolds]) {
    if (!validStarts.has(start)) collapsedFolds.delete(start);
  }
  jsonEditor.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < lines.length; index += 1) {
    if (isLineHidden(index)) continue;
    const range = foldRanges.find((item) => item.start === index);
    const collapsed = Boolean(range && collapsedFolds.has(index));
    const row = document.createElement("div");
    row.className = "json-line";
    const number = document.createElement("span");
    number.className = "json-line-number";
    number.textContent = String(index + 1);
    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = `json-fold${range ? " has-children" : ""}`;
    fold.textContent = range ? (collapsed ? "▸" : "▾") : "";
    if (range) {
      fold.addEventListener("click", () => {
        if (collapsedFolds.has(index)) collapsedFolds.delete(index);
        else collapsedFolds.add(index);
        renderJsonEditor();
      });
    }
    const code = document.createElement("span");
    code.className = "json-code";
    code.innerHTML = highlightJsonLine(lines[index] || " ");
    if (collapsed && range) {
      const preview = document.createElement("span");
      preview.className = "json-collapsed";
      preview.textContent = ` … ${range.end - range.start - 1} 行`;
      code.append(preview);
    }
    row.append(number, fold, code);
    fragment.append(row);
  }
  jsonEditor.append(fragment);
}

function setEditorText(value: string, parse = true) {
  skipLiveParse = true;
  editor.value = value;
  skipLiveParse = false;
  syncGutter();
  if (parse) void loadContents(value, fileName);
  else renderJsonEditor();
}

function escapeJsonText(value: string): string {
  return JSON.stringify(value);
}

function unescapeJsonText(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return JSON.parse(trimmed.startsWith("'") ? `"${trimmed.slice(1, -1)}"` : trimmed);
  }
  return JSON.parse(`"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`);
}

function minifyEscapeJson(value: string): string {
  try {
    return JSON.stringify(JSON.stringify(JSON.parse(value)));
  } catch {
    return JSON.stringify(value.replace(/\s+/g, " ").trim());
  }
}

function applyView(view: "graph" | "tree") {
  const workspace = byId("workspace");
  workspace.classList.toggle("tree-mode", view === "tree");
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  if (view === "graph") void ensureGraphRendered();
}

async function ensureGraphRendered() {
  if (!graphReady) {
    try {
      graph = await invoke<GraphPayload>("graph_view");
      graphReady = true;
    } catch (error) {
      showError(String(error));
      return;
    }
  }
  renderGraph();
  centerView();
}

function showValid(documentState: LoadedDocument) {
  validity.textContent = "有效";
  validity.classList.remove("error");
  validity.title = "";
  const size = (documentState.stats.bytes / 1024).toFixed(1);
  stats.textContent = `${documentState.stats.nodes.toLocaleString()} 节点 · 深度 ${documentState.stats.depth} · ${size} KB · ${documentState.stats.parseMs} ms`;
  if (documentState.graph.truncated) {
    stats.textContent += " · 图形已截断";
  }
}

async function loadContents(contents: string, name = fileName) {
  fileName = name;
  fileLabel.textContent = name;
  document.title = `${name} | R JSON`;
  stats.textContent = "正在加载…";
  try {
    const loaded = await invoke<LoadedDocument>("load_document", { contents, fileName: name });
    editor.value = loaded.pretty;
    graph = loaded.graph;
    graphReady = false;
    treeData = loaded.tree;
    selectedId = null;
    selectedPath = "$";
    emptyState.classList.add("hidden");
    collapsedFolds.clear();
    const lineCount = loaded.pretty.split("\n").length;
    if (lineCount <= FOLD_EDITOR_LINE_LIMIT) editorShell.classList.add("fold-mode");
    else editorShell.classList.remove("fold-mode");
    await yieldToUi();
    syncGutter();
    renderJsonEditor();
    await yieldToUi();
    renderTree(loaded.tree);
    showValid(loaded);
    if (!isTreeMode()) await ensureGraphRendered();
  } catch (error) {
    showError(String(error));
  }
}

function renderGraph() {
  if (!graph) return;
  nodesLayer.replaceChildren();
  const nodeLookup = new Map(graph.nodes.map((node) => [node.id, node]));
  const stage = graphStageSize();
  edges.setAttribute("width", String(stage.width));
  edges.setAttribute("height", String(stage.height));
  edges.style.width = `${stage.width}px`;
  edges.style.height = `${stage.height}px`;
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
      .map((row) => {
        const selected = row.nodeId === selectedId ? " selected" : "";
        return `<div class="node-row${selected}" data-row-id="${row.nodeId}"><span class="key">${escapeHtml(row.key)}</span><span class="${escapeHtml(row.kind)}">${escapeHtml(row.value)}</span></div>`;
      })
      .join("");
    card.innerHTML = `<header><button class="collapse">${node.collapsed ? "+" : "–"}</button><span>${escapeHtml(title)}</span><span class="preview">${escapeHtml(node.preview)}</span></header>${rows}`;
    card.addEventListener("click", (event) => {
      if (panMoved) {
        event.preventDefault();
        return;
      }
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-row-id]");
      const rowId = row?.dataset.rowId ? Number(row.dataset.rowId) : node.id;
      void selectNode(rowId);
    });
    card.querySelector("button")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (panMoved) return;
      graph = await invoke<GraphPayload>("toggle_node", { nodeId: node.id });
      renderGraph();
    });
    fragment.append(card);
  }
  nodesLayer.append(fragment);
  viewport.style.width = `${stage.width}px`;
  viewport.style.height = `${stage.height}px`;
}

function collectAncestorIds(nodes: TreeNode[], targetId: number): Set<number> {
  const ancestorIds = new Set<number>();
  const walk = (list: TreeNode[]): boolean => {
    for (const node of list) {
      if (node.id === targetId) return true;
      if (walk(node.children)) {
        ancestorIds.add(node.id);
        return true;
      }
    }
    return false;
  };
  walk(nodes);
  return ancestorIds;
}

function renderTree(nodes: TreeNode[], scrollToSelected = false) {
  treePane.replaceChildren();
  const expandAncestors = selectedId === null ? new Set<number>() : collectAncestorIds(nodes, selectedId);
  const fragment = document.createDocumentFragment();
  for (const node of nodes) fragment.append(renderTreeNode(node, true, expandAncestors));
  treePane.append(fragment);
  if (scrollToSelected && selectedId !== null) {
    treePane.querySelector<HTMLElement>(".tree-row.active")?.scrollIntoView({ block: "center" });
  }
}

function kindLabel(kind: ValueKind): string {
  if (kind === "object") return "{}";
  if (kind === "array") return "[]";
  if (kind === "string") return "str";
  if (kind === "number") return "num";
  if (kind === "boolean") return "bool";
  return "null";
}

function displayKey(node: TreeNode): string {
  if (node.key === null) return "$";
  return node.key;
}

function displayValue(node: TreeNode): string {
  if (node.kind === "string") {
    return node.preview.replace(/^"|"$/g, "");
  }
  return node.preview;
}

function renderTreeNode(node: TreeNode, expanded: boolean, expandAncestors: Set<number>): HTMLElement {
  const item = document.createElement("div");
  item.className = "tree-node";
  const row = document.createElement("div");
  row.className = `tree-row${node.id === selectedId ? " active" : ""}`;
  row.dataset.nodeId = String(node.id);
  const hasChildren = node.childCount > 0;
  const isExpanded = expanded || expandAncestors.has(node.id);
  const count = node.kind === "array" || node.kind === "object"
    ? `<span class="tree-count">(${node.childCount})</span>`
    : "";
  const valueClass = node.kind === "boolean"
    ? `tree-value boolean ${node.preview === "true" ? "true" : "false"}`
    : `tree-value ${node.kind}`;
  const value = node.kind === "object" || node.kind === "array"
    ? ""
    : `<span class="tree-colon">:</span><span class="${valueClass}">${escapeHtml(displayValue(node))}</span>`;
  row.innerHTML = `<span class="tree-toggle${hasChildren ? " has-children" : ""}">${hasChildren ? (isExpanded ? "▾" : "▸") : ""}</span><span class="kind ${node.kind}">${kindLabel(node.kind)}</span><span class="tree-key">${escapeHtml(displayKey(node))}</span>${count}${value}<span class="tree-actions"><button class="tree-action" type="button" data-copy="path" title="复制路径"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8M8 4l4 4-4 4" /></svg></button><button class="tree-action" type="button" data-copy="value" title="复制值"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></svg></button></span>`;
  const children = document.createElement("div");
  children.className = "tree-children";
  children.hidden = !isExpanded;
  const mountLoadedChildren = () => {
    children.replaceChildren();
    for (const child of node.children) {
      children.append(renderTreeNode(child, expandAncestors.has(child.id), expandAncestors));
    }
    if (node.truncatedChildren && node.children.length > 0) {
      const note = document.createElement("small");
      note.textContent = `还有 ${node.childCount - node.children.length} 项`;
      children.append(note);
    }
  };
  if (hasChildren && isExpanded && node.children.length > 0) {
    mountLoadedChildren();
  }
  row.querySelectorAll<HTMLButtonElement>(".tree-action").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void copyTreeNode(node, button.dataset.copy === "path" ? "path" : "value", button);
    });
  });
  row.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".tree-action")) return;
    selectedId = node.id;
    selectedPath = node.path;
    treePane.querySelectorAll(".tree-row.active").forEach((active) => active.classList.remove("active"));
    row.classList.add("active");
    if (!hasChildren) return;
    const nextOpen = children.hidden;
    children.hidden = !nextOpen;
    const toggle = row.querySelector(".tree-toggle");
    if (toggle) toggle.textContent = nextOpen ? "▾" : "▸";
    if (nextOpen && children.childElementCount === 0) {
      void expandTreeChildren(node, children, expandAncestors);
    }
  });
  item.append(row);
  if (hasChildren) item.append(children);
  return item;
}

async function expandTreeChildren(node: TreeNode, container: HTMLElement, expandAncestors: Set<number>) {
  if (node.children.length === 0) {
    try {
      node.children = await invoke<TreeNode[]>("tree_children", { parentId: node.id });
      node.truncatedChildren = node.children.length < node.childCount;
    } catch (error) {
      container.textContent = String(error);
      return;
    }
  }
  const fragment = document.createDocumentFragment();
  for (const child of node.children) {
    fragment.append(renderTreeNode(child, expandAncestors.has(child.id), expandAncestors));
  }
  if (node.truncatedChildren && node.children.length > 0) {
    const note = document.createElement("small");
    note.textContent = `还有 ${node.childCount - node.children.length} 项`;
    fragment.append(note);
  }
  container.replaceChildren(fragment);
}

async function selectNode(nodeId: number, path?: string) {
  selectedId = nodeId;
  if (path) selectedPath = path;
  if (graphReady) renderGraph();
  if (!treeContains(treeData, nodeId)) {
    try {
      treeData = await invoke<TreeNode[]>("reveal_tree", { nodeId });
    } catch {
      // Keep the current tree if the node cannot be revealed.
    }
  }
  renderTree(treeData, true);
  try {
    const detail = await invoke<{ path: string; json: string }>("node_detail", { nodeId });
    selectedPath = detail.path;
  } catch {
    selectedPath = path ?? selectedPath;
  }
}

function treeContains(nodes: TreeNode[], nodeId: number): boolean {
  for (const node of nodes) {
    if (node.id === nodeId) return true;
    if (treeContains(node.children, nodeId)) return true;
  }
  return false;
}

async function copyTreeNode(node: TreeNode, kind: "path" | "value", button: HTMLButtonElement) {
  try {
    const value = kind === "path"
      ? pathForCopy(node.path)
      : await invoke<{ path: string; json: string }>("node_detail", { nodeId: node.id }).then((detail) => detail.json);
    await navigator.clipboard.writeText(value);
    showCopyHint(button, kind === "path" ? `复制${pathModeLabel()}` : "复制值");
  } catch (error) {
    showCopyHint(button, `复制失败: ${String(error)}`);
  }
}

function pathForCopy(path: string): string {
  return pathMode === "jmes" ? toJmesPath(path) : toJsonPath(path);
}

function showCopyHint(anchor: HTMLElement, label: string) {
  document.querySelectorAll(".copy-hint").forEach((hint) => hint.remove());
  const hint = document.createElement("span");
  hint.className = "copy-hint";
  hint.textContent = label;
  const bounds = anchor.getBoundingClientRect();
  hint.style.left = `${bounds.left + bounds.width / 2}px`;
  hint.style.top = `${bounds.top - 8}px`;
  document.body.append(hint);
  window.setTimeout(() => hint.remove(), 1200);
}

function toJmesPath(path: string): string {
  if (!path || path === "$") return "@";
  const segments = pathSegments(path);
  let output = "";
  for (const segment of segments) {
    if (segment.kind === "index") {
      output += `[${segment.value}]`;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment.value)) {
      output += output ? `.${segment.value}` : segment.value;
    } else {
      output += `."${segment.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
  }
  return output || "@";
}

function toJsonPath(path: string): string {
  if (!path || path === "$") return "$";
  const segments = pathSegments(path);
  let output = "$";
  for (const segment of segments) {
    if (segment.kind === "index") {
      output += `[${segment.value}]`;
    } else {
      output += `['${segment.value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}']`;
    }
  }
  return output;
}

function pathSegments(path: string): Array<{ kind: "key" | "index"; value: string }> {
  const segments: Array<{ kind: "key" | "index"; value: string }> = [];
  const source = path.startsWith("$") ? path.slice(1) : path;
  const pattern = /\[(\d+)\]|\["((?:\\.|[^"\\])*)"\]|\['((?:\\.|[^'\\])*)'\]|\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match[1] !== undefined) {
      segments.push({ kind: "index", value: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "key", value: match[2].replace(/\\"/g, '"') });
    } else if (match[3] !== undefined) {
      segments.push({ kind: "key", value: match[3].replace(/\\'/g, "'") });
    } else if (match[4] !== undefined) {
      segments.push({ kind: "key", value: match[4] });
    }
  }
  return segments;
}

function pathModeLabel(): string {
  return pathMode === "jmes" ? "JMESPath" : "JSONPath";
}

function syncSearchInputPath() {
  const search = document.getElementById("search") as HTMLInputElement | null;
  if (!search || !search.value.trim() || !selectedPath) return;
  const current = search.value.trim();
  const asJmes = toJmesPath(selectedPath);
  const asJson = toJsonPath(selectedPath);
  if (current === asJmes || current === asJson || current === selectedPath) {
    search.value = suggestionPath(selectedPath);
  }
}

function syncPathModeUi() {
  const label = document.getElementById("path-mode-label");
  const search = document.getElementById("search") as HTMLInputElement | null;
  if (label) label.textContent = pathModeLabel();
  if (search) search.placeholder = `${pathModeLabel()} 查询…`;
  document.querySelectorAll<HTMLButtonElement>("[data-path-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.pathMode === pathMode);
  });
  syncSearchInputPath();
  if (searchHits.length > 0) renderSearchResults();
}

async function copyText(value: string, label: string) {
  await navigator.clipboard.writeText(value);
  const status = byId("modal-status");
  status.textContent = `已复制${label}`;
  window.setTimeout(() => {
    if (status.textContent === `已复制${label}`) status.textContent = "";
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
  const delay = editor.value.length > 80_000 ? 600 : 180;
  liveTimer = window.setTimeout(() => {
    void loadContents(editor.value, fileName);
  }, delay);
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
  if (action === "format") {
    setEditorText(await invoke<string>("format_document"));
    return;
  }
  if (action === "minify") {
    setEditorText(await invoke<string>("minify_document"), false);
    editorShell.classList.remove("fold-mode");
    return;
  }
  if (action === "escape") {
    setEditorText(escapeJsonText(editor.value), false);
    editorShell.classList.remove("fold-mode");
    return;
  }
  if (action === "unescape") {
    try {
      setEditorText(unescapeJsonText(editor.value));
    } catch (error) {
      showError(`反转义失败: ${String(error)}`);
    }
    return;
  }
  if (action === "minify-escape") {
    setEditorText(minifyEscapeJson(editor.value), false);
    editorShell.classList.remove("fold-mode");
    return;
  }
  if (action === "repair") {
    setEditorText(editor.value.replace(/,\s*([}\]])/g, "$1"));
  }
}

async function generate(language: string) {
  if (language === "schema") {
    await openSchemaModal(true);
    return;
  }
  const generated = await invoke<string>("generate_code", { language, rootName: "Root" });
  openModal(language, generated);
}

async function convert(format: string) {
  openModal(format.toUpperCase(), await invoke<string>("convert_document", { format }));
}

async function openSchemaModal(generateFirst = false) {
  schemaModal.classList.remove("hidden");
  if (generateFirst || !schemaEditor.value.trim()) {
    try {
      schemaEditor.value = await invoke<string>("generate_schema");
      schemaStatus.textContent = "已生成 Draft-07 Schema";
    } catch (error) {
      schemaStatus.textContent = String(error);
    }
  }
}

async function validateCurrentSchema() {
  try {
    const report = await invoke<ValidationReport>("validate_schema", { schema: schemaEditor.value });
    if (report.valid) {
      schemaResult.textContent = "验证通过，当前 JSON 符合 Schema。";
      schemaStatus.textContent = "验证通过";
      return;
    }
    schemaResult.textContent = report.issues
      .map((issue) => `${issue.path}\n  ${issue.message}`)
      .join("\n\n");
    schemaStatus.textContent = `发现 ${report.issues.length} 处问题`;
  } catch (error) {
    schemaResult.textContent = String(error);
    schemaStatus.textContent = "验证失败";
  }
}

function suggestionPath(path: string): string {
  return pathForCopy(path);
}

function suggestionLabel(hit: SearchHit): string {
  return suggestionPath(hit.path);
}

function hideSearchResults() {
  window.clearTimeout(searchTimer);
  searchRequestId += 1;
  searchHits = [];
  searchActiveIndex = -1;
  searchResults.classList.add("hidden");
  searchResults.replaceChildren();
}

function renderSearchResults() {
  searchResults.replaceChildren();
  if (searchHits.length === 0) {
    searchResults.classList.add("hidden");
    return;
  }
  searchResults.classList.remove("hidden");
  searchHits.forEach((hit, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === searchActiveIndex ? "active" : "";
    button.innerHTML = `<strong>${escapeHtml(suggestionLabel(hit))}</strong><small>${escapeHtml(hit.preview)}</small>`;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      void applySearchHit(hit);
    });
    searchResults.append(button);
  });
  searchResults.querySelector<HTMLElement>("button.active")?.scrollIntoView({ block: "nearest" });
}

function moveSearchActive(delta: number) {
  if (searchHits.length === 0) return;
  const total = searchHits.length;
  searchActiveIndex = (searchActiveIndex + delta + total) % total;
  renderSearchResults();
}

function graphCardForNode(nodeId: number): GraphNode | undefined {
  if (!graph) return undefined;
  const exact = graph.nodes.find((item) => item.id === nodeId);
  if (exact) return exact;
  return graph.nodes.find((item) => item.rows.some((row) => row.nodeId === nodeId));
}

function focusGraphNode(nodeId: number) {
  const node = graphCardForNode(nodeId);
  if (!node) return;
  camera.x = canvasPane.clientWidth / 2 - (node.x + node.width / 2) * camera.scale;
  camera.y = canvasPane.clientHeight / 2 - (node.y + node.height / 2) * camera.scale;
  applyCamera();
}

async function applySearchHit(hit: SearchHit) {
  const input = byId<HTMLInputElement>("search");
  input.value = suggestionLabel(hit);
  hideSearchResults();
  if (hit.nodeId) {
    if (graphReady || !isTreeMode()) {
      try {
        graph = await invoke<GraphPayload>("reveal_node", { nodeId: hit.nodeId });
        graphReady = true;
      } catch {
        // Keep the current graph if the node cannot be revealed.
      }
    }
  }
  await selectNode(hit.nodeId, hit.path);
  focusGraphNode(hit.nodeId);
}

async function commitSearchFromInput() {
  if (searchHits.length > 0) {
    const index = searchActiveIndex >= 0 ? searchActiveIndex : 0;
    await applySearchHit(searchHits[index]);
    return;
  }
  const query = byId<HTMLInputElement>("search").value;
  if (!query.trim()) return;
  await search(query);
  if (searchHits.length > 0) await applySearchHit(searchHits[0]);
}

async function search(query: string) {
  const requestId = ++searchRequestId;
  if (!query.trim()) {
    hideSearchResults();
    return;
  }
  try {
    const hits = await invoke<SearchHit[]>("search_document", { query, mode: pathMode });
    if (requestId !== searchRequestId) return;
    searchHits = hits.slice(0, 80);
    searchActiveIndex = searchHits.length > 0 ? 0 : -1;
    renderSearchResults();
  } catch {
    if (requestId !== searchRequestId) return;
    searchHits = [];
    searchActiveIndex = -1;
    searchResults.classList.add("hidden");
    searchResults.replaceChildren();
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
  byId("new-file").onclick = resetWorkspace;
  byId("open-file").onclick = () => void openFile();
  byId("save-file").onclick = () => void saveFile();
  byId("import-url").onclick = async () => loadContents(await navigator.clipboard.readText(), "Clipboard.json");
  const themeToggle = byId("theme-toggle");
  const syncThemeToggle = () => {
    const isLight = document.documentElement.dataset.theme !== "dark";
    byId("theme-sun").classList.toggle("hidden", isLight);
    byId("theme-moon").classList.toggle("hidden", !isLight);
    const label = isLight ? "切换到深色主题" : "切换到浅色主题";
    themeToggle.title = label;
    themeToggle.setAttribute("aria-label", label);
  };
  themeToggle.onclick = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    syncThemeToggle();
  };
  syncThemeToggle();

  const fullscreenButton = byId("fullscreen");
  const syncFullscreenToggle = () => {
    const active = Boolean(document.fullscreenElement);
    byId("fullscreen-enter").classList.toggle("hidden", active);
    byId("fullscreen-exit").classList.toggle("hidden", !active);
    const label = active ? "退出全屏" : "全屏";
    fullscreenButton.title = label;
    fullscreenButton.setAttribute("aria-label", label);
  };
  fullscreenButton.onclick = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  document.addEventListener("fullscreenchange", syncFullscreenToggle);
  syncFullscreenToggle();
  byId("toggle-editor").onclick = () => byId("workspace").classList.toggle("editor-open");
  byId("open-schema").onclick = () => void openSchemaModal(true);
  byId("schema-modal-close").onclick = () => schemaModal.classList.add("hidden");
  byId("schema-generate").onclick = () => void openSchemaModal(true);
  byId("schema-validate").onclick = () => void validateCurrentSchema();
  byId("export-svg").onclick = exportSvg;
  byId("export-png").onclick = () => void exportPng();
  byId("modal-close").onclick = () => modal.classList.add("hidden");
  byId("copy-result").onclick = () => void copyText(modalBody.textContent ?? "", "代码");
  byId("copy-jsonpath").onclick = () => void copyText(selectedPath, "JSONPath");
  byId("copy-jmespath").onclick = () => void copyText(toJmesPath(selectedPath), "JMESPath");
  const pathModeMenu = byId("path-mode-menu");
  const pathModeRoot = document.querySelector<HTMLElement>(".path-mode")!;
  byId("path-mode-trigger").onclick = (event) => {
    event.stopPropagation();
    pathModeRoot.classList.toggle("open");
    pathModeMenu.classList.toggle("hidden");
  };
  document.querySelectorAll<HTMLButtonElement>("[data-path-mode]").forEach((button) => {
    button.onclick = () => {
      pathMode = button.dataset.pathMode === "json" ? "json" : "jmes";
      syncPathModeUi();
      pathModeRoot.classList.remove("open");
      pathModeMenu.classList.add("hidden");
    };
  });
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest(".path-mode")) {
      pathModeRoot.classList.remove("open");
      pathModeMenu.classList.add("hidden");
    }
  });
  syncPathModeUi();
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
    button.onclick = () => applyView(button.dataset.view as "graph" | "tree");
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

  editor.addEventListener("input", () => {
    if (skipLiveParse) return;
    editorShell.classList.remove("fold-mode");
    syncGutter();
    scheduleLiveParse();
  });
  editor.addEventListener("scroll", () => {
    byId("gutter").scrollTop = editor.scrollTop;
  });

  const splitter = byId("splitter");
  let resizing = false;
  splitter.addEventListener("pointerdown", (event) => {
    resizing = true;
    splitter.setPointerCapture(event.pointerId);
  });
  window.addEventListener("pointermove", (event) => {
    if (!resizing) return;
    const workspace = byId("workspace");
    const bounds = workspace.getBoundingClientRect();
    const ratio = Math.min(0.78, Math.max(0.32, (event.clientX - bounds.left) / bounds.width));
    workspace.style.gridTemplateColumns = `${ratio * 100}% 6px minmax(280px, 1fr)`;
  });
  window.addEventListener("pointerup", () => { resizing = false; });
  const searchInput = byId<HTMLInputElement>("search");
  searchInput.addEventListener("input", (event) => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void search((event.target as HTMLInputElement).value), 80);
  });
  searchInput.addEventListener("keydown", (event) => {
    const suggestionsOpen = !searchResults.classList.contains("hidden") && searchHits.length > 0;
    if (event.key === "Escape") {
      hideSearchResults();
      return;
    }
    if (event.key === "ArrowDown" && suggestionsOpen) {
      event.preventDefault();
      moveSearchActive(1);
      return;
    }
    if (event.key === "ArrowUp" && suggestionsOpen) {
      event.preventDefault();
      moveSearchActive(-1);
      return;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      if (!suggestionsOpen && !searchInput.value.trim()) return;
      event.preventDefault();
      void commitSearchFromInput();
    }
  });

  inspectorBody.addEventListener("wheel", (event) => {
    if (isTreeMode()) return;
    event.preventDefault();
    const bounds = inspectorBody.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left;
    const cursorY = event.clientY - bounds.top;
    const nextScale = Math.min(2.4, Math.max(0.12, camera.scale * (event.deltaY < 0 ? 1.08 : 0.92)));
    const zoomRatio = nextScale / camera.scale;
    camera.x = cursorX - (cursorX - camera.x) * zoomRatio;
    camera.y = cursorY - (cursorY - camera.y) * zoomRatio;
    camera.scale = nextScale;
    applyCamera();
  }, { passive: false });

  let dragging = false;
  let dragX = 0;
  let dragY = 0;
  inspectorBody.addEventListener("pointerdown", (event) => {
    if (isTreeMode()) return;
    if ((event.target as HTMLElement).closest("button, input, select, textarea")) return;
    dragging = true;
    panMoved = false;
    dragX = event.clientX;
    dragY = event.clientY;
    inspectorBody.setPointerCapture(event.pointerId);
  });
  inspectorBody.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const deltaX = event.clientX - dragX;
    const deltaY = event.clientY - dragY;
    if (!panMoved && Math.hypot(deltaX, deltaY) < PAN_THRESHOLD) return;
    panMoved = true;
    camera.x += deltaX;
    camera.y += deltaY;
    dragX = event.clientX;
    dragY = event.clientY;
    applyCamera();
  });
  inspectorBody.addEventListener("pointerup", () => {
    dragging = false;
  });
  inspectorBody.addEventListener("pointercancel", () => {
    dragging = false;
  });

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === "o") { event.preventDefault(); void openFile(); }
    if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); void saveFile(); }
    if (event.ctrlKey && event.key.toLowerCase() === "n") { event.preventDefault(); resetWorkspace(); }
    if (event.ctrlKey && event.key.toLowerCase() === "f") { event.preventDefault(); byId<HTMLInputElement>("search").focus(); }
    if (event.key === "Escape") {
      modal.classList.add("hidden");
      schemaModal.classList.add("hidden");
    }
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
    if (!target.closest(".search-wrap")) hideSearchResults();
  });
}

bindTitlebar();
bindInterface();
applyCamera();
applyView("tree");
syncGutter();
void resetWorkspace();
