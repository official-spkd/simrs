import 'server-only';
import { type DashboardPeriod, type ExecutiveDashboard, executiveDashboardSchema } from '@simrs/shared';
import { demoExecutiveDashboard } from '../../demo/fixtures/dasbor';
import { assertDemo } from '../demo-guard';
import { webEnv } from '../web-env';
import { notImplemented } from './not-implemented';

/**
 * I09 · Data dasbor eksekutif. Satu-satunya pintu halaman Dasbor: mode presentasi memakai data dummy (divalidasi
 * kontrak yang sama dengan API kelak), mode api menunggu backend fase 9.
 */
export async function getExecutiveDashboard(period: DashboardPeriod): Promise<ExecutiveDashboard> {
  if (webEnv().dataSource === 'demo') {
    assertDemo();
    return executiveDashboardSchema.parse(demoExecutiveDashboard(period));
  }
  return notImplemented('dasbor eksekutif');
}
