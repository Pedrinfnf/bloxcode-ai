import { getWorkspace } from '../../../lib/sandbox/workspace.mjs';
export const runtime = 'nodejs'; export const maxDuration = 300;
export async function POST(request) {
  try {
    const body = await request.json(); const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId : ''; const command = typeof body?.command === 'string' ? body.command : '';
    if (workspaceId.length < 4 || workspaceId.length > 128) return Response.json({ error: 'invalid workspaceId' }, { status: 400 });
    if (!command.trim() || command.length > 8000) return Response.json({ error: 'invalid command' }, { status: 400 });
    const workspace = await getWorkspace(workspaceId); const result = await workspace.run(command); return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
