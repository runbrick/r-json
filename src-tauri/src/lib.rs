mod codegen;
mod convert;
mod index;
mod layout;
mod model;
mod parse;
mod query;
mod session;
mod tree_node;
mod validate;

use std::fs;
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::codegen::{generate, json_schema};
use crate::convert::convert;
use crate::model::{FormatKind, GraphPayload, LayoutDirection, LoadedDocument, NodeDetail, SearchHit, TextWindow};
use crate::query::{json_path, jmes_path, run_jq};
use crate::session::Session;
use crate::validate::{validate_against_schema, ValidationReport};

pub struct AppState {
    pub session: Mutex<Option<Session>>,
}

#[tauri::command]
fn read_dropped_file(path: String) -> Result<LoadedFile, String> {
    let file_path = Path::new(&path);
    let contents = fs::read_to_string(file_path).map_err(|error| error.to_string())?;
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("dropped.json")
        .to_string();
    Ok(LoadedFile { file_name, contents })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadedFile {
    file_name: String,
    contents: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryResult {
    values: Vec<Value>,
    count: usize,
}

#[tauri::command]
fn load_document(
    state: State<AppState>,
    contents: String,
    file_name: Option<String>,
) -> Result<LoadedDocument, String> {
    let session = Session::load(&contents, file_name)?;
    let snapshot = session.snapshot();
    *state.session.lock().expect("session lock") = Some(session);
    Ok(snapshot)
}

#[tauri::command]
fn graph_view(state: State<AppState>) -> Result<GraphPayload, String> {
    state
        .session
        .lock()
        .expect("session lock")
        .as_ref()
        .map(Session::graph)
        .ok_or_else(|| "No document is loaded".to_string())
}

#[tauri::command]
fn set_layout(
    state: State<AppState>,
    direction: LayoutDirection,
) -> Result<GraphPayload, String> {
    let mut guard = state.session.lock().expect("session lock");
    let session = guard.as_mut().ok_or_else(|| "No document is loaded".to_string())?;
    session.direction = direction;
    Ok(session.graph())
}

#[tauri::command]
fn toggle_node(state: State<AppState>, node_id: u32) -> Result<GraphPayload, String> {
    let mut guard = state.session.lock().expect("session lock");
    let session = guard.as_mut().ok_or_else(|| "No document is loaded".to_string())?;
    if !session.collapsed.insert(node_id) {
        session.collapsed.remove(&node_id);
    }
    Ok(session.graph())
}

#[tauri::command]
fn expand_all(state: State<AppState>, expanded: bool) -> Result<GraphPayload, String> {
    let mut guard = state.session.lock().expect("session lock");
    let session = guard.as_mut().ok_or_else(|| "No document is loaded".to_string())?;
    session.collapsed.clear();
    if !expanded {
        session
            .collapsed
            .extend(session.index.records.iter().skip(1).map(|record| record.id));
    }
    Ok(session.graph())
}

#[tauri::command]
fn search_document(
    state: State<AppState>,
    query: String,
    mode: Option<String>,
) -> Result<Vec<SearchHit>, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    session.query_hits(mode.as_deref().unwrap_or("text"), &query)
}

#[tauri::command]
fn node_detail(state: State<AppState>, node_id: u32) -> Result<NodeDetail, String> {
    state
        .session
        .lock()
        .expect("session lock")
        .as_ref()
        .and_then(|session| session.detail(node_id))
        .ok_or_else(|| "Node not found".to_string())
}

#[tauri::command]
fn text_window(
    state: State<AppState>,
    start_line: u32,
    line_count: u32,
) -> Result<TextWindow, String> {
    state
        .session
        .lock()
        .expect("session lock")
        .as_ref()
        .map(|session| session.text_window(start_line, line_count.clamp(1, 400)))
        .ok_or_else(|| "No document is loaded".to_string())
}

#[tauri::command]
fn format_document(state: State<AppState>) -> Result<String, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    serde_json::to_string_pretty(&session.value).map_err(|error| error.to_string())
}

#[tauri::command]
fn minify_document(state: State<AppState>) -> Result<String, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    serde_json::to_string(&session.value).map_err(|error| error.to_string())
}

#[tauri::command]
fn convert_document(state: State<AppState>, format: FormatKind) -> Result<String, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    convert(&session.value, format)
}

#[tauri::command]
fn generate_code(
    state: State<AppState>,
    language: String,
    root_name: String,
) -> Result<String, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    generate(&session.value, &language, &root_name)
}

#[tauri::command]
fn generate_schema(state: State<AppState>) -> Result<String, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    serde_json::to_string_pretty(&json_schema(&session.value)).map_err(|error| error.to_string())
}

#[tauri::command]
fn validate_schema(state: State<AppState>, schema: String) -> Result<ValidationReport, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    let schema_value: Value =
        serde_json::from_str(&schema).map_err(|error| format!("Schema 不是有效 JSON: {error}"))?;
    Ok(validate_against_schema(&schema_value, &session.value))
}

#[tauri::command]
fn query_jq(state: State<AppState>, program: String) -> Result<QueryResult, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    let values = run_jq(&session.value, &program)?;
    let count = values.len();
    Ok(QueryResult { values, count })
}

#[tauri::command]
fn query_path(state: State<AppState>, expression: String) -> Result<QueryResult, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    let values = json_path(&session.value, &expression)?;
    let count = values.len();
    Ok(QueryResult { values, count })
}

#[tauri::command]
fn query_jmes(state: State<AppState>, expression: String) -> Result<QueryResult, String> {
    let guard = state.session.lock().expect("session lock");
    let session = guard.as_ref().ok_or_else(|| "No document is loaded".to_string())?;
    let values = jmes_path(&session.value, &expression)?;
    let count = values.len();
    Ok(QueryResult { values, count })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            session: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            load_document,
            graph_view,
            set_layout,
            toggle_node,
            expand_all,
            search_document,
            node_detail,
            text_window,
            format_document,
            minify_document,
            convert_document,
            generate_code,
            generate_schema,
            validate_schema,
            query_jq,
            query_path,
            query_jmes,
            read_dropped_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
