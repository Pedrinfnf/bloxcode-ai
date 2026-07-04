// ═══════════════════════════════════════════════════════════════════════════════
// UNDO / DIFF / SNAPSHOT — Track all file changes and allow reverting
// Inspired by Claude Code's undo + Codex's sandbox rollback
// ═══════════════════════════════════════════════════════════════════════════════

import fs from "node:fs/promises";
import path from "node:path";
import { _, S } from "../core/ansi.js";
import { WORKSPACE, BACKUP_DIR, SNAPSHOTS_DIR } from "../config/state.js";
import { drawBox, drawTable } from "../tui/box.js";
import { confirm } from "../tui/dialogs.js";
import { makeDiff } from "./files.js";

// ── Edit history stack ──
const editHistory = []; // { path, oldContent, newContent, timestamp, tool }

export function recordEdit(relPath, oldContent, newContent, tool = "edit") {
  editHistory.push({
    path: relPath,
    oldContent,
    newContent,
    timestamp: Date.now(),
    tool,
  });
}

export function getEditHistory() {
  return editHistory;
}

/**
 * /undo — revert the last file edit
 */
export async function undo() {
  if (!editHistory.length) {
    console.log(S("\n📭 Nenhuma edição para desfazer.\n", _.G));
    return { ok: false, reason: "empty" };
  }

  const last = editHistory[editHistory.length - 1];
  const fullPath = path.resolve(WORKSPACE, last.path);

  console.log(S(`\n↩️  Desfazer última edição:`, _.y, _.b));
  console.log(S(`   Arquivo: ${last.path}`, _.w));
  console.log(S(`   Tool: ${last.tool}`, _.G));
  console.log(S(`   ${new Date(last.timestamp).toLocaleTimeString()}`, _.G));
  console.log(makeDiff(last.newContent, last.oldContent, `${last.path} (undo)`));

  const ok = await confirm(S("Desfazer?", _.y));
  if (!ok) {
    console.log(S("\n❌ Cancelado.\n", _.r));
    return { ok: false, reason: "cancelled" };
  }

  await fs.writeFile(fullPath, last.oldContent, "utf8");
  editHistory.pop();
  console.log(S(`\n✅ Desfeito! (${editHistory.length} edições restantes no stack)\n`, _.Gr));
  return { ok: true, path: last.path };
}

/**
 * /diff — show all changes made in this session
 */
export function showSessionDiff() {
  if (!editHistory.length) {
    console.log(S("\n📭 Nenhuma edição nesta sessão.\n", _.G));
    return;
  }

  // Group by file
  const byFile = {};
  for (const edit of editHistory) {
    if (!byFile[edit.path]) byFile[edit.path] = [];
    byFile[edit.path].push(edit);
  }

  console.log(S(`\n📊 ${editHistory.length} edições em ${Object.keys(byFile).length} arquivos:\n`, _.c, _.b));

  for (const [filePath, edits] of Object.entries(byFile)) {
    const first = edits[0];
    const last = edits[edits.length - 1];
    console.log(makeDiff(first.oldContent, last.newContent, filePath));
  }

  const rows = Object.entries(byFile).map(([filePath, edits]) => [
    filePath,
    `${S(String(edits.length), _.y)} edições | ${S(edits.map(e => e.tool).join("→"), _.G)}`,
  ]);
  console.log(drawTable(rows, { title: "📊 SESSION CHANGES", color: _.c, w: 76 }));
}

/**
 * /snapshot save — save entire workspace state
 */
export async function snapshotSave(name) {
  const snapName = name || `snap-${Date.now()}`;
  const snapDir = path.join(SNAPSHOTS_DIR, snapName);
  await fs.mkdir(snapDir, { recursive: true });

  // Save edit history
  await fs.writeFile(
    path.join(snapDir, "_meta.json"),
    JSON.stringify({
      name: snapName,
      created: Date.now(),
      edits: editHistory.length,
      files: editHistory.map(e => e.path),
    }, null, 2),
    "utf8"
  );

  // Save current content of all edited files
  const saved = new Set();
  for (const edit of editHistory) {
    if (saved.has(edit.path)) continue;
    saved.add(edit.path);
    try {
      const fullPath = path.resolve(WORKSPACE, edit.path);
      const content = await fs.readFile(fullPath, "utf8");
      const snapFile = path.join(snapDir, edit.path.replace(/\//g, "__"));
      await fs.writeFile(snapFile, content, "utf8");
    } catch {}
  }

  console.log(S(`\n💾 Snapshot '${snapName}' salvo (${saved.size} arquivos)\n`, _.Gr, _.b));
  return { ok: true, name: snapName, files: saved.size };
}

/**
 * /snapshot list
 */
export async function snapshotList() {
  try {
    const entries = await fs.readdir(SNAPSHOTS_DIR, { withFileTypes: true });
    const snaps = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(SNAPSHOTS_DIR, ent.name, "_meta.json"), "utf8"));
        snaps.push(meta);
      } catch {
        snaps.push({ name: ent.name, created: 0, edits: 0, files: [] });
      }
    }
    return snaps.sort((a, b) => (b.created || 0) - (a.created || 0));
  } catch { return []; }
}

/**
 * /snapshot load — restore files from snapshot
 */
export async function snapshotLoad(name) {
  const snapDir = path.join(SNAPSHOTS_DIR, name);
  try {
    const files = await fs.readdir(snapDir);
    let restored = 0;
    for (const file of files) {
      if (file === "_meta.json") continue;
      const origPath = file.replace(/__/g, "/");
      const content = await fs.readFile(path.join(snapDir, file), "utf8");
      const fullPath = path.resolve(WORKSPACE, origPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf8");
      restored++;
    }
    console.log(S(`\n🔄 Snapshot '${name}' restaurado (${restored} arquivos)\n`, _.Gr, _.b));
    return { ok: true, restored };
  } catch (err) {
    console.log(S(`\n❌ Erro: ${err.message}\n`, _.r));
    return { ok: false, error: err.message };
  }
}
