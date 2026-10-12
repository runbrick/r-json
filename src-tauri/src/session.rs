use std::collections::HashSet;
use std::time::Instant;

use rayon::prelude::*;
use serde_json::Value;

use crate::index::{count_kinds, DocumentIndex, Record};
use crate::layout;
use crate::model::{
    DocumentStats, FormatKind, LayoutDirection, LoadedDocument, NodeDetail, SearchHit, TextWindow,
    MAX_SEARCH_HITS,
};
use crate::parse::{detect_format, parse_to_json};
use crate::query::{jmes_path, json_path};

pub struct Session {
    pub value: Value,
    pub index: DocumentIndex,
    pub collapsed: HashSet<u32>,
    pub direction: LayoutDirection,
    pub format: FormatKind,
    pub file_name: Option<String>,
    pub parse_ms: u32,
}

impl Session {
    pub fn load(contents: &str, file_name: Option<String>) -> Result<Self, String> {
        let started = Instant::now();
        let format = detect_format(file_name.as_deref(), contents);
        let value = parse_to_json(format, contents)?;
        let pretty = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
        let index = DocumentIndex::build(&value, &pretty);
        Ok(Self {
            value,
            index,
            collapsed: HashSet::new(),
            direction: LayoutDirection::Right,
            format,
            file_name,
            parse_ms: started.elapsed().as_millis() as u32,
        })
    }

    pub fn snapshot(&self) -> LoadedDocument {
        let started = Instant::now();
        let graph = layout::layout(&self.index.records, &self.collapsed, self.direction);
        let counts = count_kinds(&self.index.records);
        LoadedDocument {
            format: self.format,
            pretty: self.index.text.clone(),
            stats: DocumentStats {
                bytes: self.index.text.len(),
                nodes: self.index.records.len(),
                depth: self
                    .index
                    .records
                    .iter()
                    .map(|record| record.depth)
                    .max()
                    .unwrap_or(0),
                objects: counts["objects"],
                arrays: counts["arrays"],
                strings: counts["strings"],
                numbers: counts["numbers"],
                booleans: counts["booleans"],
                nulls: counts["nulls"],
                parse_ms: self.parse_ms,
                layout_ms: started.elapsed().as_millis() as u32,
            },
            graph,
            tree: self.index.subtree(0),
            error: None,
        }
    }

    pub fn search(&self, query: &str) -> Vec<SearchHit> {
        self.query_hits("text", query).unwrap_or_default()
    }

    pub fn query_hits(&self, mode: &str, query: &str) -> Result<Vec<SearchHit>, String> {
        let expression = query.trim();
        if expression.is_empty() {
            return Ok(Vec::new());
        }
        match mode {
            "jmes" => Ok(self.hits_from_values(jmes_path(&self.value, expression)?, "jmes")),
            "json" | "path" => Ok(self.hits_from_values(json_path(&self.value, expression)?, "json")),
            _ => Ok(self.text_search(expression)),
        }
    }

    fn text_search(&self, query: &str) -> Vec<SearchHit> {
        let needle = query.to_ascii_lowercase();
        self.index
            .records
            .par_iter()
            .filter_map(|record| {
                let key_match = record
                    .key
                    .as_deref()
                    .is_some_and(|key| key.to_ascii_lowercase().contains(&needle));
                let value_match = record.preview.to_ascii_lowercase().contains(&needle);
                let path_match = record.path.to_ascii_lowercase().contains(&needle);
                if !(key_match || value_match || path_match) {
                    return None;
                }
                Some(self.hit_from_record(record, record.preview.clone()))
            })
            .collect::<Vec<_>>()
            .into_iter()
            .take(MAX_SEARCH_HITS)
            .collect()
    }

    fn hits_from_values(&self, values: Vec<Value>, mode: &str) -> Vec<SearchHit> {
        values
            .into_iter()
            .take(MAX_SEARCH_HITS)
            .enumerate()
            .map(|(index, value)| {
                let preview = preview_value(&value);
                if let Some(record) = self.index.record_for_path(&self.value_path(&value)) {
                    return self.hit_from_record(record, preview);
                }
                SearchHit {
                    node_id: 0,
                    path: format!("{mode}[{index}]"),
                    key: None,
                    preview,
                    line: 1,
                    column: 1,
                }
            })
            .collect()
    }

    fn hit_from_record(&self, record: &Record, preview: String) -> SearchHit {
        let (line, column) = self.index.line_column(record.byte_start);
        SearchHit {
            node_id: record.id,
            path: record.path.clone(),
            key: record.key.clone(),
            preview,
            line,
            column,
        }
    }

    fn value_path(&self, value: &Value) -> String {
        self.index
            .records
            .iter()
            .find(|record| {
                self.index
                    .node_value(record.id)
                    .is_some_and(|candidate| candidate == *value)
            })
            .map(|record| record.path.clone())
            .unwrap_or_else(|| "$".to_string())
    }

    pub fn detail(&self, node_id: u32) -> Option<NodeDetail> {
        let record = self.index.records.get(node_id as usize)?;
        let json = self
            .index
            .node_value(node_id)
            .and_then(|value| serde_json::to_string_pretty(&value).ok())?;
        Some(NodeDetail {
            id: record.id,
            path: record.path.clone(),
            kind: record.kind,
            key: record.key.clone(),
            json,
            child_count: record.child_count,
            byte_start: record.byte_start,
            byte_end: record.byte_end,
        })
    }

    pub fn text_window(&self, start_line: u32, line_count: u32) -> TextWindow {
        let lines = self.index.text.lines().skip(start_line as usize);
        let page = lines.take(line_count as usize).map(str::to_string).collect();
        TextWindow {
            start_line,
            lines: page,
            total_lines: self.index.line_starts.len() as u32,
        }
    }

    pub fn graph(&self) -> crate::model::GraphPayload {
        crate::layout::layout(&self.index.records, &self.collapsed, self.direction)
    }
}

fn preview_value(value: &Value) -> String {
    match value {
        Value::String(text) => format!("\"{}\"", text.chars().take(72).collect::<String>()),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Null => "null".to_string(),
        Value::Array(items) => format!("[{} items]", items.len()),
        Value::Object(object) => format!("{{{} keys}}", object.len()),
    }
}
