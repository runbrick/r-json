use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

pub fn json_schema(value: &Value) -> Value {
    let inferred = infer_schema(value);
    let mut root = Map::new();
    root.insert(
        "$schema".to_string(),
        Value::String("http://json-schema.org/draft-07/schema#".to_string()),
    );
    if let Some(object) = inferred.as_object() {
        for (key, child) in object {
            root.insert(key.clone(), child.clone());
        }
    }
    Value::Object(root)
}

fn infer_schema(value: &Value) -> Value {
    match value {
        Value::Null => json!({}),
        Value::Bool(_) => json!({ "type": "boolean" }),
        Value::Number(number) if number.is_i64() || number.is_u64() => json!({ "type": "integer" }),
        Value::Number(_) => json!({ "type": "number" }),
        Value::String(_) => json!({ "type": "string" }),
        Value::Array(items) => array_schema(items),
        Value::Object(object) => object_schema(object),
    }
}

fn object_schema(object: &Map<String, Value>) -> Value {
    let mut properties = Map::new();
    let mut required = Vec::new();
    for key in object.keys() {
        let child_value = &object[key];
        let child_schema = infer_schema(child_value);
        let empty_schema = child_schema.as_object().is_some_and(Map::is_empty);
        properties.insert(key.clone(), child_schema);
        if !child_value.is_null() && !empty_schema {
            required.push(Value::String(key.clone()));
        }
    }
    let mut schema = json!({ "type": "object", "properties": properties });
    if !required.is_empty() {
        schema
            .as_object_mut()
            .expect("object schema")
            .insert("required".to_string(), Value::Array(required));
    }
    schema
}

fn array_schema(items: &[Value]) -> Value {
    let mut schema = json!({ "type": "array" });
    let item_schema = items
        .iter()
        .map(infer_schema)
        .reduce(|left, right| merge_schema(&left, &right))
        .unwrap_or_else(|| json!({}));
    schema
        .as_object_mut()
        .expect("array schema")
        .insert("items".to_string(), item_schema);
    schema
}

fn merge_schema(left: &Value, right: &Value) -> Value {
    if left == right {
        return left.clone();
    }
    if is_empty_schema(left) || is_empty_schema(right) {
        return json!({});
    }
    match (schema_type(left), schema_type(right)) {
        (Some("object"), Some("object")) => merge_object_schemas(left, right),
        (Some("array"), Some("array")) => {
            let items = match (left.get("items"), right.get("items")) {
                (Some(left_items), Some(right_items)) => merge_schema(left_items, right_items),
                (Some(items), None) | (None, Some(items)) => items.clone(),
                _ => json!({}),
            };
            json!({ "type": "array", "items": items })
        }
        (Some("integer"), Some("number")) | (Some("number"), Some("integer")) => {
            json!({ "type": "number" })
        }
        _ => json!({}),
    }
}

fn merge_object_schemas(left: &Value, right: &Value) -> Value {
    let left_properties = left.get("properties").and_then(Value::as_object);
    let right_properties = right.get("properties").and_then(Value::as_object);
    let mut keys = BTreeSet::new();
    if let Some(properties) = left_properties {
        keys.extend(properties.keys().cloned());
    }
    if let Some(properties) = right_properties {
        keys.extend(properties.keys().cloned());
    }

    let mut properties = Map::new();
    for key in keys {
        let left_child = left_properties.and_then(|properties| properties.get(&key));
        let right_child = right_properties.and_then(|properties| properties.get(&key));
        let merged = match (left_child, right_child) {
            (Some(left_child), Some(right_child)) => merge_schema(left_child, right_child),
            (Some(child), None) | (None, Some(child)) => child.clone(),
            _ => json!({}),
        };
        properties.insert(key, merged);
    }

    let required = required_keys(left)
        .intersection(&required_keys(right))
        .cloned()
        .map(Value::String)
        .collect::<Vec<_>>();
    let mut schema = json!({ "type": "object", "properties": properties });
    if !required.is_empty() {
        schema
            .as_object_mut()
            .expect("merged object schema")
            .insert("required".to_string(), Value::Array(required));
    }
    schema
}

fn required_keys(schema: &Value) -> BTreeSet<String> {
    schema
        .get("required")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn schema_type(schema: &Value) -> Option<&str> {
    schema.get("type").and_then(Value::as_str)
}

fn is_empty_schema(schema: &Value) -> bool {
    schema.as_object().is_some_and(Map::is_empty)
}

pub fn generate(value: &Value, language: &str, root_name: &str) -> Result<String, String> {
    match language {
        "typescript" => Ok(typescript(value, root_name)),
        "rust" => Ok(rust_types(value, root_name)),
        "go" => Ok(go_types(value, root_name)),
        "kotlin" => Ok(kotlin_types(value, root_name)),
        "schema" => serde_json::to_string_pretty(&json_schema(value)).map_err(|error| error.to_string()),
        other => Err(format!("Unsupported language: {other}")),
    }
}

fn typescript(value: &Value, root_name: &str) -> String {
    let mut output = String::new();
    emit_typescript(value, root_name, &mut output, &mut BTreeMap::new());
    output
}

fn emit_typescript(
    value: &Value,
    name: &str,
    output: &mut String,
    seen: &mut BTreeMap<String, String>,
) {
    if let Some(existing) = seen.get(name) {
        if existing == &type_signature(value) {
            return;
        }
    }
    seen.insert(name.to_string(), type_signature(value));
    match value {
        Value::Object(object) => {
            output.push_str(&format!("export interface {name} {{\n"));
            for (key, child) in object {
                let optional = if child.is_null() { "?" } else { "" };
                output.push_str(&format!(
                    "  {key}{optional}: {};\n",
                    typescript_type(child, &pascal(key))
                ));
            }
            output.push_str("}\n\n");
            for (key, child) in object {
                if child.is_object() || child.as_array().is_some_and(|items| items.first().is_some_and(Value::is_object)) {
                    let nested = child.as_array().and_then(|items| items.first()).unwrap_or(child);
                    emit_typescript(nested, &pascal(key), output, seen);
                }
            }
        }
        Value::Array(items) => {
            if let Some(first) = items.first() {
                emit_typescript(first, name, output, seen);
            }
        }
        _ => {}
    }
}

fn typescript_type(value: &Value, nested_name: &str) -> String {
    match value {
        Value::Object(_) => nested_name.to_string(),
        Value::Array(items) => format!("{}[]", items.first().map(|item| typescript_type(item, nested_name)).unwrap_or_else(|| "unknown".into())),
        Value::String(_) => "string".into(),
        Value::Number(number) if number.is_i64() || number.is_u64() => "number".into(),
        Value::Number(_) => "number".into(),
        Value::Bool(_) => "boolean".into(),
        Value::Null => "null".into(),
    }
}

fn rust_types(value: &Value, root_name: &str) -> String {
    let mut output = String::from("use serde::{Deserialize, Serialize};\n\n");
    emit_rust(value, root_name, &mut output, &mut BTreeMap::new());
    output
}

fn emit_rust(value: &Value, name: &str, output: &mut String, seen: &mut BTreeMap<String, String>) {
    if seen.insert(name.to_string(), type_signature(value)).is_some() {
        return;
    }
    let Value::Object(object) = value else {
        if let Some(first) = value.as_array().and_then(|items| items.first()) {
            emit_rust(first, name, output, seen);
        }
        return;
    };
    output.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
    output.push_str(&format!("pub struct {name} {{\n"));
    for (key, child) in object {
        let field = snake(key);
        if field != *key {
            output.push_str(&format!("    #[serde(rename = \"{key}\")]\n"));
        }
        let optional = child.is_null();
        let type_name = rust_type(child, &pascal(key));
        let rendered = if optional {
            format!("Option<{type_name}>")
        } else {
            type_name
        };
        output.push_str(&format!("    pub {field}: {rendered},\n"));
    }
    output.push_str("}\n\n");
    for (key, child) in object {
        let nested = child.as_array().and_then(|items| items.first()).unwrap_or(child);
        if nested.is_object() {
            emit_rust(nested, &pascal(key), output, seen);
        }
    }
}

fn rust_type(value: &Value, nested_name: &str) -> String {
    match value {
        Value::Object(_) => nested_name.to_string(),
        Value::Array(items) => format!("Vec<{}>", items.first().map(|item| rust_type(item, nested_name)).unwrap_or_else(|| "serde_json::Value".into())),
        Value::String(_) => "String".into(),
        Value::Number(number) if number.is_i64() || number.is_u64() => "i64".into(),
        Value::Number(_) => "f64".into(),
        Value::Bool(_) => "bool".into(),
        Value::Null => "serde_json::Value".into(),
    }
}

fn go_types(value: &Value, root_name: &str) -> String {
    let mut output = String::from("package model\n\n");
    emit_go(value, root_name, &mut output, &mut BTreeMap::new());
    output
}

fn emit_go(value: &Value, name: &str, output: &mut String, seen: &mut BTreeMap<String, String>) {
    if seen.insert(name.to_string(), type_signature(value)).is_some() {
        return;
    }
    let Value::Object(object) = value else {
        if let Some(first) = value.as_array().and_then(|items| items.first()) {
            emit_go(first, name, output, seen);
        }
        return;
    };
    output.push_str(&format!("type {name} struct {{\n"));
    for (key, child) in object {
        output.push_str(&format!(
            "\t{} {} `json:\"{}\"`\n",
            pascal(key),
            go_type(child, &pascal(key)),
            key
        ));
    }
    output.push_str("}\n\n");
    for (key, child) in object {
        let nested = child.as_array().and_then(|items| items.first()).unwrap_or(child);
        if nested.is_object() {
            emit_go(nested, &pascal(key), output, seen);
        }
    }
}

fn go_type(value: &Value, nested_name: &str) -> String {
    match value {
        Value::Object(_) => nested_name.to_string(),
        Value::Array(items) => format!("[]{}", items.first().map(|item| go_type(item, nested_name)).unwrap_or_else(|| "any".into())),
        Value::String(_) => "string".into(),
        Value::Number(number) if number.is_i64() || number.is_u64() => "int64".into(),
        Value::Number(_) => "float64".into(),
        Value::Bool(_) => "bool".into(),
        Value::Null => "any".into(),
    }
}

fn kotlin_types(value: &Value, root_name: &str) -> String {
    let mut output = String::from("import kotlinx.serialization.Serializable\n\n");
    emit_kotlin(value, root_name, &mut output, &mut BTreeMap::new());
    output
}

fn emit_kotlin(value: &Value, name: &str, output: &mut String, seen: &mut BTreeMap<String, String>) {
    if seen.insert(name.to_string(), type_signature(value)).is_some() {
        return;
    }
    let Value::Object(object) = value else {
        if let Some(first) = value.as_array().and_then(|items| items.first()) {
            emit_kotlin(first, name, output, seen);
        }
        return;
    };
    output.push_str("@Serializable\n");
    output.push_str(&format!("data class {name}(\n"));
    let fields = object
        .iter()
        .map(|(key, child)| {
            format!(
                "    val {}: {}",
                camel(key),
                kotlin_type(child, &pascal(key))
            )
        })
        .collect::<Vec<_>>()
        .join(",\n");
    output.push_str(&fields);
    output.push_str("\n)\n\n");
    for (key, child) in object {
        let nested = child.as_array().and_then(|items| items.first()).unwrap_or(child);
        if nested.is_object() {
            emit_kotlin(nested, &pascal(key), output, seen);
        }
    }
}

fn kotlin_type(value: &Value, nested_name: &str) -> String {
    match value {
        Value::Object(_) => nested_name.to_string(),
        Value::Array(items) => format!("List<{}>", items.first().map(|item| kotlin_type(item, nested_name)).unwrap_or_else(|| "Any?".into())),
        Value::String(_) => "String".into(),
        Value::Number(number) if number.is_i64() || number.is_u64() => "Long".into(),
        Value::Number(_) => "Double".into(),
        Value::Bool(_) => "Boolean".into(),
        Value::Null => "Any?".into(),
    }
}

fn type_signature(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

fn pascal(value: &str) -> String {
    let mut output = String::new();
    let mut uppercase_next = true;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if uppercase_next {
                output.extend(character.to_uppercase());
                uppercase_next = false;
            } else {
                output.push(character);
            }
        } else {
            uppercase_next = true;
        }
    }
    if output
        .chars()
        .next()
        .is_none_or(|character| character.is_ascii_digit())
    {
        output.insert_str(0, "Item");
    }
    output
}

fn snake(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars() {
        if character.is_ascii_uppercase() {
            if !output.is_empty() {
                output.push('_');
            }
            output.extend(character.to_lowercase());
        } else if character.is_ascii_alphanumeric() {
            output.push(character);
        } else if !output.ends_with('_') {
            output.push('_');
        }
    }
    output.trim_matches('_').to_string()
}

fn camel(value: &str) -> String {
    let pascal = pascal(value);
    let mut chars = pascal.chars();
    match chars.next() {
        Some(first) => first.to_lowercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}
