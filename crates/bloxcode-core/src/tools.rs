// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS — Shared between Rust and TypeScript via JSON schema
// ═══════════════════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    #[serde(rename = "type")]
    pub call_type: String, // "tool" or "final"
    pub tool: Option<String>,
    pub args: Option<serde_json::Value>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub ok: bool,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// Try to parse LLM response as a tool call
pub fn parse_tool_call(text: &str) -> Option<ToolCall> {
    let trimmed = text.trim();

    // Direct JSON
    if let Ok(call) = serde_json::from_str::<ToolCall>(trimmed) {
        return Some(call);
    }

    // JSON in code block
    if let Some(start) = trimmed.find("```json") {
        if let Some(end) = trimmed[start..].find("```\n").or(trimmed[start..].rfind("```")) {
            let json_str = &trimmed[start + 7..start + end];
            if let Ok(call) = serde_json::from_str::<ToolCall>(json_str.trim()) {
                return Some(call);
            }
        }
    }

    // First { ... }
    if let Some(brace_start) = trimmed.find('{') {
        if let Some(brace_end) = trimmed.rfind('}') {
            if brace_end > brace_start {
                if let Ok(call) = serde_json::from_str::<ToolCall>(&trimmed[brace_start..=brace_end]) {
                    return Some(call);
                }
            }
        }
    }

    None
}
