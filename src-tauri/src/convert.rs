use std::io::Cursor;

use csv::WriterBuilder;
use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use serde_json::{Map, Value};

use crate::model::FormatKind;

pub fn convert(value: &Value, format: FormatKind) -> Result<String, String> {
    match format {
        FormatKind::Json => serde_json::to_string_pretty(value).map_err(|error| error.to_string()),
        FormatKind::Yaml => serde_yaml::to_string(value).map_err(|error| error.to_string()),
        FormatKind::Toml => {
            let toml_value: toml::Value =
                serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
            toml::to_string_pretty(&toml_value).map_err(|error| error.to_string())
        }
        FormatKind::Csv => to_csv(value),
        FormatKind::Xml => to_xml(value),
    }
}

fn to_csv(value: &Value) -> Result<String, String> {
    let rows = match value {
        Value::Array(items) => items.clone(),
        other => vec![other.clone()],
    };
    let mut headers = Vec::new();
    for row in &rows {
        if let Some(object) = row.as_object() {
            for key in object.keys() {
                if !headers.contains(key) {
                    headers.push(key.clone());
                }
            }
        }
    }
    if headers.is_empty() {
        headers.push("value".to_string());
    }
    let mut writer = WriterBuilder::new().from_writer(Vec::new());
    writer
        .write_record(&headers)
        .map_err(|error| error.to_string())?;
    for row in rows {
        let record = headers
            .iter()
            .map(|header| match &row {
                Value::Object(object) => object.get(header).map(scalar).unwrap_or_default(),
                other if header == "value" => scalar(other),
                _ => String::new(),
            })
            .collect::<Vec<_>>();
        writer
            .write_record(record)
            .map_err(|error| error.to_string())?;
    }
    let bytes = writer.into_inner().map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

fn to_xml(value: &Value) -> Result<String, String> {
    let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 2);
    writer
        .write_event(Event::Decl(quick_xml::events::BytesDecl::new(
            "1.0",
            Some("UTF-8"),
            None,
        )))
        .map_err(|error| error.to_string())?;
    write_xml(&mut writer, "root", value)?;
    let cursor = writer.into_inner();
    String::from_utf8(cursor.into_inner()).map_err(|error| error.to_string())
}

fn write_xml(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    name: &str,
    value: &Value,
) -> Result<(), String> {
    let tag = sanitize_tag(name);
    match value {
        Value::Object(object) => write_object(writer, &tag, object),
        Value::Array(items) => {
            for item in items {
                write_xml(writer, &singular(&tag), item)?;
            }
            Ok(())
        }
        other => {
            writer
                .write_event(Event::Start(BytesStart::new(&tag)))
                .map_err(|error| error.to_string())?;
            writer
                .write_event(Event::Text(BytesText::new(&scalar(other))))
                .map_err(|error| error.to_string())?;
            writer
                .write_event(Event::End(BytesEnd::new(&tag)))
                .map_err(|error| error.to_string())
        }
    }
}

fn write_object(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    tag: &str,
    object: &Map<String, Value>,
) -> Result<(), String> {
    let mut start = BytesStart::new(tag);
    for (key, value) in object {
        if let Some(attribute) = key.strip_prefix('@') {
            start.push_attribute((sanitize_tag(attribute).as_str(), scalar(value).as_str()));
        }
    }
    writer
        .write_event(Event::Start(start))
        .map_err(|error| error.to_string())?;
    if let Some(text) = object.get("#text") {
        writer
            .write_event(Event::Text(BytesText::new(&scalar(text))))
            .map_err(|error| error.to_string())?;
    }
    for (key, value) in object {
        if key.starts_with('@') || key == "#text" {
            continue;
        }
        write_xml(writer, key, value)?;
    }
    writer
        .write_event(Event::End(BytesEnd::new(tag)))
        .map_err(|error| error.to_string())
}

fn scalar(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn sanitize_tag(name: &str) -> String {
    let mut tag = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if tag
        .chars()
        .next()
        .is_none_or(|character| character.is_ascii_digit())
    {
        tag.insert(0, '_');
    }
    tag
}

fn singular(name: &str) -> String {
    name.strip_suffix('s').unwrap_or(name).to_string()
}
