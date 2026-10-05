import fontkit from '@pdf-lib/fontkit';
import { formatTanggalLahir, formatTanggalWaktu } from '@simrs/shared';
import { type PDFFont, PDFDocument, type PDFPage, rgb } from 'pdf-lib';
import { encode } from 'uqr';
import { PDF_FONT_NAMES, type PdfFontName, pdfFontBytes } from './fonts';
import {
  type ClinicalPdfContent,
  type ClinicalPdfInput,
  clinicalPdfInputSchema,
  type PdfBlock,
} from './schema';

/**
 * Templat dasar dokumen klinis (ADR-0029): kop RS, identitas pasien, bagian isi, blok tanda tangan (QR verifikasi
 * TTE), dan kaki halaman "Halaman x dari y" di setiap halaman. Halaman lanjutan mengulang identitas pasien ringkas
 * (nama + RM) agar lembar yang terlepas tetap bisa dikenali pemiliknya.
 *
 * Deterministik: tanpa jam sistem, tanpa ID acak (nama fon tetap, RNG pdf-lib berbenih tetap), metadata hanya dari
 * input. Input sama → byte sama → SHA-256 sama, sehingga hash yang ditandatangani TTE bisa dibangun ulang dari data.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN_X = 48;
const MARGIN_TOP = 44;
const FOOTER_H = 40;
const CONTENT_W = A4[0] - MARGIN_X * 2;

const INK = rgb(0.078, 0.129, 0.169);
const MUTED = rgb(0.357, 0.42, 0.471);
const BRAND = rgb(0.059, 0.463, 0.431);
const LINE = rgb(0.835, 0.867, 0.89);
const SUBTLE = rgb(0.957, 0.965, 0.973);

const SEX_LABEL: Record<ClinicalPdfContent['patient']['sex'], string> = {
  male: 'Laki-laki',
  female: 'Perempuan',
  unknown: 'Tidak diketahui',
};

type Fonts = Record<PdfFontName, PDFFont>;

/** Teks satu baris tanpa karakter kendali (tab → spasi, CR dibuang). */
const clean = (s: string) => s.replace(/\r/g, '').replace(/\t/g, ' ');

/** Pecah teks menjadi baris selebar `width` (kata panjang dipotong per huruf). Baris baru di teks dipertahankan. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      if (word === '') continue;
      const next = line ? `${line} ${word}` : word;
      if (fits(next)) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      if (fits(word)) {
        line = word;
        continue;
      }
      let part = '';
      for (const ch of word) {
        if (fits(part + ch)) part += ch;
        else {
          out.push(part);
          part = ch;
        }
      }
      line = part;
    }
    out.push(line);
  }
  return out;
}

class Layout {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  y = 0;

  constructor(
    private readonly pdf: PDFDocument,
    readonly fonts: Fonts,
    private readonly doc: ClinicalPdfContent,
  ) {}

  get current(): PDFPage {
    return this.page;
  }

  bottom(): number {
    return FOOTER_H + 16;
  }

  newPage(): void {
    this.page = this.pdf.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - MARGIN_TOP;
    if (this.pages.length > 1) this.continuationHeader();
  }

  /** Pastikan ada ruang setinggi `h`; bila tidak, pindah halaman. */
  ensure(h: number): void {
    if (this.y - h < this.bottom()) this.newPage();
  }

  text(s: string, x: number, size: number, font: PDFFont = this.fonts.regular, color = INK): void {
    this.page.drawText(clean(s), { x, y: this.y - size, size, font, color });
  }

  rule(color = LINE, thickness = 0.75): void {
    this.page.drawLine({
      start: { x: MARGIN_X, y: this.y },
      end: { x: A4[0] - MARGIN_X, y: this.y },
      thickness,
      color,
    });
  }

  /** Paragraf terbungkus; berpindah halaman per baris bila perlu. */
  paragraph(
    s: string,
    opt: { x?: number; width?: number; size?: number; font?: PDFFont; color?: typeof INK } = {},
  ): void {
    const size = opt.size ?? 10;
    const lh = size * 1.4;
    const x = opt.x ?? MARGIN_X;
    for (const line of wrapText(s, opt.font ?? this.fonts.regular, size, opt.width ?? CONTENT_W)) {
      this.ensure(lh);
      this.text(line, x, size, opt.font, opt.color);
      this.y -= lh;
    }
  }

  private continuationHeader(): void {
    const { regular, semibold } = this.fonts;
    this.text(this.doc.hospital.name, MARGIN_X, 9, semibold, BRAND);
    const who = `${this.doc.patient.name} · RM ${this.doc.patient.mrn}`;
    const w = regular.widthOfTextAtSize(who, 9);
    this.text(who, A4[0] - MARGIN_X - w, 9, regular, MUTED);
    this.y -= 13;
    this.text(`${this.doc.document.title} (lanjutan)`, MARGIN_X, 9, regular, MUTED);
    this.y -= 15;
    this.rule();
    this.y -= 14;
  }
}

function drawKop(l: Layout, d: ClinicalPdfContent): void {
  const { regular, semibold } = l.fonts;
  l.text(d.hospital.name, MARGIN_X, 15, semibold, BRAND);
  l.y -= 19;
  for (const line of [d.hospital.unit, d.hospital.address, d.hospital.contact]) {
    if (!line) continue;
    l.paragraph(line, { size: 8.5, color: MUTED });
  }
  l.y -= 4;
  l.rule(BRAND, 1.5);
  l.y -= 16;
  for (const line of wrapText(d.document.title, semibold, 14, CONTENT_W)) {
    l.text(line, MARGIN_X, 14, semibold);
    l.y -= 19;
  }
  const meta = [
    d.document.number ? `Nomor ${d.document.number}` : null,
    `Terbit ${formatTanggalWaktu(d.document.issuedAt)} WIB`,
  ]
    .filter(Boolean)
    .join(' · ');
  l.paragraph(meta, { size: 9, color: MUTED, font: regular });
  l.y -= 8;
}

/** Baris label: nilai dua kolom (label tetap 150 pt). */
function drawFields(l: Layout, rows: ReadonlyArray<{ label: string; value: string }>, size = 9.5): void {
  const { regular, semibold } = l.fonts;
  const labelW = 150;
  const lh = size * 1.4;
  for (const r of rows) {
    const labelLines = wrapText(r.label, regular, size, labelW - 8);
    const valueLines = wrapText(r.value || '—', semibold, size, CONTENT_W - labelW);
    const n = Math.max(labelLines.length, valueLines.length);
    for (let i = 0; i < n; i += 1) {
      l.ensure(lh);
      if (labelLines[i]) l.text(labelLines[i] as string, MARGIN_X, size, regular, MUTED);
      if (valueLines[i]) l.text(valueLines[i] as string, MARGIN_X + labelW, size, semibold);
      l.y -= lh;
    }
    l.y -= 2;
  }
}

function drawIdentity(l: Layout, d: ClinicalPdfContent): void {
  const p = d.patient;
  const rows = [
    { label: 'Nama pasien', value: p.name },
    { label: 'No. rekam medis', value: p.mrn },
    { label: 'Tanggal lahir', value: p.birthDate ? formatTanggalLahir(p.birthDate) : 'Tidak diketahui' },
    { label: 'Jenis kelamin', value: SEX_LABEL[p.sex] },
    ...p.extra,
  ];
  const top = l.y;
  l.y -= 8;
  drawFields(l, rows);
  // Bingkai identitas (hanya bila muat di halaman pertama; identitas selalu singkat).
  l.current.drawRectangle({
    x: MARGIN_X - 8,
    y: l.y,
    width: CONTENT_W + 16,
    height: top - l.y,
    borderColor: LINE,
    borderWidth: 0.75,
  });
  l.y -= 16;
}

function drawTable(l: Layout, t: Extract<PdfBlock, { kind: 'table' }>): void {
  const { regular, semibold } = l.fonts;
  const size = 9;
  const lh = size * 1.35;
  const pad = 4;
  const weights = t.widths ?? t.columns.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (CONTENT_W * w) / total);
  const drawRow = (cells: readonly string[], header: boolean) => {
    const font = header ? semibold : regular;
    const lines = cells.map((c, i) => wrapText(c || '—', font, size, (widths[i] ?? 0) - pad * 2));
    const h = Math.max(...lines.map((x) => x.length)) * lh + pad * 2;
    l.ensure(h);
    if (header) {
      l.current.drawRectangle({ x: MARGIN_X, y: l.y - h, width: CONTENT_W, height: h, color: SUBTLE });
    }
    let x = MARGIN_X;
    const top = l.y;
    lines.forEach((cellLines, i) => {
      l.y = top - pad;
      for (const line of cellLines) {
        l.text(line, x + pad, size, font, header ? MUTED : INK);
        l.y -= lh;
      }
      x += widths[i] ?? 0;
    });
    l.y = top - h;
    l.rule();
  };
  drawRow(t.columns, true);
  for (const r of t.rows) drawRow(r, false);
  l.y -= 6;
}

function drawBlock(l: Layout, b: PdfBlock): void {
  switch (b.kind) {
    case 'paragraph':
      l.paragraph(b.text || '—');
      l.y -= 4;
      return;
    case 'fields':
      drawFields(l, b.rows);
      l.y -= 2;
      return;
    case 'list':
      for (const item of b.items) {
        const lines = wrapText(item, l.fonts.regular, 10, CONTENT_W - 14);
        lines.forEach((line, i) => {
          l.ensure(14);
          if (i === 0) l.text('•', MARGIN_X + 2, 10);
          l.text(line, MARGIN_X + 14, 10);
          l.y -= 14;
        });
      }
      l.y -= 4;
      return;
    case 'table':
      drawTable(l, b);
      return;
  }
}

/** QR modul hitam di atas putih (uqr, deterministik), sisi `size` pt dengan sudut kiri bawah (x, y). */
function drawQr(page: PDFPage, data: string, x: number, y: number, size: number): void {
  const qr = encode(data, { ecc: 'M', border: 1 });
  const cell = size / qr.size;
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  qr.data.forEach((row, r) => {
    row.forEach((on, c) => {
      if (on) {
        page.drawRectangle({
          x: x + c * cell,
          y: y + size - (r + 1) * cell,
          width: cell,
          height: cell,
          color: INK,
        });
      }
    });
  });
}

function drawSignatures(l: Layout, d: ClinicalPdfContent): void {
  if (d.signatures.length === 0) return;
  const { regular, semibold, mono } = l.fonts;
  const colW = (CONTENT_W - 24) / 2;
  const qrSize = 64;
  const blockH = 150;
  l.y -= 8;
  for (let i = 0; i < d.signatures.length; i += 2) {
    l.ensure(blockH);
    const top = l.y;
    d.signatures.slice(i, i + 2).forEach((s, k) => {
      const x = MARGIN_X + k * (colW + 24);
      l.y = top;
      for (const line of wrapText(s.role, regular, 9, colW)) {
        l.text(line, x, 9, regular, MUTED);
        l.y -= 12.6;
      }
      l.y -= 4;
      if (s.verifyUrl) {
        drawQr(l.current, s.verifyUrl, x, l.y - qrSize, qrSize);
        const note = wrapText(
          'Ditandatangani secara elektronik. Pindai QR untuk memeriksa keaslian.',
          regular,
          7.5,
          colW - qrSize - 8,
        );
        let ny = l.y;
        for (const line of note) {
          l.current.drawText(line, {
            x: x + qrSize + 8,
            y: ny - 7.5,
            size: 7.5,
            font: regular,
            color: MUTED,
          });
          ny -= 10;
        }
        l.y -= qrSize + 6;
      } else {
        // Tanpa TTE (mis. pasien/saksi di tablet): ruang tanda tangan dengan garis.
        l.y -= qrSize;
        l.current.drawLine({
          start: { x, y: l.y },
          end: { x: x + colW * 0.8, y: l.y },
          thickness: 0.75,
          color: LINE,
        });
        l.y -= 6;
      }
      for (const line of wrapText(s.name, semibold, 10, colW)) {
        l.text(line, x, 10, semibold);
        l.y -= 14;
      }
      if (s.caption) {
        // NIP/SIP (angka) dalam fon mono agar mudah dibaca dan dicocokkan.
        const font = /^[0-9 .-]+$/.test(s.caption) ? mono : regular;
        for (const line of wrapText(s.caption, font, 8.5, colW)) {
          l.text(line, x, 8.5, font, MUTED);
          l.y -= 12;
        }
      }
    });
    l.y = top - blockH;
  }
}

function drawFooters(l: Layout, d: ClinicalPdfContent): void {
  const { regular } = l.fonts;
  const n = l.pages.length;
  const left = [d.hospital.name, d.document.title, d.document.number ? `No. ${d.document.number}` : null]
    .filter(Boolean)
    .join(' · ');
  l.pages.forEach((page, i) => {
    page.drawLine({
      start: { x: MARGIN_X, y: FOOTER_H },
      end: { x: A4[0] - MARGIN_X, y: FOOTER_H },
      thickness: 0.75,
      color: LINE,
    });
    const right = `Halaman ${i + 1} dari ${n}`;
    const rw = regular.widthOfTextAtSize(right, 8);
    const leftText = wrapText(left, regular, 8, CONTENT_W - rw - 24)[0] ?? '';
    page.drawText(leftText, { x: MARGIN_X, y: FOOTER_H - 14, size: 8, font: regular, color: MUTED });
    page.drawText(right, {
      x: A4[0] - MARGIN_X - rw,
      y: FOOTER_H - 14,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });
}

/**
 * Render dokumen klinis menjadi PDF/A4. Input divalidasi `clinicalPdfInputSchema`; galat validasi dilempar sebagai
 * `ZodError` (data server yang salah bentuk, bukan masukan pengguna).
 */
export async function renderClinicalPdf(input: ClinicalPdfInput): Promise<Uint8Array> {
  const d = clinicalPdfInputSchema.parse(input);
  // Tanpa metadata otomatis (Producer/CreationDate/ModDate dari jam sistem).
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const embed = (name: PdfFontName) =>
    pdf.embedFont(pdfFontBytes(name), { subset: true, customName: PDF_FONT_NAMES[name] });
  const fonts: Fonts = {
    regular: await embed('regular'),
    semibold: await embed('semibold'),
    mono: await embed('mono'),
  };

  const issued = new Date(d.document.issuedAt);
  pdf.setTitle(d.document.title);
  pdf.setAuthor(d.hospital.name);
  pdf.setSubject(`${d.document.title} · RM ${d.patient.mrn}`);
  pdf.setProducer('SIM RS (pdf-lib)');
  pdf.setCreator('SIM RS');
  pdf.setLanguage('id-ID');
  pdf.setCreationDate(issued);
  pdf.setModificationDate(issued);

  const l = new Layout(pdf, fonts, d);
  l.newPage();
  drawKop(l, d);
  drawIdentity(l, d);
  for (const section of d.sections) {
    l.ensure(40);
    for (const line of wrapText(section.title, fonts.semibold, 11, CONTENT_W)) {
      l.text(line, MARGIN_X, 11, fonts.semibold, BRAND);
      l.y -= 15;
    }
    l.y -= 3;
    for (const b of section.blocks) drawBlock(l, b);
    l.y -= 6;
  }
  drawSignatures(l, d);
  drawFooters(l, d);
  // Tanpa object stream: kamus fon dan metadata terbaca langsung saat diperiksa; tetap deterministik.
  return pdf.save({ addDefaultPage: false, useObjectStreams: false });
}
