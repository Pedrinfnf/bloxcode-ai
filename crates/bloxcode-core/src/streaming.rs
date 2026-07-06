// ═══════════════════════════════════════════════════════════════════════════════
// LLM STREAMING — Native Rust async streaming with smart JSON detection
// This is the performance-critical part that benefits most from Rust
// ═══════════════════════════════════════════════════════════════════════════════

use anyhow::Result;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug)]
pub struct StreamResult {
    pub content: String,
    pub reasoning: String,
    pub is_json: bool,
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Usage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

/// Stream chat completion — returns chunks via callback
/// Detects JSON vs plain text in first 30 chars
pub async fn stream_chat(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
    on_text_chunk: impl Fn(&str),
) -> Result<StreamResult> {
    let url = format!("{}/chat/completions", base_url);

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_tokens": 4096,
        "temperature": 0.3,
        "stream": true,
    });

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "http://localhost")
        .header("X-Title", "BloxCode")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("API {}: {}", status, &body[..body.len().min(200)]);
    }

    let mut content = String::new();
    let mut reasoning = String::new();
    let mut usage = None;
    let mut phase = DetectPhase::Detecting;
    let mut pending = String::new();

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            let line = line.trim();
            if !line.starts_with("data: ") { continue; }
            let data = &line[6..];
            if data == "[DONE]" { continue; }

            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                let delta = &parsed["choices"][0]["delta"];

                // Reasoning field
                if let Some(r) = delta["reasoning"].as_str()
                    .or(delta["reasoning_content"].as_str())
                {
                    reasoning.push_str(r);
                    continue;
                }

                // Content
                if let Some(c) = delta["content"].as_str() {
                    // Filter <think> tags
                    if c.contains("<think>") || c.contains("</think>") {
                        reasoning.push_str(&c.replace("<think>", "").replace("</think>", ""));
                        continue;
                    }

                    content.push_str(c);

                    match phase {
                        DetectPhase::Detecting => {
                            pending.push_str(c);
                            if pending.len() >= 30 {
                                let trimmed = pending.trim_start();
                                if trimmed.starts_with('{') || trimmed.starts_with('[') {
                                    phase = DetectPhase::Buffering;
                                } else {
                                    phase = DetectPhase::Streaming;
                                    on_text_chunk(&pending);
                                }
                                pending.clear();
                            }
                        }
                        DetectPhase::Streaming => {
                            if c.trim_start().starts_with("{\"type\"") {
                                phase = DetectPhase::Buffering;
                            } else {
                                on_text_chunk(c);
                            }
                        }
                        DetectPhase::Buffering => {
                            // Silent accumulation
                        }
                    }
                }

                if let Some(u) = parsed.get("usage") {
                    usage = serde_json::from_value(u.clone()).ok();
                }
            }
        }
    }

    // Finalize short responses still in detect phase
    if matches!(phase, DetectPhase::Detecting) && !pending.is_empty() {
        let trimmed = pending.trim_start();
        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            phase = DetectPhase::Buffering;
        } else {
            on_text_chunk(&pending);
            phase = DetectPhase::Streaming;
        }
    }

    // Strip <think> blocks
    let final_content = if content.contains("<think>") {
        let _re_pattern = "<think>[\\s\\S]*?</think>";
        content
            .split("<think>")
            .enumerate()
            .map(|(i, part)| {
                if i == 0 { part.to_string() }
                else { part.split("</think>").skip(1).collect::<Vec<_>>().join("") }
            })
            .collect::<String>()
            .trim()
            .to_string()
    } else {
        content
    };

    let is_json = matches!(phase, DetectPhase::Buffering);

    Ok(StreamResult {
        content: final_content,
        reasoning,
        is_json,
        usage,
    })
}

#[derive(Debug)]
enum DetectPhase {
    Detecting,
    Streaming,
    Buffering,
}
