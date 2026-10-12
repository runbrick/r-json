use std::io::Cursor;

use csv::ReaderBuilder;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::model::FormatKind;

pub fn detect_format(file_name: Option<&str>, contents: &str) -> FormatKind {
    if let Some(name) = file_name {
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".yaml") || lower.ends_with(".yml") {
            return FormatKind::Yaml;
        }
        if lower.ends_with(".xml") {
            return FormatKind::Xml;
        }
        if lower.ends_with(".csv") || lower.ends_with(".tsv") {
            return FormatKind::Csv;
        }
        if lower.ends_with(".toml") {
            return FormatKind::Toml;
        }
        if lower.ends_with(".json") || lower.ends_with(".jsonc") {
            return FormatKind::Json;
        }
    }

    let trimmed = contents.trim_start();
    if trimmed.starts_with('<') {
        FormatKind::Xml
    } else if trimmed.starts_with('{') || trimmed.starts_with('[') {
        FormatKind::Json
    } else if looks_like_csv(trimmed) {
        FormatKind::Csv
    } else {
        FormatKind::Yaml
    }
}

pub fn parse_to_json(format: FormatKind, contents: &str) -> Result<Value, String> {
    match format {
        FormatKind::Json => serde_json::from_str(contents).or_else(|_| parse_jsonc(contents)),
        FormatKind::Yaml => serde_yaml::from_str(contents)
            .map_err(|error| error.to_string())
            .and_then(|yaml: serde_yaml::Value| {
                serde_json::to_value(yaml).map_err(|error| error.to_string())
            }),
        FormatKind::Xml => parse_xml(contents),
        FormatKind::Csv => parse_csv(contents),
        FormatKind::Toml => {
            let toml_value: toml::Value =
                toml::from_str(contents).map_err(|error| error.to_string())?;
            serde_json::to_value(toml_value).map_err(|error| error.to_string())
        }
    }
}

fn parse_jsonc(contents: &str) -> Result<Value, String> {
    let stripped = strip_json_comments(contents);
    serde_json::from_str(&stripped).map_err(|error| error.to_string())
}

fn strip_json_comments(contents: &str) -> String {
    let mut output = String::with_capacity(contents.len());
    let mut chars = contents.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(character) = chars.next() {
        if in_string {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            in_string = true;
            output.push(character);
            continue;
        }
        if character == '/' && chars.peek() == Some(&'/') {
            chars.next();
            for next in chars.by_ref() {
                if next == '\n' {
                    output.push('\n');
                    break;
                }
            }
            continue;
        }
        output.push(character);
    }
    output
}

fn parse_csv(contents: &str) -> Result<Value, String> {
    let delimiter = if contents.lines().next().unwrap_or_default().contains('\t') {
        b'\t'
    } else {
        b','
    };
    let mut reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .from_reader(Cursor::new(contents.as_bytes()));
    let headers = reader
        .headers()
        .map_err(|error| error.to_string())?
        .iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| error.to_string())?;
        let mut object = Map::new();
        for (index, header) in headers.iter().enumerate() {
            let key = if header.is_empty() {
                format!("column_{index}")
            } else {
                header.clone()
            };
            object.insert(key, Value::String(record.get(index).unwrap_or_default().to_string()));
        }
        rows.push(Value::Object(object));
    }
    Ok(Value::Array(rows))
}

fn parse_xml(contents: &str) -> Result<Value, String> {
    let mut reader = Reader::from_str(contents);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<(String, Map<String, Value>, String)> = Vec::new();
    let mut root: Option<Value> = None;
    let mut buffer = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => {
                let name = element.name().into_inner().to_string();
                let mut attributes = Map::new();
                for attribute in element.attributes().flatten() {
                    let key = attribute.key.into_inner().to_string();
                    let value = attribute
                        .normalized_value(quick_xml::XmlVersion::Explicit1_0)
                        .map(|text| text.to_string())
                        .unwrap_or_default();
                    attributes.insert(format!("@{key}"), Value::String(value));
                }
                stack.push((name, attributes, String::new()));
            }
            Ok(Event::Empty(element)) => {
                let name = element.name().into_inner().to_string();
                let mut attributes = Map::new();
                for attribute in element.attributes().flatten() {
                    let key = attribute.key.into_inner().to_string();
                    let value = attribute
                        .normalized_value(quick_xml::XmlVersion::Explicit1_0)
                        .map(|text| text.to_string())
                        .unwrap_or_default();
                    attributes.insert(format!("@{key}"), Value::String(value));
                }
                push_child(&mut stack, &mut root, name, Value::Object(attributes));
            }
            Ok(Event::Text(text)) => {
                if let Some(frame) = stack.last_mut() {
                    frame.2.push_str(&text.html_content());
                }
            }
            Ok(Event::End(_)) => {
                if let Some((name, mut attributes, text)) = stack.pop() {
                    let body = text.clone();
                    if !body.trim().is_empty() {
                        attributes.insert("#text".to_string(), Value::String(body));
                    }
                    let value = if attributes.is_empty() {
                        Value::String(text)
                    } else {
                        Value::Object(attributes)
                    };
                    push_child(&mut stack, &mut root, name, value);
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(error.to_string()),
            _ => {}
        }
        buffer.clear();
    }

    root.ok_or_else(|| "XML document is empty".to_string())
}

fn push_child(
    stack: &mut [(String, Map<String, Value>, String)],
    root: &mut Option<Value>,
    name: String,
    value: Value,
) {
    if let Some((_, parent, _)) = stack.last_mut() {
        match parent.get_mut(&name) {
            Some(Value::Array(items)) => items.push(value),
            Some(existing) => {
                let previous = existing.take();
                *existing = Value::Array(vec![previous, value]);
            }
            None => {
                parent.insert(name, value);
            }
        }
    } else {
        let mut object = Map::new();
        object.insert(name, value);
        *root = Some(Value::Object(object));
    }
}

fn looks_like_csv(contents: &str) -> bool {
    let mut lines = contents.lines().take(2);
    let Some(first) = lines.next() else {
        return false;
    };
    let Some(second) = lines.next() else {
        return false;
    };
    first.contains(',') && second.contains(',') && !first.contains(':')
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct TomlMarker {
    marker: Option<String>,
}
