import { Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';

/** P08 · Diimpor modul yang menerbitkan nomor dokumen (MPI, registrasi, kasir, akuntansi). Tanpa endpoint. */
@Module({ providers: [NumberingService], exports: [NumberingService] })
export class NumberingModule {}
