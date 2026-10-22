// Reload contract of the open Board: what the viewer opened, typed and focused survives the 5 s reload.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/board_interaction.js', 'utf8');
function page(store, path = '/boards/run.html') {
  const els = {
    'details-E2': {id: 'details-E2', tagName: 'DETAILS', open: false},
    'decision-0': {id: 'decision-0', tagName: 'DETAILS', open: true},
    note: {id: 'note', tagName: 'TEXTAREA', value: '', defaultValue: '', focus() { ctx.document.activeElement = this; }},
  };
  let tick, pagehide, reloads = 0, scrolled = 0;
  const ctx = {
    location: {pathname: path, reload: () => { reloads++; }},
    sessionStorage: {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }},
    window: {scrollY: 0, scrollTo: (_, y) => { scrolled = y; }, getSelection: () => '', addEventListener: (n, fn) => { if (n === 'pagehide') pagehide = fn; }},
    document: {
      hidden: false, body: {}, activeElement: null,
      getElementById: id => els[id] || null,
      querySelector: () => null,
      querySelectorAll: sel => Object.values(els).filter(el => sel.startsWith('details') ? el.tagName === 'DETAILS' : el.tagName !== 'DETAILS'),
      addEventListener() {},
    },
    setInterval: fn => { tick = fn; }, setTimeout() {},
  };
  ctx.document.body = {}; ctx.window.getSelection = () => '';
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return {els, ctx, tick: () => tick(), leave: () => pagehide(), get reloads() { return reloads; }, get scrolled() { return scrolled; }};
}
const store = {};
const first = page(store);
first.els['details-E2'].open = true; first.els['decision-0'].open = false;
first.els.note.value = '先别合并'; first.ctx.window.scrollY = 640;
first.ctx.document.activeElement = first.els.note;
first.tick();
assert.equal(first.reloads, 0, 'no reload while the viewer is typing');
first.ctx.document.activeElement = first.ctx.document.body;
first.tick();
assert.equal(first.reloads, 1);
const second = page(store);
assert.equal(second.els['details-E2'].open, true, 'an expanded section stays expanded');
assert.equal(second.els['decision-0'].open, false, 'a collapsed section stays collapsed');
assert.equal(second.els.note.value, '先别合并', 'typed text survives');
assert.equal(second.scrolled, 640);
second.els['details-E2'].open = false; second.leave();
assert.equal(page(store).els['details-E2'].open, false, 'leaving for a report and coming Back keeps the board as left');
const other = page(store, '/boards/other.html');
assert.equal(other.els['details-E2'].open, false, 'state is kept per board file');
console.log('PASS: open sections, typed text and scroll survive reloads and Back; typing pauses the reload');
