const f=new Map;function k(t){let e=0;for(let s=0;s<Math.min(t.length,1e3);s++){const c=t.charCodeAt(s);e=(e<<5)-e+c,e=e&e}return`pdf_${Math.abs(e)}`}function m(t,e=1e3,s=200){if(!t)return[];const c=[],r=t.split(/\n\s*\n/);let n="",o=0,a=0;for(let h=0;h<r.length;h++){const i=r[h].trim();if(i)if(n&&n.length+i.length>e){const u=o+n.length;c.push({id:`chunk_${a++}`,text:n.trim(),start:o,end:u}),n=n.slice(-s)+`

`+i,o=u-s}else n?n+=`

`+i:(n=i,o=t.indexOf(i,o))}return n.trim()&&c.push({id:`chunk_${a++}`,text:n.trim(),start:o,end:o+n.length}),c}function g(t){return t.toLowerCase().replace(/[^\w\s]/g," ").split(/\s+/).filter(e=>e.length>2)}function w(t,e,s){const c=new Set(g(t)),r=g(e);if(c.size===0||r.length===0)return 0;const n=new Map;r.forEach(i=>{n.set(i,(n.get(i)||0)+1)});const o=new Map;s.forEach(i=>{new Set(g(i.text)).forEach(l=>{o.set(l,(o.get(l)||0)+1)})});const a=s.length;let h=0;return c.forEach(i=>{const u=(n.get(i)||0)/r.length,l=o.get(i)||1,d=Math.log(a/l);h+=u*d}),h/c.size}async function C(t,e){const s=k(t);if(f.has(s))return e?.(1),s;e?.(0);const c=m(t,1e3,200);return f.set(s,{pdfId:s,chunks:c,createdAt:Date.now()}),e?.(1),s}async function p(t,e,s=5){const c=f.get(t);return c?c.chunks.map(n=>({chunk:n,score:w(e,n.text,c.chunks)})).filter(n=>n.score>0).sort((n,o)=>o.score-n.score).slice(0,s):[]}async function D(t,e,s){const c=k(t);f.has(c)||await C(t,void 0);const r=s*4,n=Math.max(3,Math.floor(r/1e3)),o=await p(c,e,n);if(o.length===0)return t.length<=r?t:t.substring(0,r*.6)+`

[...]

`+t.substring(t.length-r*.4);let a="",h=0;for(const{chunk:i}of o){if(h>=r*.9)break;const u=i.text;if(h+u.length<=r)a&&(a+=`

---

`),a+=u,h+=u.length+10;else{const l=r-h-10;l>200&&(a&&(a+=`

---

`),a+=u.substring(0,l)+"...");break}}return a||t.substring(0,r)}function F(){f.clear()}export{m as chunkPDF,F as clearPDFIndices,D as getRAGContext,C as indexPDF,p as searchPDFChunks};
