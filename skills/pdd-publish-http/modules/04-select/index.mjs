/**
 * 04-select/index.mjs — 拼多多「通用下拉选择模块」（单选 + 多选 + 规格下拉）
 *
 * 覆盖：品牌 / 产地 / 适用场景 / 功能特点 / 材质 / 使用对象 / 商品资质 / 规格类型 / 运费模板
 *
 * ════════════════════════════════════════════════════════════════
 *  真实结构（实测）
 *
 *  A. 单选可搜索（品牌）
 *   <div data-testid="beast-core-form-item" id="basic.propertys.0.value">
 *     <label class="Form_itemLabelContent">品牌</label>
 *     <div data-testid="beast-core-select">
 *       <div data-testid="beast-core-select-header" data-status="normal|active">
 *         <div class="ST_selectValueSingle">                ← 单选容器
 *           <input data-testid="beast-core-select-htmlInput"
 *                  placeholder="请输入品牌名称搜索">          ← 可搜索（无 readonly）
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 *
 *  B. 多选（适用场景）
 *   <span class="ST_selectValueMultiple">                     ← 多选容器
 *     <input data-testid="beast-core-select-htmlInput" placeholder="请选择">
 *   </span>
 *
 *  C. 规格类型下拉（只读，展开即选）
 *   <div data-testid="beast-core-select" style="width:272px">
 *     <div data-testid="beast-core-select-header" data-status="normal">
 *       <div class="ST_selectValueSingle">                     ← 单选容器
 *         <input readonly placeholder="规格类型1"
 *                data-testid="beast-core-select-htmlInput">    ← ★ readonly，不能输入
 *       </div>
 *     </div>
 *   </div>
 *
 *  ★ 三条关键规则（实测踩过）
 *    ① 面板挂在 body 上，**多个面板会叠加** → 打开前必须先关掉其它面板
 *    ② 单选选完面板**自动关闭**；多选选完**不关**，需手动点空白
 *    ③ readonly 的 input 不能输入，只能点 header 展开后点选项
 * ════════════════════════════════════════════════════════════════
 *
 * 用法
 *   import { selectOptions, readSelected, probeSelect, openSelect, listOptions, closeAllSelects } from './04-select/index.mjs'
 *
 *   // 单选（品牌，可搜索）
 *   await selectOptions(page, { formItemId: 'basic.propertys.0.value', values: ['无品牌/无注册商标'] })
 *
 *   // 多选（适用场景）
 *   await selectOptions(page, { formItemId: 'basic.propertys.2.value', values: ['家用', '办公'] })
 *
 *   // 规格下拉（只读，用 text 定位 placeholder）
 *   await selectOptions(page, { placeholderText: '规格类型1', values: ['口味'] })
 *
 *   // 或直接给 select 元素的 XPath
 *   await selectOptions(page, { selectXpath: '//div[@data-testid="beast-core-select"][.//input[@placeholder="规格类型1"]]', values: ['口味'] })
 */

const norm = s => String(s || '').replace(/[\s\u3000]/g, '').replace(/[,，.。:：;；、]/g, '')

const HELPERS = `
(function () {
  if (window.__pddSel3) return;
  function norm(s){return String(s||'').replace(/[\\s\\u3000]/g,'').replace(/[,，.。:：;；、]/g,'')}
  function vis(e){if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0}
  function q(xp){try{const r=document.evaluate(xp,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);const a=[];for(let i=0;i<r.snapshotLength;i++)a.push(r.snapshotItem(i));return a}catch(e){return[]}}

  // 定位 select 元素（4 种方式）
  function findSelect(o){
    if(o.selectXpath){
      const l=q(o.selectXpath);
      for(const e of l){
        const s=e.matches&&e.matches('[data-testid="beast-core-select"]')?e:(e.querySelector?e.querySelector('[data-testid="beast-core-select"]'):null);
        if(s)return s;
      }
    }
    if(o.formItemId){
      const item=document.getElementById(o.formItemId)||document.querySelector('[data-testid="beast-core-form-item"][id="'+o.formItemId+'"]');
      if(item){const s=item.querySelector('[data-testid="beast-core-select"]');if(s)return s}
    }
    if(o.placeholderText){
      const inputs=[...document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]')];
      for(const inp of inputs){
        if((inp.placeholder||'')===o.placeholderText||(inp.placeholder||'').includes(o.placeholderText)){
          const s=inp.closest('[data-testid="beast-core-select"]');
          if(s)return s;
        }
      }
    }
    if(o.selector){
      const e=document.querySelector(o.selector);
      if(e)return e.matches('[data-testid="beast-core-select"]')?e:e.querySelector('[data-testid="beast-core-select"]');
    }
    return null;
  }

  // ★ 所有当前可见的弹层面板（可能叠加，取最上层）
  function visiblePopups(){
    const sels='[class*="ST_popup"], [class*="ST_dropdown"], [class*="popup"], [class*="Popup"], [role="listbox"]';
    return [...document.querySelectorAll(sels)].filter(vis);
  }

  // 取最上层面板的选项
  function findOptions(){
    const popups=visiblePopups();
    // 从后往前（后插入的在上层）
    for(let i=popups.length-1;i>=0;i--){
      const p=popups[i];
      const els=[...p.querySelectorAll('[class*="option"], li, [role="option"]')].filter(vis);
      if(els.length) return {ok:true, els, popupCount:popups.length, popupIdx:i};
    }
    return {ok:false, els:[], popupCount:popups.length};
  }

  // ★ 关闭所有面板：点空白 + ESC
  function closeAll(){
    try{
      const before=visiblePopups().length;
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
      document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',bubbles:true}));
      // 点 body 空白处（避开面板）
      const ev=(t)=>{const e=new MouseEvent(t,{bubbles:true,cancelable:true,view:window,clientX:5,clientY:5});document.body.dispatchEvent(e)};
      ev('mousedown');ev('mouseup');ev('click');
      const after=visiblePopups().length;
      return {before, after};
    }catch(e){return {before:-1,after:-1,error:String(e)}}
  }

  window.__pddSel3={norm,vis,q,findSelect,findOptions,closeAll,visiblePopups};
})();
true;
`

const targetOf = o => ({
  selectXpath: o.selectXpath,
  formItemId: o.formItemId,
  placeholderText: o.placeholderText,
  selector: o.selector,
})

/**
 * 关闭所有已展开的下拉面板
 */
export async function closeAllSelects(page) {
  await page.evaluate(HELPERS).catch(() => { })
  const r = await page.evaluate(() => window.__pddSel3.closeAll()).catch(() => ({ before: -1, after: -1 }))
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)))
  return r
}

/**
 * 探测下拉框状态
 */
export async function probeSelect(page, opts = {}) {
  await page.evaluate(HELPERS).catch(() => { })
  return page.evaluate((o) => {
    const S = window.__pddSel3
    const el = S.findSelect(o)
    if (!el) return { found: false, error: 'NOT_FOUND' }

    const header = el.querySelector('[data-testid="beast-core-select-header"]')
    const status = header ? header.getAttribute('data-status') : ''
    const singleEl = el.querySelector('[class*="ST_selectValueSingle"]')
    const multiEl = el.querySelector('[class*="ST_selectValueMultiple"]')
    const input = el.querySelector('[data-testid="beast-core-select-htmlInput"]')

    let selected = []
    const container = multiEl || singleEl
    if (container) {
      // ① 多选：tag 形式（ST_tag / IPT_tag 里的 tag 元素）
      const tagEls = [...container.querySelectorAll(
        '[class*="ST_tag"] [class*="content"], [class*="ST_tag"] [class*="text"], [class*="IPT_tag"] [class*="content"], [class*="selectionItem"], [class*="SelectionItem"]'
      )]
      const tags = tagEls.map(e => (e.textContent || '').trim()).filter(Boolean)
      if (tags.length) selected = tags
      else {
        // ② 单选：容器文本（排除 placeholder）
        const txt = (container.textContent || '').replace(/\s+/g, ' ').trim()
        const ph = input ? (input.placeholder || '').trim() : ''
        const inpVal = input ? (input.value || '').trim() : ''
        const cand = txt && txt !== ph ? txt : (inpVal && inpVal !== ph ? inpVal : '')
        if (cand && !/^(请选择|请输入)/.test(cand)) selected = [cand]
      }
    }
    // ③ 兜底：整个 select 容器的文本
    if (!selected.length) {
      const all = (el.textContent || '').replace(/\s+/g, ' ').trim()
      const ph = input ? (input.placeholder || '').trim() : ''
      if (all && all !== ph && !/^(请选择|请输入)/.test(all) && all.length < 60) selected = [all]
    }

    return {
      found: true,
      mode: multiEl ? 'multiple' : (singleEl ? 'single' : 'unknown'),
      expanded: status === 'active',
      readonly: input ? !!input.readOnly : false,
      placeholder: input ? (input.placeholder || '') : '',
      searchable: input ? (!input.readOnly && /搜索|请输入/.test(input.placeholder || '')) : false,
      selected,
      visible: S.vis(el),
    }
  }, targetOf(opts)).catch(e => ({ found: false, error: String(e.message).slice(0, 120) }))
}

/**
 * 展开下拉（会先关掉其它面板，避免叠加）
 */
export async function openSelect(page, opts = {}) {
  await page.evaluate(HELPERS).catch(() => { })

  // ★ 先关所有面板
  await closeAllSelects(page)

  const r = await page.evaluate((o) => {
    const S = window.__pddSel3
    const el = S.findSelect(o)
    if (!el) return { ok: false, error: 'NOT_FOUND' }
    el.scrollIntoView({ block: 'center' })

    const header = el.querySelector('[data-testid="beast-core-select-header"]') || el
    if (header.getAttribute('data-status') === 'active') return { ok: true, already: true }
    header.click()
    return { ok: true }
  }, targetOf(opts)).catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))

  if (r.ok && !r.already) await page.evaluate(() => new Promise(r => setTimeout(r, 600)))
  return r
}

/**
 * 列出当前最上层面板的选项
 */
export async function listOptions(page) {
  await page.evaluate(HELPERS).catch(() => { })
  return page.evaluate(() => {
    const S = window.__pddSel3
    const { ok, els, popupCount } = S.findOptions()
    return {
      popupCount,
      options: els.map(e => ({
        text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        disabled: /disabled/i.test(String(e.className || '')),
      })),
    }
  }).catch(() => ({ popupCount: 0, options: [] }))
}

/**
 * 选中一个或多个值
 *
 * @param {object} page
 * @param {object} opts { formItemId? | selectXpath? | placeholderText? | selector?, values, search?, timeoutMs? }
 * @returns {Promise<{ok, mode?, selected?, tried?, error?}>}
 */
export async function selectOptions(page, opts = {}) {
  const res = { ok: false, error: '', tried: [] }
  const values = (Array.isArray(opts.values) ? opts.values : [opts.values]).filter(Boolean)
  if (!values.length) { res.error = '缺 values'; return res }

  // ① 探测
  const probe = await probeSelect(page, opts)
  if (!probe.found) { res.error = '找不到下拉框: ' + (probe.error || ''); return res }
  res.mode = probe.mode
  const isMulti = probe.mode === 'multiple'
  const timeout = opts.timeoutMs ?? 10000

  // ② 是否需要搜索：可搜索 且 非 readonly
  const needSearch = opts.search === true || (probe.searchable && !opts.forceNoSearch)

  // ★ 多选：先记录当前已选，已选的跳过（否则再点一次 = 取消勾选）
  const alreadySelected = (probe.selected || []).map(norm)
  const toSelect = values.filter(v => !alreadySelected.includes(norm(v)))
  if (isMulti && toSelect.length < values.length) {
    const skipped = values.filter(v => alreadySelected.includes(norm(v)))
    res.skipped = skipped
  }

  for (let vi = 0; vi < toSelect.length; vi++) {
    const v = toSelect[vi]

    // 展开（内部已先关所有面板）
    const opened = await openSelect(page, opts)
    if (!opened.ok) { res.error = '展开失败: ' + (opened.error || ''); return res }

    // 需要搜索就先输入
    if (needSearch) {
      const typed = await page.evaluate((o, kw) => {
        const S = window.__pddSel3
        const el = S.findSelect(o)
        if (!el) return false
        const input = el.querySelector('[data-testid="beast-core-select-htmlInput"]')
        if (!input || input.readOnly) return false
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
        input.focus()
        if (setter) setter.call(input, String(kw)); else input.value = String(kw)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, targetOf(opts), v).catch(() => false)
      if (typed) await page.evaluate(() => new Promise(r => setTimeout(r, 1200)))
    }

    // 找选项并点
    const t0 = Date.now()
    let picked = null
    let opts0 = []
    while (Date.now() - t0 < timeout) {
      const r = await page.evaluate((wantNorm) => {
        const S = window.__pddSel3
        const { ok, els } = S.findOptions()
        if (!ok || !els.length) return { ok: false, wait: true }
        const norm = t => String(t || '').replace(/[\s\u3000]/g, '').replace(/[,，.。:：;；、]/g, '')
        let hit = els.find(e => norm(e.textContent) === wantNorm && !/disabled/i.test(String(e.className || '')))
        if (!hit) hit = els.find(e => norm(e.textContent).includes(wantNorm) && !/disabled/i.test(String(e.className || '')))
        if (!hit) return { ok: false, options: els.map(e => (e.textContent || '').replace(/\s+/g, '').trim()).filter(Boolean).slice(0, 20) }
        hit.scrollIntoView({ block: 'center' })
        hit.click()
        return { ok: true, selected: (hit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) }
      }, norm(v)).catch(e => ({ ok: false, error: String(e.message).slice(0, 100) }))

      if (r.ok) { picked = r.selected; break }
      if (r.options?.length) { opts0 = r.options; break }
      await page.evaluate(() => new Promise(r => setTimeout(r, 400)))
    }

    if (!picked) {
      res.tried.push({ value: v, ok: false, options: opts0 })
      res.error = `「${v}」未找到${opts0.length ? '，可选: ' + opts0.slice(0, 10).join(' / ') : '（面板无选项）'}`
      await closeAllSelects(page)
      return res
    }

    res.tried.push({ value: v, ok: true, picked })
    await page.evaluate(() => new Promise(r => setTimeout(r, 600)))

    // ★ 单选选完自动关（不用手动关）；多选继续留在面板里
    if (!isMulti) break

    // 多选：清空搜索框以便下次搜索
    if (needSearch && vi < toSelect.length - 1) {
      await page.evaluate((o) => {
        const S = window.__pddSel3
        const el = S.findSelect(o)
        if (!el) return
        const input = el.querySelector('[data-testid="beast-core-select-htmlInput"]')
        if (!input || input.readOnly) return
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
        input.focus()
        if (setter) setter.call(input, ''); else input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, targetOf(opts)).catch(() => { })
      await page.evaluate(() => new Promise(r => setTimeout(r, 500)))
    }
  }

  // ③ 多选选完必须关面板（否则读不到已选值，且挡后续操作）
  if (isMulti) {
    await closeAllSelects(page)
    // ★ 多选关闭后再多点几次空白，确保面板真的消失
    for (let i = 0; i < 3; i++) {
      const left = await page.evaluate(() => window.__pddSel3.visiblePopups().length).catch(() => 0)
      if (left === 0) break
      await page.evaluate(() => {
        const ev = (t, x, y) => document.body.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }))
        const pts = [[10, 10], [10, 200], [300, 10], [window.innerWidth - 20, 10]]
        for (const [x, y] of pts) { ev('mousedown', x, y); ev('mouseup', x, y); ev('click', x, y) }
        return true
      }).catch(() => { })
      await page.evaluate(() => new Promise(r => setTimeout(r, 400)))
    }
  }

  // ④ 读回校验
  const after = await probeSelect(page, opts)
  res.selected = after.selected || []

  // 主图不比对（多选读回可能是合并文本），这里按「每一个都出现在 selected 文本里」判断
  const joined = res.selected.map(norm).join('|')
  res.ok = values.every(v => joined.includes(norm(v)))
  if (!res.ok) res.error = res.error || `读回不一致：期望 [${values.join(',')}]，实际 [${res.selected.join(',')}]`
  return res
}

/**
 * 读已选值
 */
export async function readSelected(page, opts = {}) {
  const p = await probeSelect(page, opts)
  return { found: p.found, mode: p.mode, selected: p.selected || [], readonly: p.readonly }
}

export { norm }


