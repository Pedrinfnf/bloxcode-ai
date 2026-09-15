function requireString(args, key, { allowEmpty = false, max = 200000 } = {}) {
  const value = args?.[key];
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  if (!allowEmpty && value.trim() === '') throw new Error(`${key} is required`);
  if (value.length > max) throw new Error(`${key} is too long`);
  return value;
}

export function createToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'shell',
        description: 'Run a shell command inside the isolated coding workspace. Use this for tests, builds, package managers, git, and repository inspection.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute from the workspace root.' },
          },
          required: ['command'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files below a workspace-relative directory. Returns a bounded recursive listing.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative directory, default .', default: '.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a UTF-8 text file from the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative file path.' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write complete UTF-8 text content to a workspace file, creating parent directories when needed.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Workspace-relative file path.' },
            content: { type: 'string', description: 'Complete new file contents.' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_diff',
        description: 'Return the current Git diff and short status for the workspace.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
  ];
}

export function createToolExecutor(workspace) {
  if (!workspace || typeof workspace !== 'object') throw new TypeError('workspace is required');

  return async function executeTool(name, args = {}) {
    switch (name) {
      case 'shell':
        return workspace.run(requireString(args, 'command', { max: 8000 }));
      case 'list_files':
        return workspace.listFiles(typeof args.path === 'string' && args.path.trim() ? args.path : '.');
      case 'read_file':
        return workspace.readFile(requireString(args, 'path', { max: 1024 }));
      case 'write_file':
        return workspace.writeFile(
          requireString(args, 'path', { max: 1024 }),
          requireString(args, 'content', { allowEmpty: true, max: 500000 }),
        );
      case 'git_diff':
        return workspace.gitDiff();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
