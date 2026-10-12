use std::collections::HashSet;

use crate::index::Record;
use crate::model::{
    Bounds, GraphEdge, GraphNode, GraphPayload, LayoutDirection, ValueKind, MAX_RENDER_NODES,
};

const CARD_WIDTH: f32 = 280.0;
const ROW_HEIGHT: f32 = 24.0;
const CARD_CHROME: f32 = 18.0;
const COLUMN_GAP: f32 = 96.0;
const SIBLING_GAP: f32 = 16.0;

struct Placed {
    id: u32,
    depth: u16,
    height: f32,
    subtree: f32,
    y: f32,
}

pub fn layout(
    records: &[Record],
    collapsed: &HashSet<u32>,
    direction: LayoutDirection,
) -> GraphPayload {
    if records.is_empty() {
        return GraphPayload {
            nodes: Vec::new(),
            edges: Vec::new(),
            total_nodes: 0,
            truncated: false,
            bounds: Bounds {
                width: 800.0,
                height: 600.0,
            },
        };
    }

    let mut cards = Vec::new();
    collect_cards(records, 0, collapsed, &mut cards);
    let total_nodes = cards.len();
    let truncated = total_nodes > MAX_RENDER_NODES;
    if truncated {
        cards.truncate(MAX_RENDER_NODES);
    }
    let visible: HashSet<u32> = cards.iter().map(|card| card.id).collect();

    let mut placed = cards
        .iter()
        .map(|card| Placed {
            id: card.id,
            depth: card.depth,
            height: card_height(records, card.id, collapsed),
            subtree: 0.0,
            y: 0.0,
        })
        .collect::<Vec<_>>();
    let index_of = |id: u32, placed: &[Placed]| placed.iter().position(|item| item.id == id);

    for position in (0..placed.len()).rev() {
        let id = placed[position].id;
        let child_positions = linked_children(records, id, collapsed)
            .into_iter()
            .filter_map(|child_id| index_of(child_id, &placed))
            .collect::<Vec<_>>();
        if child_positions.is_empty() {
            placed[position].subtree = placed[position].height;
            continue;
        }
        let children_span = child_positions
            .iter()
            .map(|child| placed[*child].subtree)
            .sum::<f32>()
            + SIBLING_GAP * (child_positions.len().saturating_sub(1)) as f32;
        placed[position].subtree = children_span.max(placed[position].height);
    }

    if let Some(root) = placed.first_mut() {
        root.y = 32.0;
    }
    for position in 0..placed.len() {
        let id = placed[position].id;
        let parent_y = placed[position].y;
        let parent_height = placed[position].height;
        let parent_subtree = placed[position].subtree;
        let child_positions = linked_children(records, id, collapsed)
            .into_iter()
            .filter_map(|child_id| index_of(child_id, &placed))
            .collect::<Vec<_>>();
        if child_positions.is_empty() {
            continue;
        }
        let children_span = child_positions
            .iter()
            .map(|child| placed[*child].subtree)
            .sum::<f32>()
            + SIBLING_GAP * (child_positions.len().saturating_sub(1)) as f32;
        let mut cursor = parent_y + (parent_subtree - children_span) / 2.0;
        let _ = parent_height;
        for child in child_positions {
            placed[child].y = cursor;
            cursor += placed[child].subtree + SIBLING_GAP;
        }
    }

    let mut nodes = Vec::with_capacity(placed.len());
    let mut edges = Vec::new();
    for item in &placed {
        let record = &records[item.id as usize];
        let rows = inline_rows(records, record.id, collapsed);
        let width = card_width(record, &rows);
        let node = GraphNode {
            id: record.id,
            parent_id: record.parent,
            key: record.key.clone(),
            kind: record.kind,
            preview: record.preview.clone(),
            child_count: record.child_count,
            path: record.path.clone(),
            collapsed: collapsed.contains(&record.id),
            x: 40.0 + item.depth as f32 * (CARD_WIDTH + COLUMN_GAP),
            y: item.y,
            width,
            height: item.height,
            depth: item.depth,
            text_start: record.byte_start,
            text_end: record.byte_end,
            rows,
        };
        if let Some(parent_id) = linked_parent(records, record.id) {
            if visible.contains(&parent_id) {
                edges.push(GraphEdge {
                    id: edges.len() as u32,
                    from: parent_id,
                    to: record.id,
                    label: edge_label(records, record.id),
                });
            }
        }
        nodes.push(node);
    }

    let (width, _) = layout_bounds(&nodes);
    orient(&mut nodes, direction, width);
    let (content_width, content_height) = layout_bounds(&nodes);
    GraphPayload {
        nodes,
        edges,
        total_nodes,
        truncated,
        bounds: Bounds {
            width: content_width + 120.0,
            height: content_height + 80.0,
        },
    }
}

struct Card {
    id: u32,
    depth: u16,
}

fn collect_cards(records: &[Record], id: u32, collapsed: &HashSet<u32>, output: &mut Vec<Card>) {
    let record = &records[id as usize];
    if is_card(record) {
        output.push(Card {
            id,
            depth: output
                .last()
                .map(|card| card.depth.saturating_add(1))
                .unwrap_or(0),
        });
    }
    if collapsed.contains(&id) && is_card(record) {
        return;
    }
    for child_id in &record.children {
        collect_cards(records, *child_id, collapsed, output);
    }
}

fn is_card(record: &Record) -> bool {
    matches!(record.kind, ValueKind::Object | ValueKind::Array) || record.parent.is_none()
}

fn linked_children(records: &[Record], id: u32, collapsed: &HashSet<u32>) -> Vec<u32> {
    if collapsed.contains(&id) {
        return Vec::new();
    }
    let mut output = Vec::new();
    for child_id in &records[id as usize].children {
        push_linked(records, *child_id, collapsed, &mut output);
    }
    output
}

fn push_linked(
    records: &[Record],
    id: u32,
    collapsed: &HashSet<u32>,
    output: &mut Vec<u32>,
) {
    let record = &records[id as usize];
    if is_card(record) {
        output.push(id);
        return;
    }
    if collapsed.contains(&id) {
        return;
    }
    for child_id in &record.children {
        push_linked(records, *child_id, collapsed, output);
    }
}

fn linked_parent(records: &[Record], id: u32) -> Option<u32> {
    let mut cursor = records[id as usize].parent;
    while let Some(parent_id) = cursor {
        if is_card(&records[parent_id as usize]) {
            return Some(parent_id);
        }
        cursor = records[parent_id as usize].parent;
    }
    None
}

fn edge_label(records: &[Record], id: u32) -> String {
    let mut labels = Vec::new();
    let mut cursor = Some(id);
    while let Some(current) = cursor {
        let record = &records[current as usize];
        if is_card(record) && current != id {
            break;
        }
        if let Some(key) = &record.key {
            labels.push(key.clone());
        }
        cursor = record.parent;
        if cursor.is_some_and(|parent| is_card(&records[parent as usize])) {
            break;
        }
    }
    labels.reverse();
    labels.join(".")
}

fn card_height(records: &[Record], id: u32, collapsed: &HashSet<u32>) -> f32 {
    let rows = if collapsed.contains(&id) {
        1
    } else {
        records[id as usize].children.len().clamp(1, 12) + 1
    };
    CARD_CHROME + rows as f32 * ROW_HEIGHT + 8.0
}

fn card_width(record: &Record, rows: &[crate::model::FieldRow]) -> f32 {
    let longest = rows
        .iter()
        .map(|row| row.key.chars().count() + row.value.chars().count())
        .max()
        .unwrap_or(12);
    let label = record.key.as_deref().unwrap_or("$").chars().count();
    (190.0 + (label.max(longest)) as f32 * 7.1).clamp(220.0, CARD_WIDTH + 70.0)
}

fn inline_rows(records: &[Record], id: u32, collapsed: &HashSet<u32>) -> Vec<crate::model::FieldRow> {
    if collapsed.contains(&id) {
        return Vec::new();
    }
    records[id as usize]
        .children
        .iter()
        .take(12)
        .map(|child_id| {
            let child = &records[*child_id as usize];
            crate::model::FieldRow {
                key: child.key.clone().unwrap_or_else(|| child.id.to_string()),
                value: child.preview.clone(),
                kind: child.kind,
            }
        })
        .collect()
}

fn layout_bounds(nodes: &[GraphNode]) -> (f32, f32) {
    let mut width = 640.0_f32;
    let mut height = 480.0_f32;
    for node in nodes {
        width = width.max(node.x + node.width);
        height = height.max(node.y + node.height);
    }
    (width, height)
}

fn orient(nodes: &mut [GraphNode], direction: LayoutDirection, width: f32) {
    match direction {
        LayoutDirection::Right => {}
        LayoutDirection::Left => {
            for node in nodes {
                node.x = width - node.x - node.width + 40.0;
            }
        }
        LayoutDirection::Down | LayoutDirection::Up => {
            for node in &mut *nodes {
                let column = (node.x - 40.0) / (CARD_WIDTH + COLUMN_GAP);
                let original_y = node.y;
                node.x = original_y;
                node.y = 36.0 + column * 168.0;
            }
            if direction == LayoutDirection::Up {
                let max_y = nodes
                    .iter()
                    .map(|node| node.y + node.height)
                    .fold(0.0, f32::max);
                for node in nodes {
                    node.y = max_y - node.y + 24.0;
                }
            }
        }
    }
}
