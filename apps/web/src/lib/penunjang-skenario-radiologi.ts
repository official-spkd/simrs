import type { RadiologyExam, RadStatus } from '@simrs/shared';
import type { RunResult } from './demo/engine/types';
import { exam } from './demo/fixtures/penunjang';
import { STAF } from './demo/fixtures/staf';
import { type ScenarioResults, scenarioPatientId, simIso, taskAt, taskValue } from './penunjang-skenario';

/**
 * Proyeksi pemeriksaan radiologi pasien skenario (pembangun-layar §6). Tn. Hartono: "Foto toraks" dari order set
 * nyeri dada IGD (`asesmen-dokter.orderset = set`) — terjadwal cito, lalu menunggu ekspertise saat tata laksana,
 * dan ditandatangani radiolog saat admisi rawat inap. Order manual tidak membawa foto toraks.
 */

function reached(R: RunResult, stepId: string): boolean {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  return R.finished || (i >= 0 && R.step >= i);
}

export const HARTONO_ACCESSION = 'RAD-2610-0337';

export function hartonoChestXray(R: RunResult): RadiologyExam | null {
  const orderAt = taskAt(R, 'asesmen-dokter', 'orderset');
  if (orderAt === undefined || taskValue(R, 'asesmen-dokter', 'orderset') !== 'set') return null;
  const signed = reached(R, 'admisi');
  const status: RadStatus = signed
    ? 'ditandatangani'
    : reached(R, 'tata-laksana')
      ? 'ekspertise'
      : 'terjadwal';
  const admisiIdx = R.def.steps.findIndex((s) => s.id === 'admisi');
  const signedAt = R.stepStart[admisiIdx] ?? orderAt + 60;
  return exam({
    id: 'rad-hartono',
    accession: HARTONO_ACCESSION,
    patientId: scenarioPatientId('igd-ranap'),
    location: 'IGD · bed resusitasi 2',
    sender: STAF.dokterJagaIgd,
    modality: 'DR',
    procedure: 'Foto toraks',
    procedureCode: null,
    priority: 'cito',
    status,
    room: 'Portabel IGD',
    scheduledAt: simIso(R.def, orderAt + 5),
    startedAt: status === 'terjadwal' ? undefined : simIso(R.def, orderAt + 12),
    indication: 'Order set nyeri dada IGD: curiga sindrom koroner akut, sesak',
    report: signed
      ? {
          findings:
            'Cor: membesar ringan (CTR 0,55). Pulmo: corakan bronkovaskular normal, tidak tampak infiltrat. Tidak tampak garis Kerley maupun efusi pleura. Tulang yang tervisualisasi intak.',
          impression: 'Kardiomegali ringan tanpa tanda edema paru.',
          signedAt: simIso(R.def, signedAt),
        }
      : undefined,
  });
}

/** Pemeriksaan pasien skenario yang sudah ada di worklist radiologi. */
export function scenarioRadiologyExams(results: ScenarioResults): RadiologyExam[] {
  const h = hartonoChestXray(results['igd-ranap']);
  return h ? [h] : [];
}
