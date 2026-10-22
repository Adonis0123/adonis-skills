// Copy stays in this page. The reload below only re-reads this same file in the browser,
// so a person watching the board sees a new write without refreshing, and the coordinator never reads the page.
(function () {
  if (typeof location === 'undefined' || typeof location.reload !== 'function') return;
  // A reload rebuilds the page from the file, so what the viewer opened, typed or focused is saved first and put back after.
  // Only elements with an id are kept: the id is what matches them across reloads.
  var key = 'agent-dispatch-board:' + location.pathname;
  var editable = 'input[id],textarea[id]:not(.copy-area),select[id]';
  function restore() {
    var saved;
    try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) {}
    if (!saved) return;
    Object.keys(saved.open || {}).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.tagName === 'DETAILS') el.open = saved.open[id];
    });
    Object.keys(saved.values || {}).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = saved.values[id];
      else el.value = saved.values[id];
    });
    var focused = saved.focus && document.getElementById(saved.focus);
    if (focused && focused.focus) focused.focus({preventScroll: true});
    if (saved.y) window.scrollTo(0, saved.y);
  }
  function save() {
    var state = {y: window.scrollY || 0, open: {}, values: {}, focus: null};
    document.querySelectorAll('details[id]').forEach(function (el) { state.open[el.id] = el.open; });
    document.querySelectorAll(editable).forEach(function (el) {
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) state.values[el.id] = el.checked; }
      else if (el.value !== el.defaultValue) state.values[el.id] = el.value;
    });
    var active = document.activeElement;
    if (active && active.id && active !== document.body) state.focus = active.id;
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch (_) {}
  }
  function busy() {
    if (document.querySelector('textarea.copy-area')) return true;
    var active = document.activeElement;
    // Typing must never be cut off by a reload: wait until the field loses focus.
    if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return true;
    return Boolean(window.getSelection && String(window.getSelection()));
  }
  restore();
  // Opening a report in this tab and coming Back must also find the board as it was left.
  window.addEventListener('pagehide', save);
  setInterval(function () {
    if (document.hidden || busy()) return;
    save();
    location.reload();
  }, 5000);
})();
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-copy]');
  if (!button) return;
  const text = button.dataset.copy;
  const label = button.textContent;
  button.blur();
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (_) {}
  if (!copied) {
    const area = document.createElement('textarea');
    area.value = text;
    area.className = 'copy-area';
    document.body.append(area);
    area.focus(); area.select();
    try { copied = document.execCommand('copy'); } catch (_) {}
    if (copied) area.remove();
    else {
      area.className = 'copy-area manual';
      button.textContent = '按 ⌘C 复制选中文字';
      area.addEventListener('blur', () => { area.remove(); button.textContent = label; }, {once:true});
      return;
    }
  }
  button.textContent = '✓';
  setTimeout(() => { button.textContent = label; button.blur(); }, 2000);
});
