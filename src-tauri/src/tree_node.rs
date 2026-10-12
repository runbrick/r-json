use serde::{Deserialize, Serialize};

use crate::model::ValueKind;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub id: u32,
    pub key: Option<String>,
    pub kind: ValueKind,
    pub preview: String,
    pub child_count: u32,
    pub path: String,
    pub children: Vec<TreeNode>,
    pub truncated_children: bool,
}
