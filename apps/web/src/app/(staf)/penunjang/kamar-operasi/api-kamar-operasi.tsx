import {
  ANESTHESIA_RECORD_FORM_CODE,
  formSchemaSchema,
  isoDateJakarta,
  PRE_ANESTHESIA_FORM_CODE,
  surgeryStaffOptionsSchema,
  surgerySupplyOptionsSchema,
} from '@simrs/shared';
import { Alert } from '@simrs/ui';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getSurgeryBoardLive } from '@/lib/server/data/penunjang/kamar-operasi';
import { can, type SessionView } from '@/lib/session-view';
import { OkApiClient, type OkPermissions } from './ok-api-client';
import type { AnesthesiaFormDef } from './ok-api-report';

type StaffOptions = z.infer<typeof surgeryStaffOptionsSchema>['items'];
type SupplyOptions = z.infer<typeof surgerySupplyOptionsSchema>['items'];

const formDetail = z.object({
  code: z.string(),
  published: z
    .object({
      version: z.int(),
      title: z.string(),
      schema: formSchemaSchema,
      writeRoles: z.array(z.string()),
    })
    .nullable(),
});

/** Formulir P07 anestesi versi terbit (null bila belum terbit di RS ini). */
async function anesthesiaForm(code: string): Promise<AnesthesiaFormDef | null> {
  const d = await optional(() => api(`/api/v1/forms/${code}`, { schema: formDetail }), null);
  return d?.published ? { ...d.published, code: d.code } : null;
}

async function optional<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401) return fallback;
    throw err;
  }
}

/**
 * S06 · Kamar operasi mode api (4.7/4.7b): papan 4 kamar per tanggal (`?tanggal=`), kasus terpilih (`?pilih=`), daftar
 * tilik WHO, anestesi (formulir P07), peristiwa, hitung kasa, BHP, laporan operasi berversi ber-TTE, spesimen PA. Aksi mengikuti izin sesi `surgery.*`; ditegakkan
 * ulang API (lingkup unit OK/relasi, urutan, gerbang insisi).
 */
export async function ApiKamarOperasi({
  session,
  tanggal,
  pilih,
}: {
  session: SessionView;
  tanggal: string | null;
  pilih: string | null;
}) {
  const date = tanggal && /^\d{4}-\d{2}-\d{2}$/.test(tanggal) ? tanggal : isoDateJakarta();
  let board;
  try {
    board = await getSurgeryBoardLive(date);
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401) {
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="m-0 text-h1 font-bold">Kamar operasi</h1>
          <Alert
            level={err.status === 403 ? 'warning' : 'critical'}
            title={
              err.status === 403
                ? 'Kamar operasi hanya untuk petugas unit kamar operasi'
                : 'Papan kamar operasi belum bisa dimuat'
            }
          >
            {err.message}
          </Alert>
        </div>
      );
    }
    throw err;
  }
  const perms: OkPermissions = {
    schedule: can(session, 'surgery', 'schedule'),
    checklist: can(session, 'surgery', 'checklist'),
    count: can(session, 'surgery', 'count'),
    report: can(session, 'surgery', 'report'),
    override: can(session, 'surgery', 'override'),
  };
  const canWriteForms = can(session, 'forms.response', 'write');
  const [staff, supplies, pre, record] = await Promise.all([
    perms.schedule
      ? optional(
          async () => (await api('/api/v1/surgery/staff', { schema: surgeryStaffOptionsSchema })).items,
          [] as StaffOptions,
        )
      : Promise.resolve([] as StaffOptions),
    perms.checklist
      ? optional(
          async () =>
            (await api('/api/v1/surgery/supplies/options', { schema: surgerySupplyOptionsSchema })).items,
          [] as SupplyOptions,
        )
      : Promise.resolve([] as SupplyOptions),
    anesthesiaForm(PRE_ANESTHESIA_FORM_CODE),
    anesthesiaForm(ANESTHESIA_RECORD_FORM_CODE),
  ]);
  return (
    <OkApiClient
      tenantName={session.tenant.name}
      board={board}
      initialCaseId={pilih}
      perms={perms}
      userId={session.user.id}
      staff={staff}
      supplies={supplies}
      anesthesiaForms={{ pre, record }}
      role={session.role?.code ?? null}
      canWriteForms={canWriteForms}
    />
  );
}
