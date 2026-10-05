import 'server-only';
import { type BedBoard, bedBoardSchema } from '@simrs/shared';
import { demoBedRequests, demoBeds, demoWards } from '../../../demo/fixtures/rawat-inap';
import { DEMO_NOW } from '../../../demo/fixtures/waktu';
import { applyScenarioBeds, hartonoBedRequest, ratnaBedRequest } from '../../../rawat-inap-scenario';
import type { SessionView } from '../../../session-view';
import { scenarioRuns } from '../../demo/scenario-context';
import { assertDemo } from '../../demo-guard';
import { webEnv } from '../../web-env';
import { notImplemented } from '../not-implemented';

/**
 * K05 · Data layar Tempat tidur. Mode presentasi: ruang dari `BANGSAL`, bed + permintaan fiktif, ditumpangi bed dan
 * permintaan pasien skenario; mode api menunggu backend fase 3 (potongan 3.3, layar W3; halaman menampilkan "Belum
 * tersambung").
 */

export async function getBedBoard(session: SessionView): Promise<BedBoard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    const runs = await scenarioRuns(session);
    const igd = runs.results['igd-ranap'];
    const elektif = runs.results['elektif-btn'];
    const beds = applyScenarioBeds(demoBeds(), igd, elektif);
    const requests = [hartonoBedRequest(igd), ratnaBedRequest(elektif)].filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );
    return bedBoardSchema.parse({
      asOf: DEMO_NOW,
      wards: demoWards(),
      beds,
      requests: [...requests, ...demoBedRequests(beds)],
    });
  }
  return notImplemented('tempat tidur');
}
