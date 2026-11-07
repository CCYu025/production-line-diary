// In-page full computed-style snapshot + node-side diff.
//
// takeSnap(page, { scope })       scope = CSS selector (e.g. "main"): snapshot only that subtree,
//                                 element paths are relative to the scope root.
// diffSnaps(a, b, opts)           opts.ignoreProps: string[] of CSS property names to skip
//                                 opts.ignoreRect: ignore all bounding-rect differences
//                                 opts.ignoreWidthRelated: skip width-derived props (width/height/inline-size/
//                                   block-size/min-max-*, perspective-origin, transform-origin, resolved grid
//                                   tracks, left/right/inset-inline, auto-margins) and rect x/w diffs.
//                                 opts.ignoreCustoms: skip :root custom-property diffs (use when scoped).
//                                 opts.ignoreOffsetY: (scoped snapshots) compare rect y relative to the scope root's own y, i.e. ignore
//                                   the vertical offset of the whole subtree (OS frame bar above <main>); relative layout is still compared.
//                                 opts.ignoreVertical: skip height-related diffs (rect y/h; height/block-size/min-max-height/top/bottom/inset-block/
//                                   grid-template-rows/origins). Width-related diffs (rect x/w, width props) are still reported unless ignoreWidthRelated is
//                                   also set. S4(b): the OS frame changes <main>'s height, which shifts/stretches descendants vertically; the per-element
//                                   computed styles keyed by DOM path are what is compared.
// data-fx attribute counts are recorded (snap.fx) but never counted as diffs.

export function snapExpr(scope = null) {
  return `JSON.stringify((()=>{
  const SCOPE=${JSON.stringify(scope)};
  const toggles=[...document.querySelectorAll('button[aria-pressed]')].filter(b=>/CYBER/.test(b.textContent||''));
  const excl=new Set();
  for(const toggle of toggles){ excl.add(toggle); toggle.querySelectorAll('*').forEach(e=>excl.add(e)); const p=toggle.parentElement; if(p&&p.childElementCount===1){excl.add(p);} }
  const root=SCOPE?document.querySelector(SCOPE):document.documentElement;
  if(!root) return {missingScope:true,names:[],customs:{},els:[],fx:0,url:location.href,title:document.title,theme:null,meta:null};
  const names=[]; const cs0=getComputedStyle(document.documentElement); const customs={}; for(let i=0;i<cs0.length;i++){ const n=cs0[i]; if(n.startsWith("--")) customs[n]=cs0.getPropertyValue(n); else names.push(n);}
  names.sort();
  const out=[];
  const fx=document.querySelectorAll('[data-fx]').length;
  function pathOf(el){ const parts=[]; for(let e=el;e&&e!==root.parentElement&&e!==document.documentElement;e=e.parentElement){ const par=e.parentElement; const same=par?[...par.children].filter(c=>c.tagName===e.tagName&&!excl.has(c)):[e]; parts.push(e.tagName.toLowerCase()+(same.length>1?'['+same.indexOf(e)+']':'')); } return (SCOPE?'$scope>':'html>')+parts.reverse().join('>'); }
  const all=[root,...root.querySelectorAll('*')];
  for(const el of all){
    if(excl.has(el)) continue;
    const tag=el.tagName; if(['SCRIPT','STYLE','LINK','META','TITLE','HEAD','NOSCRIPT'].includes(tag)) continue;
    const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
    const v=names.map(n=>cs.getPropertyValue(n));
    const pe={}; for(const ps of ['::before','::after']){ const pcs=getComputedStyle(el,ps); const c=pcs.getPropertyValue('content'); if(c&&c!=='none'&&c!=='normal'){ const o={}; for(const n of ['content','display','position','color','background-color','width','height','font-family','font-size','border-radius','border-top-width','opacity','animation-name']) o[n]=pcs.getPropertyValue(n); pe[ps]=o; } }
    out.push({p:pathOf(el),tag:tag.toLowerCase(),id:el.id||undefined,txt:(el.childNodes.length&&[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').slice(0,30))||undefined,r:[+r.x.toFixed(2),+r.y.toFixed(2),+r.width.toFixed(2),+r.height.toFixed(2)],v,pe,sw:el===document.documentElement?[el.scrollWidth,el.clientWidth]:undefined});
  }
  return {names,customs,els:out,fx,rootY:+root.getBoundingClientRect().y.toFixed(2),url:location.href,title:document.title,theme:document.documentElement.dataset.theme||null,meta:(document.querySelector('meta[name=color-scheme]')||{}).content||null};
})())`;
}

export async function takeSnap(p, { scope = null } = {}) {
  const len = await p.eval(`(window.__snap=${snapExpr(scope)}).length`);
  let out = '';
  for (let i = 0; i < len; i += 300000) out += await p.eval(`window.__snap.slice(${i},${i + 300000})`);
  return JSON.parse(out);
}

const WIDTH_PROP = /^(min-|max-)?(width|height|inline-size|block-size)$|^(perspective-origin|transform-origin|grid-template-columns|grid-template-rows|left|right|inset-inline-start|inset-inline-end|inset-inline|margin-left|margin-right|margin-inline-start|margin-inline-end|column-width|text-indent|offset-.*|-webkit-perspective-origin|-webkit-transform-origin)$/;

const HEIGHT_PROP = /^(min-|max-)?(height|block-size)$|^(top|bottom|inset-block-start|inset-block-end|inset-block|grid-template-rows|perspective-origin|transform-origin|-webkit-perspective-origin|-webkit-transform-origin)$/;

export function diffSnaps(a, b, { ignoreProps = [], ignoreRect = false, ignoreWidthRelated = false, ignoreCustoms = false, ignoreOffsetY = false, ignoreVertical = false } = {}) {
  const diffs = [];
  if (a.missingScope || b.missingScope) { diffs.push({ kind: 'missing-scope', a: !!a.missingScope, b: !!b.missingScope }); return diffs; }
  if (JSON.stringify(a.names) !== JSON.stringify(b.names)) diffs.push({ kind: 'propnames', a: a.names.length, b: b.names.length });
  const ca = a.customs || {}, cb = b.customs || {};
  for (const k of ignoreCustoms ? [] : Object.keys(ca)) if (ca[k] !== cb[k]) diffs.push({ kind: 'custom', k, a: ca[k], b: cb[k] });
  const extraCustoms = Object.keys(cb).filter((k) => !(k in ca));
  if (!ignoreCustoms && extraCustoms.length) diffs.push({ kind: 'custom-extra', k: extraCustoms.join(',') });
  const skip = new Set(ignoreProps);
  const mapA = new Map(a.els.map((e) => [e.p, e])), mapB = new Map(b.els.map((e) => [e.p, e]));
  for (const [p, ea] of mapA) {
    const eb = mapB.get(p);
    if (!eb) { diffs.push({ kind: 'missing-in-b', p, tag: ea.tag, txt: ea.txt }); continue; }
    if (!ignoreRect) {
      const oyA = ignoreOffsetY ? a.rootY ?? 0 : 0, oyB = ignoreOffsetY ? b.rootY ?? 0 : 0;
      const rr = ['x', 'y', 'w', 'h'].map((k, i) => [k, ea.r[i] - (i === 1 ? oyA : 0), eb.r[i] - (i === 1 ? oyB : 0)])
        .filter(([k]) => !(ignoreWidthRelated && (k === 'x' || k === 'w')))
        .filter(([k]) => !(ignoreVertical && (k === 'y' || k === 'h')))
        .filter(([, x, y]) => Math.abs(x - y) > 0.011);
      if (rr.length) diffs.push({ kind: 'rect', p, tag: ea.tag, txt: ea.txt, d: rr.map(([k, x, y]) => `${k}:${x}->${y}`).join(' ') });
    }
    const pd = [];
    for (let i = 0; i < a.names.length; i++) {
      const n = a.names[i];
      if (skip.has(n)) continue;
      if (ignoreWidthRelated && WIDTH_PROP.test(n)) continue;
      if (ignoreVertical && HEIGHT_PROP.test(n)) continue;
      if (ea.v[i] !== eb.v[i]) pd.push(`${n}: ${ea.v[i]} -> ${eb.v[i]}`);
    }
    if (pd.length) diffs.push({ kind: 'style', p, tag: ea.tag, txt: ea.txt, d: pd });
    let peA = ea.pe, peB = eb.pe;
    if (ignoreWidthRelated || ignoreVertical) {
      const strip = (pe) => Object.fromEntries(Object.entries(pe).map(([k, o]) => [k, Object.fromEntries(Object.entries(o).filter(([n]) => !((ignoreWidthRelated && (n === 'width' || n === 'height')) || (ignoreVertical && n === 'height'))))]));
      peA = strip(peA); peB = strip(peB);
    }
    if (JSON.stringify(peA) !== JSON.stringify(peB)) diffs.push({ kind: 'pseudo', p, a: ea.pe, b: eb.pe });
    if (ea.txt !== eb.txt) diffs.push({ kind: 'text', p, a: ea.txt, b: eb.txt });
  }
  for (const [p, eb] of mapB) if (!mapA.has(p)) diffs.push({ kind: 'extra-in-b', p, tag: eb.tag, txt: eb.txt });
  return diffs;
}
