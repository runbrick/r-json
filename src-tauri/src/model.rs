use serde::{Deserialize, Serialize};

pub use crate::tree_node::TreeNode;

pub const MAX_RENDER_NODES: usize = 8_000;
pub const MAX_SEARCH_HITS: usize = 400;
pub const MAX_TREE_CHILDREN: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FormatKind {
    Json,
    Yaml,
    Xml,
    Csv,
    Toml,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ValueKind {
    Object,
    Array,
    String,
    Number,
    Boolean,
    Null,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LayoutDirection {
    Right,
    Left,
    Down,
    Up,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: u32,
    pub parent_id: Option<u32>,
    pub key: Option<String>,
    pub kind: ValueKind,
    pub preview: String,
    pub child_count: u32,
    pub path: String,
    pub collapsed: bool,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub depth: u16,
    pub text_start: u32,
    pub text_end: u32,
    pub rows: Vec<FieldRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: u32,
    pub from: u32,
    pub to: u32,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldRow {
    pub key: String,
    pub value: String,
    pub kind: ValueKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphPayload {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub total_nodes: usize,
    pub truncated: bool,
    pub bounds: Bounds,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Bounds {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub node_id: u32,
    pub path: String,
    pub key: Option<String>,
    pub preview: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentStats {
    pub bytes: usize,
    pub nodes: usize,
    pub depth: u16,
    pub objects: usize,
    pub arrays: usize,
    pub strings: usize,
    pub numbers: usize,
    pub booleans: usize,
    pub nulls: usize,
    pub parse_ms: u32,
    pub layout_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocument {
    pub format: FormatKind,
    pub pretty: String,
    pub stats: DocumentStats,
    pub graph: GraphPayload,
    pub tree: Vec<TreeNode>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDetail {
    pub id: u32,
    pub path: String,
    pub kind: ValueKind,
    pub key: Option<String>,
    pub json: String,
    pub child_count: u32,
    pub byte_start: u32,
    pub byte_end: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextWindow {
    pub start_line: u32,
    pub lines: Vec<String>,
    pub total_lines: u32,
}
