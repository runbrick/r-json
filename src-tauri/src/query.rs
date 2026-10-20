use jaq_core::data::JustLut;
use jaq_core::load::{Arena, File, Loader};
use jaq_core::{unwrap_valr, Compiler, Ctx, Vars};
use jaq_json::Val;
use jaq_std::{defs, funs};
use serde_json::Value;

use crate::index::{child_index_path, child_key_path};
use crate::model::MAX_SEARCH_HITS;

const MAX_PREFIX_PARENTS: usize = 64;
const MAX_PREFIX_CHILDREN: usize = 256;

pub struct LocatedValue {
    pub path: String,
    pub value: Value,
}

pub fn run_jq(value: &Value, program: &str) -> Result<Vec<Value>, String> {
    let program = if program.trim().is_empty() { "." } else { program };
    let arena = Arena::default();
    let loader = Loader::new(jaq_core::defs().chain(defs()).chain(jaq_json::defs()));
    let modules = loader
        .load(&arena, File { path: (), code: program })
        .map_err(|errors| format!("{errors:?}"))?;
    let filter = Compiler::default()
        .with_funs(jaq_core::funs().chain(funs()).chain(jaq_json::funs()))
        .compile(modules)
        .map_err(|errors| format!("{errors:?}"))?;
    let input = serde_json::from_value::<Val>(value.clone()).map_err(|error| error.to_string())?;
    let context = Ctx::<JustLut<Val>>::new(&filter.lut, Vars::new([]));
    filter
        .id
        .run((context, input))
        .take(500)
        .map(|result| {
            unwrap_valr(result)
                .map(|item| {
                    let rendered = format!("{item}");
                    serde_json::from_str(&rendered).unwrap_or(Value::String(rendered))
                })
                .map_err(|error| error.to_string())
        })
        .collect()
}

pub fn json_path(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    Ok(json_path_located(value, expression)?
        .into_iter()
        .map(|item| item.value)
        .collect())
}

pub fn json_path_located(value: &Value, expression: &str) -> Result<Vec<LocatedValue>, String> {
    walk_json_path(value, expression, false)
}

/// JSONPath that also accepts an unfinished last segment.
/// `$.use` suggests every child key starting with `use` instead of requiring the full name.
pub fn json_path_prefix(value: &Value, expression: &str) -> Result<Vec<LocatedValue>, String> {
    walk_json_path(value, expression, true)
}

fn walk_json_path(
    value: &Value,
    expression: &str,
    allow_prefix: bool,
) -> Result<Vec<LocatedValue>, String> {
    let path = expression.trim();
    if path.is_empty() || path == "$" {
        return Ok(vec![root_located(value)]);
    }
    let body = path
        .strip_prefix('$')
        .ok_or_else(|| "JSON Path must start with $".to_string())?;
    let mut matches = vec![root_located(value)];
    let mut remainder = body;
    while !remainder.is_empty() {
        if remainder.starts_with("..") {
            return Err("Recursive descent is available through jq".to_string());
        }
        let last = is_last_segment(remainder);
        if let Some(rest) = remainder.strip_prefix('[') {
            if allow_prefix && last && !rest.contains(']') {
                return Ok(filter_prefix(matches, rest, MAX_SEARCH_HITS));
            }
            let (token, after) = split_bracket(rest)?;
            matches = step_bracket_located(matches, token)?;
            remainder = after;
        } else if let Some(rest) = remainder.strip_prefix('.') {
            let end = rest.find(['.', '[']).unwrap_or(rest.len());
            let key = &rest[..end];
            matches = if allow_prefix && last {
                filter_prefix(matches, key, MAX_SEARCH_HITS)
            } else {
                step_key_located(matches, key)
            };
            remainder = &rest[end..];
        } else if allow_prefix && last {
            return Ok(filter_prefix(matches, remainder, MAX_SEARCH_HITS));
        } else {
            return Err(format!("Unsupported JSON Path token near {remainder}"));
        }
    }
    Ok(matches)
}

fn step_key_located(values: Vec<LocatedValue>, key: &str) -> Vec<LocatedValue> {
    values
        .into_iter()
        .filter_map(|item| {
            item.value.get(key).cloned().map(|child| LocatedValue {
                path: child_key_path(&item.path, key),
                value: child,
            })
        })
        .collect()
}

fn step_bracket_located(values: Vec<LocatedValue>, token: &str) -> Result<Vec<LocatedValue>, String> {
    if token == "*" {
        return Ok(values.into_iter().flat_map(expand_children).collect());
    }
    if let Ok(index) = token.parse::<usize>() {
        return Ok(values
            .into_iter()
            .filter_map(|item| {
                item.value
                    .as_array()
                    .and_then(|items| items.get(index).cloned())
                    .map(|child| LocatedValue {
                        path: child_index_path(&item.path, index),
                        value: child,
                    })
            })
            .collect());
    }
    let key = token.trim_matches(|character| character == '"' || character == '\'');
    Ok(step_key_located(values, key))
}

fn expand_children(item: LocatedValue) -> Vec<LocatedValue> {
    match item.value {
        Value::Array(items) => items
            .into_iter()
            .enumerate()
            .map(|(index, child)| LocatedValue {
                path: child_index_path(&item.path, index),
                value: child,
            })
            .collect(),
        Value::Object(object) => object
            .into_iter()
            .map(|(key, child)| LocatedValue {
                path: child_key_path(&item.path, &key),
                value: child,
            })
            .collect(),
        other => vec![LocatedValue {
            path: item.path,
            value: other,
        }],
    }
}

pub fn jmes_path(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    Ok(jmes_path_located(value, expression)?
        .into_iter()
        .map(|item| item.value)
        .collect())
}

pub fn jmes_path_located(value: &Value, expression: &str) -> Result<Vec<LocatedValue>, String> {
    walk_jmes_path(value, expression, false)
}

/// JMESPath that also accepts an unfinished last identifier.
/// `users.na` suggests `users.name` as soon as the prefix is typed.
pub fn jmes_path_prefix(value: &Value, expression: &str) -> Result<Vec<LocatedValue>, String> {
    walk_jmes_path(value, expression, true)
}

fn walk_jmes_path(
    value: &Value,
    expression: &str,
    allow_prefix: bool,
) -> Result<Vec<LocatedValue>, String> {
    let expression = expression.trim();
    if expression.is_empty() || expression == "@" {
        return Ok(vec![root_located(value)]);
    }
    let mut cursor = vec![root_located(value)];
    let mut remainder = expression;
    while !remainder.is_empty() {
        if remainder.starts_with('.') {
            if allow_prefix && remainder == "." {
                return Ok(filter_prefix(cursor, "", MAX_SEARCH_HITS));
            }
            remainder = remainder.trim_start_matches('.');
            if remainder.is_empty() {
                break;
            }
        }
        let last = is_last_segment(remainder);
        if let Some(rest) = remainder.strip_prefix('[') {
            if allow_prefix && last && !rest.contains(']') {
                return Ok(filter_prefix(cursor, rest, MAX_SEARCH_HITS));
            }
            let (token, after) = split_bracket(rest)?;
            cursor = apply_jmes_bracket_located(cursor, token)?;
            remainder = after;
            continue;
        }
        let end = remainder.find(['.', '[']).unwrap_or(remainder.len());
        let identifier = &remainder[..end];
        cursor = if allow_prefix && last && identifier != "*" {
            filter_prefix(cursor, identifier, MAX_SEARCH_HITS)
        } else if identifier == "*" {
            cursor.into_iter().flat_map(expand_children).collect()
        } else {
            step_key_located(cursor, identifier)
        };
        remainder = &remainder[end..];
    }
    Ok(cursor)
}

fn root_located(value: &Value) -> LocatedValue {
    LocatedValue {
        path: "$".to_string(),
        value: value.clone(),
    }
}

fn is_last_segment(remainder: &str) -> bool {
    match remainder.chars().next() {
        Some('[') => !remainder.contains(']'),
        Some('.') => {
            let rest = remainder.trim_start_matches('.');
            !rest.contains('.') && !rest.contains('[')
        }
        _ => !remainder.contains('.') && !remainder.contains('['),
    }
}

/// Keep children whose key or index starts with `prefix`.
/// Object keys use the sorted map, so the scan stops at the first miss.
/// Results are capped so one keystroke cannot walk a huge document.
fn filter_prefix(values: Vec<LocatedValue>, prefix: &str, limit: usize) -> Vec<LocatedValue> {
    let prefix = prefix.trim_matches(|character| character == '"' || character == '\'');
    let mut output = Vec::new();
    for item in values.into_iter().take(MAX_PREFIX_PARENTS) {
        match &item.value {
            Value::Object(object) => {
                // Keys keep document order, so a sorted range scan is not valid.
                // This still runs once per path segment; later keystrokes reuse the page.
                for (key, child) in object {
                    if !key.starts_with(prefix) {
                        continue;
                    }
                    output.push(LocatedValue {
                        path: child_key_path(&item.path, key),
                        value: child.clone(),
                    });
                    if output.len() >= limit {
                        return sort_prefix_hits(output);
                    }
                }
            }
            Value::Array(items) => {
                for index in prefixed_indices(items.len(), prefix, limit - output.len()) {
                    let Some(child) = items.get(index) else {
                        continue;
                    };
                    output.push(LocatedValue {
                        path: child_index_path(&item.path, index),
                        value: child.clone(),
                    });
                    if output.len() >= limit {
                        return sort_prefix_hits(output);
                    }
                }
            }
            _ => {}
        }
    }
    sort_prefix_hits(output)
}

fn sort_prefix_hits(mut hits: Vec<LocatedValue>) -> Vec<LocatedValue> {
    hits.sort_by(|left, right| {
        let left_key = segment_tail(&left.path);
        let right_key = segment_tail(&right.path);
        left_key
            .len()
            .cmp(&right_key.len())
            .then_with(|| left.path.cmp(&right.path))
    });
    hits
}

fn segment_tail(path: &str) -> &str {
    path.rsplit(['.', '['])
        .next()
        .unwrap_or(path)
        .trim_end_matches(']')
}

fn prefixed_indices(length: usize, prefix: &str, limit: usize) -> Vec<usize> {
    let mut output = Vec::new();
    if limit == 0 || length == 0 {
        return output;
    }
    if prefix.is_empty() {
        output.extend(0..length.min(limit).min(MAX_PREFIX_CHILDREN));
        return output;
    }
    if !prefix.bytes().all(|byte| byte.is_ascii_digit()) {
        return output;
    }
    fn walk(current: &str, length: usize, limit: usize, output: &mut Vec<usize>) {
        if output.len() >= limit || current.len() > 8 {
            return;
        }
        if let Ok(index) = current.parse::<usize>() {
            if index < length && current == index.to_string() {
                output.push(index);
            }
        }
        if current.starts_with('0') {
            return;
        }
        for digit in b'0'..=b'9' {
            let next = format!("{current}{}", digit as char);
            if next.parse::<usize>().ok().is_some_and(|index| index < length) {
                walk(&next, length, limit, output);
            }
        }
    }
    walk(prefix, length, limit.min(MAX_PREFIX_CHILDREN), &mut output);
    output
}

fn split_bracket(text: &str) -> Result<(&str, &str), String> {
    let mut depth = 1;
    let mut quoted = false;
    for (offset, character) in text.char_indices() {
        match character {
            '"' | '\'' if !quoted => quoted = true,
            '"' | '\'' if quoted => quoted = false,
            '[' if !quoted => depth += 1,
            ']' if !quoted => {
                depth -= 1;
                if depth == 0 {
                    return Ok((&text[..offset], &text[offset + 1..]));
                }
            }
            _ => {}
        }
    }
    Err("Unclosed JMESPath bracket".to_string())
}

fn apply_jmes_bracket_located(
    values: Vec<LocatedValue>,
    token: &str,
) -> Result<Vec<LocatedValue>, String> {
    let token = token.trim();
    if token == "*" {
        return Ok(values.into_iter().flat_map(expand_children).collect());
    }
    if let Some(index) = token
        .strip_prefix('-')
        .and_then(|digits| digits.parse::<usize>().ok())
    {
        return Ok(values
            .into_iter()
            .filter_map(|item| {
                item.value.as_array().and_then(|items| {
                    items.len().checked_sub(index).and_then(|position| {
                        items.get(position).cloned().map(|child| (position, child))
                    })
                }).map(|(position, child)| LocatedValue {
                    path: child_index_path(&item.path, position),
                    value: child,
                })
            })
            .collect());
    }
    if token.contains(':') {
        return Ok(values
            .into_iter()
            .flat_map(|item| slice_array_located(item, token))
            .collect());
    }
    if let Some(list) = token.strip_prefix('[') {
        let mut output = Vec::new();
        for item in values {
            for raw_index in list.trim_end_matches(']').split(',') {
                if let Ok(index) = raw_index.trim().parse::<usize>() {
                    if let Some(child) = item.value.as_array().and_then(|items| items.get(index)).cloned() {
                        output.push(LocatedValue {
                            path: child_index_path(&item.path, index),
                            value: child,
                        });
                    }
                }
            }
        }
        return Ok(output);
    }
    step_bracket_located(values, token)
}

fn slice_array_located(item: LocatedValue, token: &str) -> Vec<LocatedValue> {
    let Some(items) = item.value.as_array() else {
        return Vec::new();
    };
    let mut parts = token.split(':');
    let start = parts.next().and_then(|text| parse_bound(text, items.len(), 0));
    let end = parts
        .next()
        .and_then(|text| parse_bound(text, items.len(), items.len()));
    let step = parts
        .next()
        .and_then(|text| text.parse::<isize>().ok())
        .unwrap_or(1);
    let (Some(start), Some(end)) = (start, end) else {
        return Vec::new();
    };
    if step == 0 {
        return Vec::new();
    }
    let mut output = Vec::new();
    let mut index = start as isize;
    if step > 0 {
        while index < end as isize {
            if let Some(child) = items.get(index as usize) {
                output.push(LocatedValue {
                    path: child_index_path(&item.path, index as usize),
                    value: child.clone(),
                });
            }
            index += step;
        }
    }
    output
}

fn parse_bound(text: &str, length: usize, default_value: usize) -> Option<usize> {
    if text.is_empty() {
        return Some(default_value);
    }
    text.parse::<isize>().ok().map(|value| {
        if value < 0 {
            length.saturating_sub(value.unsigned_abs())
        } else {
            (value as usize).min(length)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn paths(items: &[LocatedValue]) -> Vec<&str> {
        items.iter().map(|item| item.path.as_str()).collect()
    }

    #[test]
    fn jmes_prefix_suggests_before_the_key_is_complete() {
        let value = json!({"users": [{"name": "ada", "nicks": []}], "usage": 1});
        let hits = jmes_path_prefix(&value, "u").unwrap();
        assert_eq!(paths(&hits), vec!["$.usage", "$.users"]);
        assert!(jmes_path_located(&value, "u").unwrap().is_empty());
    }

    #[test]
    fn nested_prefix_only_reads_the_next_segment() {
        let value = json!({"users": [{"name": "ada"}, {"name": "bea"}]});
        let hits = jmes_path_prefix(&value, "users[0].n").unwrap();
        assert_eq!(paths(&hits), vec!["$.users[0].name"]);
        let exact = jmes_path_prefix(&value, "users[0].name").unwrap();
        assert_eq!(exact[0].value, json!("ada"));
    }

    #[test]
    fn json_path_prefix_matches_partial_keys_and_indexes() {
        let value = json!({"users": [{"name": "ada"}, {"name": "bea"}]});
        let hits = json_path_prefix(&value, "$.u").unwrap();
        assert_eq!(paths(&hits), vec!["$.users"]);
        let indexed = json_path_prefix(&value, "$.users[1").unwrap();
        assert_eq!(paths(&indexed), vec!["$.users[1]"]);
    }

    #[test]
    fn array_prefix_skips_indexes_outside_the_prefix() {
        let value = json!((0..12).collect::<Vec<_>>());
        let hits = json_path_prefix(&value, "$[1").unwrap();
        assert_eq!(paths(&hits), vec!["$[1]", "$[10]", "$[11]"]);
    }
}
