import 'server-only';
import {
  type Antibiogram,
  antibiogramSchema,
  type DiagnosticWorklist,
  diagnosticWorklistSchema,
  type MicroWorklist,
  microWorklistSchema,
  type PaWorklist,
  paWorklistSchema,
} from '@simrs/shared';
import { api } from '../../api';

/** S02 Mikrobiologi/PA + S10 diagnostik lain · bacaan mode api (fase 4 · 4.8, ADR-0120). Izin + ABAC + audit di API. */

export function microWorklist(): Promise<MicroWorklist> {
  return api('/api/v1/micro/worklist', { schema: microWorklistSchema });
}

export function antibiogram(from: string, to: string): Promise<Antibiogram> {
  return api(`/api/v1/micro/antibiogram?${new URLSearchParams({ from, to }).toString()}`, {
    schema: antibiogramSchema,
  });
}

export function paWorklist(): Promise<PaWorklist> {
  return api('/api/v1/pa/worklist', { schema: paWorklistSchema });
}

export function diagnosticWorklist(): Promise<DiagnosticWorklist> {
  return api('/api/v1/diagnostics/worklist', { schema: diagnosticWorklistSchema });
}
