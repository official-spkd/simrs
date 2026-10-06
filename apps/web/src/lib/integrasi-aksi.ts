import 'server-only';
import { formatJam } from '@simrs/shared';
import { integrationEventSchema, type IntegrationEvent } from './integrasi-event-schemas';
import { DENIED, invalid, penunjangSession } from './penunjang-aksi';
import { commitEvent } from './server/demo/state';
import { assertDemo } from './server/demo-guard';
export async function saveIntegration(screen: string, event: IntegrationEvent, rev: number) {
  assertDemo();
  const session = await penunjangSession(screen);
  if (!session) return DENIED;
  const p = integrationEventSchema.safeParse(event);
  if (!p.success || !Number.isSafeInteger(rev) || rev < 0)
    return invalid('Permintaan atau revisi tidak sah.');
  const r = await commitEvent('integrasi', p.data, { rev, session });
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  const at = formatJam(new Date());
  return { ok: true, at, message: `Perubahan demo tersimpan atas nama ${session.user.displayName} · ${at}` };
}
