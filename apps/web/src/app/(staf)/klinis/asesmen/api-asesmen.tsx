import {
  CONSENT_EDUCATION_FORM,
  CONSENT_INFORMATION_KEYS,
  allFields,
  encounterAssessmentSchema,
  formSchemaSchema,
} from '@simrs/shared';
import { cx } from '@simrs/ui';
import Link from 'next/link';
import { z } from 'zod';
import { AssessmentForm, AssessmentList } from '@/components/klinis/assessment-api';
import { CompletenessCard } from '@/components/klinis/completeness-card';
import { ApiScreenShell, EncounterBanner, EncounterGate } from '@/components/klinis/encounter-screen';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { resolveEncounter } from '@/lib/server/data/klinis/encounter-screen';
import { completeness, optional } from '@/lib/server/data/klinis/konsul';
import type { SessionView } from '@/lib/session-view';

const ROUTE = '/klinis/asesmen';

const formList = z.array(
  z.object({ code: z.string(), title: z.string(), published: z.object({ version: z.int() }).nullable() }),
);
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

/**
 * K06 · Asesmen & skrining mode api: formulir P07 terbit diisi per kunjungan (`POST /patients/:id/forms/:code/responses`
 * + `encounterId`, hak tulis per profesi), daftar asesmen kunjungan (`GET /encounters/:id/assessments`), dan
 * kelengkapan paket formulir setting kunjungan (EP 6b/7a). Templat persetujuan diisi di tablet Persetujuan; edukasi di
 * layar Edukasi.
 */
export async function ApiAsesmen({
  session,
  searchParams,
}: {
  session: SessionView;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const res = await resolveEncounter(searchParams.kunjungan);
  const crumb = `Klinis / Asesmen & skrining · ${session.tenant.name}`;
  if (res.kind !== 'ok') {
    return (
      <ApiScreenShell crumb={crumb} title="Asesmen & skrining">
        <EncounterGate res={res} route={ROUTE} />
      </ApiScreenShell>
    );
  }
  const c = res.context;
  const encounterId = c.encounter.id;
  const [items, forms, packageStatus] = await Promise.all([
    api(`/api/v1/encounters/${encounterId}/assessments`, { schema: encounterAssessmentSchema.array() }),
    api('/api/v1/forms', { schema: formList }),
    optional(() => completeness(encounterId)),
  ]);
  const choices = forms
    .filter((f) => f.published && f.code !== CONSENT_EDUCATION_FORM)
    .sort((a, b) => a.title.localeCompare(b.title, 'id'));
  const wanted = typeof searchParams.form === 'string' ? searchParams.form : null;
  let selected: (NonNullable<z.infer<typeof formDetail>['published']> & { code: string }) | null = null;
  if (wanted && /^[a-z][a-z0-9_]{2,40}$/.test(wanted)) {
    try {
      const d = await api(`/api/v1/forms/${wanted}`, { schema: formDetail });
      if (d.published) selected = { ...d.published, code: d.code };
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }
  const sel = selected;
  const isConsentTemplate =
    sel !== null && CONSENT_INFORMATION_KEYS.every((k) => allFields(sel.schema).some((f) => f.key === k));
  const role = session.role?.code ?? null;
  const href = (code: string) => `${ROUTE}?kunjungan=${encounterId}&form=${code}`;
  return (
    <ApiScreenShell crumb={crumb} title="Asesmen & skrining">
      <EncounterBanner context={c} />
      {packageStatus && <CompletenessCard data={packageStatus} />}
      <nav aria-label="Formulir asesmen" className="flex flex-wrap gap-1.5">
        {choices.map((f) => (
          <Link
            key={f.code}
            href={href(f.code)}
            aria-current={selected?.code === f.code ? 'page' : undefined}
            className={cx(
              'inline-flex min-h-11 items-center rounded-full border px-3.5 text-small no-underline',
              selected?.code === f.code
                ? 'border-transparent bg-nav-active font-semibold text-white'
                : 'border-line-strong bg-white/90 text-ink-700 hover:bg-brand-50/60',
            )}
          >
            {f.title}
          </Link>
        ))}
        <Link
          href={`/klinis/edukasi?kunjungan=${encounterId}`}
          className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-white/90 px-3.5 text-small text-ink-700 no-underline hover:bg-brand-50/60"
        >
          Edukasi terintegrasi (layar Edukasi)
        </Link>
      </nav>
      {selected && isConsentTemplate ? (
        <p className="m-0 rounded-card bg-white/90 px-4 py-3 text-small text-ink-700 shadow-card">
          Formulir ini templat persetujuan tindakan; diisi lewat tablet Persetujuan tindakan.
        </p>
      ) : selected ? (
        <AssessmentForm
          key={selected.code}
          patientId={c.patient.id}
          encounterId={encounterId}
          form={selected}
          allowed={!!role && selected.writeRoles.includes(role)}
        />
      ) : (
        <p className="m-0 rounded-card bg-white/90 px-4 py-3 text-small text-ink-700 shadow-card">
          Pilih formulir di atas untuk mengisi asesmen pada kunjungan ini.
        </p>
      )}
      <AssessmentList items={items} />
    </ApiScreenShell>
  );
}
