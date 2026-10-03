# design/

- `tokens.json`, `tokens.css`: token desain Klinis Bersih (sumber untuk `packages/ui`).
- `mockups/*.dc.html`: sumber 32 layar mockup interaktif (format Design Component dari kanvas Claude).
  Berkas ini **acuan read-only** untuk Claude Code: baca markup dan blok `<script type="text/x-dc">` untuk tata letak, data contoh, dan alur interaksi.
  Berkas tidak bisa dibuka langsung di browser tanpa runtime kanvas; lihat versi hidupnya di
  https://claude.ai/artifact/68mwSh34uMk31GWyNDJfHj
- Peta layar → rute → komponen: `docs/08-desain-ui.md`.
