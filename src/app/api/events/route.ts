import { cookieToken, sessionState } from '@/server/security';
import { transaction } from '@/server/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const token = cookieToken(request);
  const initial = await sessionState(token);
  if (initial.status === 'signed-out') return new Response(null, { status: 401 });
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let cancelled = false,
        running = false,
        tick = 0;
      const close = () => {
        if (cancelled) return;
        cancelled = true;
        clearInterval(timer);
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {}
      };
      cleanup = close;
      const send = async () => {
        if (cancelled || running) return;
        running = true;
        try {
          const state = await sessionState(token, false);
          const payload: Record<string, unknown> = {
            status: state.status,
            reconcile: tick++ % 5 === 0,
          };
          if (state.principal?.role === 'owner')
            payload.requests = await transaction(
              async (tx) =>
                (
                  await tx.query(
                    "SELECT s.id,s.device,s.created_at,v.display_name,v.username FROM sessions s JOIN viewer_accounts v ON v.id=s.viewer_id WHERE s.status='pending' AND s.request_expires_at>now() AND v.status='Active' AND (v.expires_at IS NULL OR v.expires_at>now()) ORDER BY s.created_at",
                  )
                ).rows,
              state.principal,
            );
          if (!cancelled)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          if (!['pending', 'approved'].includes(state.status)) close();
        } catch {
          if (!cancelled) controller.enqueue(encoder.encode('event: reconnect\ndata: {}\n\n'));
          close();
        } finally {
          running = false;
        }
      };
      const timer = setInterval(send, 2000);
      const timeout = setTimeout(close, 55000);
      request.signal.addEventListener('abort', close);
      void send();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
