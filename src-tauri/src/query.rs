use jaq_core::data::JustLut;
use jaq_core::load::{Arena, File, Loader};
use jaq_core::{unwrap_valr, Compiler, Ctx, Vars};
use jaq_json::Val;
use jaq_std::{defs, funs};
use serde_json::Value;

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
    let path = expression.trim();
    if path.is_empty() || path == "$" {
        return Ok(vec![value.clone()]);
    }
    let body = path
        .strip_prefix('$')
        .ok_or_else(|| "JSON Path must start with $".to_string())?;
    let mut matches = vec![value.clone()];
    let mut remainder = body;
    while !remainder.is_empty() {
        if remainder.starts_with("..") {
            return Err("Recursive descent is available through jq".to_string());
        }
        if let Some(rest) = remainder.strip_prefix('[') {
            let (token, after) = split_bracket(rest)?;
            matches = step_bracket(matches, token)?;
            remainder = after;
        } else if let Some(rest) = remainder.strip_prefix('.') {
            let end = rest.find(['.', '[']).unwrap_or(rest.len());
            let key = &rest[..end];
            matches = matches
                .into_iter()
                .filter_map(|item| item.get(key).cloned())
                .collect();
            remainder = &rest[end..];
        } else {
            return Err(format!("Unsupported JSON Path token near {remainder}"));
        }
    }
    Ok(matches)
}

fn step_bracket(values: Vec<Value>, token: &str) -> Result<Vec<Value>, String> {
    if token == "*" {
        return Ok(values
            .into_iter()
            .flat_map(|value| match value {
                Value::Array(items) => items,
                Value::Object(object) => object.into_values().collect(),
                other => vec![other],
            })
            .collect());
    }
    if let Ok(index) = token.parse::<usize>() {
        return Ok(values
            .into_iter()
            .filter_map(|value| value.as_array().and_then(|items| items.get(index)).cloned())
            .collect());
    }
    let key = token.trim_matches(|character| character == '"' || character == '\'');
    Ok(values
        .into_iter()
        .filter_map(|value| value.get(key).cloned())
        .collect())
}

pub fn jmes_path(value: &Value, expression: &str) -> Result<Vec<Value>, String> {
    let expression = expression.trim();
    if expression.is_empty() || expression == "@" {
        return Ok(vec![value.clone()]);
    }
    let mut cursor = vec![value.clone()];
    let mut remainder = expression;
    while !remainder.is_empty() {
        remainder = remainder.trim_start_matches('.');
        if remainder.is_empty() {
            break;
        }
        if let Some(rest) = remainder.strip_prefix('[') {
            let (token, after) = split_bracket(rest)?;
            cursor = apply_jmes_bracket(cursor, token)?;
            remainder = after;
            continue;
        }
        let end = remainder.find(['.', '[']).unwrap_or(remainder.len());
        let identifier = &remainder[..end];
        if identifier == "*" {
            cursor = cursor
                .into_iter()
                .flat_map(|item| match item {
                    Value::Array(items) => items,
                    Value::Object(object) => object.into_values().collect(),
                    other => vec![other],
                })
                .collect();
        } else {
            cursor = cursor
                .into_iter()
                .filter_map(|item| item.get(identifier).cloned())
                .collect();
        }
        remainder = &remainder[end..];
    }
    Ok(cursor)
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

fn apply_jmes_bracket(values: Vec<Value>, token: &str) -> Result<Vec<Value>, String> {
    let token = token.trim();
    if token == "*" {
        return step_bracket(values, "*");
    }
    if let Some(index) = token
        .strip_prefix('-')
        .and_then(|digits| digits.parse::<usize>().ok())
    {
        return Ok(values
            .into_iter()
            .filter_map(|value| {
                value.as_array().and_then(|items| {
                    items
                        .len()
                        .checked_sub(index)
                        .and_then(|position| items.get(position))
                        .cloned()
                })
            })
            .collect());
    }
    if token.contains(':') {
        return Ok(values
            .into_iter()
            .flat_map(|value| slice_array(value, token))
            .collect());
    }
    if let Some(list) = token.strip_prefix('[') {
        let mut output = Vec::new();
        for value in values {
            for raw_index in list.trim_end_matches(']').split(',') {
                if let Ok(index) = raw_index.trim().parse::<usize>() {
                    if let Some(item) = value.as_array().and_then(|items| items.get(index)) {
                        output.push(item.clone());
                    }
                }
            }
        }
        return Ok(output);
    }
    step_bracket(values, token)
}

fn slice_array(value: Value, token: &str) -> Vec<Value> {
    let Some(items) = value.as_array() else {
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
            if let Some(item) = items.get(index as usize) {
                output.push(item.clone());
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
