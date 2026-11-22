#!/usr/bin/env node
/**
 * xhs-publish-re —— 小红书图文/视频发布（Node · HTTP 主链路 + 页面兜底）
 * ============================================================================
 * 执行策略（**先主链路，失败才兜底**）：
 *
 *   ① 主链路（默认）：纯 HTTP + 自算签名（_shared/xhs-sign.mjs）
 *        · 不开浏览器、不占 Profile、不等页面渲染
 *        · 单条发布秒级完成，不受前端改版影响
 *        · 与 xiaohongshu-crawl 同一套签名实现（那边已真机跑通 34 次）
 *
 *   ② 兜底（--fallback page 或主链路报 sign_rejected / risk_control）：
 *        页面内代签名 + UI 填表（_shared/xhs-browser.mjs）
 *        · 只在签名算法被平台改版打断时用
 *        · 慢（要开真 Chrome、等前端渲染），但签名由页面自己算，抗改版
 *
 * 用法：
 *   node scripts/publish.mjs --type image --title "标题" --images "a.jpg,b.jpg"
 *   node scripts/publish.mjs --type video --title "标题" --video "a.mp4" --timer "2026-10-25 20:00"
 *   node scripts/publish.mjs ... --dry true          # 只做前置校验与素材探测，不发布
 *   node scripts/publish.mjs ... --confirm true      # 真正提交（L2 门禁）
 *   node scripts/publish.mjs ... --fallback page     # 强制走浏览器兜底
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILL_ROOT = join(HERE, '..')
const PLUGIN_ROOT = process.env.DSAGENT_PLUGIN_ROOT || join(SKILL_ROOT, '..', '..')
const PURL = (p) => pathToFileURL(p).href

// ── 契约常量（与 SKILL.md / contract.json 保持一致）──
const TITLE_MAX = 20
const DESC_MAX = 1000
const IMG_MAX = 18
const VIDEO_EXTS = ['.mp4', '.mov', '.mkv', '.webm', '.flv', '.f4v', '.m4v', '.ts']
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp']

/* ── 参数 ─────────────────────────────────────────────────── */
function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--'))
      continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--'))
      out[key] = 'true'
    else { out[key] = next; i++ }
  }
  return out
}
const ARGS = parseArgs(process.argv)
const truthy = (v) => ['true', '1', 'yes', 'y'].includes(String(v ?? '').trim().toLowerCase())

const TYPE = (ARGS.type || 'image').trim().toLowerCase()
const TITLE = (ARGS.title || '').trim()
const DESC = ARGS.desc || ''
const VIDEO = (ARGS.video || '').trim()
const TIMER = (ARGS.timer || '').trim()
const DRY = truthy(ARGS.dry)
const CONFIRM = truthy(ARGS.confirm)
const ACCOUNT = (ARGS.account || '').trim()
/** auto=先主链路再兜底 | http=只走主链路 | page=强制兜底 */
const FALLBACK = (ARGS.fallback || 'auto').trim().toLowerCase()

function splitImages(raw) {
  const s = String(raw || '').trim()
  if (!s)
    return []
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s)
      if (Array.isArray(arr))
        return arr.map((x) => String(x).trim()).filter(Boolean)
    } catch { return [] }
  }
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}
const IMAGES = splitImages(ARGS.images)

/* ── 输出协议 ─────────────────────────────────────────────── */
const log = (m) => process.stderr.write('[xhs-publish] ' + m + '\n')
const fail = (kind, message, extra = {}) => ({ ok: false, failureKind: kind, failure_kind: kind, message, text: message, ...extra })

/** stdout 走管道时写入是异步的，必须等 flush 再退出，否则宿主只看到半行 JSON */
function emitAndExit(payload, code) {
  const line = '__DSAGENT_RESULT__' + JSON.stringify(payload) + '\n'
  process.exitCode = code
  process.stdout.write(line, () => process.exit(code))
  setTimeout(() => process.exit(code), 2000).unref?.()
}

/**
 * 退出哨兵：裸 process.exit 会跳过 finally，浏览器/Profile 锁就还不了。
 * 抛它 → main 的 finally 正常执行 → 顶层再真正 exit。
 */
class Exit extends Error {
  constructor(code, payload) {
    super('__exit__')
    this.code = code
    this.payload = payload
  }
}
const exitWith = (code, payload) => { throw new Exit(code, payload) }

/* ── 心跳：宿主 idle 看门狗 60s，浏览器兜底链路可能跑几分钟 ── */
let beatTimer = null
let beat = 0
function startHeartbeat(stepRef) {
  beatTimer = setInterval(() => {
    beat += 1
    log(`心跳 ${beat}（${stepRef.value}，已 ${beat * 10}s）`)
  }, 10_000)
  beatTimer.unref?.()
}
function stopHeartbeat() {
  if (beatTimer)
    clearInterval(beatTimer)
  beatTimer = null
}

/* ── 参数校验（未过校验不打任何接口）─────────────────────── */
function validate() {
  if (!TITLE)
    return '缺少 --title（小红书要求标题非空）'
  if ([...TITLE].length > TITLE_MAX)
    return `标题 ${[...TITLE].length} 字，超过小红书上限 ${TITLE_MAX} 字。`
  if (DESC.length > DESC_MAX)
    return `正文 ${DESC.length} 字，超过上限 ${DESC_MAX} 字。`
  if (TYPE !== 'image' && TYPE !== 'video')
    return '--type 只能是 image 或 video。'
  if (!['auto', 'http', 'page'].includes(FALLBACK))
    return '--fallback 只能是 auto / http / page。'

  if (TYPE === 'image') {
    if (!IMAGES.length)
      return '--type image 需要 --images（英文逗号分隔的本地图片绝对路径）'
    if (IMAGES.length > IMG_MAX)
      return `图片 ${IMAGES.length} 张，超过上限 ${IMG_MAX} 张。`
    const missing = IMAGES.filter((x) => !existsSync(x))
    if (missing.length)
      return `以下图片不存在：${missing.slice(0, 3).join(', ')}`
    for (const x of IMAGES) {
      if (!IMG_EXTS.includes(x.slice(x.lastIndexOf('.')).toLowerCase()))
        return `图片格式不支持（仅 ${IMG_EXTS.join('/')}）：${x}`
      const st = statSync(x)
      if (!st.isFile() || st.size === 0)
        return `图片不可用（非文件或大小为 0）：${x}`
    }
  } else {
    if (!VIDEO)
      return '--type video 需要 --video（本地视频绝对路径）'
    if (!existsSync(VIDEO))
      return `视频文件不存在：${VIDEO}`
    if (!VIDEO_EXTS.includes(VIDEO.slice(VIDEO.lastIndexOf('.')).toLowerCase()))
      return `视频格式不支持（仅 ${VIDEO_EXTS.join('/')}）：${VIDEO}`
    const st = statSync(VIDEO)
    if (!st.isFile() || st.size === 0)
      return `视频不可用（非文件或大小为 0）：${VIDEO}`
  }

  if (TIMER && !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(TIMER))
    return `--timer 格式应为 "YYYY-MM-DD HH:mm"，当前：${TIMER}`
  return null
}

/* ── L2 门禁：未确认且非 dry-run → 只出预览 ──────────────── */
function previewPayload() {
  return {
    ok: false,
    needConfirm: true,
    failureKind: 'need_confirm',
    failure_kind: 'need_confirm',
    message: '发布预览（未提交）。确认后请带 --confirm true 重新调用。',
    preview: {
      type: TYPE,
      title: TITLE,
      desc: DESC.slice(0, 200),
      images: TYPE === 'image' ? IMAGES : [],
      video: TYPE === 'video' ? VIDEO : '',
      timer: TIMER || '立即发布',
      account: ACCOUNT || '(会话内唯一账号)',
      channel: FALLBACK === 'page' ? '页面兜底（UI 填表）' : 'HTTP 主链路（自算签名）',
      fallback: FALLBACK === 'auto' ? '主链路失败且可兜底时自动切换' : FALLBACK,
    },
  }
}

/* ── 主链路：HTTP ───────────────────────────────────────── */
/**
 * 图文：全程纯 HTTP。
 * 视频：permit 必须借浏览器（SDK 私有通道），COS PUT 与提交笔记回纯 HTTP。
 */
async function publishViaHttp({ cookieStr, api, lib, store, shopKey }) {
  const out = { channel: 'http', account: shopKey, steps: [] }
  const step = (s) => { out.steps.push(s); log(`[http] ${s}`) }

  if (TYPE === 'image') {
    step(`upload ${IMAGES.length} image(s)`)
    const fileIds = []
    for (let i = 0; i < IMAGES.length; i++) {
      const r = await api.uploadImage({ cookieStr, filePath: IMAGES[i] })
      if (!r.ok)
        return { ...out, ok: false, failureKind: r.failureKind, message: `第 ${i + 1} 张上传失败：${r.message}` }
      fileIds.push(r.fileId)
      log(`[http]   ${basename(IMAGES[i])} → ${r.fileId}`)
    }
    out.fileIds = fileIds
    step('post note')
    const r2 = await api.publishImageNote({ cookieStr, title: TITLE, desc: DESC, fileIds, timer: TIMER })
    out.response = { status: r2.status, payload: r2.payload }
    if (!r2.ok)
      return { ...out, ok: false, failureKind: r2.failureKind, message: r2.message }
    out.noteId = r2.payload?.data?.id || r2.payload?.data?.note_id || null
    step('done')
    return { ...out, ok: true }
  }

  /* 视频 */
  step('request permit')

  // ① 先试纯 HTTP（万一平台放开 / 或会话有特权）
  let picked = null
  const rp = await api.requestPermit({ cookieStr })
  if (rp.ok) {
    picked = api.pickPermit(rp.payload)
    if (picked)
      out.permitSource = 'http'
  }

  // ② 纯 HTTP 拿不到 → 借浏览器（这是已知的硬限制）
  if (!picked) {
    log('[http] 纯 HTTP 拿 permit 失败，改借浏览器（permit 走 SDK 私有通道）')
    const session = await lib.openXhsSession({ store, shopKey, log })
    try {
      const g = await lib.grabPermitViaPage(session)
      if (!g.ok)
        return { ...out, ok: false, failureKind: g.failureKind, message: `借页面拿 permit 失败：${g.message}` }
      picked = api.pickPermit(g.payload)
      if (!picked)
        return { ...out, ok: false, failureKind: 'api_error', message: 'permit 里没有可用的 fileId / uploadAddr' }
      out.permitSource = 'page'
    } finally {
      try { await session.close() } catch { /* 忽略 */ }
    }
  }

  out.permit = {
    uploadAddr: picked.uploadAddr, fileId: picked.fileId,
    qos: picked.permit.qos, storageType: picked.permit.storageType,
  }

  // ③ COS 直传（纯 HTTP + 自算签名）
  step(`COS PUT → ${picked.uploadAddr}`)
  const up = await api.uploadVideoToCos({ permit: picked.permit, filePath: VIDEO })
  if (!up.ok)
    return { ...out, ok: false, failureKind: up.failureKind || 'api_error', message: `视频直传失败：${up.message}` }
  out.uploaded = { size: up.size, parts: up.parts }

  // ④ 提交笔记（纯 HTTP）
  step('post note')
  const r3 = await api.publishVideoNote({
    cookieStr, title: TITLE, desc: DESC, fileId: picked.fileId,
    duration: out.duration || 0, timer: TIMER,
  })
  out.response = { status: r3.status, payload: r3.payload }
  if (!r3.ok)
    return { ...out, ok: false, failureKind: r3.failureKind, message: r3.message }
  out.noteId = r3.payload?.data?.id || r3.payload?.data?.note_id || null
  step('done')
  return { ...out, ok: true }
}

/* ── 兜底：页面内代签名 + UI 填表 ───────────────────────── */
async function publishViaPage({ store, shopKey, lib }) {
  const out = { channel: 'page', account: shopKey, steps: [] }
  const mark = (s) => { out.steps.push(s); log(`[page] ${s}`) }

  const session = await lib.openXhsSession({ store, shopKey, log })
  try {
    const { ev } = session

    const HELPERS = `
      function setNativeValue(el, value) {
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
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
    `

    mark('open')
    await ev(`location.href='https://creator.xiaohongshu.com/publish/publish?source=official'`)
    await lib.sleep(7000)

    mark('tab')
    out.tab = await ev(`(function(){
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
    })()`)
    await lib.sleep(2500)

    mark('attach')
    if (TYPE === 'image') {
      const files = IMAGES.map((p) => ({
        name: basename(p),
        type: p.toLowerCase().endsWith('.png') ? 'image/png'
          : p.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg',
        data: readFileSync(p).toString('base64'),
      }))
      out.attach = await ev(`(async function(){
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
      })()`)
    } else {
      const file = {
        name: basename(VIDEO),
        type: VIDEO.toLowerCase().endsWith('.mov') ? 'video/quicktime'
          : VIDEO.toLowerCase().endsWith('.mkv') ? 'video/x-matroska'
            : VIDEO.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4',
        data: readFileSync(VIDEO).toString('base64'),
      }
      out.attach = await ev(`(async function(){
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
      })()`)
    }

    mark('wait-media')
    let ready = false
    let lastSt = null
    for (let i = 0; i < 70; i++) {
      await lib.sleep(2000)
      const raw = await ev(`(function(){
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
      })()`).catch(() => null)
      let parsed = null
      try { parsed = JSON.parse(raw) } catch { parsed = null }
      if (!parsed)
        continue
      lastSt = parsed
      out.media = parsed
      if (!parsed.hasBtn)
        continue
      if (TYPE === 'image') {
        if (parsed.imgEdit && parsed.submitDisabled === 'false' && !parsed.playerErr) { ready = true; break }
      } else if (parsed.reUpload && parsed.submitDisabled === 'false' && !parsed.playerErr && parsed.videoOk) {
        ready = true
        break
      }
    }
    out.mediaReady = ready
    if (!ready) {
      return {
        ...out, ok: false, failureKind: 'api_error',
        message: lastSt?.playerErr
          ? '播放器报「请刷新试试」：素材可能被污染或格式不受支持，换素材重试。'
          : '媒体未就绪（等了 140s 仍未见上传完成的标志）。',
      }
    }

    mark('fill')
    const fillRaw = await ev(`(function(){
      ${HELPERS}
      var res = { title: null, desc: null };
      var ti = [...document.querySelectorAll('input')]
        .find(function(i){ return /标题|title/i.test(i.placeholder||'') || /title/i.test(i.className||''); });
      if (ti) { setNativeValue(ti, ${JSON.stringify(TITLE)}); res.title = ti.value; }
      else { res.title = 'NO_INPUT'; }
      var d = document.querySelector('[contenteditable=true], .ql-editor');
      if (d) {
        var html = ${JSON.stringify(DESC)}.split('\\n').map(function(s){ return s.trim(); })
          .filter(Boolean).map(function(s){ return '<p>' + s.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</p>'; }).join('');
        setContentEditable(d, html);
        res.desc = d.innerHTML.slice(0, 120);
      } else { res.desc = 'NO_EDITOR'; }
      return JSON.stringify(res);
    })()`)
    try { out.fill = JSON.parse(fillRaw) } catch { out.fill = { raw: fillRaw } }
    await lib.sleep(1000)

    if (TIMER) {
      mark('timer')
      let switched = false
      for (let attempt = 0; attempt < 3 && !switched; attempt++) {
        await ev(`(function(){
          var w = document.querySelector('.post-time-switch-container');
          if (!w) return 'no container';
          w.scrollIntoView({ block:'center' });
          var cb = w.querySelector('input[type=checkbox]');
          if (cb) cb.click();
          return 'clicked';
        })()`).catch(() => {})
        await lib.sleep(2500)
        const chkRaw = await ev(`(function(){
          var w = document.querySelector('.post-time-switch-container');
          var cb = w ? w.querySelector('input[type=checkbox]') : null;
          var dp = document.querySelector('.date-picker-container');
          return JSON.stringify({ checked: cb ? cb.checked : null, hasPicker: !!dp });
        })()`).catch(() => null)
        let chk = null
        try { chk = JSON.parse(chkRaw) } catch { chk = null }
        if (chk && chk.checked === true) { switched = true; out.timerPickerShown = chk.hasPicker }
      }
      out.timerSwitch = switched
      if (switched) {
        await lib.sleep(1500)
        const tfRaw = await ev(`(function(){
          ${HELPERS}
          var res = {};
          var dp = document.querySelector('.date-picker-container input, .d-datepicker input');
          if (!dp) { res.reason = 'no input'; return JSON.stringify(res); }
          res.readOnly = !!dp.readOnly;
          res.before = dp.value;
          if (!dp.readOnly) {
            setNativeValue(dp, ${JSON.stringify(TIMER)});
            dp.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
            dp.dispatchEvent(new Event('change', { bubbles:true }));
            dp.blur && dp.blur();
            res.filled = dp.value;
          } else { dp.click(); res.clicked = true; }
          return JSON.stringify(res);
        })()`).catch(() => null)
        try { out.timerFill = JSON.parse(tfRaw) } catch { out.timerFill = tfRaw }
        await lib.sleep(2000)
        await ev(`(function(){
          ${HELPERS}
          var conf = findTextEl(/^(确定|确认|完成|应用)$/, 'button,div,span')
            .filter(function(e){ return e.getBoundingClientRect().width > 0; });
          if (conf.length) fireClick(conf[conf.length - 1]);
          return 'confirmed';
        })()`).catch(() => {})
      }
    }

    mark('check-btn')
    const btnRaw = await ev(`(function(){
      var el = document.querySelector('xhs-publish-btn');
      if (!el) return JSON.stringify({ found:false, reason:'no xhs-publish-btn' });
      return JSON.stringify({ found:true,
        submitDisabled: el.getAttribute('submit-disabled'),
        submitText: el.getAttribute('submit-text') });
    })()`).catch(() => null)
    try { out.btn = JSON.parse(btnRaw) } catch { out.btn = { found: false, raw: btnRaw } }

    if (!out.btn?.found)
      return { ...out, ok: false, failureKind: 'api_error', message: 'xhs-publish-btn 不存在（表单未渲染）' }
    if (out.btn.submitDisabled === 'true')
      return { ...out, ok: false, failureKind: 'api_error', message: 'submit-disabled=true（表单校验未过：标题/正文/封面缺失）' }

    mark('publish')
    await ev(`(function(){
      var el = document.querySelector('xhs-publish-btn');
      var e = new CustomEvent('publish', { bubbles: true, composed: true, cancelable: true, detail: { src: 'script' } });
      el.dispatchEvent(e);
      try { el.click(); } catch(err) {}
      return 'dispatched';
    })()`).catch(() => {})

    mark('observe')
    for (let i = 0; i < 40; i++) {
      await lib.sleep(1500)
      const stRaw = await ev(`(function(){
        var t = document.body.innerText.replace(/\\s+/g,' ');
        return JSON.stringify({
          url: location.href,
          onSuccess: /\\/publish\\/success/.test(location.href) || /published=true/.test(location.href),
          success: /发布成功/.test(t),
          hasConfirm: /确认发布|立即发布|确定发布/.test(t),
          formGone: !/重新上传/.test(t) && !document.querySelector('xhs-publish-btn'),
          txt: t.slice(0, 200),
        });
      })()`).catch(() => null)
      let st = null
      try { st = JSON.parse(stRaw) } catch { st = null }
      if (!st)
        continue
      out.state = st
      if (st.hasConfirm) {
        await ev(`(function(){
          ${HELPERS}
          var b = findTextEl(/^(确认发布|立即发布|确定发布|确认)$/, 'button,div,span')
            .filter(function(e){ return e.getBoundingClientRect().width > 0; });
          if (b.length) fireClick(b[b.length - 1]);
          return 'confirmed';
        })()`).catch(() => {})
        await lib.sleep(2500)
        continue
      }
      if (st.onSuccess || st.success || st.formGone)
        return { ...out, ok: true }
    }
    return { ...out, ok: false, failureKind: 'api_error', message: '点击发布后未见成功标志（有滑块需人工完成）。' }
  } finally {
    try { await session.close() } catch { /* 忽略 */ }
  }
}

/* ── 主流程 ───────────────────────────────────────────────── */
async function main() {
  const verr = validate()
  if (verr)
    exitWith(1, fail('api_error', verr))

  if (!CONFIRM && !DRY)
    exitWith(0, previewPayload())

  const stepRef = { value: 'boot' }

  const lib = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'xhs-browser.mjs')))
  const libs = await lib.loadXhsLibs()
  const store = lib.openStore(libs)

  // dry-run 是自检模式：允许选到状态位为 expired 的账号，
  // 否则「账号过期」会直接挡住自检，连签名对不对都验不了。
  const pick = await lib.pickXhsAccount(store, {
    want: ACCOUNT, skill: 'xhs-publish-re', allowExpired: DRY,
  })
  if (!pick.ok)
    exitWith(2, fail(pick.failureKind || 'not_bound', pick.text || '账号不可用', pick.accounts ? { accounts: pick.accounts } : {}))

  const account = store.get(pick.shopKey)
  if (!account)
    exitWith(2, fail('not_bound', `账号不存在：${pick.shopKey}`))

  const api = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'xhs-api.mjs')))
  const cookieStr = api.jarToCookieStr(account.cookies)
  log(`使用账号 ${pick.label || pick.shopKey}（${pick.shopKey}）`)

  const base = { type: TYPE, account: pick.shopKey, timer: TIMER || null }

  /* ── dry-run：真实验证签名 + 素材 + 登录态，不发布 ── */
  if (DRY) {
    const probe = {}
    stepRef.value = 'dry'
    log('dry-run：验证签名有效性与登录态…')

    // ① 签名有效性：homefeed 是免登录接口，做「正确签名 vs 篡改签名」对照
    //    正确 200 / 篡改 406 → 签名算法被平台接受
    try {
      const s = await import(PURL(join(PLUGIN_ROOT, 'skills', '_shared', 'xhs-sign.mjs')))
      const feedUrl = 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed'
      const feedPayload = {
        cursor_score: '', num: 20, refresh_type: 1, note_index: 0,
        unread_begin_note_id: '', unread_end_note_id: '', unread_note_count: 0,
        category: 'homefeed_recommend', search_key: '', need_num: 20,
        image_formats: ['jpg', 'webp', 'avif'], need_filter_image: false,
      }
      const good = s.signHeaders('POST', feedUrl, cookieStr, { payload: feedPayload })
      const tampered = { ...good.headers }
      const xs = good.headers['x-s']
      tampered['x-s'] = xs.slice(0, 120) + (xs[120] === 'A' ? 'B' : 'A') + xs.slice(121)

      const callFeed = async (h) => {
        const res = await fetch(feedUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json;charset=UTF-8', origin: 'https://www.xiaohongshu.com', referer: 'https://www.xiaohongshu.com/', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36', cookie: cookieStr, ...h },
          body: good.bodyStr,
        })
        const t = await res.text()
        let j = null
        try { j = JSON.parse(t) } catch { /* 忽略 */ }
        return { status: res.status, code: j?.code ?? null, msg: j?.msg ?? null }
      }
      const rOk = await callFeed(good.headers)
      const rBad = await callFeed(tampered)
      probe.sign = {
        valid: rOk.status === 200 && rBad.status !== 200,
        goodStatus: rOk.status,
        tamperedStatus: rBad.status,
        xsLength: xs.length,
        xsCommonLength: good.headers['x-s-common']?.length || 0,
      }
    } catch (e) {
      probe.sign = { valid: false, error: String(e.message || e) }
    }

    // ② 登录态：/user/me 的 code 才是准的
    const me = await api.fetchSelfInfo({ cookieStr })
    probe.login = {
      ok: me.ok,
      code: me.payload?.code ?? null,
      message: me.ok ? '登录态有效' : (me.message || '未知'),
    }

    // ③ 素材
    if (TYPE === 'image') {
      probe.material = IMAGES.map((p) => ({ path: p, size: statSync(p).size, ext: p.slice(p.lastIndexOf('.')) }))
    } else {
      probe.material = [{ path: VIDEO, size: statSync(VIDEO).size, ext: VIDEO.slice(VIDEO.lastIndexOf('.')) }]
    }
    probe.channel = FALLBACK === 'page' ? 'page' : 'http'

    const notes = []
    if (!probe.sign?.valid)
      notes.push('签名验证未通过')
    if (!probe.login?.ok)
      notes.push(`登录态失效（${probe.login?.message}）`)
    notes.push('未发布')

    exitWith(0, {
      ok: true, ...base, dryRun: true, needConfirm: true,
      channel: probe.channel,
      probe,
      publishable: !!(probe.sign?.valid && probe.login?.ok),
      message: `dry-run 完成：${notes.join('；')}。`,
    })
  }

  /* ── 真发布 ── */
  startHeartbeat(stepRef)
  let session = null
  try {
    let result = null

    if (FALLBACK !== 'page') {
      stepRef.value = 'http'
      log('主链路：自算签名（视频的 permit 段会借浏览器）')
      const r = await publishViaHttp({ cookieStr, api, lib, store, shopKey: pick.shopKey })
      result = { ...base, ...r }
      log(`主链路结果：${r.ok ? '成功' : '失败（' + r.failureKind + '）'}`)

      if (!r.ok && FALLBACK === 'auto' && api.shouldFallback(r.failureKind)) {
        log(`主链路失败（${r.failureKind}），切换到页面兜底…`)
        result.fallbackFrom = { failureKind: r.failureKind, message: r.message, steps: r.steps }
      } else if (!r.ok || FALLBACK !== 'auto') {
        // 不需要/不允许兜底
        if (!r.ok) {
          exitWith(r.failureKind === 'token_expired' ? 2 : 6,
            fail(r.failureKind || 'api_error', r.message || '发布失败', { detail: result }))
        }
        exitWith(0, { ...result, message: `已通过 HTTP 主链路提交（${TIMER ? '定时 ' + TIMER : '即时'}）。平台可能仍在审核。` })
      }
    }

    if (FALLBACK === 'page' || result?.fallbackFrom) {
      stepRef.value = 'page'
      const r = await publishViaPage({ store, shopKey: pick.shopKey, lib })
      result = { ...base, ...r, ...(result?.fallbackFrom ? { fallbackFrom: result.fallbackFrom } : {}) }
      if (!r.ok)
        exitWith(6, fail(r.failureKind || 'api_error', r.message || '页面兜底发布失败', { detail: result }))
    }

    exitWith(0, {
      ...result,
      ok: true,
      message: `已通过${result.channel === 'http' ? ' HTTP 主链路' : '页面兜底'}提交（${TIMER ? '定时 ' + TIMER : '即时'}）。平台可能仍在审核，以创作平台「笔记管理」为准。`,
    })
  } finally {
    stopHeartbeat()
    if (session)
      try { await session.close() } catch { /* 忽略 */ }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    if (e instanceof Exit)
      return emitAndExit(e.payload ?? { ok: false, failure_kind: 'skill_error', message: 'no payload' }, e.code)
    emitAndExit(fail(e?.failureKind || 'skill_error', String(e?.message || e)), 1)
  },
)
