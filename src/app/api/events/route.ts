import { cookieToken, sessionState, hashToken } from '@/server/security';
import { get, workspace } from '@/server/firebase/store';
import { pendingRequests } from '@/server/services/viewers';
import type { Session } from '@/server/firebase/models';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const token = cookieToken(request);
  const initial = await sessionState(token);
  if (!token || !['approved', 'pending'].includes(initial.status))
    return new Response(null, { status: 401 });
  const index = await get('session_tokens', hashToken(token));
  const session = index ? await get<Session>('sessions', String(index.session_id)) : undefined;
  if (!session) return new Response(null, { status: 401 });
  const root = await workspace();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false,
        running = false,
        dirty = false;
      let scheduled: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe: (() => void)[] = [];
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timeout);
        clearTimeout(scheduled);
        for (const stop of unsubscribe) stop();
        request.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {}
      };
      const send = async () => {
        scheduled = undefined;
        if (closed) return;
        if (running) {
          dirty = true;
          return;
        }
        running = true;
        try {
          const state = await sessionState(token, false);
          const payload: Record<string, unknown> = { status: state.status, reconcile: true };
          if (state.principal?.role === 'owner')
            payload.requests = await pendingRequests(state.principal);
          if (!closed)
            controller.enqueue(encoder.encode('data: ' + JSON.stringify(payload) + '\n\n'));
          if (!['pending', 'approved'].includes(state.status)) close();
        } catch {
          if (!closed) controller.enqueue(encoder.encode('event: reconnect\ndata: {}\n\n'));
          close();
        } finally {
          running = false;
          if (dirty && !closed) {
            dirty = false;
            schedule();
          }
        }
      };
      const schedule = () => {
        if (!closed && !scheduled) scheduled = setTimeout(() => void send(), 50);
      };
      const timeout = setTimeout(close, 55000);
      cleanup = close;
      request.signal.addEventListener('abort', close);
      if (request.signal.aborted) {
        close();
        return;
      }
      for (const ref of [
        root.collection('sessions').doc(session.id),
        root
          .collection(session.owner_id ? 'owners' : 'viewer_accounts')
          .doc((session.owner_id || session.viewer_id)!),
        root.collection('meta').doc('access'),
      ])
        unsubscribe.push(ref.onSnapshot(schedule, close));
      if (initial.principal?.role === 'owner')
        unsubscribe.push(
          root.collection('sessions').where('status', '==', 'pending').onSnapshot(schedule, close),
        );
      schedule();
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
