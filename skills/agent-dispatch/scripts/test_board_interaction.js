// Copy contract of the static Board: clipboard API, execCommand fallback, manual selection.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/board_interaction.js', 'utf8');
function browser({api=true, fallback=true}={}) {
  let copied='', area;
  const handlers={}, timers=[];
  const button={tagName:'BUTTON',dataset:{copy:'A1：按推荐办'},textContent:'复制推荐答复',blur(){}};
  const context={
    document:{body:{append(a){area=a;}},addEventListener:(name,fn)=>{handlers[name]=fn;},
      createElement:()=>({dataset:{},focus(){},select(){},remove(){area=null;},addEventListener(name,fn){this.onblur=fn;}}),
      execCommand(){copied=area.value;return fallback;}},
    navigator:{clipboard:api?{writeText:async t=>{copied=t;}}:undefined},
    setTimeout:fn=>timers.push(fn), setInterval:()=>{throw Error('without location the reload must stay unarmed');}};
  vm.createContext(context);vm.runInContext(source,context);
  return {button,handlers,timers,get copied(){return copied;},get area(){return area;}};
}
(async()=>{
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|EventSource|WebSocket/, 'the Board never fetches');
  assert.match(source, /location\.reload/, 'the open page re-reads itself');
  for (const [api, fallback] of [[true,true],[false,true],[false,false]]) {
    const b=browser({api,fallback});
    await b.handlers.click({target:{closest:()=>b.button}});
    if (api||fallback) {
      assert.equal(b.copied,'A1：按推荐办');assert.equal(b.button.textContent,'✓');
      b.timers.forEach(fn=>fn());assert.equal(b.button.textContent,'复制推荐答复');
    } else {
      assert.equal(b.button.textContent,'按 ⌘C 复制选中文字');assert.equal(b.area.className,'copy-area manual');
      b.area.onblur();assert.equal(b.button.textContent,'复制推荐答复');
    }
  }
  const other=browser();await other.handlers.click({target:{closest:()=>null}});assert.equal(other.copied,'');
  console.log('PASS: copy via clipboard, execCommand fallback and manual selection; reload stays in the browser');
})().catch(e=>{console.error(e);process.exitCode=1;});
