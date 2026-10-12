use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub path: String,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub valid: bool,
    pub issues: Vec<ValidationIssue>,
}

pub fn validate_against_schema(schema: &Value, instance: &Value) -> ValidationReport {
    let issues = validate(schema, instance, "$");
    ValidationReport {
        valid: issues.is_empty(),
        issues,
    }
}

fn validate(schema: &Value, instance: &Value, path: &str) -> Vec<ValidationIssue> {
    if schema.as_object().is_some_and(|object| object.is_empty()) {
        return Vec::new();
    }

    let mut issues = Vec::new();
    if let Some(type_value) = schema.get("type") {
        if !type_matches(type_value, instance) {
            issues.push(ValidationIssue {
                path: path.to_string(),
                message: format!(
                    "期望类型 {}，实际为 {}",
                    display_type(type_value),
                    instance_type(instance)
                ),
            });
            return issues;
        }
    }

    match instance {
        Value::Object(object) => {
            if let Some(required) = schema.get("required").and_then(Value::as_array) {
                for key in required.iter().filter_map(Value::as_str) {
                    if !object.contains_key(key) {
                        issues.push(ValidationIssue {
                            path: format!("{path}.{key}"),
                            message: format!("缺少必填字段 {key}"),
                        });
                    }
                }
            }
            if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
                for (key, value) in object {
                    if let Some(child_schema) = properties.get(key) {
                        issues.extend(validate(child_schema, value, &format!("{path}.{key}")));
                    }
                }
            }
        }
        Value::Array(items) => {
            if let Some(item_schema) = schema.get("items") {
                for (index, item) in items.iter().enumerate() {
                    issues.extend(validate(item_schema, item, &format!("{path}[{index}]")));
                }
            }
        }
        _ => {}
    }

    issues
}

fn type_matches(expected: &Value, instance: &Value) -> bool {
    match expected {
        Value::String(type_name) => instance_has_type(instance, type_name),
        Value::Array(types) => types.iter().any(|item| {
            item.as_str()
                .is_some_and(|type_name| instance_has_type(instance, type_name))
        }),
        _ => true,
    }
}

fn instance_has_type(instance: &Value, type_name: &str) -> bool {
    match type_name {
        "object" => instance.is_object(),
        "array" => instance.is_array(),
        "string" => instance.is_string(),
        "boolean" => instance.is_boolean(),
        "null" => instance.is_null(),
        "integer" => instance
            .as_number()
            .is_some_and(|number| number.is_i64() || number.is_u64()),
        "number" => instance.is_number(),
        _ => true,
    }
}

fn instance_type(instance: &Value) -> &'static str {
    match instance {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(number) if number.is_i64() || number.is_u64() => "integer",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn display_type(expected: &Value) -> String {
    match expected {
        Value::String(type_name) => type_name.clone(),
        Value::Array(types) => types
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" | "),
        other => other.to_string(),
    }
}
