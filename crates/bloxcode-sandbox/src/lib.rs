// ═══════════════════════════════════════════════════════════════════════════════
// SANDBOX — Safe command execution with approval and danger detection
// Inspired by Codex CLI sandbox + Claude Code permission system
// ═══════════════════════════════════════════════════════════════════════════════

use anyhow::Result;
use std::process::Command;
use std::path::Path;

/// Danger level of a command
#[derive(Debug, PartialEq)]
pub enum DangerLevel {
    Safe,        // read-only commands
    Normal,      // typical dev commands
    Dangerous,   // destructive commands
    Critical,    // system-level danger
}

/// Check how dangerous a command is
pub fn assess_danger(cmd: &str) -> DangerLevel {
    let c = cmd.to_lowercase();

    // Critical
    if c.contains("rm -rf /") || c.contains("mkfs") || c.contains("dd if=") ||
       c.contains(":(){ :|:& };:") || c.contains("shutdown") || c.contains("reboot") {
        return DangerLevel::Critical;
    }

    // Dangerous
    if c.contains("rm -rf") || c.contains("chmod 777") || c.contains("sudo ") ||
       (c.contains("curl") && c.contains("| sh")) ||
       (c.contains("wget") && c.contains("| bash")) {
        return DangerLevel::Dangerous;
    }

    // Safe (read-only)
    if c.starts_with("cat ") || c.starts_with("ls ") || c.starts_with("pwd") ||
       c.starts_with("echo ") || c.starts_with("head ") || c.starts_with("tail ") ||
       c.starts_with("grep ") || c.starts_with("find ") || c.starts_with("wc ") ||
       c.starts_with("git status") || c.starts_with("git log") || c.starts_with("git diff") {
        return DangerLevel::Safe;
    }

    DangerLevel::Normal
}

/// Execute a command in a workspace directory
pub async fn exec_command(cmd: &str, cwd: &Path, timeout_secs: u64) -> Result<ExecResult> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        tokio::process::Command::new("bash")
            .arg("-lc")
            .arg(cmd)
            .current_dir(cwd)
            .output()
    ).await??;

    Ok(ExecResult {
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        success: output.status.success(),
    })
}

#[derive(Debug)]
pub struct ExecResult {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}
