import { describe, expect, it } from 'vitest';
import { mockStartupProblem } from './config';

describe('gerbang start mock (tanpa autentikasi, kredensial mock bawaan)', () => {
  it('menolak APP_ENV/NODE_ENV production', () => {
    expect(mockStartupProblem({ APP_ENV: 'production' })).toMatch(/produksi/);
    expect(mockStartupProblem({ APP_ENV: 'local', NODE_ENV: 'production' })).toMatch(/produksi/);
  });

  it('menolak bind ke luar loopback kecuali diizinkan eksplisit', () => {
    expect(mockStartupProblem({ APP_ENV: 'local', HOST: '0.0.0.0' })).toMatch(/loopback/);
    expect(mockStartupProblem({ APP_ENV: 'local', HOST: '192.168.1.10' })).toMatch(/loopback/);
    expect(mockStartupProblem({ APP_ENV: 'local', HOST: '0.0.0.0', MOCK_ALLOW_REMOTE: 'true' })).toBeNull();
  });

  it('lokal di loopback diizinkan (juga tanpa APP_ENV, seperti tes)', () => {
    expect(mockStartupProblem({ APP_ENV: 'local' })).toBeNull();
    expect(mockStartupProblem({ APP_ENV: 'staging', HOST: '127.0.0.1' })).toBeNull();
    expect(mockStartupProblem({ HOST: 'localhost' })).toBeNull();
    expect(mockStartupProblem({ HOST: '::1' })).toBeNull();
  });
});
