import { type AppEnv, resolveAppEnv } from '@simrs/shared';

/**
 * Sumber data layar yang backend-nya belum ada (ADR-0023): `demo` = data dummy fiktif untuk presentasi,
 * `api` = backend sungguhan. Layar fase 1 (Akses, Audit, Formulir, MPI) selalu memakai API.
 */
export type DataSource = 'api' | 'demo';

/**
 * Penyimpanan peta refresh sesi (proxy, ADR-0073): `redis` dibagi semua instans web, `memory` per proses.
 * `auto` (bawaan) = Redis bila `REDIS_URL` ada dan terjangkau, selain itu memori dengan peringatan.
 */
export type RefreshStore = 'auto' | 'redis' | 'memory';

export interface WebEnv {
  appEnv: AppEnv;
  apiBaseUrl: string;
  /** Kolom "Kode RS" di layar masuk (lokal/staging). Produksi: RS ditentukan dari subdomain. */
  tenantCodeField: boolean;
  /** Isi awal kolom "Kode RS" (`LOGIN_TENANT_CODE`; lokal bawaan RSCM, keputusan pengguna 4 Okt 2026). */
  loginTenantCode: string;
  /** Cookie Secure + `__Host-` di luar lokal (lokal memakai http://localhost). */
  secureCookies: boolean;
  /** Mode presentasi hanya bila `APP_ENV=local` DAN `DATA_SOURCE=demo`; staging/produksi selalu `api`. */
  dataSource: DataSource;
  /** Redis bersama (`REDIS_URL`) untuk peta refresh sesi antar-instans; null = tidak disetel. */
  redisUrl: string | null;
  /** `REFRESH_STORE`; `memory` diabaikan di produksi (web multi-instans wajib berbagi peta refresh). */
  refreshStore: RefreshStore;
  /** Awalan kunci Redis peta refresh (`REFRESH_REDIS_PREFIX`). */
  refreshRedisPrefix: string;
}

function refreshStoreOf(raw: string | undefined, appEnv: AppEnv): RefreshStore {
  const v = raw?.trim().toLowerCase();
  const store: RefreshStore = v === 'redis' || v === 'memory' ? v : 'auto';
  return appEnv === 'production' && store === 'memory' ? 'redis' : store;
}

/** Kode RS awal di layar masuk: dari env bila sah, selain itu RSCM di lokal; kosong di luar lokal. */
function tenantCodeDefault(raw: string | undefined, appEnv: AppEnv): string {
  const code = raw?.trim().toUpperCase() ?? '';
  if (/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(code)) return code;
  return appEnv === 'local' ? 'RSCM' : '';
}

/** Konfigurasi web dari env server, gagal aman: APP_ENV tak disetel/tak dikenal = production. */
export function webEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  const appEnv = resolveAppEnv(source.APP_ENV);
  return {
    appEnv,
    apiBaseUrl: source.API_BASE_URL ?? 'http://localhost:4000',
    tenantCodeField: appEnv !== 'production',
    loginTenantCode: tenantCodeDefault(source.LOGIN_TENANT_CODE, appEnv),
    secureCookies: appEnv !== 'local',
    dataSource: appEnv === 'local' && source.DATA_SOURCE?.trim().toLowerCase() === 'demo' ? 'demo' : 'api',
    redisUrl: source.REDIS_URL?.trim() || null,
    refreshStore: refreshStoreOf(source.REFRESH_STORE, appEnv),
    refreshRedisPrefix: source.REFRESH_REDIS_PREFIX?.trim() || 'simrs:web:refresh:',
  };
}
