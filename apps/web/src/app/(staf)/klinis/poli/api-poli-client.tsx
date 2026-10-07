'use client';

import { formatJam, type PoliEncounter, type PoliVisit, type PoliWorklistApi } from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import type { PoliActionResult, PoliOps } from '@/components/klinis/poli-ops';
import { PoliWorkspace } from '@/components/klinis/poli-workspace';
import {
  callNextPoliAction,
  cosignPoliAction,
  recordVitalsApiAction,
  savePoliDraftAction,
  signPoliAction,
  ticketActionPoli,
} from './actions-api';

/** Aksi mode api: Server Action → API, lalu muat ulang data server (`router.refresh`). */
function useApiPoliOps(worklist: PoliWorklistApi): PoliOps {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  return useMemo(() => {
    const run = (fn: () => Promise<PoliActionResult>, done: (r: PoliActionResult) => void) => {
      if (busy.current) return;
      busy.current = true;
      startTransition(async () => {
        try {
          const r = await fn();
          if (r.ok) router.refresh();
          done(r);
        } finally {
          busy.current = false;
        }
      });
    };
    return {
      pending,
      vitalsMode: 'lengkap',
      saveDraft: (input, done) => run(() => savePoliDraftAction(input), done),
      sign: (input, done) => run(() => signPoliAction(input), done),
      cosign: (input, done) => run(() => cosignPoliAction(input), done),
      recordVitals: (input, done) => run(() => recordVitalsApiAction(input), done),
      callNext: (done) =>
        worklist.serviceId
          ? run(() => callNextPoliAction(worklist.serviceId, worklist.poli.room), done)
          : done({ ok: false, error: 'Unit Anda belum punya layanan antrean poli.' }),
    } satisfies PoliOps;
  }, [pending, router, worklist.serviceId, worklist.poli.room]);
}

/**
 * K01/K02 · Ruang kerja poli mode api (W1): komponen yang sama dengan mode presentasi (`PoliWorkspace`), aksi lewat
 * API. Tambahan mode api: panggil/mulai tiket pasien terpilih (task 4), isian resume rawat jalan ringkas di SOAP, dan
 * tautan resume setelah kunjungan selesai.
 */
export function ApiPoliClient({
  worklist,
  visit,
  role,
  cpoeHref,
  kasirHref,
  rujukHref,
  resumeHref,
  canCall,
}: {
  worklist: PoliWorklistApi;
  visit: PoliVisit;
  role: string | null;
  /** Null bila layar CPOE belum terbuka untuk peran ini (mode api). */
  cpoeHref: string | null;
  kasirHref: string | null;
  rujukHref: string | null;
  resumeHref: string | null;
  canCall: boolean;
}) {
  const ops = useApiPoliOps(worklist);
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();
  const a = visit.api;
  const finished = a.encounterStatus === 'finished';
  const cpptFinal = a.cppt?.status === 'final';
  const encounter: PoliEncounter = {
    ...visit.encounter,
    // Tanda tangan di layar = kunjungan selesai (CPPT final + resume RJ + tutup).
    soap: { ...visit.encounter.soap, signedAt: finished ? (visit.encounter.soap.signedAt ?? '—') : null },
  };
  const pendingCosign =
    a.cppt?.status === 'menunggu_cosign'
      ? { at: formatJam(a.cppt.recordedAt), author: a.cppt.authorName }
      : null;

  const ticket = (action: 'call' | 'start') =>
    startTransition(async () => {
      if (!a.queueTicketId) return;
      const r = await ticketActionPoli(a.queueTicketId, action, worklist.poli.room);
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? '') : (r.error ?? 'Gagal.') });
      if (r.ok) router.refresh();
    });

  const ticketButtons =
    canCall && a.queueTicketId && !finished ? (
      a.ticketStatus === 'waiting' || a.ticketStatus === 'skipped' ? (
        <Button type="button" variant="primary" disabled={busy} onClick={() => ticket('call')}>
          <Icon name="bell" size={16} />
          Panggil pasien · {encounter.queueNo}
        </Button>
      ) : a.ticketStatus === 'called' ? (
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => ticket('call')}>
            <Icon name="bell" size={16} />
            Panggil ulang
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => ticket('start')}>
            Mulai periksa
          </Button>
        </>
      ) : null
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={
            msg.ok ? 'm-0 text-small font-semibold text-success' : 'm-0 text-small font-semibold text-danger'
          }
        >
          {msg.text}
        </p>
      )}
      {finished && resumeHref && (
        <p role="status" className="m-0 text-small text-ink-700">
          Kunjungan selesai · resume rawat jalan{' '}
          {a.resume.signatureStatus === 'signed' ? 'ber-TTE' : 'menunggu TTE penyelenggara'}.{' '}
          <Link href={resumeHref}>Buka resume</Link>
        </p>
      )}
      <PoliWorkspace
        worklist={worklist}
        encounter={encounter}
        role={role}
        binding={null}
        cpoeHref={cpoeHref}
        kasirHref={kasirHref}
        rujukHref={rujukHref}
        rev={0}
        pendingCosign={pendingCosign}
        ops={ops}
        apiFields={
          a.draft
            ? { plan: a.draft.plan, followUp: a.draft.followUp, condition: a.draft.condition }
            : { plan: '', followUp: '', condition: '' }
        }
        finishedLabel={cpptFinal && !finished && a.canSign ? 'Selesaikan kunjungan' : null}
        extraActions={ticketButtons}
      />
    </div>
  );
}
