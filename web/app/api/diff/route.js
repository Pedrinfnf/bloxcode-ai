import { getWorkspace } from '../../../lib/sandbox/workspace.mjs';
export const runtime = 'nodejs'; export const maxDuration = 120;
export async function GET(request) {
  try { const { searchParams } = new URL(request.url); const workspaceId = searchParams.get('workspaceId') || ''; if (workspaceId.length < 4 || workspaceId.length > 128) return Response.json({ error: 'invalid workspaceId' }, { status: 400 }); const workspace = await getWorkspace(workspaceId); const diff = await workspace.gitDiff(); return Response.json({ diff }, { headers: { 'cache-control': 'no-store' } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
