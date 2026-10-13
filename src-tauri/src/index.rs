use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

use crate::model::{TreeNode, ValueKind, MAX_TREE_CHILDREN};

pub(crate) fn child_key_path(parent: &str, key: &str) -> String {
    object_path(parent, key)
}

pub(crate) fn child_index_path(parent: &str, index: usize) -> String {
    format!("{parent}[{index}]")
}

#[derive(Debug)]
pub struct Record {
    pub id: u32,
    pub parent: Option<u32>,
    pub key: Option<String>,
    pub kind: ValueKind,
    pub preview: String,
    pub child_count: u32,
    pub path: String,
    pub depth: u16,
    pub byte_start: u32,
    pub byte_end: u32,
    pub children: Vec<u32>,
}

pub struct DocumentIndex {
    pub records: Vec<Record>,
    pub line_starts: Vec<u32>,
    pub text: String,
    root: Value,
}

impl DocumentIndex {
    pub fn build(value: &Value, text: &str) -> Self {
        let mut records = Vec::new();
        walk(value, None, None, "$", 0, &mut records);
        assign_text_offsets(&mut records, text);
        Self {
            records,
            line_starts: line_index(text),
            text: text.to_string(),
            root: value.clone(),
        }
    }

    pub fn node_value(&self, id: u32) -> Option<Value> {
        value_at_path(&self.root, &self.records.get(id as usize)?.path)
    }

    pub fn record_for_path(&self, path: &str) -> Option<&Record> {
        self.records.iter().find(|record| record.path == path)
    }

    pub fn line_column(&self, byte_offset: u32) -> (u32, u32) {
        let index = self
            .line_starts
            .partition_point(|start| *start <= byte_offset)
            .saturating_sub(1);
        let line_start = self.line_starts.get(index).copied().unwrap_or(0);
        (
            index as u32 + 1,
            byte_offset.saturating_sub(line_start) + 1,
        )
    }

    pub fn record_at_line(&self, line: u32) -> Option<&Record> {
        let line_index = line.saturating_sub(1) as usize;
        let line_start = *self.line_starts.get(line_index)?;
        let line_end = self
            .line_starts
            .get(line_index + 1)
            .copied()
            .unwrap_or(self.text.len() as u32);
        let mut best: Option<&Record> = None;
        for record in &self.records {
            if record.byte_end <= line_start || record.byte_start >= line_end {
                continue;
            }
            let better = match best {
                None => true,
                Some(current) => {
                    record.depth > current.depth
                        || (record.depth == current.depth
                            && record.byte_end.saturating_sub(record.byte_start)
                                <= current.byte_end.saturating_sub(current.byte_start))
                }
            };
            if better {
                best = Some(record);
            }
        }
        best
    }

    pub fn subtree(&self, root_id: u32) -> Vec<TreeNode> {
        let Some(root) = self.records.get(root_id as usize) else {
            return Vec::new();
        };
        vec![to_tree_shallow(root, &self.records)]
    }

    pub fn children_of(&self, parent_id: u32) -> Vec<TreeNode> {
        let Some(parent) = self.records.get(parent_id as usize) else {
            return Vec::new();
        };
        parent
            .children
            .iter()
            .take(MAX_TREE_CHILDREN)
            .filter_map(|child_id| self.records.get(*child_id as usize))
            .map(|child| to_tree_leaf(child))
            .collect()
    }

    pub fn tree_with_path(&self, node_id: u32) -> Vec<TreeNode> {
        if self.records.get(node_id as usize).is_none() {
            return self.subtree(0);
        }
        let mut path_ids = HashSet::new();
        let mut cursor = Some(node_id);
        while let Some(id) = cursor {
            path_ids.insert(id);
            cursor = self.records.get(id as usize).and_then(|record| record.parent);
        }
        let Some(root) = self.records.first() else {
            return Vec::new();
        };
        vec![to_tree_along(root, &self.records, &path_ids)]
    }
}

fn walk(
    value: &Value,
    parent: Option<u32>,
    key: Option<String>,
    path: &str,
    depth: u16,
    records: &mut Vec<Record>,
) -> u32 {
    let id = records.len() as u32;
    records.push(Record {
        id,
        parent,
        key: key.clone(),
        kind: kind_of(value),
        preview: String::new(),
        child_count: 0,
        path: path.to_string(),
        depth,
        byte_start: 0,
        byte_end: 0,
        children: Vec::new(),
    });

    let (preview, children) = match value {
        Value::Object(map) => {
            let mut child_ids = Vec::with_capacity(map.len());
            for (child_key, child_value) in map {
                let child_path = object_path(path, child_key);
                child_ids.push(walk(
                    child_value,
                    Some(id),
                    Some(child_key.clone()),
                    &child_path,
                    depth.saturating_add(1),
                    records,
                ));
            }
            (format!("{{{} keys}}", map.len()), child_ids)
        }
        Value::Array(items) => {
            let mut child_ids = Vec::with_capacity(items.len());
            for (index, child_value) in items.iter().enumerate() {
                let child_path = format!("{path}[{index}]");
                child_ids.push(walk(
                    child_value,
                    Some(id),
                    Some(index.to_string()),
                    &child_path,
                    depth.saturating_add(1),
                    records,
                ));
            }
            (format!("[{} items]", items.len()), child_ids)
        }
        Value::String(text) => (quote_preview(text), Vec::new()),
        Value::Number(number) => (number.to_string(), Vec::new()),
        Value::Bool(flag) => (flag.to_string(), Vec::new()),
        Value::Null => ("null".to_string(), Vec::new()),
    };

    let record = &mut records[id as usize];
    record.preview = preview;
    record.child_count = children.len() as u32;
    record.children = children;
    id
}

fn assign_text_offsets(records: &mut [Record], text: &str) {
    if records.is_empty() {
        return;
    }
    let bytes = text.as_bytes();
    let mut pos = 0usize;
    skip_ws(bytes, &mut pos);
    scan_value(records, 0, bytes, &mut pos);
}

fn scan_value(records: &mut [Record], id: u32, bytes: &[u8], pos: &mut usize) {
    skip_ws(bytes, pos);
    let start = *pos;
    let Some(record) = records.get(id as usize) else {
        return;
    };
    let kind = record.kind;
    let children = record.children.clone();

    match kind {
        ValueKind::Object => {
            if consume(bytes, pos, b'{') {
                for child_id in children {
                    skip_ws(bytes, pos);
                    let child_start = *pos;
                    skip_string(bytes, pos);
                    skip_ws(bytes, pos);
                    let _ = consume(bytes, pos, b':');
                    scan_value(records, child_id, bytes, pos);
                    let value_end = *pos;
                    skip_ws(bytes, pos);
                    let child_end = if consume(bytes, pos, b',') { *pos } else { value_end };
                    if let Some(child) = records.get_mut(child_id as usize) {
                        child.byte_start = child_start as u32;
                        child.byte_end = child_end as u32;
                    }
                }
                skip_ws(bytes, pos);
                let _ = consume(bytes, pos, b'}');
            } else {
                skip_literal(bytes, pos);
            }
        }
        ValueKind::Array => {
            if consume(bytes, pos, b'[') {
                for child_id in children {
                    skip_ws(bytes, pos);
                    let child_start = *pos;
                    scan_value(records, child_id, bytes, pos);
                    let value_end = *pos;
                    skip_ws(bytes, pos);
                    let child_end = if consume(bytes, pos, b',') { *pos } else { value_end };
                    if let Some(child) = records.get_mut(child_id as usize) {
                        child.byte_start = child_start as u32;
                        child.byte_end = child_end as u32;
                    }
                }
                skip_ws(bytes, pos);
                let _ = consume(bytes, pos, b']');
            } else {
                skip_literal(bytes, pos);
            }
        }
        ValueKind::String => skip_string(bytes, pos),
        _ => skip_literal(bytes, pos),
    }

    if id == 0 {
        if let Some(record) = records.get_mut(id as usize) {
            record.byte_start = start as u32;
            record.byte_end = *pos as u32;
        }
    }
}

fn skip_ws(bytes: &[u8], pos: &mut usize) {
    while *pos < bytes.len() && matches!(bytes[*pos], b' ' | b'\n' | b'\r' | b'\t') {
        *pos += 1;
    }
}

fn consume(bytes: &[u8], pos: &mut usize, expected: u8) -> bool {
    if bytes.get(*pos) == Some(&expected) {
        *pos += 1;
        true
    } else {
        false
    }
}

fn skip_string(bytes: &[u8], pos: &mut usize) {
    if !consume(bytes, pos, b'"') {
        return;
    }
    while *pos < bytes.len() {
        match bytes[*pos] {
            b'\\' => *pos = (*pos + 2).min(bytes.len()),
            b'"' => {
                *pos += 1;
                return;
            }
            _ => *pos += 1,
        }
    }
}

fn skip_literal(bytes: &[u8], pos: &mut usize) {
    while *pos < bytes.len() && !matches!(bytes[*pos], b',' | b'}' | b']' | b' ' | b'\n' | b'\r' | b'\t') {
        *pos += 1;
    }
}

fn object_path(parent: &str, key: &str) -> String {
    if key
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
        && key
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic() || character == '_')
    {
        format!("{parent}.{key}")
    } else {
        format!("{parent}[{}]", serde_json::to_string(key).unwrap_or_else(|_| "\"\"".into()))
    }
}

fn value_at_path(root: &Value, path: &str) -> Option<Value> {
    if path == "$" {
        return Some(root.clone());
    }
    let mut cursor = root;
    let body = path.strip_prefix('$')?;
    let mut remainder = body;
    while !remainder.is_empty() {
        if let Some(rest) = remainder.strip_prefix('[') {
            if rest.starts_with('"') {
                let (key, after) = parse_quoted(rest)?;
                cursor = cursor.get(key)?;
                remainder = after.strip_prefix(']')?;
            } else {
                let (index_text, after) = rest.split_once(']')?;
                let index: usize = index_text.parse().ok()?;
                cursor = cursor.as_array()?.get(index)?;
                remainder = after;
            }
        } else if let Some(rest) = remainder.strip_prefix('.') {
            let end = rest.find(['.', '[']).unwrap_or(rest.len());
            cursor = cursor.get(&rest[..end])?;
            remainder = &rest[end..];
        } else {
            return None;
        }
    }
    Some(cursor.clone())
}

fn parse_quoted(text: &str) -> Option<(&str, &str)> {
    let bytes = text.as_bytes();
    if bytes.first() != Some(&b'"') {
        return None;
    }
    let mut escaped = false;
    for (offset, byte) in bytes.iter().enumerate().skip(1) {
        if escaped {
            escaped = false;
            continue;
        }
        if *byte == b'\\' {
            escaped = true;
            continue;
        }
        if *byte == b'"' {
            return Some((&text[1..offset], &text[offset + 1..]));
        }
    }
    None
}

fn to_tree_leaf(record: &Record) -> TreeNode {
    TreeNode {
        id: record.id,
        key: record.key.clone(),
        kind: record.kind,
        preview: record.preview.clone(),
        child_count: record.child_count,
        path: record.path.clone(),
        children: Vec::new(),
        truncated_children: false,
    }
}

fn to_tree_shallow(record: &Record, records: &[Record]) -> TreeNode {
    let children = record
        .children
        .iter()
        .take(MAX_TREE_CHILDREN)
        .filter_map(|child_id| records.get(*child_id as usize))
        .map(to_tree_leaf)
        .collect::<Vec<_>>();
    TreeNode {
        id: record.id,
        key: record.key.clone(),
        kind: record.kind,
        preview: record.preview.clone(),
        child_count: record.child_count,
        path: record.path.clone(),
        truncated_children: record.children.len() > children.len(),
        children,
    }
}

fn to_tree_along(record: &Record, records: &[Record], path_ids: &HashSet<u32>) -> TreeNode {
    let children = record
        .children
        .iter()
        .take(MAX_TREE_CHILDREN)
        .filter_map(|child_id| records.get(*child_id as usize))
        .map(|child| {
            if path_ids.contains(&child.id) {
                to_tree_along(child, records, path_ids)
            } else {
                to_tree_leaf(child)
            }
        })
        .collect::<Vec<_>>();
    TreeNode {
        id: record.id,
        key: record.key.clone(),
        kind: record.kind,
        preview: record.preview.clone(),
        child_count: record.child_count,
        path: record.path.clone(),
        truncated_children: record.children.len() > children.len(),
        children,
    }
}

pub fn kind_of(value: &Value) -> ValueKind {
    match value {
        Value::Object(_) => ValueKind::Object,
        Value::Array(_) => ValueKind::Array,
        Value::String(_) => ValueKind::String,
        Value::Number(_) => ValueKind::Number,
        Value::Bool(_) => ValueKind::Boolean,
        Value::Null => ValueKind::Null,
    }
}

pub fn quote_preview(text: &str) -> String {
    let truncated: String = text.chars().take(72).collect();
    let suffix = if text.chars().count() > 72 { "…" } else { "" };
    format!("\"{truncated}{suffix}\"")
}

pub fn line_index(text: &str) -> Vec<u32> {
    let mut starts = vec![0];
    for (offset, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            starts.push((offset + 1) as u32);
        }
    }
    starts
}

pub fn count_kinds(records: &[Record]) -> BTreeMap<&'static str, usize> {
    let mut counts = BTreeMap::from([
        ("objects", 0),
        ("arrays", 0),
        ("strings", 0),
        ("numbers", 0),
        ("booleans", 0),
        ("nulls", 0),
    ]);
    for record in records {
        let key = match record.kind {
            ValueKind::Object => "objects",
            ValueKind::Array => "arrays",
            ValueKind::String => "strings",
            ValueKind::Number => "numbers",
            ValueKind::Boolean => "booleans",
            ValueKind::Null => "nulls",
        };
        *counts.get_mut(key).unwrap() += 1;
    }
    counts
}
