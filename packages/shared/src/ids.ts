import { validate, version, v5 as uuidv5, v7 as uuidv7 } from 'uuid';

/** Semua PK memakai UUID v7 yang dibangkitkan aplikasi (urut waktu, aman untuk sinkron edge). */
export function newId(): string {
  return uuidv7();
}

export function isUuid(value: string): boolean {
  return validate(value);
}

export function isUuidV7(value: string): boolean {
  return validate(value) && version(value) === 7;
}

/**
 * UUID v5 (berbasis nama): ID deterministik untuk hal yang tidak punya baris sendiri di database (mis. sel jadwal
 * "libur"). Nama yang sama dalam namespace yang sama selalu menghasilkan ID yang sama. Bukan untuk PK baru.
 */
export function nameBasedId(name: string, namespace: string): string {
  return uuidv5(name, namespace);
}
