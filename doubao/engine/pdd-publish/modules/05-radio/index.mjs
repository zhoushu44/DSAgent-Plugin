/**
 * 05-radio/index.mjs — 拼多多「通用单选框模块」
 *
 * 覆盖所有 beast-core 单选组（是否支持定制 / 是否接触食品 / 发货类型 / 是否预售…）
 *
 * ════════════════════════════════════════════════════════════════
 *  页面结构（实测）
 *
 *   <div data-testid="beast-core-form-item" id="basic.propertys.4.value">
 *     <label class="Form_itemLabelContent">是否支持定制</label>
 *     <div class="RD_outerWrapper_5-194-0">                 ← 单选组容器
 *       <label class="RD_radio_5-194-0">                    ← 单个选项
 *         <span class="RD_radioIcon_5-194-0">
 *           <svg data-testid="beast-core-icon-radio-normal">        ← 未选
 *                class="RD_circleBg_5-194-0 RD_radioCircle_5-194-0">
 *         </span>
 *         <span class="RD_radioLabel_5-194-0">支持定制</span>
 *       </label>
 *       <label class="RD_radio_5-194-0">
 *         <span class="RD_radioIcon_5-194-0">
 *           <svg data-testid="beast-core-icon-radio-filled">        ← ★ 已选
 *         </span>
 *         <span class="RD_radioLabel_5-194-0">不支持</span>
 *       </label>
 *     </div>
 *   </div>
 *
 *  ★ 判定规则（从 SVG 的 data-testid 看）
 *      radio-normal         = 未选中
 *      radio-filled         = 已选中
 *      radio-disable        = 未选中 + 禁用
 *      radio-disable_filled = 已选中 + 禁用
 *    → 只要 data-testid 含 "_filled" 就是选中
 *
 *  ★ 点击方式：点 label（不是点 input，input 通常隐藏）
 * ════════════════════════════════════════════════════════════════
 *
 * 用法
 *   import { selectRadio, readRadio, listRadios } from './05-radio/index.mjs'
 *
 *   // 按表单项 id + 选项文字
 *   await selectRadio(page, { formItemId: 'basic.propertys.4.value', label: '不支持' })
 *
 *   // 按表单项 id + 序号（0 开始）
 *   await selectRadio(page, { formItemId: 'basic.propertys.4.value', index: 1 })
 *
 *   // 按 XPath
 *   await selectRadio(page, { xpath: '//div[@id="basic.propertys.4.value"]', label: '不支持' })
 *
 *   // 读当前选中
 *   await readRadio(page, { formItemId: 'basic.propertys.4.value' })
 */

const norm = s => String(s || '').replace(/[\s\u3000]/g, '').replace(/[,，.。:：;；、]/g, '')

/** 页面内工具（幂等注入） */
const HELPERS = `
(function () {
  if (window.__pddRadio) return;

  function norm(s){return String(s||'').replace(/[\\s\\u3000]/g,'').replace(/[,，.。:：;；、]/g,'')}
  function vis(e){if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0}
  function q(xp){try{const r=document.evaluate(xp,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);const a=[];for(let i=0;i<r.snapshotLength;i++)a.push(r.snapshotItem(i));return a}catch(e){return[]}}

  // 找单选组容器
  function findGroup(o){
    if(o.xpath){
      const l=q(o.xpath);
      for(const e of l){
        if(e.querySelector&&(e.querySelector('[class*="RD_outerWrapper"]')||e.querySelector('[class*="RD_radio"]')))return e;
      }
    }
    if(o.formItemId){
      const item=document.getElementById(o.formItemId)||document.querySelector('[data-testid="beast-core-form-item"][id="'+o.formItemId+'"]');
      if(item)return item;
    }
    if(o.nearText){
      const cands=[...document.querySelectorAll('[data-testid="beast-core-form-item"]')];
      for(const it of cands){
        const lb=it.querySelector('label');
        if(lb&&norm(lb.textContent).includes(norm(o.nearText)))return it;
      }
    }
    if(o.selector){
      const e=document.querySelector(o.selector);
      if(e)return e;
    }
    return null;
  }

  // 组内所有选项（label 级）
  function findOptions(group){
    if(!group)return [];
    // 优先 RD_radio label
    let els=[...group.querySelectorAll('label[class*="RD_radio"]')].filter(vis);
    if(!els.length) els=[...group.querySelectorAll('[class*="RD_radio"]')].filter(vis);
    if(!els.length){
      // 兜底：含 radio svg 的最近 label/div
      const svgs=[...group.querySelectorAll('svg[data-testid*="radio"]')];
      els=svgs.map(s=>s.closest('label')||s.closest('div')).filter(Boolean).filter(vis);
    }
    return els;
  }

  // 是否选中（看内部 svg 的 data-testid 是否含 _filled）
  function isChecked(el){
    if(!el)return false;
    const svg=el.querySelector('svg[data-testid*="radio"]');
    if(svg){
      const tid=svg.getAttribute('data-testid')||'';
      return /_?filled/i.test(tid);
    }
    const inp=el.querySelector('input[type="radio"]');
    if(inp)return !!inp.checked;
    return /checked|active|selected/i.test(String(el.className||''));
  }

  function isDisabled(el){
    if(!el)return false;
    const svg=el.querySelector('svg[data-testid*="radio"]');
    if(svg&&/disable/i.test(svg.getAttribute('data-testid')||''))return true;
    const inp=el.querySelector('input[type="radio"]');
    if(inp&&inp.disabled)return true;
    return /disabled/i.test(String(el.className||''));
  }

  // 选项文字
  function labelOf(el){
    if(!el)return '';
    const lb=el.querySelector('[class*="RD_radioLabel"]');
    if(lb)return (lb.textContent||'').replace(/\\s+/g,' ').trim();
    return (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40);
  }

  window.__pddRadio={norm,vis,q,findGroup,findOptions,isChecked,isDisabled,labelOf};
})();
true;
`

const targetOf = o => ({
  xpath: o.xpath, formItemId: o.formItemId, nearText: o.nearText, selector: o.selector,
})

/**
 * 列出单选组的所有选项
 * @returns {Promise<{found:boolean, options?:Array<{text,checked,disabled,index}>, error?:string}>}
 */
export async function listRadios(page, opts = {}) {
  await page.evaluate(HELPERS).catch(() => { })
  const r = await page.evaluate((o) => {
    const R = window.__pddRadio
    const g = R.findGroup(o)
    if (!g) return { found: false, error: 'NOT_FOUND' }
    const els = R.findOptions(g)
    return {
      found: true,
      options: els.map((e, i) => ({
        index: i,
        text: R.labelOf(e),
        checked: R.isChecked(e),
        disabled: R.isDisabled(e),
      })),
    }
  }, targetOf(opts)).catch(e => ({ found: false, error: String(e.message).slice(0, 120) }))
  return r
}

/**
 * 读当前选中的选项
 * @returns {Promise<{found:boolean, selected:string, options?:Array}>}
 */
export async function readRadio(page, opts = {}) {
  const r = await listRadios(page, opts)
  if (!r.found) return { found: false, selected: '', options: [] }
  const hit = (r.options || []).find(o => o.checked)
  return { found: true, selected: hit ? hit.text : '', options: r.options }
}

/**
 * 选中某个单选
 *
 * @param {object} page
 * @param {object} opts
 * @param {string} [opts.formItemId]  表单项 id
 * @param {string} [opts.xpath]       组容器 XPath
 * @param {string} [opts.nearText]    按分组标题文字定位
 * @param {string} [opts.label]       选项文字（归一化匹配）
 * @param {number} [opts.index]       选项序号（0 开始，label 未给时用）
 * @param {boolean} [opts.verify=true] 点完读回校验
 * @returns {Promise<{ok:boolean, selected?:string, options?:Array, error?:string}>}
 */
export async function selectRadio(page, opts = {}) {
  await page.evaluate(HELPERS).catch(() => { })
  const res = { ok: false, error: '' }

  // ① 列出选项
  const list = await listRadios(page, opts)
  if (!list.found) { res.error = '找不到单选组: ' + (list.error || ''); return res }
  res.options = list.options
  if (!list.options.length) { res.error = '单选组里没有选项'; return res }

  // ② 找目标
  let target = null
  if (opts.label != null) {
    const want = norm(opts.label)
    target = list.options.find(o => norm(o.text) === want)
      || list.options.find(o => norm(o.text).includes(want))
    if (!target) {
      res.error = `「${opts.label}」不存在，可选: ${list.options.map(o => o.text).join(' / ')}`
      return res
    }
  } else if (typeof opts.index === 'number') {
    target = list.options[opts.index]
    if (!target) { res.error = `序号 ${opts.index} 越界（共 ${list.options.length} 项）`; return res }
  } else {
    res.error = '需要 label 或 index'
    return res
  }

  // ③ 已选中则跳过（避免重复点击）
  if (target.checked) {
    res.ok = true
    res.selected = target.text
    res.skipped = true
    return res
  }
  if (target.disabled) { res.error = `「${target.text}」已禁用`; return res }

  // ④ 点击该选项的 label
  const clicked = await page.evaluate((o, wantText, wantIndex) => {
    const R = window.__pddRadio
    const g = R.findGroup(o)
    if (!g) return { ok: false, error: '组消失' }
    const els = R.findOptions(g)
    let el = null
    if (wantText != null) {
      const w = R.norm(wantText)
      el = els.find(e => R.norm(R.labelOf(e)) === w) || els.find(e => R.norm(R.labelOf(e)).includes(w))
    } else {
      el = els[wantIndex]
    }
    if (!el) return { ok: false, error: '选项消失' }
    el.scrollIntoView({ block: 'center' })
    el.click()
    // 兜底：点内部 input
    const inp = el.querySelector('input[type="radio"]')
    if (inp && !inp.checked) { try { inp.click() } catch (e) { } }
    return { ok: true, clicked: R.labelOf(el) }
  }, targetOf(opts), opts.label != null ? opts.label : null, typeof opts.index === 'number' ? opts.index : null)
    .catch(e => ({ ok: false, error: String(e.message).slice(0, 120) }))

  if (!clicked.ok) { res.error = '点击失败: ' + (clicked.error || ''); return res }

  await page.evaluate(() => new Promise(r => setTimeout(r, 400)))

  // ⑤ 读回校验
  if (opts.verify !== false) {
    const after = await readRadio(page, opts)
    res.selected = after.selected
    res.ok = norm(after.selected) === norm(target.text) || norm(after.selected).includes(norm(target.text))
    if (!res.ok) res.error = `读回不一致：点了「${target.text}」，实际选中「${after.selected}」`
  } else {
    res.ok = true
    res.selected = clicked.clicked
  }
  return res
}

export { norm }

