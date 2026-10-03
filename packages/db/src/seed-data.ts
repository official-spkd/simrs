/** Tenant RS fiktif untuk lokal dan tes. Kode Kemenkes berawalan 9999 = jelas fiktif. */
export const SEED_TENANTS = [
  {
    id: '0199a000-0000-7000-8000-000000000001',
    code: 'RSFA',
    name: 'RS Fiktif Andalas',
    kemenkesCode: '9999001',
    bpjsPpkCode: '0301R001',
    satusehatOrgId: 'mock-org-001',
    hospitalClass: 'B',
  },
  {
    id: '0199a000-0000-7000-8000-000000000002',
    code: 'RSFB',
    name: 'RS Fiktif Bahari',
    kemenkesCode: '9999002',
    bpjsPpkCode: '0301R002',
    satusehatOrgId: 'mock-org-002',
    hospitalClass: 'C',
  },
] as const;
