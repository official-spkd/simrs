import { v7 as uuidv7, validate, version } from 'uuid';

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
