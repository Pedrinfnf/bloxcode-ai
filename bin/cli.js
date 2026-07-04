#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  🤖 BLOXCODE v4.0 — AI Terminal Agent                                      ║
 * ║  Inspired by: Codex CLI + OpenCode + Claude Code                           ║
 * ║  Multi-file Architecture | Sub-Agents | TUI | MCP | Skills                 ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { createApp } from "../src/index.js";

const app = await createApp();
await app.run();
