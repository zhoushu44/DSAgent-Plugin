import{s as Re}from"./rolldown-runtime-BSJ3dJRS.js";import{a as Me}from"./vendor-react-BflrOYNF.js";import{D as Te,E as Pe,O as Q,k as Z}from"./vendor-state-routing-DFChRAiR.js";import{ar as ke,in as me,rr as z,tn as ge}from"./index-B3kRscgu.js";import{Ln as ie,Mr as De,Rn as se,_ as pe,a as we,i as ae}from"./gateway-client-BZvNv_1t.js";import{n as Oe,r as Ne}from"./platform-zuIjaMu9.js";import{Cs as qe,Hg as Le,Um as We,Vg as ye,js as ce,ks as ue,th as Be}from"./app-store-Ckqd27Cr.js";Q();const An=600*1e3,Ae=Z((e,t)=>({notice:null,dismissed:!1,lastShownAt:null,show:n=>{const r=n?.now??Date.now(),i=t();return i.dismissed||i.lastShownAt!=null&&r-i.lastShownAt<6e5?!1:(e({lastShownAt:r,notice:{visible:!0,reason:n?.reason??"not_detected",shownAt:r}}),!0)},dismiss:()=>e(n=>({dismissed:!0,notice:n.notice?{...n.notice,visible:!1}:null})),reset:()=>e({notice:null,dismissed:!1,lastShownAt:null})}));Q();const le=Z((e,t)=>({pendingWaits:[],waitForExtension:n=>new Promise((r,i)=>{e(o=>({pendingWaits:[...o.pendingWaits,{runId:n,resolve:r,reject:i}]}))}),resolveAll:()=>{const{pendingWaits:n}=t();for(const r of n)r.resolve();e({pendingWaits:[]})},rejectAll:n=>{const{pendingWaits:r}=t();for(const i of r)i.reject(n);e({pendingWaits:[]})},removeByRunId:n=>{e(r=>({pendingWaits:r.pendingWaits.filter(i=>i.runId!==n)}))}})),Ue="accio.browser.external.v1",He="accio.ext.hello";const Fe="accio.ext.cmd";var Ve=5e3,Je=3e4;function $e(){return globalThis.chrome?.runtime??null}function je(){try{return $e()?.lastError?.message}catch{return}}var Ke=class ve{port=null;seq=0;pending=new Map;eventListeners=[];disconnectListeners=[];ready=!1;constructor(t){this.extensionId=t}static async connect(t){const n=new ve(t);return await n._connect(),n}async _connect(){return new Promise((t,n)=>{let r=!1;const i=setTimeout(()=>{r||n(new Error("Extension connection timeout"))},Ve);try{const a=$e();if(!a)throw new Error("chrome.runtime is not available");this.port=a.connect(this.extensionId,{name:Ue})}catch(a){clearTimeout(i),n(new Error(`Failed to connect to extension: ${a instanceof Error?a.message:String(a)}`));return}const o=a=>{this._onPortMessage(a)};this.port.onDisconnect.addListener(()=>{const a=je();this.port=null,this.ready=!1;for(const[c,u]of this.pending)clearTimeout(u.timer),u.reject(new Error(a?`Extension port disconnected: ${a}`:"Extension port disconnected"));this.pending.clear();for(const c of this.disconnectListeners)c()});const s=a=>{const c=a;c.type==="accio.ext.helloAck"?(clearTimeout(i),r=!0,this.ready=!0,this.port?.onMessage.removeListener(s),this.port?.onMessage.addListener(o),t()):o(c)};this.port.onMessage.addListener(s),this.port.postMessage({type:He})})}_onPortMessage(t){if(t.type==="accio.ext.result"&&typeof t.id=="string"){const n=this.pending.get(t.id);if(!n)return;clearTimeout(n.timer),this.pending.delete(t.id),t.error?n.reject(new Error(String(t.error))):n.resolve(t.result)}else if(t.type==="accio.ext.event")for(const n of this.eventListeners)n(t.method,t.params)}async call(t,n){if(!this.ready||!this.port)throw new Error("ExtensionTransport not connected");const r=String(++this.seq);return new Promise((i,o)=>{const s=setTimeout(()=>{this.pending.delete(r),o(new Error(`Extension command timeout: ${t}`))},Je);this.pending.set(r,{resolve:i,reject:o,timer:s}),this.port.postMessage({type:Fe,id:r,method:t,params:n})})}onEvent(t){return this.eventListeners.push(t),()=>{this.eventListeners=this.eventListeners.filter(n=>n!==t)}}onDisconnect(t){return this.disconnectListeners.push(t),()=>{this.disconnectListeners=this.disconnectListeners.filter(n=>n!==t)}}close(){this.port?.disconnect(),this.port=null,this.ready=!1}get isConnected(){return this.ready&&this.port!==null}};const w=(e,t,n)=>JSON.stringify({ok:!0,action:e,...n?{targetId:n}:{},data:t},null,2),h=(e,t,n=!1)=>JSON.stringify({ok:!1,error:{code:e,message:t,retryable:n}});function Se(e){const t=e.trim(),n=t.startsWith("@")?t.slice(1):t.startsWith("ref=")?t.slice(4):t;return/^e\d+$/.test(n)?n:null}function q(e,t){return e.includes("element not visible")?`Element ref="${t}" is not visible. It may be hidden by CSS or off-screen.`:e.includes("zero size")?`Element ref="${t}" has zero size. It may be hidden, detached, or not rendered yet.`:e.includes("no visible viewport area")?`Element ref="${t}" has no visible area in the viewport. Try scrolling or taking a fresh snapshot.`:e.includes("not found")||e.includes("Cannot read")||e.includes("null")?`Element ref="${t}" not found in DOM. Run a new snapshot to get current page state.`:e.includes("not interactable")||e.includes("pointer-events: none")||e.includes("covered by another element")||e.includes("outside document")?`Element ref="${t}" is not interactable (hidden or covered). Try scrolling into view or re-snapshotting.`:e.includes("detached")||e.includes("no longer")?`Element ref="${t}" was removed from DOM. The page may have re-rendered — run snapshot again.`:e.includes("net::ERR_NAME_NOT_RESOLVED")?"Domain could not be resolved. Check the URL is spelled correctly.":e.includes("net::ERR_CONNECTION_REFUSED")?"Connection refused. The server may be down or blocking access.":e.includes("net::ERR_")?`Network error during navigation. Check the URL and connectivity. (${e.split(`
`)[0]})`:e}function Xe(e){return e.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n").replace(/\r/g,"")}var ze=0,G=new Map,ee=new Map;function Ge(e,t){let n=G.get(e);n||(n=new Map,G.set(e,n));let r=n.get(t);return r||(r=`e${++ze}`,n.set(t,r)),r}function Ye(e,t){ee.set(e,t)}function Ee(e,t){return ee.get(e)?.get(t)}function Qe(e){G.delete(e),ee.delete(e)}var Ze=`(function() {
  if (window.__accioMonitoring) return;
  window.__accioMonitoring = true;
  window.__accioConsole = [];
  window.__accioErrors = [];
  window.__accioRequests = [];

  // T1: Console ring buffer (100 entries)
  var methods = ['log', 'warn', 'error', 'info', 'debug'];
  methods.forEach(function(method) {
    var orig = console[method];
    console[method] = function() {
      var args = Array.prototype.slice.call(arguments);
      window.__accioConsole.push({ level: method, args: args.map(String), ts: Date.now() });
      if (window.__accioConsole.length > 100) window.__accioConsole.shift();
      orig && orig.apply(console, arguments);
    };
  });

  // T2: Error ring buffer (50 entries)
  window.addEventListener('error', function(e) {
    window.__accioErrors.push({ message: e.message, stack: e.error && e.error.stack, ts: Date.now() });
    if (window.__accioErrors.length > 50) window.__accioErrors.shift();
  });
  window.addEventListener('unhandledrejection', function(e) {
    window.__accioErrors.push({ message: String(e.reason), ts: Date.now() });
    if (window.__accioErrors.length > 50) window.__accioErrors.shift();
  });

  // T3: Network request ring buffer (200 entries) — fetch + XHR
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function() {
      var url = String(arguments[0] && (arguments[0].url || arguments[0]) || '');
      var method = (arguments[1] && arguments[1].method) || 'GET';
      var entry = { url: url, method: method.toUpperCase(), ts: Date.now(), status: null, type: 'fetch' };
      window.__accioRequests.push(entry);
      if (window.__accioRequests.length > 200) window.__accioRequests.shift();
      var p = origFetch.apply(this, arguments);
      if (p && p.then) {
        p.then(function(r) { entry.status = r && r.status; }).catch(function() { entry.status = 0; });
      }
      return p;
    };
  }
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__accioMethod = method;
    this.__accioUrl = url;
    return origOpen.apply(this, arguments);
  };
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    var entry = { url: String(this.__accioUrl || ''), method: String(this.__accioMethod || 'GET').toUpperCase(), ts: Date.now(), status: null, type: 'xhr' };
    window.__accioRequests.push(entry);
    if (window.__accioRequests.length > 200) window.__accioRequests.shift();
    this.addEventListener('loadend', function() { entry.status = this.status; }, { once: true });
    return origSend.apply(this, arguments);
  };
})()`,J=5e4;function et(e){if(e==null)return e;if(typeof e=="string")return e.length<=J?e:e.slice(0,J)+`
...[truncated, total ${e.length} chars]`;const t=JSON.stringify(e);return t.length<=J?e:Array.isArray(e)?{__truncated:!0,type:"array",length:e.length,totalChars:t.length,hint:`Result too large (${t.length} chars). Use a more specific expression to extract only the fields you need.`,sample:e.slice(0,3)}:typeof e=="object"?{__truncated:!0,type:"object",keys:Object.keys(e),totalChars:t.length,hint:`Result too large (${t.length} chars). Use a more specific expression, e.g. extract only the fields you need like: expr.fieldName`}:e}var Y=new Set;function tt(e){Y.delete(e)}async function te(e,t){Y.has(e)||(await t.call("CDP.send",{targetId:e,cdpMethod:"Runtime.evaluate",cdpParams:{expression:Ze,returnByValue:!1}}),Y.add(e))}async function nt(e,t){const n=String(e.targetId??"");if(!n)return h("missing_target","targetId is required");const r=typeof e.expression=="string"?e.expression.trim():"";if(r){const i=await t.call("CDP.send",{targetId:n,cdpMethod:"Runtime.evaluate",cdpParams:{expression:r,returnByValue:!0,awaitPromise:!0}}),o=i?.result?.value,s=i?.exceptionDetails;return s?w("console",{result:null,error:String(s?.text??s)},n):w("console",{result:et(o??null)},n)}return await te(n,t),w("console",{logs:(await t.call("CDP.send",{targetId:n,cdpMethod:"Runtime.evaluate",cdpParams:{expression:"window.__accioConsole || []",returnByValue:!0}}))?.result?.value??[]},n)}async function rt(e,t){const n=String(e.targetId??"");return n?(await te(n,t),w("errors",{errors:(await t.call("CDP.send",{targetId:n,cdpMethod:"Runtime.evaluate",cdpParams:{expression:"window.__accioErrors || []",returnByValue:!0}}))?.result?.value??[]},n)):h("missing_target","targetId is required")}async function ot(e,t){const n=String(e.targetId??"");return n?(await te(n,t),w("requests",{requests:(await t.call("CDP.send",{targetId:n,cdpMethod:"Runtime.evaluate",cdpParams:{expression:"window.__accioRequests || []",returnByValue:!0}}))?.result?.value??[]},n)):h("missing_target","targetId is required")}async function be(e,t,n=1e4){await t.call("CDP.send",{targetId:e,cdpMethod:"Runtime.evaluate",cdpParams:{expression:`new Promise(function(resolve) {
        if (document.readyState !== 'loading') return resolve(document.readyState);
        document.addEventListener('DOMContentLoaded', function() { resolve('interactive'); }, { once: true });
      })`,awaitPromise:!0,returnByValue:!0,timeout:n}})}async function it(e,t,n=15e3){await t.call("CDP.send",{targetId:e,cdpMethod:"Runtime.evaluate",cdpParams:{expression:`new Promise(function(resolve) {
        var inflight = 0;
        var idleTimer;
        function onIdle() { idleTimer = setTimeout(resolve, 500); }
        function onBusy() { clearTimeout(idleTimer); }
        // Patch fetch
        var origFetch = window.fetch;
        if (origFetch) {
          window.fetch = function() {
            inflight++; onBusy();
            var p = origFetch.apply(this, arguments);
            function done() { if (--inflight === 0) onIdle(); }
            p && p.then && p.then(done, done);
            return p;
          };
        }
        // Patch XHR
        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function() {
          inflight++; onBusy();
          this.addEventListener('loadend', function() { if (--inflight === 0) onIdle(); }, { once: true });
          return origSend.apply(this, arguments);
        };
        // Start idle timer immediately (handles pages with no in-flight requests)
        onIdle();
        // Safety timeout
        setTimeout(resolve, ${n-1e3});
      })`,awaitPromise:!0,returnByValue:!0,timeout:n}})}async function st(e,t){const n=String(e.targetId??""),r=String(e.targetUrl??e.url??""),i=String(e.waitUntil??"domcontentloaded");if(!n)return h("missing_target","targetId is required");if(!r)return h("missing_url","targetUrl is required");const o=await t.call("CDP.send",{targetId:n,cdpMethod:"Page.navigate",cdpParams:{url:r}});return await be(n,t),i==="networkidle"&&await it(n,t),Qe(n),tt(n),w("navigate",{url:r,frameId:o?.frameId,waitUntil:i},n)}async function at(e){return w("status",{connected:!0,implementation:"app",tabCount:(await e.call("Target.getTargets"))?.targetInfos?.length??0})}async function ct(e){return w("tabs",{tabs:(await e.call("Target.getTargets"))?.targetInfos??[]})}async function ut(e,t){const n=String(e.targetUrl??e.url??"about:blank"),r=!!e.retain,i=await t.call("Target.openTarget",{url:n,retain:r}),o=String(i?.targetId??i?.tabId??"");return o&&await be(o,t).catch(()=>{}),w("open",{url:n,targetId:o,tabs:(await t.call("Target.getTargets"))?.targetInfos??[]},o)}async function lt(e,t){const n=String(e.targetId??"");return n?(await t.call("Target.activateTarget",{targetId:n}),w("focus",{targetId:n},n)):h("missing_target","targetId is required")}async function dt(e,t){const n=String(e.targetId??"");return n?(await t.call("Target.closeTarget",{targetId:n}),w("close",{targetId:n})):h("missing_target","targetId is required")}var ft=new Set(["button","link","textbox","searchbox","combobox","checkbox","radio","listbox","menuitem","option","tab","slider","spinbutton","switch","treeitem","menuitemcheckbox","menuitemradio","columnheader"]),ht=new Set(["RootWebArea","document","main","navigation","banner","contentinfo","region","list","listitem","group","article","section","complementary","form","paragraph"]),mt=new Set(["none","presentation","InlineTextBox"]),gt={RootWebArea:"document",StaticText:"text",generic:"text"},pt=new Set(["heading","listitem","row","treeitem"]),wt=new Set(["button"]),yt=new Set(["gridcell","menuitemcheckbox","menuitemradio","option","row","tab","treeitem"]),$t=new Set(["textbox","searchbox","combobox"]);async function vt(e,t){const n=String(e.targetId??"");if(!n)return h("missing_target","targetId is required");const[r,i]=await Promise.all([t.call("CDP.send",{targetId:n,cdpMethod:"Accessibility.getFullAXTree",cdpParams:{}}),t.call("CDP.send",{targetId:n,cdpMethod:"Runtime.evaluate",cdpParams:{expression:"location.href",returnByValue:!0}})]),o=r?.nodes??[],s=i?.result?.value??"",{text:a,refs:c}=St(o,n);Ye(n,c);const u=c.size,p=a==="(empty)"?0:a.split(`
`).length,l=u>=5?"rich":u>=1?"sparse":"empty";let m="";l==="empty"?m=`
[AX tree quality: empty — no interactive elements detected (interactable=0, lines=${p}). This page likely uses shadow DOM or custom elements. Recommended strategy: use console(expression=...) for DOM inspection (e.g. document.querySelectorAll("...").length), or screenshot to visually locate elements, then act with CSS selector instead of ref.]`:l==="sparse"&&(m=`
[AX tree quality: sparse — only ${u} interactive element(s) found. Some elements may not be exposed via accessibility tree. Consider console(expression=...) or screenshot if act(ref=...) fails.]`);const g=JSON.stringify({url:s,targetId:n,axQuality:l,interactableCount:u});return w("snapshot",{snapshot:`${a}${m}
---
${g}`},n)}function St(e,t){if(!e.length)return{text:"(empty)",refs:new Map};const n=new Map;for(const a of e)n.set(a.nodeId,a);const r=e.filter(a=>!a.parentId||!n.has(a.parentId)),i=new Map,o=[];function s(a,c){const u=n.get(a);if(!u||u.ignored)return;const p=String(u.role?.value??""),l=String(u.name?.value??"").trim();if(mt.has(p)){for(const $ of u.childIds??[])s($,c);return}const m=gt[p]??p.toLowerCase();if(!l&&!ht.has(p)){for(const $ of u.childIds??[])s($,c);return}let g;ft.has(p)&&u.backendDOMNodeId&&(g=Ge(t,u.backendDOMNodeId),i.set(g,u.backendDOMNodeId));const y=[],_=$=>u.properties?.find(R=>R.name===$)?.value?.value,E=_("url");E&&y.push(`href="${E}"`);const I=_("checked");I!==void 0&&y.push(`checked=${I}`),_("disabled")&&y.push("disabled");const k=_("expanded");if(k!==void 0&&y.push(`expanded=${k}`),pt.has(p)){const $=_("level");$!==void 0&&y.push(`level=${$}`)}if(wt.has(p)){const $=_("pressed");$!==void 0&&y.push(`pressed=${$}`)}if(yt.has(p)){const $=_("selected");$!==void 0&&y.push(`selected=${$}`)}if($t.has(p)){const $=_("placeholder");$&&$!==l&&y.push(`placeholder="${$}"`)}const B=y.length?" "+y.join(" "):"",N=l?` "${Xe(l)}"`:"",C=g?` [ref=${g}]`:"",x="  ".repeat(c);o.push(`${x}- ${m}${N}${B}${C}`);for(const $ of u.childIds??[])s($,c+1)}for(const a of r)s(a.nodeId,0);return{text:o.join(`
`)||"(empty)",refs:i}}We();const Et=15e3;function ne(e,t="evaluate error"){return String(e.exception?.description??e.text??t)}function bt(e){return`(async () => { ${e} })()`}async function _e(e,t,n){const r=bt(t),i=await n.call("CDP.send",{targetId:e,cdpMethod:"Runtime.compileScript",cdpParams:{expression:r,sourceURL:"browser-act-evaluate.js",persistScript:!1}});return i.exceptionDetails?Be(new SyntaxError(ne(i.exceptionDetails))).message:await n.call("CDP.send",{targetId:e,cdpMethod:"Runtime.evaluate",cdpParams:{expression:r,returnByValue:!0,awaitPromise:!0}})}function _t(e=Et){return`function() {
    var el = this;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return new Promise(function(resolve, reject) {
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility())
        return reject(new Error('element not visible'));
      function getViewportSize() {
        var doc = typeof document !== 'undefined' ? document : null;
        var docEl = doc && doc.documentElement ? doc.documentElement : null;
        return {
          width:
            (typeof window !== 'undefined' && window.innerWidth) ||
            (docEl && docEl.clientWidth) ||
            0,
          height:
            (typeof window !== 'undefined' && window.innerHeight) ||
            (docEl && docEl.clientHeight) ||
            0,
        };
      }
      function isHitWithinElement(hit) {
        var node = hit;
        while (node) {
          if (node === el) return true;
          node = node.parentNode || node.host || null;
        }
        return false;
      }
      function getClickablePointResult() {
        var style =
          typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        if (style) {
          if (style.display === 'none' || style.visibility !== 'visible')
            return { error: 'element not visible' };
          if (style.pointerEvents === 'none')
            return { error: 'element not interactable (pointer-events: none)' };
        }
        if (typeof el.checkVisibility === 'function' && !el.checkVisibility())
          return { error: 'element not visible' };
        var r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0)
          return { error: 'element has zero size after stability wait' };
        var viewport = getViewportSize();
        var left = Math.max(r.left, 0);
        var right = Math.min(r.right, viewport.width);
        var top = Math.max(r.top, 0);
        var bottom = Math.min(r.bottom, viewport.height);
        if (right <= left || bottom <= top)
          return { error: 'element has no visible viewport area' };
        var point = {
          x: Math.round((left + right) / 2),
          y: Math.round((top + bottom) / 2),
        };
        var doc = typeof document !== 'undefined' ? document : null;
        if (doc && typeof doc.elementFromPoint === 'function') {
          var hit = doc.elementFromPoint(point.x, point.y);
          if (!hit)
            return { error: 'element clickable point is outside document' };
          if (!isHitWithinElement(hit))
            return { error: 'element is covered by another element' };
        }
        return { point: point };
      }
      function settle() {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        var result = getClickablePointResult();
        if (result.error) return reject(new Error(result.error));
        return resolve(result.point);
      }
      var settled = false;
      var timeout = setTimeout(settle, ${e});
      var lastRect = '', stable = 0, maxFrames = 40;
      var raf =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : function(cb) {
              return setTimeout(cb, 16);
            };
      function check() {
        if (settled) return;
        if (--maxFrames <= 0) {
          return settle();
        }
        var r = el.getBoundingClientRect();
        var key = r.x + ',' + r.y + ',' + r.width + ',' + r.height;
        if (key === lastRect) {
          stable += 1;
          if (stable >= 3) return settle();
        } else {
          stable = 0;
          lastRect = key;
        }
        raf(check);
      }
      raf(check);
    });
  }`}async function xt(e,t){const n=String(e.targetId??"");if(!n)return h("missing_target","targetId is required");const r=e.request;if(!r?.kind)return h("missing_request","request.kind is required");const i=String(r.kind),o=String(r.ref??r.selector??""),s=String(r.text??""),a=!!r.clearFirst,c=Se(o);if(c){const u=Ee(n,c);return u?It(n,u,i,s,a,o,t):h("ref_not_found",`ref "${o}" not found. The page may have navigated or changed. Call browser_snapshot first to get fresh element refs, then retry act.`)}return Ct(n,o,i,s,a,t)}async function It(e,t,n,r,i,o,s){if(n==="wait"){const l=Math.min(Number(r)||1e3,3e4);return new Promise(m=>setTimeout(()=>m(w("act",{kind:n,ref:o,done:!0},e)),l))}const a=(await s.call("CDP.send",{targetId:e,cdpMethod:"DOM.resolveNode",cdpParams:{backendNodeId:t}}))?.object?.objectId;if(!a)return h("element_gone",`Element ref="${o}" no longer exists in DOM`);if(n==="click"){const l=await s.call("CDP.send",{targetId:e,cdpMethod:"Runtime.callFunctionOn",cdpParams:{objectId:a,functionDeclaration:_t(),awaitPromise:!0,returnByValue:!0}});if(l?.exceptionDetails)return h("act_failed",q(String(l.exceptionDetails?.exception?.description??"pre-check error"),o));const m=l?.result?.value;if(!m)return h("act_failed",`Could not determine click coordinates for ref="${o}"`);for(const[g,y,_]of[["mouseMoved",0,0],["mousePressed",1,1],["mouseReleased",0,1]])await s.call("CDP.send",{targetId:e,cdpMethod:"Input.dispatchMouseEvent",cdpParams:{type:g,x:m.x,y:m.y,button:"left",buttons:y,clickCount:_}});return w("act",{kind:n,ref:o,done:!0,coords:m},e)}const c=await s.call("CDP.send",{targetId:e,cdpMethod:"Runtime.callFunctionOn",cdpParams:{objectId:a,functionDeclaration:`function() {
        this.scrollIntoView({ block: 'center', inline: 'nearest' });
        if (typeof this.checkVisibility === 'function' && !this.checkVisibility())
          throw new Error('element not visible');
      }`,awaitPromise:!1}});if(c?.exceptionDetails)return h("act_failed",q(String(c.exceptionDetails?.exception?.description??"pre-check error"),o));let u;switch(n){case"type":if(/[^\x00-\x7F]/.test(r)){const l=await s.call("CDP.send",{targetId:e,cdpMethod:"Runtime.callFunctionOn",cdpParams:{objectId:a,functionDeclaration:`function() {
              this.focus();
              if (${i}) {
                this.value = '';
                this.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }`}});return l?.exceptionDetails?h("act_failed",q(String(l.exceptionDetails?.exception?.description??"focus error"),o)):(await s.call("CDP.send",{targetId:e,cdpMethod:"Input.insertText",cdpParams:{text:r}}),w("act",{kind:n,ref:o,done:!0},e))}u=`function() {
        this.focus();
        if (${i}) { this.value = ''; this.textContent = ''; }
        this.value = ${JSON.stringify(r)};
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`;break;case"hover":u=`function() {
        this.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        this.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      }`;break;case"select":u=`function() {
        this.focus();
        var opts = Array.from(this.options || []);
        var opt = opts.find(function(o) {
          return o.value === ${JSON.stringify(r)} || o.text.trim() === ${JSON.stringify(r)};
        });
        if (!opt) throw new Error('Option not found: ' + ${JSON.stringify(r)});
        this.value = opt.value;
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`;break;case"press":await s.call("CDP.send",{targetId:e,cdpMethod:"Runtime.callFunctionOn",cdpParams:{objectId:a,functionDeclaration:"function() { this.focus(); }"}});for(const l of["keyDown","keyUp"])await s.call("CDP.send",{targetId:e,cdpMethod:"Input.dispatchKeyEvent",cdpParams:{type:l,key:r,text:r.length===1?r:""}});return w("act",{kind:n,ref:o,key:r,done:!0},e);case"scrollIntoView":u=`function() {
        this.scrollIntoView({ block: 'center', inline: 'nearest' });
      }`;break;case"fill":u=`function() {
        this.focus();
        this.value = ${JSON.stringify(r)};
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`;break;case"evaluate":{const l=await _e(e,r,s);return typeof l=="string"?h("act_failed",l):l.exceptionDetails?h("act_failed",ne(l.exceptionDetails)):w("act",{kind:n,ref:o,result:l.result?.value??null,done:!0},e)}case"close":return await s.call("Target.closeTarget",{targetId:e}),w("act",{kind:n,ref:o,done:!0},e);default:return h("unsupported_act",`act.kind '${n}' not supported in app backend`)}const p=await s.call("CDP.send",{targetId:e,cdpMethod:"Runtime.callFunctionOn",cdpParams:{objectId:a,functionDeclaration:u}});return p.exceptionDetails?h("act_failed",q(String(p.exceptionDetails.exception?.description??"Runtime error"),o)):w("act",{kind:n,ref:o,done:!0},e)}async function Ct(e,t,n,r,i,o){if(n==="wait"){const c=Math.min(Number(r)||1e3,3e4);return new Promise(u=>setTimeout(()=>u(w("act",{kind:n,ref:t,done:!0},e)),c))}if(n==="press"){await o.call("CDP.send",{targetId:e,cdpMethod:"Runtime.evaluate",cdpParams:{expression:`(function() {
          var el = document.querySelector(${JSON.stringify(t)});
          if (el) el.focus();
        })()`}});for(const c of["keyDown","keyUp"])await o.call("CDP.send",{targetId:e,cdpMethod:"Input.dispatchKeyEvent",cdpParams:{type:c,key:r,text:r.length===1?r:""}});return w("act",{kind:n,ref:t,key:r,done:!0},e)}let s;switch(n){case"click":s=`(function() {
        var el = document.querySelector(${JSON.stringify(t)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(t)});
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.click(); return true;
      })()`;break;case"type":s=`(function() {
        var el = document.querySelector(${JSON.stringify(t)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(t)});
        if (${i}) { el.value = ''; el.textContent = ''; }
        el.focus();
        el.value = ${JSON.stringify(r)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`;break;case"hover":s=`(function() {
        var el = document.querySelector(${JSON.stringify(t)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(t)});
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        return true;
      })()`;break;case"select":s=`(function() {
        var el = document.querySelector(${JSON.stringify(t)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(t)});
        var opts = Array.from(el.options || []);
        var opt = opts.find(function(o) {
          return o.value === ${JSON.stringify(r)} || o.text.trim() === ${JSON.stringify(r)};
        });
        if (!opt) throw new Error('Option not found: ' + ${JSON.stringify(r)});
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`;break;case"scrollIntoView":s=`(function() {
        var el = document.querySelector(${JSON.stringify(t)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(t)});
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        return true;
      })()`;break;case"fill":s=`(function() {
        var el = document.querySelector(${JSON.stringify(t)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(t)});
        el.focus();
        el.value = ${JSON.stringify(r)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`;break;case"evaluate":{const c=await _e(e,r,o);return typeof c=="string"?h("act_failed",c):c.exceptionDetails?h("act_failed",ne(c.exceptionDetails)):w("act",{kind:n,ref:t,result:c.result?.value??null,done:!0},e)}case"close":return await o.call("Target.closeTarget",{targetId:e}),w("act",{kind:n,ref:t,done:!0},e);default:return h("unsupported_act",`act.kind '${n}' not supported in app backend`)}const a=await o.call("CDP.send",{targetId:e,cdpMethod:"Runtime.evaluate",cdpParams:{expression:s,returnByValue:!0,awaitPromise:!1}});return a.exceptionDetails?h("act_failed",q(String(a.exceptionDetails.exception?.description??"Runtime error"),t)):w("act",{kind:n,ref:t,done:!0},e)}async function Rt(e,t){const n=(await t.call("CDP.send",{targetId:e,cdpMethod:"Runtime.evaluate",cdpParams:{expression:`({
        width: Math.max(
          document.body.scrollWidth, document.documentElement.scrollWidth,
          document.body.offsetWidth,  document.documentElement.offsetWidth,
          document.body.clientWidth,  document.documentElement.clientWidth
        ),
        height: Math.max(
          document.body.scrollHeight, document.documentElement.scrollHeight,
          document.body.offsetHeight,  document.documentElement.offsetHeight,
          document.body.clientHeight,  document.documentElement.clientHeight
        )
      })`,returnByValue:!0}}))?.result?.value;return{width:n?.width??1280,height:n?.height??720}}async function Mt(e,t){const n=String(e.targetId??"");if(!n)return h("missing_target","targetId is required");const r=!!e.fullPage;let i;const o=1280,s=900;if(r){const c=await Rt(n,t),u=Math.min(1,o/c.width,s/c.height);i={format:"jpeg",quality:72,captureBeyondViewport:!0,clip:{x:0,y:0,width:c.width,height:c.height,scale:u}}}else{const c=await t.call("CDP.send",{targetId:n,cdpMethod:"Runtime.evaluate",cdpParams:{expression:"({ w: window.innerWidth, h: window.innerHeight })",returnByValue:!0}}),u=c?.result?.value?.w??o,p=c?.result?.value?.h??s;i={format:"jpeg",quality:72,clip:{x:0,y:0,width:u,height:p,scale:Math.min(1,o/u,s/p)}}}const a=await t.call("CDP.send",{targetId:n,cdpMethod:"Page.captureScreenshot",cdpParams:i});return a?.data?w("screenshot",{type:"base64",data:a.data,mimeType:"image/jpeg",fullPage:r},n):h("screenshot_failed","No screenshot data returned")}async function Tt(e,t){const n=String(e.targetId??"");if(!n)return h("missing_target","targetId is required");const r=String(e.scrollDirection??"down"),i=Number(e.scrollAmount??0);let o;if(r==="top")o="(function(){ window.scrollTo(0,0); return [window.scrollY, document.documentElement.scrollHeight, window.innerHeight] })()";else if(r==="bottom")o="(function(){ window.scrollTo(0,document.documentElement.scrollHeight); return [window.scrollY, document.documentElement.scrollHeight, window.innerHeight] })()";else{const u=r==="up"?-1:1;o=`(function(){ window.scrollBy(0, ${i?String(u*i):`Math.round(window.innerHeight * 0.75) * ${u}`}); return [window.scrollY, document.documentElement.scrollHeight, window.innerHeight] })()`}const[s=0,a=0,c=0]=(await t.call("CDP.send",{targetId:n,cdpMethod:"Runtime.evaluate",cdpParams:{expression:o,returnByValue:!0}}))?.result?.value??[];return w("scroll",{scrollY:s,scrollHeight:a,viewportHeight:c,atTop:s<=0,atBottom:s+c>=a-1,scrollPercentage:Math.round(s/Math.max(1,a-c)*100)},n)}async function Pt(e,t){const n=String(e.targetId??""),r=String(e.selector??""),i=Math.min(Number(e.timeout??1e4),3e4);if(!n)return h("missing_target","targetId is required");if(!r)return h("missing_selector","selector is required");const o=await t.call("CDP.send",{targetId:n,cdpMethod:"Runtime.evaluate",cdpParams:{expression:`new Promise(function(resolve, reject) {
        var sel = ${JSON.stringify(r)};
        var el = document.querySelector(sel);
        if (el) return resolve(true);
        var timer = setTimeout(function() {
          observer.disconnect();
          reject(new Error('waitFor timeout: "' + sel + '" not found within ${i}ms'));
        }, ${i});
        var observer = new MutationObserver(function() {
          if (document.querySelector(sel)) {
            clearTimeout(timer);
            observer.disconnect();
            resolve(true);
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      })`,awaitPromise:!0,returnByValue:!0,timeout:i+2e3}});return o?.exceptionDetails?h("waitfor_timeout",String(o.exceptionDetails?.exception?.description??"waitFor failed")):w("waitFor",{selector:r,found:!0},n)}async function kt(e,t){const n=String(e.targetId??"");if(!n)return h("missing_target","targetId is required");const r=String(e.sourceRef??e.ref??"");if(!r)return h("missing_source","sourceRef is required");const i=await de(n,r,t);if("error"in i)return i.error;let o,s;const a=String(e.targetRef??"");if(a){const g=await de(n,a,t);if("error"in g)return g.error;o=g.x,s=g.y}else if(o=Number(e.targetX??0),s=Number(e.targetY??0),!o&&!s)return h("missing_target_coords","targetRef or targetX/Y required");const{x:c,y:u}=i,p=Math.round((c+o)/2),l=Math.round((u+s)/2),m=[["mouseMoved",c,u,0,0],["mousePressed",c,u,1,1],["mouseMoved",p,l,1,0],["mouseMoved",o,s,1,0],["mouseReleased",o,s,0,1]];for(const[g,y,_,E,I]of m)await t.call("CDP.send",{targetId:n,cdpMethod:"Input.dispatchMouseEvent",cdpParams:{type:g,x:y,y:_,button:"left",buttons:E,clickCount:I}}),g==="mousePressed"&&await new Promise(k=>setTimeout(k,60));return w("drag",{from:{x:c,y:u},to:{x:o,y:s},done:!0},n)}async function de(e,t,n){const r=Se(t);if(r){const o=Ee(e,r);if(!o)return{error:h("ref_not_found",`ref "${t}" not found in last snapshot`)};const s=(await n.call("CDP.send",{targetId:e,cdpMethod:"DOM.resolveNode",cdpParams:{backendNodeId:o}}))?.object?.objectId;if(!s)return{error:h("element_gone",`Element ref="${t}" no longer exists in DOM`)};const a=(await n.call("CDP.send",{targetId:e,cdpMethod:"Runtime.callFunctionOn",cdpParams:{objectId:s,functionDeclaration:`function() {
          var r = this.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }`,returnByValue:!0}}))?.result?.value;return a||{error:h("coords_failed",`Could not get coordinates for ref="${t}"`)}}const i=(await n.call("CDP.send",{targetId:e,cdpMethod:"Runtime.evaluate",cdpParams:{expression:`(function() {
        var el = document.querySelector(${JSON.stringify(t)});
        if (!el) return null;
        var r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`,returnByValue:!0}}))?.result?.value;return i||{error:h("element_not_found",`Selector "${t}" not found`)}}async function Dt(e,t,n){switch(e){case"status":return at(n);case"tabs":return ct(n);case"open":return ut(t,n);case"focus":return lt(t,n);case"close":return dt(t,n);case"navigate":return st(t,n);case"snapshot":return vt(t,n);case"screenshot":return Mt(t,n);case"scroll":return Tt(t,n);case"act":return xt(t,n);case"console":return nt(t,n);case"errors":return rt(t,n);case"requests":return ot(t,n);case"waitFor":return Pt(t,n);case"drag":return kt(t,n);default:return h("unsupported_action",`Action '${e}' is not supported by app backend`,!1)}}me();pe();De();var v=ge("browser-runtime"),S="[AppBrowser]",Ot=120;function fe(e,t=Ot){return e?e.length>t?`${e.slice(0,t)}...`:e:""}function Nt(e){return Object.keys(e).sort().join(",")}function qt(e){if(!(!(e instanceof Error)||!("code"in e)))return String(e.code??"").trim()||void 0}var Lt=class{transport=null;connecting=!1;config=null;init(e){(!this.config||this.config.extensionId!==e.extensionId||this.config.gatewayBaseUrl!==e.gatewayBaseUrl)&&v.info(`${S} [runtime] init extensionId=${e.extensionId} gatewayBaseUrl=${e.gatewayBaseUrl}`),this.config=e}async executeAction(e){const{runId:t,toolCallId:n,sessionKey:r,requestId:i,action:o,params:s,timeoutMs:a}=e;if(!this.config)throw v.warn(`${S} [runtime] not initialized runId=${t}`),new Error("AppBrowserRuntime not initialized");const c=Date.now();v.info(`${S} [runtime] execute start runId=${t} requestId=${i||"empty"} toolCallId=${n||"empty"} sessionKey=${r||"empty"} action=${o} timeoutMs=${a} paramKeys=${Nt(s)||"none"}`),v.info(`${S} [runtime] ensureConnected start runId=${t} extensionId=${this.config.extensionId}`);const u=await this._ensureConnected();v.info(`${S} [runtime] ensureConnected done runId=${t} connected=${u.isConnected}`),v.info(`${S} [runtime] execute bridge runId=${t} action=${o}`);try{const p=await Promise.race([Dt(o,s,u),new Promise((m,g)=>setTimeout(()=>g(new Error(`action timeout after ${a}ms`)),a))]),l=Date.now()-c;return v.info(`${S} [runtime] execute success runId=${t} action=${o} durationMs=${l} resultLength=${p.length} resultPreview=${fe(p)||"empty"}`),p}catch(p){const l=Date.now()-c,m=p instanceof Error?p.message:String(p),g=qt(p);throw v.warn(`${S} [runtime] execute failed runId=${t} action=${o} durationMs=${l} errorCode=${g??"none"} error=${m}`),p}}async handleRunRequest(e){const{runId:t,action:n}=e;try{const r=await this.executeAction(e);v.info(`${S} [runtime] handleRunRequest success runId=${t} action=${n}`),await this.reportComplete(t,r)}catch(r){const i=r instanceof Error?r.message:String(r);v.warn(`${S} [runtime] handleRunRequest failed runId=${t} action=${n} error=${i}`),await this.reportFail(t,i)}}async reportComplete(e,t){if(!this.config){v.warn(`${S} [runtime] skip legacy HTTP complete report runId=${e} reason=config-missing`);return}try{v.info(`${S} [runtime] legacy HTTP complete runId=${e} resultLength=${t.length} resultPreview=${fe(t)||"empty"} route=${ie.path}`),await ae.request(ie,{body:{runId:e,result:t}}),v.info(`${S} [runtime] legacy HTTP complete done runId=${e}`)}catch(n){v.error(`${S} [runtime] failed to report complete for runId=${e}:`,n)}}async reportFail(e,t){if(!this.config){v.warn(`${S} [runtime] skip legacy HTTP fail report runId=${e} reason=config-missing`);return}try{v.warn(`${S} [runtime] legacy HTTP fail runId=${e} error=${t} route=${se.path}`),await ae.request(se,{body:{runId:e,error:t}}),v.warn(`${S} [runtime] legacy HTTP fail done runId=${e}`)}catch(n){v.error(`${S} [runtime] failed to report fail for runId=${e}:`,n)}}async _ensureConnected(){if(!this.config)throw v.warn(`${S} [runtime] ensureConnected called without config`),new Error("AppBrowserRuntime not initialized");if(this.transport?.isConnected)return v.info(`${S} [runtime] transport already connected, reusing existing transport`),this.transport;if(this.connecting){v.info(`${S} [runtime] connection already in progress, waiting for in-flight connect`),await new Promise(t=>setTimeout(t,100));const e=this.transport?.isConnected??!1;if(v.info(`${S} [runtime] wait over connected=${e}`),this.transport?.isConnected)return this.transport}this.connecting=!0;try{const{extensionId:e}=this.config;return v.info(`${S} [runtime] connecting to extension extensionId=${e}`),this.transport=await Ke.connect(e),this.transport.onDisconnect(()=>{v.warn(`${S} [runtime] extension disconnected`),this.transport=null,this.config?.onDisconnect?.()}),v.info(`${S} [runtime] extension connected successfully extensionId=${e}`),this.transport}finally{this.connecting=!1}}get isConnected(){return this.transport?.isConnected??!1}disconnect(){v.info(`${S} [runtime] disconnecting`),this.transport?.close(),this.transport=null}};const he=new Lt;var Wt=Re(Me(),1);Q();Pe();Oe();qe();pe();Le();ke();me();var d=ge("browser-tool-ws"),f="[AppBrowserWS]",re=6e5,Bt="accio.extension.ready",At="accio.extension.status",Ut=120,F="browser-tool-app",Ht=300*1e3;function xe(e,t=Ut){return e?e.length>t?`${e.slice(0,t)}...`:e:""}function oe(e){return e?Object.keys(e).sort().join(","):""}function O(e){return F}function W(){return F}function Ft(e){if(!(!(e instanceof Error)||!("code"in e)))return String(e.code??"").trim()||void 0}function j(e){if(Ie("browser_tool.complete",e.success?`runId=${e.runId} success=true resultLength=${e.result?.length??0} resultPreview=${e.result?xe(e.result):"empty"}`:`runId=${e.runId} success=false errorCode=${e.errorCode??"none"} error=${e.error??"none"}`),!b||b.readyState!==WebSocket.OPEN){Ce("browser_tool.complete",b?.readyState);return}b.send(JSON.stringify({type:"browser_tool.complete",data:e}))}function Vt(e){const t=oe(e.params);d.info(`${f} run requested runId=${e.runId??"missing"} toolCallId=${e.toolCallId??"missing"} sessionKey=${e.sessionKey??"missing"} action=${e.action??"missing"} timeoutMs=${e.timeoutMs??re} paramKeys=${t||"none"}`)}function Jt(e,t){d.info(`${f} waiting extensionId runId=${e} action=${t}`)}function jt(e,t){d.info(`${f} extensionId resolved runId=${e} connected=${!!t} extensionId=${t??"null"}`)}function Ie(e,t){d.info(`${f} → send type=${e} clientId=${W()}${t?` ${t}`:""}`)}function Kt(e,t){d.info(`${f} ← recv type=${e} clientId=${W()}${t?` ${t}`:""}`)}function Xt(e,t,n){d.info(`${f} connect attempt clientId=${O(e)} sessionKey=${e} gatewayBaseUrl=${t} wsUrl=${n}`)}function zt(e,t,n){d.info(`${f} reuse socket clientId=${O(e)} sessionKey=${e} wsUrl=${t} readyState=${n}`)}function Gt(e){d.info(`${f} execute start runId=${e.runId} toolCallId=${e.toolCallId??"missing"} sessionKey=${e.sessionKey??"missing"} action=${e.action} timeoutMs=${e.timeoutMs??re} paramKeys=${oe(e.params)||"none"}`)}function Yt(e,t,n,r){d.warn(`${f} execute failed runId=${e} action=${t} errorCode=${r??"none"} error=${n}`)}function Qt(e,t,n){d.info(`${f} execute success runId=${e} action=${t} resultLength=${n.length} resultPreview=${xe(n)||"empty"}`)}function Zt(e,t,n){d.info(`${f} runtime init runId=${e} extensionId=${t} gatewayBaseUrl=${n}`)}function en(e,t){d.info(`${f} skip platform.type=${e} reason=${t}`)}function tn(e,t){d.info(`${f} hook mounted platform=${t} consumers=${e}`)}function nn(e){d.info(`${f} hook unmount consumers=${e}`)}function rn(){d.info(`${f} init browser tool ws`)}function on(e){d.warn(`${f} failed to init browser tool ws`,e)}function sn(e){const t=e instanceof Error?e.message:String(e);return t.includes("ExtensionTransport not connected")||t.includes("Extension connection timeout")||t.includes("Failed to connect to extension")||t.includes("extension is not connected")||t.includes("no extensionId")}function an(e){d.info(`${f} gateway info resolved gatewayBaseUrl=${e}`)}function cn(){d.info(`${f} ping received, replying pong`)}function Ce(e,t){d.warn(`${f} socket not open, skip send type=${e} readyState=${t??-1} clientId=${W()}`)}function un(e){d.warn(`${f} invalid ws message`,e)}function ln(e){d.warn(`${f} missing run payload fields`,e)}function dn(){d.info(`${f} extension disconnected, clearing extensionId cache`)}function fn(e,t){d.warn(`${f} socket error wsUrl=${e} clientId=${W()}`,t)}function hn(e,t,n){d.info(`${f} socket close clientId=${O(e)} sessionKey=${e} wsUrl=${t} code=${n}`)}function mn(e,t){d.info(`${f} closing stale socket clientId=${O(e)} sessionKey=${e} wsUrl=${t??"null"}`)}function gn(){d.info(`${f} closing shared socket`)}function pn(e){d.warn(`${f} no extensionId runId=${e}`)}function wn(e){d.warn(`${f} extensionId not received within ${e}ms — extension may not be installed, page may need refresh, or origin=${window.location.origin} is not in content_scripts matches`)}function yn(e){d.info(`${f} received extensionId from content script: ${e??"null"}`)}function $n(){d.info(`${f} requesting extensionId via window.postMessage`)}function vn(e,t,n){d.info(`${f} ensureSocket sessionKey=${e} clientId=${O(e)} gatewayBaseUrl=${t} wsUrl=${n}`)}function Sn(e,t,n){d.info(`${f} socket connected clientId=${O(e)} sessionKey=${e} wsUrl=${t} readyState=${n}`)}function K(e,t){d.warn(`${f} failed to send browser_tool.complete runId=${e}`,t)}var En=e=>({readyState:e.readyState,status:e.status,extensionDetected:e.extensionDetected}),L=Z(e=>({readyState:WebSocket.CLOSED,status:"idle",extensionDetected:null,setReadyState:t=>e({readyState:t}),setStatus:t=>e({status:t}),setExtensionDetected:t=>e({extensionDetected:t})})),b=null,A=null,X=0,T=0,M=null,D=null,U=new Map;function bn(e,t){const n=(U.get(e)??Promise.resolve()).then(t).catch(()=>{});U.set(e,n),n.then(()=>{U.get(e)===n&&U.delete(e)})}function P(e,t){L.getState().setStatus(e),L.getState().setReadyState(t)}function Un(e){const t=Te(En);return L(e??t)}function _n(e,t){const n=F;let r;return e.startsWith("http://")?r=`ws://${e.slice(7)}`:e.startsWith("https://")?r=`wss://${e.slice(8)}`:e.startsWith("/")?r=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}${e}`:r=e.replace(/\/$/,""),`${r}/websocket/connect?clientId=${n}`}function xn(e){const t=F;return`${e.replace(/\/websocket\/connect\/?$/,"").replace(/\/$/,"")}/websocket/connect?clientId=${t}`}function In(e){if(!b||b.readyState!==WebSocket.OPEN){Ce(e.type,b?.readyState);return}Ie(e.type),b.send(JSON.stringify(e))}function Cn(){try{const e=window.location.search||"",t=window.location.hash||"",n=new URLSearchParams(e),r=t.includes("?")?t.slice(t.indexOf("?")+1):"",i=new URLSearchParams(r);return n.get("sessionKey")||i.get("sessionKey")||window.localStorage.getItem("phoenix.activeSessionKey")||""}catch{return""}}function Rn(e=3e3){return M?Promise.resolve(M):D||(D=new Promise(t=>{const n=o=>{M=o?.extensionId.trim()?o:null,L.getState().setExtensionDetected(!!M),D=null,t(M)},r=window.setTimeout(()=>{window.removeEventListener("message",i),wn(e),n(null)},e),i=o=>{const s=o.data;if(o.source!==window||s?.type!==Bt)return;yn(s.extensionId),window.clearTimeout(r),window.removeEventListener("message",i);const a=s.extensionId?.trim();n(a?{extensionId:a,extensionVersion:s.extensionVersion?.trim()||void 0}:null)};window.addEventListener("message",i),$n(),window.postMessage({type:"accio.extension.request"},window.location.origin)}),D)}async function H(e=3e3){return(await Rn(e))?.extensionId??null}function Mn(){M=null,D=null}async function Hn(e=3e3){return await H(e)?new Promise(t=>{const n=o=>{window.clearTimeout(r),window.removeEventListener("message",i),t(o)},r=window.setTimeout(()=>n(null),e),i=o=>{const s=o.data;o.source!==window||s?.type!==At||n(s.status??null)};window.addEventListener("message",i),window.postMessage({type:"accio.extension.status.request"},window.location.origin)}):null}async function Tn(){return Mn(),H(1500)}async function Pn(e){const t=await we(),n=t?.url??"/gateway";an(n);const r=Cn(),i=t?.wsUrl,o=i?xn(i):_n(n,r);if(vn(r,n,o),b&&b.readyState<=WebSocket.OPEN&&A===o)return zt(r,o,b.readyState),b;if(b&&A!==o){mn(r,A);try{b.close()}catch{}b=null}Xt(r,n,o),P("connecting",WebSocket.CONNECTING),X+=1;const s=Date.now();z.isWeb&&await ye();const a=Date.now()-s,c=Date.now(),u=ue(c);let p=!1,l;try{l=new WebSocket(o)}catch(m){throw P("closed",WebSocket.CLOSED),d.warn(`${f} WebSocket constructor threw wsUrl=${o}`,m),m}return b=l,A=o,l.onopen=()=>{if(P("open",l.readyState),Sn(r,o,l.readyState),!p){p=!0;const m=Date.now();ce({wsKind:"browser_tool",result:"success",connectCost:m-c,gateWaitCost:a,isReconnect:X>1,connectStartSinceNav:u,readySinceNav:ue(m)})}},l.onmessage=m=>{let g;try{g=JSON.parse(m.data)}catch(N){un(N);return}if(Kt(g.type,g.type==="browser_tool.run.requested"&&g.data?`runId=${g.data.runId??"?"} action=${g.data.action??"?"} paramKeys=${oe(g.data.params)||"none"}`:void 0),g.type==="browser_tool.ping"){cn(),In({type:"browser_tool.pong",data:{}});return}if(g.type!=="browser_tool.run.requested")return;const y=g.data;if(!y?.runId||!y?.action){ln(y);return}Vt(y);const _=y.sessionKey??"",E=y.runId,I=y.action,k=new Set(["navigate","snapshot","act","scroll","screenshot","open"]).has(I),B=async()=>{Jt(E,I);const N=Date.now();let C=await H();if(C||(d.info(`${f} extensionId null, retrying handshake runId=${E}`),C=await Tn()),jt(E,C),!C)try{let x;if(await Promise.race([le.getState().waitForExtension(E),new Promise(($,R)=>{x=setTimeout(()=>R(new Error("wait_timeout")),540*1e3)})]),clearTimeout(x),C=await H(),!C)throw new Error("still not connected after wait")}catch{le.getState().removeByRunId(E),pn(E);try{j({runId:E,success:!1,error:"Accio Browser Relay extension is not connected. Please install it and enable relay.",errorCode:"EXTENSION_NOT_CONNECTED"})}catch(x){K(E,x)}return}Zt(E,C,n),he.init({extensionId:C,gatewayBaseUrl:n,onDisconnect:()=>{dn(),M=null}});try{Gt(y);const x=y.timeoutMs??re,$=Math.max(x-(Date.now()-N),3e4),R=await he.executeAction({runId:E,toolCallId:y.toolCallId??"",sessionKey:_,requestId:y.requestId??E,action:I,params:y.params??{},timeoutMs:$});Qt(E,I,R);try{j({runId:E,success:!0,result:R})}catch(V){K(E,V)}}catch(x){const $=x instanceof Error?x.message:String(x),R=Ft(x);Yt(E,I,$,R),e?.showWebConnectionNotice&&sn(x)&&Ae.getState().show({reason:"not_detected"});try{j({runId:E,success:!1,error:$,errorCode:R})}catch(V){K(E,V)}}};k&&_?(d.info(`${f} queue action=${I} runId=${E} sessionKey=${_}`),bn(_,B)):B()},l.onclose=m=>{b===l&&(P("closed",WebSocket.CLOSED),d.info(`${f} socket close wsUrl=${o} code=${m.code} reason=${m.reason||"none"} wasClean=${m.wasClean}`),hn(r,o,m.code),p||(p=!0,ce({wsKind:"browser_tool",result:"fail",gateWaitCost:a,isReconnect:X>1,closeCode:m.code,durationBeforeClose:Date.now()-c,connectStartSinceNav:u,failReason:m.code===1008||m.code===4401?"auth_rejected":m.code===1006?"network":"server_close"})),b=null)},l.onerror=m=>{if(b!==l)return;const g=l.readyState;P(g===WebSocket.OPEN?"open":"closed",g),d.warn(`${f} socket error wsUrl=${o} readyState=${g} clientId=${W()}`,m),fn(o,m)},l}async function kn(){if(z.isVps)return{enabled:!0,reason:"appConfig.isVps"};try{z.isWeb&&await ye(Ht);const e=(await we())?.wsUrl;if(typeof e=="string"&&e.trim())return{enabled:!0,reason:"gatewayInfo.wsUrl"}}catch(e){d.warn(`${f} failed to resolve gateway info for ws gate`,e)}return{enabled:!1,reason:"node backend is not app-runtime/ws"}}function Fn(){const e=Ne();(0,Wt.useEffect)(()=>{let t=!0,n=!1;return(async()=>{try{const r=await kn();if(!t)return;if(!r.enabled){en(e.type,r.reason),P("idle",WebSocket.CLOSED);return}n=!0,T+=1,tn(T,e.type),rn(),await Pn({showWebConnectionNotice:e.type==="web"})}catch(r){if(!t)return;d.warn(`${f} ensureSocket threw — wsUrl build or WebSocket creation failed`,r),on(r)}})(),()=>{if(t=!1,!!n){if(T=Math.max(0,T-1),nn(T),T===0&&b){gn();try{b.close()}catch{}b=null,P("closed",WebSocket.CLOSED)}T===0&&L.getState().setExtensionDetected(M?!0:null)}}},[e.type])}export{Fn as a,Ae as c,Mn as i,Rn as n,Un as o,Hn as r,le as s,H as t};
