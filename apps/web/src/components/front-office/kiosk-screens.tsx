import type { IconName } from '@simrs/ui';
import type { KioskMethod } from './kiosk-keypad';
import { fs, KioskBackRow, KioskOption, KioskTitle } from './kiosk-ui';

export interface KioskPurpose {
  title: string;
  desc: string;
  icon: IconName;
  /** Cara identifikasi yang disarankan. */
  rec: KioskMethod['id'];
  /** Peserta JKN: verifikasi biometrik sebelum tiket/SEP. */
  bpjs: boolean;
}

export const PURPOSES: readonly KioskPurpose[] = [
  {
    title: 'Saya sudah punya booking',
    desc: 'Pindai kode QR dari aplikasi, Mobile JKN, atau WhatsApp',
    icon: 'qr',
    rec: 'booking',
    bpjs: true,
  },
  {
    title: 'Pasien BPJS',
    desc: 'Kontrol atau rujukan baru. Cetak SEP dan nomor antrean',
    icon: 'card',
    rec: 'bpjs',
    bpjs: true,
  },
  {
    title: 'Pasien umum atau asuransi',
    desc: 'Daftar ke poli dan pilih dokter',
    icon: 'userPlus',
    rec: 'nik',
    bpjs: false,
  },
  {
    title: 'Ambil antrean farmasi atau kasir',
    desc: 'Setelah pemeriksaan selesai',
    icon: 'list',
    rec: 'nik',
    bpjs: false,
  },
];

export const METHODS: Record<KioskMethod['id'], KioskMethod & { icon: IconName }> = {
  nik: { id: 'nik', title: 'NIK e-KTP', desc: '16 digit angka pada KTP elektronik', len: 16, icon: 'idCard' },
  booking: {
    id: 'booking',
    title: 'Kode booking',
    desc: '10 digit dari Mobile JKN, aplikasi, atau WhatsApp',
    len: 10,
    icon: 'qr',
  },
  bpjs: { id: 'bpjs', title: 'Nomor kartu BPJS', desc: '13 digit pada kartu JKN-KIS', len: 13, icon: 'card' },
};

export function KioskHome({ greeting, onPick }: { greeting: string; onPick: (i: number) => void }) {
  return (
    <>
      <div className="flex flex-col gap-3 px-16 pt-[72px] pb-8">
        <h1 className="m-0 leading-[1.15] font-bold tracking-[-0.01em]" style={fs(56)}>
          {greeting}
          <span className="block text-brand-700">Apa yang ingin Anda lakukan?</span>
        </h1>
        <p className="m-0 text-ink-700" style={fs(24)}>
          Sentuh salah satu pilihan di bawah. Petugas siap membantu di meja informasi.
        </p>
      </div>
      <div className="flex flex-col gap-6 px-16">
        {PURPOSES.map((p, i) => (
          <KioskOption
            key={p.title}
            title={p.title}
            desc={p.desc}
            icon={p.icon}
            primary={i === 0}
            onClick={() => onPick(i)}
          />
        ))}
      </div>
    </>
  );
}

export function KioskMethods({
  purpose,
  step,
  onBack,
  onPick,
}: {
  purpose: KioskPurpose;
  step: string;
  onBack: () => void;
  onPick: (id: KioskMethod['id']) => void;
}) {
  return (
    <div className="flex flex-col gap-10 px-16 pt-14">
      <KioskBackRow onBack={onBack} step={step} />
      <KioskTitle
        title="Bagaimana kami menemukan data Anda?"
        sub={`${purpose.title}. Pilih salah satu cara di bawah.`}
      />
      <div className="flex flex-col gap-6">
        {(['nik', 'booking', 'bpjs'] as const).map((id) => {
          const m = METHODS[id];
          const rec = id === purpose.rec;
          return (
            <KioskOption
              key={id}
              title={m.title}
              desc={m.desc}
              icon={m.icon}
              primary={rec}
              tag={rec ? 'Disarankan' : undefined}
              onClick={() => onPick(id)}
            />
          );
        })}
      </div>
    </div>
  );
}

export type BiometricChoice = 'wajah' | 'jari';

/** Verifikasi biometrik peserta JKN (syarat SEP rawat jalan): pengenalan wajah atau sidik jari. */
export function KioskBiometric({
  step,
  busy,
  onBack,
  onPick,
}: {
  step: string;
  busy: boolean;
  onBack: () => void;
  onPick: (c: BiometricChoice) => void;
}) {
  return (
    <div className="flex flex-col gap-10 px-16 pt-14">
      <KioskBackRow onBack={onBack} step={step} />
      <KioskTitle
        title="Verifikasi biometrik peserta JKN"
        sub="Syarat penerbitan SEP rawat jalan. Pilih salah satu cara verifikasi."
      />
      <div className="flex flex-col gap-6">
        <KioskOption
          title="Pengenalan wajah"
          desc="Lihat ke kamera di atas layar selama 3 detik"
          icon="scan"
          primary
          disabled={busy}
          onClick={() => onPick('wajah')}
        />
        <KioskOption
          title="Sidik jari"
          desc="Letakkan jari telunjuk kanan pada pemindai di bawah layar"
          icon="fileCheck"
          disabled={busy}
          onClick={() => onPick('jari')}
        />
      </div>
      {busy && (
        <p role="status" className="m-0 font-semibold text-brand-700" style={fs(24)}>
          Mencocokkan data biometrik dengan BPJS…
        </p>
      )}
    </div>
  );
}
