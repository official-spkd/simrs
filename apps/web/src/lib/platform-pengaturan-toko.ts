import { type ComponentCode, COMPONENTS, TENANT_SETTINGS, type TenantSettingKey } from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { DEMO_MODULE_OVERRIDES, DEMO_SETTINGS, DEMO_TEMPLATES } from './demo/fixtures/platform';
import {
  isCoreModule,
  MODULE_CODES,
  missingDeps,
  type ModuleState,
  moduleStateFrom,
  type PrintTemplate,
  type SettingDraft,
  type TemplateKind,
  templateIssues,
} from './platform-pengaturan';

/**
 * P10/P12 · Domain toko demo `pengaturan` (ADR-0085): modul aktif per RS, pengaturan umum, dan template cetak berversi
 * dari layar Pengaturan RS. Aturan murni (dependensi modul, skema `TENANT_SETTINGS`, syarat template) sehingga
 * domain ini `generic`. Modul aktif dibaca CD-0 untuk menyembunyikan menu (`screenHiddenByModules`), pengaturan
 * dibaca layar lain (mis. rata-rata layanan antrean di info publik).
 */

export const SETTINGS_DOMAIN = 'pengaturan';

const jam = z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/);
const moduleCode = z.string().refine((c): c is ComponentCode => Object.hasOwn(COMPONENTS, c), 'Kode modul');
const settingKey = z
  .string()
  .refine((k): k is TenantSettingKey => Object.hasOwn(TENANT_SETTINGS, k), 'Kunci pengaturan');
const TEMPLATE_IDS = [
  'kop',
  'label',
  'gelang',
  'etiket',
  'kuitansi',
] as const satisfies readonly TemplateKind[];

export const settingsEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('modul.disimpan'),
    changes: z
      .array(z.strictObject({ code: moduleCode, on: z.boolean() }))
      .min(1)
      .max(81),
    reason: z.string().trim().min(5).max(300),
    jam,
  }),
  z.strictObject({
    type: z.literal('pengaturan.disimpan'),
    values: z.record(settingKey, z.unknown()),
    jam,
  }),
  z.strictObject({
    type: z.literal('template.diterbitkan'),
    id: z.enum(TEMPLATE_IDS),
    header: z.string().max(120),
    subheader: z.string().max(160),
    showQr: z.boolean(),
    showBarcode: z.boolean(),
    showAllergy: z.boolean(),
    footer: z.string().max(200),
    note: z.string().trim().min(3).max(300),
    /** Saat terbit (jam hari demo, ISO). */
    at: z.iso.datetime({ offset: true }),
    jam,
  }),
]);
export type SettingsEvent = z.infer<typeof settingsEventSchema>;

export interface SettingsStoreState {
  modules: ModuleState;
  moduleLog: ReadonlyArray<{ t: string; text: string }>;
  settings: SettingDraft;
  settingsSaved: { jam: string; by: string; keys: TenantSettingKey[] } | null;
  templates: readonly PrintTemplate[];
  history: Readonly<Partial<Record<TemplateKind, ReadonlyArray<{ v: number; at: string; note: string }>>>>;
}

const label = (c: ComponentCode) => `${c} ${COMPONENTS[c].name}`;

/** Keadaan modul setelah perubahan; galat bila melanggar inti/dependensi. */
function applyModules(s: ModuleState, changes: ReadonlyArray<{ code: ComponentCode; on: boolean }>) {
  const next = { ...s };
  for (const c of changes) next[c.code] = c.on;
  for (const c of MODULE_CODES) {
    if (!next[c] && isCoreModule(c)) return `Modul inti ${label(c)} tidak bisa dimatikan.`;
    const missing = next[c] ? missingDeps(c, next) : [];
    if (missing.length) return `${label(c)} butuh ${missing.join(', ')} aktif.`;
  }
  return next;
}

function settingProblem(values: Record<string, unknown>): string | null {
  const keys = Object.keys(values);
  if (keys.length === 0) return 'Belum ada nilai yang diubah.';
  for (const k of keys as TenantSettingKey[]) {
    if (!TENANT_SETTINGS[k].schema.safeParse(values[k]).success) {
      return `Nilai ${TENANT_SETTINGS[k].label.toLowerCase()} tidak valid.`;
    }
  }
  return null;
}

function gate(s: SettingsStoreState, ev: SettingsEvent): string | null {
  switch (ev.type) {
    case 'modul.disimpan': {
      if (ev.changes.every((c) => s.modules[c.code as ComponentCode] === c.on)) return 'Tidak ada perubahan.';
      const r = applyModules(s.modules, ev.changes as Array<{ code: ComponentCode; on: boolean }>);
      return typeof r === 'string' ? r : null;
    }
    case 'pengaturan.disimpan':
      return settingProblem(ev.values);
    case 'template.diterbitkan': {
      const cur = s.templates.find((t) => t.id === ev.id);
      if (!cur) return 'Template tidak dikenal.';
      const issues = templateIssues({ ...cur, ...ev });
      return issues[0] ?? null;
    }
  }
}

export const settingsDomain = defineDomain<SettingsStoreState, SettingsEvent>(SETTINGS_DOMAIN, {
  initial: () => ({
    modules: moduleStateFrom(DEMO_MODULE_OVERRIDES),
    moduleLog: [{ t: '07.55', text: 'B06 Mutu dan keselamatan pasien diaktifkan · pilot komite mutu' }],
    settings: { ...DEMO_SETTINGS },
    settingsSaved: null,
    templates: DEMO_TEMPLATES.map((t) => ({ ...t })),
    history: {},
  }),
  eventSchema: settingsEventSchema,
  screens: ['pengaturan'],
  generic: true,
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const err = gate(s, d);
    if (err) throw new Error(err);
    switch (d.type) {
      case 'modul.disimpan': {
        const changes = d.changes as Array<{ code: ComponentCode; on: boolean }>;
        const modules = applyModules(s.modules, changes) as ModuleState;
        return {
          ...s,
          modules,
          moduleLog: [
            ...changes
              .filter((c) => s.modules[c.code] !== c.on)
              .map((c) => ({
                t: d.jam,
                text: `${label(c.code)} ${c.on ? 'diaktifkan' : 'dimatikan'} · ${d.reason} (${ev.actor.name})`,
              })),
            ...s.moduleLog,
          ],
        };
      }
      case 'pengaturan.disimpan':
        return {
          ...s,
          settings: { ...s.settings, ...d.values },
          settingsSaved: { jam: d.jam, by: ev.actor.name, keys: Object.keys(d.values) as TenantSettingKey[] },
        };
      case 'template.diterbitkan': {
        const cur = s.templates.find((t) => t.id === d.id);
        if (!cur) return s;
        const v = cur.version + 1;
        return {
          ...s,
          templates: s.templates.map((t) =>
            t.id === d.id
              ? {
                  ...t,
                  header: d.header,
                  subheader: d.subheader,
                  showQr: d.showQr,
                  showBarcode: d.showBarcode,
                  showAllergy: d.showAllergy,
                  footer: d.footer,
                  version: v,
                  publishedAt: d.at,
                  publishedBy: ev.actor.name,
                }
              : t,
          ),
          history: {
            ...s.history,
            [d.id]: [{ v, at: d.jam, note: d.note }, ...(s.history[d.id] ?? [])],
          },
        };
      }
    }
  },
});

/**
 * Untuk CD-0 (menu/sidebar): layar disembunyikan bila SEMUA komponen katalognya mati di RS ini. Layar tanpa kode
 * komponen (Simulasi, Cadangan, Go-live) tidak pernah disembunyikan.
 */
export function screenHiddenByModules(
  screen: { components: readonly string[] },
  modules: Readonly<Partial<Record<string, boolean>>>,
): boolean {
  return screen.components.length > 0 && screen.components.every((c) => modules[c] === false);
}
