/*
 * xhs_publish.cjs — 小红书图文/视频统一发布脚本（最终版）
 * =====================================================
 * 逆向成果汇总：
 *   1) 发布按钮在 closed Shadow DOM 内（attachShadow mode:"closed"），
 *      querySelector 不可见 → 必须派发 CustomEvent('publish', {composed:true})
 *   2) Vue3 v-model 必须用原生 setter 填充，直接 el.value=x 无效
 *   3) 视频上传走腾讯云 COS STS（ak=sk="null"，SecurityToken=permit.token）
 *   4) 播放器必须就绪（无「请刷新试试」）否则表单校验不过
 *   5) 不能 location.href 跳转（丢表单状态）
 *
 * 用法：
 *   node xhs_publish.cjs --type image --images a.jpg,b.jpg --title T --desc D
 *   node xhs_publish.cjs --type video --video a.mp4 --title T --desc D
 *   node xhs_publish.cjs --type image --images a.jpg --title T --desc D \
 *        --timer "2026-10-25 20:00"
 *   加 --dry 只填表不发布
 *
 * 前置：sign_service.cjs 已在 8787 跑着且已登录。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const g = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const TYPE = g('--type', 'image');                 // image | video
const IMAGES = (g('--images', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const VIDEO = g('--video', '');
const TITLE = g('--title', '');
const DESC = g('--desc', '');
const TIMER = g('--timer', '');                    // "YYYY-MM-DD HH:mm"
const DRY = argv.includes('--dry');
const PORT = Number(g('--port', '8787'));
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function svc(endpoint, body, timeout = 300000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${BASE}${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json;charset utf-8' },
      body: JSON.stringify(body || {}), signal: ctrl.signal,
    });
    return await r.json();
  } finally { clearTimeout(t); }
}

async function ev(code, timeout = 300000) {
  const r = await svc('/eval', { code }, timeout);
  if (!r || r.ok !== true) throw new Error(JSON.stringify(r).slice(0, 400));
  return r.result;
}

const jparse = (v) => { try { return JSON.parse(v); } catch (e) { return v; } };
const OUT = { ok: false, type: TYPE };

// ── 页面内通用工具（注入到每次 eval 的代码里）──────────────
const HELPERS = `
  function setNativeValue(el, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setNativeTextarea(el, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function setContentEditable(el, html) {
    el.focus();
    if (el.isContentEditable) {
      el.innerHTML = html;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }
  }
  function fireClick(el) {
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var types = ['pointerover','mouseover','pointerdown','mousedown','pointerup','mouseup','click'];
    for (var i = 0; i < types.length; i++) {
      var Ctor = types[i].indexOf('pointer') === 0 ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(types[i], { bubbles:true, cancelable:true, composed:true,
        clientX:x, clientY:y, button:0, buttons:(i===3||i===4)?1:0, view:window, isPrimary:true, pointerId:1 }));
    }
    if (typeof el.click === 'function') el.click();
  }
  function findTextEl(re, tagFilter) {
    var els = [...document.querySelectorAll(tagFilter || 'div,span,button,a')];
    return els.filter(function(e){ return e.children.length === 0 && re.test((e.innerText||'').trim()); });
  }
`;

(async () => {
  // 0. 参数校验
  if (TYPE === 'image' && !IMAGES.length) throw new Error('--type image 需要 --images a.jpg,b.jpg');
  if (TYPE === 'video' && !VIDEO) throw new Error('--type video 需要 --video a.mp4');
  if (TYPE === 'image') for (const p of IMAGES) if (!fs.existsSync(p)) throw new Error('图片不存在: ' + p);
  if (TYPE === 'video' && !fs.existsSync(VIDEO)) throw new Error('视频不存在: ' + VIDEO);

  const h = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  if (!h || !h.ready) throw new Error('sign_service 未就绪，先 node sign_service.cjs');
  if (!h.login) throw new Error('未登录');
  OUT.login = true;

  // 1. 打开发布页（干净态）
  OUT.step = 'open';
  await ev(`location.href='https://creator.xiaohongshu.com/publish/publish?source=official'`);
  await sleep(7000);

  // 2. 切到对应 tab（图文 tab 需点「上传图文」；视频 tab 是默认）
  OUT.step = 'tab';
  OUT.tab = await ev(`(function(){
    var want = ${JSON.stringify(TYPE === 'video' ? 'video' : 'image')};
    var ins = [...document.querySelectorAll('input[type=file]')];
    var hasVideo = ins.some(function(i){ return /mp4|mov|mkv|video/i.test(i.accept||''); });
    var hasImage = ins.some(function(i){ return /jpg|jpeg|png|webp|image/i.test(i.accept||''); });
    if (want === 'video' && hasVideo) return 'video-ready';
    if (want === 'image' && hasImage) return 'image-ready';
    var label = want === 'video' ? '上传视频' : '上传图文';
    var tabs = [...document.querySelectorAll('div,span,button,a')]
      .filter(function(e){ return e.children.length === 0 && (e.innerText||'').trim() === label; });
    if (tabs.length) { tabs[0].click(); return 'switched-to-' + label; }
    return 'no-tab video=' + hasVideo + ' image=' + hasImage;
  })()`);
  await sleep(2500);

  // 3. 挂载媒体
  OUT.step = 'attach';
  if (TYPE === 'image') {
    const files = IMAGES.map((p) => ({
      name: path.basename(p),
      type: /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg',
      data: fs.readFileSync(p).toString('base64'),
    }));
    OUT.attach = await ev(`(async function(){
      ${HELPERS}
      var files = ${JSON.stringify(files)};
      var dt = new DataTransfer();
      for (var i = 0; i < files.length; i++) {
        var bin = atob(files[i].data); var bytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        dt.items.add(new File([bytes], files[i].name, { type: files[i].type }));
      }
      var ins = [...document.querySelectorAll('input[type=file]')];
      var t = ins.find(function(i){ return /jpg|jpeg|png|webp|image/i.test(i.accept||''); });
      if (!t) return 'no image input';
      t.files = dt.files;
      t.dispatchEvent(new Event('change', { bubbles: true }));
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'attached ' + dt.files.length;
    })()`);
  } else {
    const file = {
      name: path.basename(VIDEO),
      type: /\.mov$/i.test(VIDEO) ? 'video/quicktime'
        : /\.mkv$/i.test(VIDEO) ? 'video/x-matroska'
        : /\.webm$/i.test(VIDEO) ? 'video/webm' : 'video/mp4',
      data: fs.readFileSync(VIDEO).toString('base64'),
    };
    OUT.attach = await ev(`(async function(){
      ${HELPERS}
      var meta = ${JSON.stringify(file)};
      var bin = atob(meta.data); var bytes = new Uint8Array(bin.length);
      for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
      var dt = new DataTransfer();
      dt.items.add(new File([bytes], meta.name, { type: meta.type }));
      var ins = [...document.querySelectorAll('input[type=file]')];
      var t = ins.find(function(i){ return /mp4|mov|mkv|video/i.test(i.accept||''); });
      if (!t) return 'no video input';
      t.files = dt.files;
      t.dispatchEvent(new Event('change', { bubbles: true }));
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 'attached ' + bytes.length;
    })()`);
  }

  // 4. 等媒体就绪
  //    图文标志：出现「图片编辑 N/18」+ xhs-publish-btn submit-disabled=false
  //    视频标志：出现「重新上传」+ 播放器无错误 + submit-disabled=false
  OUT.step = 'wait-media';
  let ready = false;
  for (let i = 0; i < 70; i++) {
    await sleep(2000);
    const st = jparse(await ev(`(function(){
      var t = document.body.innerText.replace(/\\s+/g,' ');
      var playerErr = /请刷新试试|不支持视频展示/.test(t);
      var btn = document.querySelector('xhs-publish-btn');
      var sd = btn ? btn.getAttribute('submit-disabled') : null;
      var imgEdit = (/图片编辑\\s*\\d+\\s*\\//.test(t));
      var reUpload = /重新上传/.test(t);
      var video = document.querySelector('video');
      var videoOk = !video || video.error === null;
      return JSON.stringify({ imgEdit: imgEdit, reUpload: reUpload, playerErr: playerErr,
        hasBtn: !!btn, submitDisabled: sd, hasVideo: !!video, videoOk: videoOk });
    })()`).catch(() => null));
    if (!st || typeof st !== 'object') continue;
    OUT.media = st;
    if (!st.hasBtn) continue;
    if (TYPE === 'image') {
      if (st.imgEdit && st.submitDisabled === 'false' && !st.playerErr) { ready = true; break; }
    } else {
      if (st.reUpload && st.submitDisabled === 'false' && !st.playerErr && st.videoOk) { ready = true; break; }
    }
  }
  OUT.mediaReady = ready;
  if (!ready) { OUT.error = '媒体未就绪'; console.log(JSON.stringify(OUT, null, 2)); process.exit(3); }

  // 5. 填标题 + 正文（★ 原生 setter，Vue3 v-model 才能收到）
  OUT.step = 'fill';
  OUT.fill = jparse(await ev(`(function(){
    ${HELPERS}
    var res = { title: null, desc: null };
    var ti = [...document.querySelectorAll('input')]
      .find(function(i){ return /标题|title/i.test(i.placeholder||'') || /title/i.test(i.className||''); });
    if (ti) {
      setNativeValue(ti, ${JSON.stringify(TITLE)});
      res.title = ti.value;
    } else { res.title = 'NO_INPUT'; }
    var d = document.querySelector('[contenteditable=true], .ql-editor');
    if (d) {
      var html = ${JSON.stringify(DESC)}.split('\\n').map(function(s){ return s.trim(); })
        .filter(Boolean).map(function(s){ return '<p>' + s.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</p>'; }).join('');
      setContentEditable(d, html);
      res.desc = d.innerHTML.slice(0, 120);
    } else { res.desc = 'NO_EDITOR'; }
    return JSON.stringify(res);
  })()`));
  await sleep(1000);

  // 6. 定时发布（可选）
  //    结构：.post-time-switch-container > .custom-switch-card > .d-switch
  //    开启后弹出 .date-picker-container（d-datepicker），默认已填当前时间
  if (TIMER) {
    OUT.step = 'timer';
    // 6.1 开开关
    //    ★ 实测：合成 MouseEvent 序列对 d-switch 无效，必须用原生 cb.click()
    let switched = false;
    for (let attempt = 0; attempt < 3 && !switched; attempt++) {
      const r = jparse(await ev(`(function(){
        var w = document.querySelector('.post-time-switch-container');
        if (!w) return JSON.stringify({ ok:false, reason:'no container' });
        w.scrollIntoView({ block:'center' });
        var cb = w.querySelector('input[type=checkbox]');
        var sw = w.querySelector('.d-switch');
        if (!cb) return JSON.stringify({ ok:false, reason:'no checkbox' });
        var before = cb.checked;
        cb.click();                       // ★ 原生 click，合成事件无效
        return JSON.stringify({ ok:true, before: before, after: cb.checked });
      })()`));
      OUT[`timer-sw${attempt}`] = r;
      await sleep(2500);
      const chk = jparse(await ev(`(function(){
        var w = document.querySelector('.post-time-switch-container');
        var cb = w ? w.querySelector('input[type=checkbox]') : null;
        var dp = document.querySelector('.date-picker-container');
        return JSON.stringify({ checked: cb ? cb.checked : null, hasPicker: !!dp });
      })()`).catch(() => null));
      if (chk && chk.checked === true) { switched = true; OUT.timerPickerShown = chk.hasPicker; }
    }
    OUT.timerSwitch = switched;
    if (!switched) OUT.timerWarn = '定时开关未能打开';
    await sleep(1500);

    // 6.2 DatePicker 出现后填时间
    if (switched) {
      // 等 picker 渲染
      let dpReady = false;
      for (let i = 0; i < 8 && !dpReady; i++) {
        await sleep(1000);
        dpReady = jparse(await ev(`(function(){
          var dp = document.querySelector('.date-picker-container input, .d-datepicker input, .date-picker-container .d-datepicker-input-filter');
          return JSON.stringify({ ready: !!dp, readOnly: dp ? !!dp.readOnly : null, val: dp ? dp.value : null });
        })()`).catch(() => null));
        dpReady = dpReady && dpReady.ready;
      }
      OUT.timerPicker = dpReady;

      OUT.timerFill = jparse(await ev(`(function(){
        ${HELPERS}
        var res = {};
        var dp = document.querySelector('.date-picker-container input, .d-datepicker input');
        if (!dp) { res.reason = 'no input'; return JSON.stringify(res); }
        dp.scrollIntoView({ block:'center' });
        res.readOnly = !!dp.readOnly;
        res.before = dp.value;
        if (!dp.readOnly) {
          setNativeValue(dp, ${JSON.stringify(TIMER)});
          dp.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
          dp.dispatchEvent(new Event('change', { bubbles:true }));
          dp.blur && dp.blur();
          res.filled = dp.value;
        } else {
          dp.click();      // 只读则用原生 click 开面板
          res.clicked = true;
        }
        return JSON.stringify(res);
      })()`));
      await sleep(2000);

      // 面板内确认
      OUT.timerConfirm = jparse(await ev(`(function(){
        ${HELPERS}
        var res = {};
        var conf = findTextEl(/^(确定|确认|完成|应用)$/, 'button,div,span')
          .filter(function(e){ return e.getBoundingClientRect().width > 0; });
        if (conf.length) {
          var b = conf[conf.length - 1];
          (b.closest('button,div[role=button]') || b).click ? null : null;
          if (typeof b.click === 'function') b.click();
          fireClick(b);
          res.confirmed = (b.innerText||'').trim();
        }
        var dp = document.querySelector('.date-picker-container input, .d-datepicker input');
        res.time = dp ? dp.value : null;
        var w = document.querySelector('.post-time-switch-container');
        var cb = w ? w.querySelector('input[type=checkbox]') : null;
        res.switchChecked = cb ? cb.checked : null;
        return JSON.stringify(res);
      })()`));
    }
  }

  // 7. 校验发布按钮可用
  OUT.step = 'check-btn';
  OUT.btn = jparse(await ev(`(function(){
    var el = document.querySelector('xhs-publish-btn');
    if (!el) return JSON.stringify({ found:false, reason:'no xhs-publish-btn' });
    var r = el.getBoundingClientRect();
    return JSON.stringify({ found:true,
      rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],
      submitDisabled: el.getAttribute('submit-disabled'),
      submitText: el.getAttribute('submit-text'),
      isPublish: el.getAttribute('is-publish') });
  })()`));

  if (DRY) {
    OUT.ok = true; OUT.step = 'dry-done';
    console.log(JSON.stringify(OUT, null, 2));
    return;
  }

  if (!OUT.btn.found) { OUT.error = 'xhs-publish-btn 不存在（表单未渲染）'; console.log(JSON.stringify(OUT, null, 2)); process.exit(4); }
  if (OUT.btn.submitDisabled === 'true') { OUT.error = 'submit-disabled=true（表单校验未过）'; console.log(JSON.stringify(OUT, null, 2)); process.exit(5); }

  // 8. 派发 publish 事件（穿透 closed shadow）
  OUT.step = 'publish';
  OUT.dispatch = await ev(`(function(){
    var el = document.querySelector('xhs-publish-btn');
    var e = new CustomEvent('publish', { bubbles: true, composed: true, cancelable: true, detail: { src: 'script' } });
    var ok = el.dispatchEvent(e);
    try { el.click(); } catch(err) {}
    return JSON.stringify({ dispatched: true, notCancelled: ok });
  })()`);

  // 9. 观察结果
  OUT.step = 'observe';
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const st = jparse(await ev(`(function(){
      var t = document.body.innerText.replace(/\\s+/g,' ');
      return JSON.stringify({
        url: location.href,
        onSuccess: /\\/publish\\/success/.test(location.href) || /published=true/.test(location.href),
        success: /发布成功/.test(t),
        hasConfirm: /确认发布|立即发布|确定发布/.test(t),
        formGone: !/重新上传/.test(t) && !document.querySelector('xhs-publish-btn'),
        txt: t.slice(0, 200),
      });
    })()`).catch(() => null));
    if (!st || typeof st !== 'object') continue;
    OUT.state = st;
    if (st.hasConfirm) {
      await ev(`(function(){
        ${HELPERS}
        var b = findTextEl(/^(确认发布|立即发布|确定发布|确认)$/, 'button,div,span')
          .filter(function(e){ return e.getBoundingClientRect().width > 0; });
        if (b.length) fireClick(b[b.length - 1]);
        return 'confirmed';
      })()`).catch(() => {});
      await sleep(2500);
      continue;
    }
    if (st.onSuccess || st.success || st.formGone) { OUT.ok = true; break; }
  }

  console.log(JSON.stringify(OUT, null, 2));
  process.exit(OUT.ok ? 0 : 6);
})().catch((e) => {
  OUT.error = String(e && e.stack || e);
  console.log(JSON.stringify(OUT, null, 2));
  process.exit(1);
});
