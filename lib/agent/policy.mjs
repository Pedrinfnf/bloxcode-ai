import path from 'node:path';
import crypto from 'node:crypto';

export const WORKSPACE_ROOT = '/home/vercel-sandbox/workspace';

export function safeWorkspacePath(input) {
  const value = String(input ?? '');
  if (value.includes('\0')) throw new Error('NUL byte is not allowed in workspace paths');
  if (path.posix.isAbsolute(value)) throw new Error('Absolute paths are not allowed');
  const normalized = path.posix.normalize(value || '.').replace(/^\.\//, '');
  const absolute = path.posix.resolve(WORKSPACE_ROOT, normalized);
  if (absolute !== WORKSPACE_ROOT && !absolute.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new Error('Path resolves outside workspace');
  }
  return absolute;
}

const BLOCKED_COMMANDS = [
  /(^|[;&|]\s*)rm\s+-[^\n]*r[^\n]*f[^\n]*\s+\/(?:\s|$)/i,
  /(^|\s)(?:sudo\s+)?(?:reboot|shutdown|poweroff|halt)(?:\s|$)/i,
  /(^|\s)mkfs(?:\.|\s)/i,
  /dd\s+[^\n]*of=\/dev\//i,
  /:\(\)\s*\{\s*:\|:&\s*;\s*\}\s*;\s*:/,
];

export function assertCommandAllowed(command) {
  const value = String(command ?? '').trim();
  if (!value) throw new Error('Command is required');
  if (value.length > 8000) throw new Error('Command is too long');
  if (BLOCKED_COMMANDS.some((pattern) => pattern.test(value))) {
    throw new Error('Command blocked by sandbox safety policy');
  }
  return value;
}

export function normalizeWorkspaceName(workspaceId) {
  const original = String(workspaceId ?? '').trim().toLowerCase();
  const slug = original
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  const digest = crypto.createHash('sha256').update(original || 'workspace').digest('hex').slice(0, 12);
  const safe = slug || digest;
  return `bloxcode-${safe}`.slice(0, 63).replace(/-+$/g, '') || `bloxcode-${digest}`;
}
