// Uji asap tanpa browser: muat inti + berkas layar, render setiap layar, jalankan setiap aksi dengan argumen contoh.
// Pakai: node cek.mjs [berkas-layar.js ...]   (tanpa argumen = semua screens-*.js)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const core = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(new URL('.', import.meta.url)).filter((f) => /^screens-.*\.js$/.test(f));

const el = () => ({ innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, focus() {}, remove() {} });
const els = {};
const document = {
  getElementById: (id) => (els[id] ??= el()),
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: el,
};
const ctx = { document, console, setTimeout: () => 0, history: { replaceState() {} }, location: { hash: '' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, scrollTo() {}, structuredClone };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(core, ctx, { filename: 'index.html#core' });
for (const f of files) {
  const path = new URL(`./${f}`, import.meta.url);
  if (!existsSync(path)) { console.log(`- lewati ${f} (belum ada)`); continue; }
  vm.runInContext(readFileSync(path, 'utf8'), ctx, { filename: f });
}
const SIM = ctx.SIM;
let fail = 0;
const toasts = [];
SIM.toast = (t) => toasts.push(t);
const check = (label, fn) => { try { fn(); } catch (e) { fail++; console.log(`✗ ${label}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); } };
for (const id of SIM.order) {
  const def = SIM.screens.get(id);
  check(`${id} render`, () => { SIM.go(id); const h = els.content.innerHTML; if (!h || h.length < 200) throw new Error('isi layar terlalu pendek'); if (/undefined|\[object Object\]|NaN/.test(h.replace(/data-[a-z-]+="[^"]*"/g, ''))) throw new Error('teks "undefined"/"[object Object]"/"NaN" di HTML'); });
  // Kumpulkan argumen yang muncul di HTML untuk tiap aksi, lalu jalankan.
  const h = els.content.innerHTML;
  for (const act of Object.keys(def.actions)) {
    const args = [...h.matchAll(new RegExp(`data-act="${act}"(?: data-arg="([^"]*)")?`, 'g'))].map((m) => m[1]);
    const runArgs = args.length ? [...new Set(args)].slice(0, 3) : [undefined];
    for (const a of runArgs) check(`${id} aksi ${act}(${a ?? ''})`, () => {
      const t = { dataset: { act, arg: a }, value: '', closest: () => null };
      const r = def.actions[act](SIM.local(id), SIM.j, t, SIM);
      if (r !== false) SIM.render();
    });
  }
  check(`${id} render ulang`, () => SIM.render());
}
// Tautan data-go harus menuju layar yang ada.
const gos = new Set();
for (const id of SIM.order) { SIM.go(id); for (const m of els.content.innerHTML.matchAll(/data-go="([^"]+)"/g)) gos.add(`${id}→${m[1]}`); }
for (const g of gos) { const to = g.split('→')[1]; if (to !== 'peta' && !SIM.screens.has(to)) console.log(`! tautan ke layar yang belum ada: ${g}`); }
console.log(`${SIM.order.length} layar diperiksa: ${SIM.order.join(', ')}`);
console.log(fail ? `GAGAL: ${fail} masalah` : 'LULUS');
process.exit(fail ? 1 : 0);
