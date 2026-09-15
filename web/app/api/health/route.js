export const runtime = 'nodejs';
export async function GET() { return Response.json({ ok: true, service: 'bloxcode-work', model: process.env.KIMI_MODEL || 'moonshotai/Kimi-K3', vllmConfigured: Boolean(process.env.VLLM_BASE_URL), sandbox: 'vercel' }, { headers: { 'cache-control': 'no-store' } }); }
