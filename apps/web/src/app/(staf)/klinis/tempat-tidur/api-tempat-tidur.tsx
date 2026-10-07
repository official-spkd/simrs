import { practitionerOptionListSchema, type PractitionerOption } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { getBedBoardLive } from '@/lib/server/data/klinis/bed';
import { can, type SessionView } from '@/lib/session-view';
import { BedLive, type BedPermissions } from './bed-live';

/**
 * K04/K05 · Tempat tidur mode api (layar W3): papan bed dari API (label pasien hanya inisial; lingkup unit perawat),
 * real-time lewat SSE (`./events`), status Aplicare per ruang. Aksi mengikuti izin sesi (`bed.write`: status bed,
 * alokasi, transfer, pulang; `encounter.write`: admisi dari IGD); semuanya ditegakkan ulang API. `?bangsal=<kode>`.
 */
export async function ApiTempatTidur({ session, bangsal }: { session: SessionView; bangsal: string | null }) {
  let board;
  try {
    board = await getBedBoardLive();
  } catch (err) {
    if (err instanceof ApiError) {
      return (
        <div className="flex max-w-3xl flex-col gap-4">
          <h1 className="m-0 text-h1 font-bold">Manajemen tempat tidur</h1>
          <Alert
            level={err.status === 403 ? 'warning' : 'critical'}
            title="Papan tempat tidur belum bisa dimuat"
          >
            {err.message}
          </Alert>
        </div>
      );
    }
    throw err;
  }
  const perms: BedPermissions = {
    write: can(session, 'bed', 'write'),
    admit: can(session, 'encounter', 'write'),
  };
  let doctors: PractitionerOption[] = [];
  if (perms.admit) {
    try {
      doctors = (await api('/api/v1/registration/practitioners', { schema: practitionerOptionListSchema }))
        .items;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }
  const wanted = bangsal?.toUpperCase() ?? null;
  const initialUnit = board.units.find((u) => u.code === wanted)?.unitId ?? 'semua';
  return (
    <BedLive
      tenantName={session.tenant.name}
      board={board}
      doctors={doctors}
      perms={perms}
      initialUnit={initialUnit}
    />
  );
}
