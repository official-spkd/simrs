import { DEMO_TODAY } from './waktu';

/**
 * I06 · Data dummy device gateway (ADR-0023): dua analyzer terdaftar (prinsipal perangkat, ADR-0027) dan pesan
 * ORU^R01 contoh. Nomor lab sama dengan worklist Laboratorium (L2610050163 Ny. Anisa, L2610050142 Ny. Endang,
 * L2610050171 Ny. Lestiani yang sampelnya belum diterima). LOINC hanya dari contoh seed. PID berisi RM saja dan
 * disamarkan sebelum disimpan di log gateway.
 */

const at = (hhmm: string) => `${DEMO_TODAY}T${hhmm.replace('.', ':')}:00+07:00`;

export interface GatewayDevice {
  id: string;
  name: string;
  protocol: string;
  status: 'online' | 'offline';
  lastMessageAt: string;
  messagesToday: number;
}

export const DEVICES: readonly GatewayDevice[] = [
  {
    id: 'HEMA-01',
    name: 'Analyzer hematologi',
    protocol: 'HL7 v2.5.1 ORU^R01 · HTTP ber-HMAC',
    status: 'online',
    lastMessageAt: at('10.36'),
    messagesToday: 142,
  },
  {
    id: 'KIMIA-01',
    name: 'Analyzer kimia klinik',
    protocol: 'HL7 v2.5.1 ORU^R01 · HTTP ber-HMAC',
    status: 'online',
    lastMessageAt: at('10.39'),
    messagesToday: 218,
  },
];

const msh = (device: string, controlId: string, ts: string) =>
  `MSH|^~\\&|${device}|LAB|SIMRS|RSFA|20261005${ts}00||ORU^R01|${controlId}|P|2.5.1`;

export interface PresetMessage {
  id: string;
  label: string;
  raw: string;
}

export const PRESET_MESSAGES: readonly PresetMessage[] = [
  {
    id: 'pm-1',
    label: 'Hematologi · L2610050163 (DL pra-SC)',
    raw: [
      msh('HEMA-01', 'HEM-261005-0418', '1044'),
      'PID|||00-31-77-02^^^RM',
      'OBR|1|L2610050163||DL',
      'OBX|1|NM|718-7^Hemoglobin^LN||11.8|g/dL|12.0-15.5|L|||F',
      'OBX|2|NM|6690-2^Leukosit^LN||9800|/uL|4000-11000|N|||F',
      'OBX|3|NM|777-3^Trombosit^LN||245000|/uL|150000-450000|N|||F',
    ].join('\n'),
  },
  {
    id: 'pm-2',
    label: 'Kimia · L2610050142 (kreatinin, kalium)',
    raw: [
      msh('KIMIA-01', 'KIM-261005-0733', '1045'),
      'PID|||00-12-88-40^^^RM',
      'OBR|1|L2610050142||KIMIA',
      'OBX|1|NM|2160-0^Kreatinin^LN||1.3|mg/dL|0.5-1.1|H|||F',
      'OBX|2|NM|2823-3^Kalium^LN||4.1|mmol/L|3.5-5.1|N|||F',
    ].join('\n'),
  },
  {
    id: 'pm-3',
    label: 'Kimia · L2610050171 (sampel belum diterima)',
    raw: [
      msh('KIMIA-01', 'KIM-261005-0734', '1046'),
      'PID|||00-27-14-55^^^RM',
      'OBR|1|L2610050171||KIMIA',
      'OBX|1|NM|2345-7^Glukosa sewaktu^LN||132|mg/dL|70-140|N|||F',
    ].join('\n'),
  },
  {
    id: 'pm-4',
    label: 'Hematologi · L2610059999 (nomor lab tidak dikenal)',
    raw: [
      msh('HEMA-01', 'HEM-261005-0419', '1047'),
      'PID|||00-00-00-00^^^RM',
      'OBR|1|L2610059999||DL',
      'OBX|1|NM|718-7^Hemoglobin^LN||13.1|g/dL|13.5-17.5|L|||F',
    ].join('\n'),
  },
];

/** Control ID yang sudah diproses hari ini (pesan ulang = duplikat idempoten). */
export const PROCESSED_TODAY: readonly string[] = ['HEM-261005-0417', 'KIM-261005-0732'];
