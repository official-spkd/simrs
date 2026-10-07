/**
 * APP_ENV=demo: demo publik ber-data fiktif (mis. demo.spkd.store/demo-simrs). Pengamanan setara staging, mode
 * presentasi boleh, integrasi wajib mock, penyimpanan disk boleh.
 */
import { describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/config/env';

describe('APP_ENV=demo', () => {
  const base = {
    ...process.env,
    APP_ENV: 'demo',
    NODE_ENV: 'production',
    STORAGE_DRIVER: 'disk',
    INTEGRATION_MODE: 'mock',
    ALLOW_DEV_TENANT_HEADER: 'true',
  };

  it('fitur pengembang dan tenant dari header selalu mati walau diminta', () => {
    const env = loadApiEnv(base);
    expect(env.APP_ENV).toBe('demo');
    expect(env.devTools).toBe(false);
    expect(env.devTenantHeader).toBe(false);
    expect(loadApiEnv({ ...base, NODE_ENV: 'development' }).devTools).toBe(false);
  });

  it('penyimpanan disk dan integrasi mock diterima', () => {
    expect(loadApiEnv(base).STORAGE_DRIVER).toBe('disk');
    expect(loadApiEnv(base).INTEGRATION_MODE).toBe('mock');
  });

  it('integrasi sungguhan ditolak: data fiktif tidak boleh dikirim ke BPJS/SATUSEHAT', () => {
    expect(() => loadApiEnv({ ...base, INTEGRATION_MODE: 'sandbox' })).toThrow(/APP_ENV=demo/);
    expect(() => loadApiEnv({ ...base, INTEGRATION_MODE: 'production' })).toThrow(/APP_ENV=demo/);
  });

  it('staging tetap menolak penyimpanan disk', () => {
    expect(() => loadApiEnv({ ...base, APP_ENV: 'staging' })).toThrow(/STORAGE_DRIVER=disk/);
  });
});
