import 'server-only';
import { type BedBoard, bedBoardSchema, type BedRequest } from '@simrs/shared';
import { demoBedRequests, demoBeds, demoWards, matchingBeds } from '../../../demo/fixtures/rawat-inap';
import { DEMO_NOW } from '../../../demo/fixtures/waktu';
import { applyBeds, type BedState } from '../../../rawat-inap-bed-toko';
import { BOARDING_TARGET_MINUTES } from '../../../rawat-inap';
import { applyScenarioBeds, hartonoBedRequest, ratnaBedRequest } from '../../../rawat-inap-scenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { readDomain } from '../../demo/state';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/**
 * K05 · Data layar Tempat tidur. Mode presentasi: ruang dari `BANGSAL`, bed + permintaan fiktif, keadaan toko demo
 * (`tempat-tidur`: status bed, alokasi, permintaan bed dari IGD), ditumpangi bed dan permintaan pasien skenario; mode
 * api menunggu backend fase 3 (potongan 3.3, layar W3; halaman menampilkan "Belum tersambung").
 */

/** Permintaan bed dari IGD yang tersimpan, dalam bentuk kontrak papan (kandidat dari bed siap terkini). */
function igdRequests(s: BedState, beds: BedBoard['beds']): BedRequest[] {
  return s.igdRequests
    .filter((r) => !s.allocations[r.id] && !s.cancelled[r.encounterId])
    .map((r) => {
      const wait = Math.max(0, Math.round((Date.parse(DEMO_NOW) - Date.parse(r.requestedAt)) / 60_000));
      return {
        id: r.id,
        patientName: r.patientName,
        sex: r.sex,
        ageYears: r.ageYears,
        rm: r.rm,
        from: r.from,
        need: `${r.need} · ${r.kelas}`,
        kelas: r.kelas,
        waitMinutes: wait,
        late: wait >= BOARDING_TARGET_MINUTES,
        candidates: matchingBeds(beds, r.kelas),
        scenario: null,
      };
    });
}

export async function getBedBoard(session: SessionView): Promise<BedBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const [runs, store] = await Promise.all([scenarioRuns(session), readDomain('tempat-tidur')]);
    const igd = runs.results['igd-ranap'];
    const elektif = runs.results['elektif-btn'];
    const beds = applyBeds(applyScenarioBeds(demoBeds(), igd, elektif), store.state);
    const requests = [hartonoBedRequest(igd), ratnaBedRequest(elektif)].filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );
    const fixture = demoBedRequests(beds).filter((r) => !store.state.allocations[r.id]);
    return bedBoardSchema.parse({
      asOf: DEMO_NOW,
      wards: demoWards(),
      beds,
      requests: [...requests, ...igdRequests(store.state, beds), ...fixture],
    });
  }
  return notImplemented('tempat tidur');
}
