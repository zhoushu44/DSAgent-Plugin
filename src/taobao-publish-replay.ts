/**
 * 觅千手式「Json/Json2 setter 劫持重放」—— 淘宝/天猫发布模式 2。
 *
 * 机制（SOURCE: skills/taobao-publish-mqs/SOURCE.md，逆向 觅千手 v5.61 pageHooks.js）：
 *   淘宝发布页是 React 受控表单，框架会把整个表单 state 赋值给 window.Json / window.Json2。
 *   这里用 Object.defineProperty 劫持这两个 setter，在框架赋值瞬间把本地存好的商品数据
 *   原地 merge 进框架自己的 state 对象 —— 框架随后渲染出的就是已填好的表单，
 *   不做任何 DOM 逐格输入，也不会触发受控组件的「程序值 vs 用户值」不同步问题。
 *
 *   门禁对齐觅千手 evaluateMoveJsonFullReplay：只在 sell 发布页生效、单次只 merge 一次
 *   （merge 后置 kdds_taobao_sku_hook_done=true，等价于觅千手的 hook_done 门禁）。
 *   ★ catchup 边界遵守觅千手：不主动给旧页面补课（避免上一单 payload 污染新表单），
 *     payload 由宿主在每次发布前注入。
 */

// ── merge 字段集 / 保护字段（对齐觅千手常量）──────────────────
const MOVE_COMPONENT_SYNC_KEYS = [
  'title', 'shopping_title', 'mainImagesGroup', 'images', 'threeToFourImages',
  'sku', 'saleProp', 'customSaleProp', 'descRepublicOfSell', 'price', 'quantity',
  'outerId', 'tbExtractWay', 'shippingArea', 'shopcat', 'catProp', 'wirelessDesc',
  'deliverWeight', 'multiDiscountPromotion', 'sizeMapping',
]
const PROTECTED_OFFICIAL_ONLY_KEYS = [
  'auctionPoint', 'stuffStatus', 'sevenDaySupport', 'ysbCheckTask', 'qualityIdentify',
]
const LISTING_DELIVERY_FV_KEYS = ['startTime', 'tmDeliveryTime', 'tbDeliveryTime', 'deliveryTimeType']

export interface TaobaoReplaySkuInput {
  name: string
  price?: string
  stock?: string
  outerId?: string
}

export interface TaobaoReplayPayloadInput {
  title: string
  price?: string
  stock?: string
  itemNo?: string
  images: string[]
  skus: TaobaoReplaySkuInput[]
  /**
   * 销售属性规格值名列表（选填）。复刻觅千手：光有 sku 数据行不够，框架渲染「销售属性」
   * 区的规格勾选状态靠 saleProp + customSaleProp 驱动，三层一起 merge 才算真正填上
   * （否则提交时「销售属性必填项未填」）。值为规格值名（如「格蕾灰」），与 skus[].name 对应。
   */
  salePropValues?: string[]
  /**
   * 主图 URL 列表（COS/外链，已是 URL 而非本地文件）。复刻觅千手搬品：图片走 replay 塞 URL，
   * 不做 DOM 文件上传。塞入 formValues.mainImagesGroup.images + formValues.images。
   */
  imageUrls?: string[]
  /**
   * 详情图 URL 列表（COS/外链）。复刻觅千手：塞 formValues.wirelessDesc 数组（每项 {type:'img',value:url}）
   * 与 formValues.descRepublicOfSell.descPageCommitParam.templateContent（HTML img 串）。
   */
  detailImageUrls?: string[]
}

/**
 * 构造主图数组元素：{ url, pix }。
 * ★ 必须是对象（照觅千手 skuPicture = { url, pix } 的形态）——
 *   纯 URL 字符串会被 simplyImages 组件渲染成空占位框（DOM img=0，页面仍显示「上传图片」）。
 *
 * pix 推断：优先取 CDN 文件名里的 -WxH 尾缀（淘宝 imgextra 命名惯例，
 *   如 O1CN01xxx_!!2218891961201-2-tps-800-800.jpg），取不到给 '800x800'。
 */
function picItem(url: string): { url: string; pix: string } {
  const u = String(url || '').trim()
  const m = u.match(/[-_](\d{2,5})x(\d{2,5})\.(?:jpg|jpeg|png|webp)/i)
  return { url: u, pix: m ? `${m[1]}x${m[2]}` : '800x800' }
}

/**
 * 由宿主侧统一商品参数组装觅千手文档结构 { models: { formValues }, components }。
 * 只填我们掌握语义的字段；类目属性（catProp）、运费模板（tbExtractWay）等由框架默认
 * 或现有 DOM 链路兜底。SKU 采用淘宝 sku 数组的常见结构（props/price/quantity/outerId）。
 */
export function buildTaobaoJsonDocument(input: TaobaoReplayPayloadInput): Record<string, unknown> {
  const title = String(input.title || '').trim()
  const formValues: Record<string, unknown> = { title }
  if (input.price) formValues.price = String(input.price)
  if (input.stock) formValues.quantity = String(input.stock)
  if (input.itemNo) formValues.outerId = String(input.itemNo)
  // ★ 复刻觅千手 applyStickyMovePayloadToJsonTarget 的三层 SKU 结构：
  //   sku（数据行）+ saleProp（pid→规格值数组，驱动规格勾选渲染）+ customSaleProp（自定义规格项）。
  //   只 merge sku 不 merge saleProp/customSaleProp，框架渲染不出「销售属性」勾选态，提交报必填未填。
  const saleVals = (Array.isArray(input.salePropValues) ? input.salePropValues : [])
    .map(v => String(v || '').trim()).filter(Boolean)
  if (Array.isArray(input.skus) && input.skus.length) {
    formValues.sku = input.skus.map(s => ({
      props: [{ name: s.name }],
      price: s.price ? String(s.price) : (input.price ? String(input.price) : ''),
      quantity: s.stock ? String(s.stock) : '0',
      outerId: s.outerId ? String(s.outerId) : '',
    }))
    // saleProp：自定义规格用 pid=-1（淘宝自定义销售属性的约定 pid），值为 [{text}] 数组
    const vals = saleVals.length ? saleVals : input.skus.map(s => s.name)
    formValues.saleProp = { '-1': vals.map(v => ({ text: v })) }
    // customSaleProp：自定义规格项结构 [{items:[{text}]}]
    formValues.customSaleProp = [{ items: vals.map(v => ({ text: v })) }]
  }
  // ★ 复刻觅千手搬品：主图/详情图走 URL 注入（非 DOM 文件上传）。
  //   主图 → mainImagesGroup.images（+images 兜底）；详情图 → wirelessDesc 数组 + descRepublicOfSell。
  //
  //   ★ 主图元素必须是**对象** { url, pix }，不能是裸 URL 字符串。
  //     实测证据：state 里放字符串数组时，页面的 simplyImages 组件渲染出的是 5 个
  //     「上传图片」空占位框（DOM img=0），而 state 明明有值 —— 组件读的是 item.url。
  //     对照觅千手 resolveSearchPicture 返回的 skuPicture 元素也是 { url, pix } 形态，
  //     与此一致。pix 从 CDN 文件名里的 -WxH 尾缀推断（如 ...-2-tps-800-800.jpg），
  //     推不出来时给一个安全默认值（不影响渲染，只影响比例校验提示）。
  const imgUrls = (Array.isArray(input.imageUrls) ? input.imageUrls : [])
    .map(u => String(u || '').trim()).filter(Boolean)
  if (imgUrls.length) {
    const items = imgUrls.map(u => picItem(u))
    formValues.mainImagesGroup = { images: items }
    formValues.images = items
  }
  const detUrls = (Array.isArray(input.detailImageUrls) ? input.detailImageUrls : [])
    .map(u => String(u || '').trim()).filter(Boolean)
  if (detUrls.length) {
    // wirelessDesc：无线端详情模块（兼容旧版详情）
    formValues.wirelessDesc = detUrls.map(u => ({ type: 'img', ...picItem(u) }))
    // desc：旧版 PC 详情（HTML 串）
    const html = detUrls.map(u => `<img src="${u}"/>`).join('')
    formValues.desc = html
    // ★ descType='1'：详情类型开关。实测「只写 desc/descRepublicOfSell 不写 descType」时
    //   编辑器不渲染（DOM img=0）；三者同时写才出图（实验已验证 editorImgs 0→3）。
    formValues.descType = '1'
    // ★ descRepublicOfSell：新版详情（newDescVersion=1 / descRepublicEnable=1 时以此为准）。
    //   该组件 ref 是 props.value → formValues.descRepublicOfSell，读的是
    //   descPageCommitParam.templateContent + 完整 descPageCommitParam 结构。
    //   只给 templateContent 而缺字段，编辑器会认为没有详情。
    formValues.descRepublicOfSell = {
      descPageCommitParam: {
        opt: 0,
        clientType: 1,
        bizSource: 'sell',
        userId: 0,           // 由框架按当前登录态补；给 0 不阻断渲染
        itemId: 0,
        templateId: 0,
        version: 0,
        freeTry: 0,
        needServerComposite: false,
        batchPut: false,
        detailHeight: 0,
        params: 'params',
        maxHeight: 100000,
        articleId: 0,
        smart: false,
        sell: false,
        newItem: true,
        bsellerBack2OldVersion: false,
        fliggyItem: false,
        changed: true,
        templateContent: html,
      },
    }
  }
  return { models: { formValues }, components: {} }
}

/**
 * 从 formValues 取某个组件该同步的 `props.value`（对齐觅千手 getComponentPropValueFromFv）。
 *
 * ★ 这里有全篇最关键的一处「照着觅千手抄」的细节：
 *   觅千手的实现是
 *     function getComponentPropValueFromFv(ck, targetFv){
 *       if (targetFv) return ck === "mainImagesGroup" && targetFv.mainImagesGroup
 *         ? cloneJsonValue(targetFv.mainImagesGroup)      // ← 整个对象 { images: [...] }
 *         : (void 0 !== targetFv[ck] ? cloneJsonValue(targetFv[ck]) : void 0)
 *     }
 *   注意 `mainImagesGroup` 分支返回的是 **targetFv.mainImagesGroup 这个对象本身**，
 *   而不是 `.images` 数组。
 *
 *   踩过的坑：早先这里写成 `fv.mainImagesGroup.images`（纯 URL 数组），
 *   结果是 —— formValues 里 URL 齐全、replay 也报 mergedFields 含 mainImagesGroup，
 *   但页面的主图区一个 img 都没有。因为组件渲染读的是 props.value 的**对象形态**
 *   （它要据此渲染 items / 每张图的元信息），给一个裸字符串数组它认不出来，直接当空。
 *   改成对象后 DOM 立刻出图。
 */
function componentPropValueFromFv(ck: string, fv: Record<string, unknown> | null | undefined): unknown {
  if (!fv) return undefined
  if (ck === 'mainImagesGroup' && fv.mainImagesGroup) return fv.mainImagesGroup
  return fv[ck] !== undefined ? fv[ck] : undefined
}

/**
 * 生成注入页面的 init script（evaluateOnNewDocument 用）。
 * payload 序列化内联进脚本；脚本负责：
 *   ① 写 localStorage 门禁 key（detailData 会话活跃标记）
 *   ② defineProperty 劫持 window.Json / window.Json2，setter 内做觅千手式 merge
 *   ③ merge 成功置 kdds_taobao_sku_hook_done=true，并挂 window.__kddsReplayResult 供回读
 */
export function buildTaobaoJsonReplayInitScript(docJson: string): string {
  const SYNC = JSON.stringify(MOVE_COMPONENT_SYNC_KEYS)
  const PROTECTED = JSON.stringify(PROTECTED_OFFICIAL_ONLY_KEYS)
  const DELIVERY = JSON.stringify(LISTING_DELIVERY_FV_KEYS)
  // ★ 对照觅千手 MOVE_COMPONENT_SYNC_KEYS 的完整清单（含 sizeMapping / shopcat 等）；
  //   SYNC_KEYS 之外还有几个组件是「只在 formValues 与 components 之间映射」的，
  //   这里全量内联，保证组件值与 formValues 始终同源。
  const FV_ONLY_KEYS = JSON.stringify(['images', 'customSaleProp', 'catProp'])
  return `(function(){
  if (window.__kddsJsonHookInstalled) return;
  window.__kddsJsonHookInstalled = true;
  // 新文档加载 = 新表单实例，重置单次门禁（防跨页残留拦住本页 merge）。
  // 门禁作用域是「同一表单页只 merge 一次」，不是「同一浏览器 profile 只 merge 一次」。
  try { localStorage.removeItem('kdds_taobao_sku_hook_done'); } catch(e){}
  var DOC = ${docJson};
  var SYNC_KEYS = ${SYNC};
  var PROTECTED_KEYS = ${PROTECTED};
  var DELIVERY_KEYS = ${DELIVERY};
  // 详情三件套是否交给 replay 接管。默认 false —— 见 applyReplay 里的长注释：
  // merge 详情字段会让 #lite-decoration-editor 不挂载，详情图必须走页面上传器。
  var MERGE_DETAIL_FIELDS = false;
  // SKU / 销售属性三件套是否交给 replay 接管。默认 false —— 见 applyReplay 里的长注释：
  // merge 这三个字段会让 #struct-catProp 的 label.required 全部消失（属性区被破坏）。
  var MERGE_SKU_FIELDS = true;
  function clone(v){ if(v==null) return v; try{ return JSON.parse(JSON.stringify(v)); }catch(e){ return v; } }
  function hasSub(fv,key){
    if(!fv || fv[key]===undefined || fv[key]===null) return false;
    if(key==='startTime'){ var s=fv.startTime; return !!(s && s.type!==undefined && s.type!==null && s.type!==''); }
    if(key==='tmDeliveryTime'||key==='tbDeliveryTime'||key==='deliveryTimeType'){
      var o=fv[key]; return !!(o && typeof o==='object' && o.type!==undefined && o.type!==null && String(o.type)!=='');
    }
    if(key==='catProp' && typeof fv[key]==='object') return Object.keys(fv[key]).length>0;
    if(key==='shopcat') return Array.isArray(fv[key]) && fv[key].length>0;
    return true;
  }
  function substantive(fv){
    if(!fv || typeof fv!=='object') return false;
    if(fv.title && String(fv.title).trim()) return true;
    var m11 = fv.mainImagesGroup && fv.mainImagesGroup.images;
    return !!((Array.isArray(m11)&&m11.length) || (Array.isArray(fv.images)&&fv.images.length)
      || (Array.isArray(fv.threeToFourImages)&&fv.threeToFourImages.length)
      || (Array.isArray(fv.sku)&&fv.sku.length)
      || (Array.isArray(fv.wirelessDesc)&&fv.wirelessDesc.length)
      || (typeof fv.desc==='string' && fv.desc.trim()));
  }
  try { localStorage.setItem('kdds_taobao_detailData', JSON.stringify({collect_source:'dsagent_replay', t: Date.now()})); } catch(e){}

  /**
   * 组件同步（对齐觅千手 syncMoveComponentsFromFormValues + getComponentPropValueFromFv）。
   *
   * ★ 一个字段的 props.value 取什么，必须走「表单字段 → 组件值」的映射，而不是无脑 fv[ck]：
   *     · mainImagesGroup → fv.mainImagesGroup（**整个对象** {images:[...]}，不是 .images 数组）
   *     · 其它           → fv[ck] 原样
   *   当年写成 fv.mainImagesGroup.images（裸数组）的后果是：state 有值、DOM 无图，静默失败。
   */
  function compValueFromFv(ck, fv){
    if(!fv) return undefined;
    if(ck==='mainImagesGroup' && fv.mainImagesGroup) return clone(fv.mainImagesGroup);
    return fv[ck]!==undefined ? clone(fv[ck]) : undefined;
  }
  function syncComponents(val, storedComp, fv){
    if(!val || !val.components) return [];
    var synced=[];
    SYNC_KEYS.forEach(function(ck){
      var pv = compValueFromFv(ck, fv);
      if(pv===undefined && storedComp && storedComp[ck] && storedComp[ck].props){
        // 兜底：storedComp 里 mainImagesGroup 的 props.value 也应是对象形态
        pv = clone(storedComp[ck].props.value);
      }
      if(ck==='shopcat' && !(Array.isArray(pv)&&pv.length)) return;
      if(pv!==undefined){
        var c = val.components[ck];
        if(c && c.props){ c.props.value = pv; synced.push(ck); }
      }
    });
    DELIVERY_KEYS.forEach(function(ck){
      if(hasSub(fv,ck)){
        var c = val.components[ck];
        if(c && c.props){ c.props.value = clone(fv[ck]); synced.push(ck); }
      }
    });
    return synced;
  }

  function applyReplay(val, hookSource){
    // ★ 不再用 hook_done 单次门禁：merge 是幂等的（每次写同样的值），
    //   而「多合几次」正是命中最晚那次渲染窗口的办法（simplyImages 只在挂载时读值）。
    //   只用它判断「是否已至少成功合并过一次」，供 catchup 提前退出。
    if(!val) return {applied:false, reason:'no_val', hookSource:hookSource};
    var storedFv = DOC.models && DOC.models.formValues;
    if(!storedFv || typeof storedFv!=='object')
      return {applied:false, reason:'no_stored_formValues', hookSource:hookSource};
    if(!substantive(storedFv))
      return {applied:false, reason:'empty_stored_content', hookSource:hookSource};
    var storedComp = DOC.components || {};
    val.models = val.models || {};
    var fv = val.models.formValues;
    if(!fv || typeof fv!=='object'){ fv = {}; val.models.formValues = fv; }
    val.components = val.components || {};
    var merged=[], preserved=[], protectedSnap={};
    PROTECTED_KEYS.forEach(function(k){
      if(hasSub(fv,k)){ protectedSnap[k]=clone(fv[k]); preserved.push(k); }
    });
    // ★★ SKU / 销售属性三件套（sku / customSaleProp / saleProp）同理**默认不 merge**。
    //
    //   实测证据（2026-10，v5 轮 DOM 探针）：
    //     注入 replay 并 merge 这三个字段后，
    //       #struct-catProp 里 struct-p-* 有 28 个，但 label.required **= 0 个**
    //     ——商品属性区被整体破坏（必填标记消失、属性无法填、提交报「重要属性 0/7」）。
    //     不注入 replay 时同一页面 label.required 有 7 个，一切正常。
    //
    //   结论与详情字段完全同类：replay 直接写入这些**结构化复合字段**会打断组件
    //   初始化，把本来能用的表单搞坏。故销售属性改由 fillSkus 走 DOM 键入 + Tab，
    //   SKU 表价格/数量也由 DOM 回填（这条路径一直可用）。
    if (MERGE_SKU_FIELDS) {
      if(Array.isArray(storedFv.sku)&&storedFv.sku.length){ fv.sku=clone(storedFv.sku); merged.push('sku'); }
      if(Array.isArray(storedFv.customSaleProp)&&storedFv.customSaleProp.length){ fv.customSaleProp=clone(storedFv.customSaleProp); merged.push('customSaleProp'); }
      if(storedFv.saleProp && typeof storedFv.saleProp==='object' && Object.keys(storedFv.saleProp).length){
        fv.saleProp=clone(storedFv.saleProp); merged.push('saleProp');
      }
    }    if(storedFv.title && String(storedFv.title).trim()){ fv.title=storedFv.title; merged.push('title'); }
    if(Array.isArray(storedFv.shopping_title)&&storedFv.shopping_title.length
       && storedFv.shopping_title[0] && String(storedFv.shopping_title[0].value||'').trim()){
      fv.shopping_title=clone(storedFv.shopping_title); merged.push('shopping_title');
    }
    var m11 = storedFv.mainImagesGroup && storedFv.mainImagesGroup.images;
    if((Array.isArray(m11)&&m11.length) || (Array.isArray(storedFv.images)&&storedFv.images.length)){
      if(storedFv.mainImagesGroup){ fv.mainImagesGroup=clone(storedFv.mainImagesGroup); merged.push('mainImagesGroup'); }
      else { fv.images=clone(storedFv.images); merged.push('images'); }
    }
    if(Array.isArray(storedFv.threeToFourImages)&&storedFv.threeToFourImages.length){
      fv.threeToFourImages=clone(storedFv.threeToFourImages); merged.push('threeToFourImages');
    }
    // ★★ 详情三件套（wirelessDesc / desc / descRepublicOfSell）**故意不 merge**。
    //
    //   实测证据（2026-10，对照实验）：
    //     - 不注入 replay 时，lite-decoration-editor / panel_edit 正常挂载（757px，
    //       菜单「图片/文字/源码导入/模板/高级编辑/智能详情」齐全）
    //     · 注入 replay 且 merge 了 desc 相关字段 → 详情编辑器**直接不存在**（edPresent=false），
    //       「添加→图片」点不到，素材层也不出。
    //   即：往 descRepublicOfSell 里塞结构化的 templateContent 会打断详情组件的初始化，
    //   把一个本来能用的富人编辑器搞成空白。
    //
    //   所以详情图改走觅千手真实路径：**塞给页面自己的上传器**
    //   （见 src/taobao-publish.ts injectDetailImages：getImgBlob → DataTransfer →
    //     File → input.files → dispatchEvent('change')），
    //   由框架在上传成功后自行写入 descRepublicOfSell。这才是它原本的工作方式。
    //
    //   下面三块保留为「显式开关」：只有调用方确实想让 replay 接管详情（例如已有
    //   完全正确的整段 descRepublicOfSell 文档）时才打开，默认关闭。
    if (MERGE_DETAIL_FIELDS) {
      if(Array.isArray(storedFv.wirelessDesc)&&storedFv.wirelessDesc.length){
        fv.wirelessDesc=clone(storedFv.wirelessDesc); merged.push('wirelessDesc');
      }
      if(typeof storedFv.desc==='string' && storedFv.desc.trim()){ fv.desc=storedFv.desc; merged.push('desc'); }
      if(storedFv.descRepublicOfSell && storedFv.descRepublicOfSell.descPageCommitParam
         && storedFv.descRepublicOfSell.descPageCommitParam.templateContent){
        fv.descRepublicOfSell=clone(storedFv.descRepublicOfSell); merged.push('descRepublicOfSell');
      }
    }
    ['price','quantity','outerId','tbExtractWay','shippingArea','deliverWeight','multiDiscountPromotion','shopcat','sizeMapping'].forEach(function(k){
      if(hasSub(storedFv,k)){ fv[k]=clone(storedFv[k]); merged.push(k); }
    });
    if(hasSub(storedFv,'catProp')){
      var sc=storedFv.catProp, tc=fv.catProp;
      if(tc && typeof tc==='object' && Object.keys(tc).length>0){
        fv.catProp = Object.assign({}, clone(sc), clone(tc));
      } else {
        fv.catProp = clone(sc);
      }
      merged.push('catProp');
    }
    DELIVERY_KEYS.forEach(function(k){
      if(hasSub(storedFv,k)){ fv[k]=clone(storedFv[k]); merged.push(k); }
      else if(hasSub(fv,k)){ preserved.push(k); }
    });
    PROTECTED_KEYS.forEach(function(k){
      if(protectedSnap[k]!==undefined) fv[k]=protectedSnap[k];
    });
    var synced = syncComponents(val, storedComp, fv);
    if(!merged.length) return {applied:false, reason:'nothing_to_merge', hookSource:hookSource, syncedComponents:synced};
    try { localStorage.setItem('kdds_taobao_sku_hook_done','true'); } catch(e){}
    return {applied:true, replayMode:'full_lazy_merge', hookSource:hookSource,
      mergedFields:merged, preservedFields:preserved, syncedComponents:synced,
      titleLen: fv.title ? String(fv.title).trim().length : 0,
      skuLen: Array.isArray(fv.sku)?fv.sku.length:0};
  }

  var _J, _J2, seq=0, seq2=0;
  /**
   * 就绪门禁 —— 只要 val 还是对象就尝试合并（不做严格结构检查）。
   *
   * ★ 实测铁证（2026-10，内嵌实验 + 独立最小验证脚本，连真实发布页）：
   *   在表单已渲染之后，把 components.mainImagesGroup.props.value 换成完全正确的
   *   { images: [{url,pix}, ...] }，DOM **没有任何反应**：
   *       replace 前 img=0（文案「上传图片」×5）
   *       replace 后 img=0
   *       2s 后     img=0
   *   而同样的 payload 走 replay（在框架 set 期间合并）时，**详情图能渲染出 3 张 img**，
   *   主图却始终是 0 —— 说明单纯「写 state」对 simplyImages 不够，必须命中它读取的时机。
   *
   *   所以这里不再自我加限：只要 val 是对象就合，越早越好；后续 set 继续合，
   *   直到 hook_done。宁可多合几次（幂等，写的是同样的值），也不错过渲染窗口。
   */
  function isReady(val){
    return !!val && typeof val === 'object'
  }
  // 结构诊断：记录每次 set 前 val 的真实字段路径，供定位「框架渲染源 vs merge 目标」。
  function dumpStruct(val){
    try{
      var d = {modelsKeys: val.models?Object.keys(val.models):[],
        fvKeys: (val.models&&val.models.formValues)?Object.keys(val.models.formValues):[],
        compKeys: val.components?Object.keys(val.components):[],
        ready: isReady(val),
        compCount: val.components?Object.keys(val.components).length:0};
      ['title','price','quantity','outerId','itemTitle','babyTitle','sellTitle'].forEach(function(k){
        var c = val.components && val.components[k];
        if(c){ d['comp.'+k] = {propsKeys: c.props?Object.keys(c.props):[], value: c.props?String(c.props.value).slice(0,40):undefined}; }
      });
      // 抓 base-card / sale-card / global 的实际内容（标题价格可能藏这里）
      ['base-card','sale-card','global','__fields__'].forEach(function(mk){
        var m = val.models && val.models[mk];
        if(m && typeof m==='object'){
          d['models.'+mk] = JSON.stringify(m).slice(0, 300);
        } else if(m !== undefined){ d['models.'+mk] = String(m).slice(0,120); }
      });
      if(val.models && val.models.formValues){
        d['fv.title'] = String(val.models.formValues.title||'').slice(0,40);
        d['fv.price'] = val.models.formValues.price;
        // formValues 里疑似标题/价格的 key（值像标题/价格的）
        var fv = val.models.formValues, susp = {};
        Object.keys(fv).forEach(function(k){
          var v = fv[k];
          if(typeof v==='string' && v && (v.length>10 && /[\u4e00-\u9fa5]/.test(v))) susp[k]=v.slice(0,40);
          else if(typeof v==='number') susp[k]=v;
        });
        d.fvSuspicious = susp;
      }
      return d;
    }catch(e){ return {err:String(e)}; }
  }

  /**
   * 补做入口：对已挂载的活引用**反复**合并。
   *
   * ★ 为什么不因 hook_done 而停：simplyImages 只在挂载那一刻读 props.value，
   *   而框架可能挂载多次（tab 切换、异步组件补建）。merge 是幂等的，
   *   多合几次只会增加命中渲染窗口的概率，不会写坏数据。
   */
  function catchupReplay(){
    var targets = [['Json', _J], ['Json2', _J2]];
    for (var i=0;i<targets.length;i++){
      var name = targets[i][0], t = targets[i][1];
      if(!t || !isReady(t)) continue;
      var r = applyReplay(t, 'catchup.'+name);
      if(r && r.applied){ window.__kddsReplayResult = r; return; }
    }
  }
  var tries = 0;
  var timer = setInterval(function(){
    tries++;
    try { catchupReplay(); } catch(e){}
    // 详情编辑器（富文本）通常比主图晚挂载，补做窗口给足：250ms × 160 ≈ 40s
    if(tries > 160) clearInterval(timer);
  }, 250);

  /**
   * 安装 hook（照抄觅千手安装段：先取 liveJson 作初值，再 defineProperty）。
   * 未就绪时**照样保存引用**（_J = val），只是不 merge —— 否则 catchup 拿不到活对象。
   */
  var liveJson = (window.Json && window.Json.models) ? window.Json : null;
  var liveJson2 = (window.Json2 && window.Json2.models) ? window.Json2 : null;
  _J = liveJson || {};
  _J2 = liveJson2 || {};

  Object.defineProperty(window,'Json',{configurable:true, enumerable:true,
    get:function(){ return _J; },
    set:function(val){
      seq++;
      _J = val;                       // ★ 先存引用（catchup 要用）
      if(!isReady(val)) return;       // 空壳：不 merge，等后续 set / catchup
      var before = dumpStruct(val);
      var r = applyReplay(val,'Json.set#'+seq);
      r.beforeStruct = before;
      r.afterStruct = dumpStruct(val);
      window.__kddsReplayResult = r;
    }});
  Object.defineProperty(window,'Json2',{configurable:true, enumerable:true,
    get:function(){ return _J2; },
    set:function(val){
      seq2++;
      _J2 = val;
      if(!isReady(val)) return;
      var r = applyReplay(val,'Json2.set#'+seq2);
      if(r.applied) window.__kddsReplayResult = r;
    }});
})();`
}
