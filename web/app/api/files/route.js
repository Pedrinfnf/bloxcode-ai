import { getWorkspace } from '../../../lib/sandbox/workspace.mjs';
export const runtime = 'nodejs'; export const maxDuration = 120;
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url); const workspaceId = searchParams.get('workspaceId') || ''; const path = searchParams.get('path') || '.'; const file = searchParams.get('file');
    if (workspaceId.length < 4 || workspaceId.length > 128) return Response.json({ error: 'invalid workspaceId' }, { status: 400 });
    if (path.length > 1024 || (file && file.length > 1024)) return Response.json({ error: 'path too long' }, { status: 400 });
    const workspace = await getWorkspace(workspaceId);
    if (file) { const content = await workspace.readFile(file); return Response.json({ file, content }, { headers: { 'cache-control': 'no-store' } }); }
    const files = await workspace.listFiles(path); return Response.json({ path, files }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
