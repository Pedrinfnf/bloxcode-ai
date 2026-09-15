import path from 'node:path';
import { assertCommandAllowed, normalizeWorkspaceName, safeWorkspacePath, WORKSPACE_ROOT } from '../agent/policy.mjs';

const STATE_ROOT = '/home/vercel-sandbox/.bloxcode';
const STATE_FILE = `${STATE_ROOT}/session.json`;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

async function commandOutput(result) {
  const stdout = typeof result?.stdout === 'function' ? await result.stdout() : '';
  const stderr = typeof result?.stderr === 'function' ? await result.stderr() : '';
  const exitCode = Number.isInteger(result?.exitCode)
    ? result.exitCode
    : Number.isInteger(result?.code)
      ? result.code
      : 0;
  return { ok: exitCode === 0, exitCode, stdout: String(stdout || ''), stderr: String(stderr || '') };
}

function toText(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString('utf8');
  return String(value ?? '');
}

export async function getWorkspace(workspaceId) {
  const { Sandbox } = await import('@vercel/sandbox');
  const name = normalizeWorkspaceName(workspaceId);

  const sandbox = await Sandbox.getOrCreate({
    name,
    resume: true,
    onCreate: async (sbx) => {
      await sbx.runCommand('mkdir', ['-p', WORKSPACE_ROOT, STATE_ROOT]);
      await sbx.runCommand('sh', ['-lc', `cd ${shellQuote(WORKSPACE_ROOT)} && if [ ! -d .git ]; then git init -q; fi`]);
    },
  });

  return {
    name,
    root: WORKSPACE_ROOT,

    async run(command) {
      const safe = assertCommandAllowed(command);
      const result = await sandbox.runCommand('sh', ['-lc', `cd ${shellQuote(WORKSPACE_ROOT)} && ${safe}`]);
      return commandOutput(result);
    },

    async listFiles(relativePath = '.') {
      const absolute = safeWorkspacePath(relativePath);
      const target = shellQuote(absolute);
      const result = await sandbox.runCommand('sh', [
        '-lc',
        `cd ${shellQuote(WORKSPACE_ROOT)} && target=${target} && if [ -d "$target" ]; then find "$target" -maxdepth 3 -mindepth 1 -not -path '*/node_modules/*' -not -path '*/.git/*' -printf '%y\t%p\n' | head -300; elif [ -e "$target" ]; then printf 'f\\t%s\\n' "$target"; else exit 2; fi`,
      ]);
      const output = await commandOutput(result);
      if (!output.ok) throw new Error(output.stderr || `Unable to list ${relativePath}`);
      return output.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [kind, absolutePath] = line.split('\t');
          return {
            type: kind === 'd' ? 'directory' : 'file',
            path: path.posix.relative(WORKSPACE_ROOT, absolutePath),
          };
        });
    },

    async readFile(relativePath) {
      const absolute = safeWorkspacePath(relativePath);
      const bytes = await sandbox.fs.readFile(absolute);
      const text = toText(bytes);
      if (text.length > 500000) throw new Error('File is too large to read in the agent UI');
      return text;
    },

    async writeFile(relativePath, content) {
      const absolute = safeWorkspacePath(relativePath);
      await sandbox.fs.mkdir(path.posix.dirname(absolute), { recursive: true });
      await sandbox.fs.writeFile(absolute, String(content), 'utf8');
      return { ok: true, path: path.posix.relative(WORKSPACE_ROOT, absolute), bytes: Buffer.byteLength(String(content)) };
    },

    async gitDiff() {
      const result = await sandbox.runCommand('sh', [
        '-lc',
        `cd ${shellQuote(WORKSPACE_ROOT)} && printf '%s\\n' '--- status ---' && git status --short 2>/dev/null || true; printf '%s\\n' '--- diff ---'; git diff --no-ext-diff --no-color 2>/dev/null || true`,
      ]);
      const output = await commandOutput(result);
      return output.stdout.slice(0, 500000);
    },

    async loadSession() {
      try {
        const raw = toText(await sandbox.fs.readFile(STATE_FILE));
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.messages) ? parsed.messages : [];
      } catch {
        return [];
      }
    },

    async saveSession(messages) {
      if (!Array.isArray(messages)) throw new TypeError('messages must be an array');
      if (messages.length > 400) throw new Error('Workspace model history is full; create a new workspace');
      await sandbox.fs.mkdir(STATE_ROOT, { recursive: true });
      await sandbox.fs.writeFile(
        STATE_FILE,
        JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), messages }),
        'utf8',
      );
    },
  };
}
