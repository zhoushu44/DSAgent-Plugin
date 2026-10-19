# 拼多多上架模式2（请求劫持改包）复刻底稿

> 逆向来源：Chrome 扩展「觅千手 v5.61」`_gm.js`（5.83MB CDN 引擎，模块 m_042_8087）+ `service_worker_new.js`（111KB）+ `content_script_loader_v3.js`（10.8KB）+ 模块 m_062_8174（Anti-Content 破解）。
> 本文档是复刻施工图：全部逻辑以伪代码 + 字段表 + 接口表给出，每节末尾标注证据文件（`evidence/` 目录，44 份美化代码段）。
> 原始偏移坐标见 `C:\Users\Administrator\mqs-swarm-docs-result\`（7 篇逆向文档 + 84 条事实登记）。

---

## 0. 一句话原理

**不自己构造提交请求，而是等商家在拼多多后台点「提交」——在浏览器层把原生提交请求拦下来，只替换其中的图片/SKU 价格/运费字段，再以页面身份重放。** 类目、属性、标题、SKU 结构等由商家（或 UI 自动化）在页面上正常填好，模式2 只做「临门一脚」的数据替换，因此天然规避了「整包构造签名不全」的问题。

与模式1（UI 自动化填表，`src/pdd-publish.ts`）的关系：模式2 可以复用模式1 的「开页 + 类目选择 + 标题/属性填充」前半段，只把「填 SKU 价格表 + 提交」后半段换成劫持改包。

---

## 1. 全链路时序（原生实现，MV3 扩展版）

```
[页面世界 _gm.js: S 类]                        [Service Worker]                    [loader 桥]
─────────────────────────                      ────────────────                    ──────────
1. 填完规格后组装 goodsDetail
   (含 gallery/price_detail/sku_sort/
    sku_price/sku_key/movingConfig/
    anti_content...)
2. goodsDetail 写 localStorage + IndexedDB
3. 生成 anti_content (见 §6)
4. pdd_set_hijack_flag ──────────────────────→ hijackFlags[tabId] = {
     (runtime.sendMessage)                       needHijack:true, goodsDetail,
                                                timestamp:now }
                                              DNR sessionRule 挂 block
                                              (挡 goodsCommit/action/edit)
5. 商家点「提交」→ 原生 fetch 被 DNR block
                                              ┌─ 6. webRequest.onBeforeRequest 命中
                                              │    flag/TTL(5min)/processing 三重校验
                                              │    TextDecoder 解 requestBody.raw[0].bytes
                                              │    JSON.parse → 原始 body
                                              │
7.                                           ←┤    pdd_transform_request_body ──→ postMessage →
   transformRequestBody(body, goodsDetail)  ←────────────────────────────────────── 页面收到
   四步流水线 (见 §4)
   前后 _pddSummarizeEditBody 快照            │    (30s 超时)
   结果写 localStorage.kdds_pdd_requestBody  ←┘ 页面回 pdd_transform_response
                                              8. sleep 2s
                                              9. chrome.cookies.getAll 拼 cookie
                                              10. 先 disablePddEditBlock (关键顺序!)
                                              11. pdd_send_modified_request ────→ postMessage →
                                                                        页面 fetch 重放:
                                                                        POST edit
                                                                        Anti-Content 头
                                                                        credentials:include
                                                                        (30s 超时) ←─┐
                                              12. 失败且 shouldUseProxyFallback → 兜底见 §5
                                              13. 成功: fill_price_complete=true 写回
                                                  disableDNR → notify → 300ms → tabs.reload
                                                  失败: 清 flag 写回 disableDNR → notify
14. 页面 _onPddHijackResultMessage
    resolve _pddHijackWait (120s 超时)
```

证据：`evidence/sw_handlePddSetHijackFlag_87605.js`、`evidence/sw_sw_hijack_goods_commit_51753.js`、`evidence/sw_webrequest_tail.js`（主流程全文）、`evidence/sw_webrequest_tail2.js`（收尾+兜底）、`evidence/sw_finish_success_failure_62294.js`、`evidence/8087_transform_call_site.js`。

---

## 2. 常量表（照抄即可）

```js
const PDD_TRANSFORM_TIMEOUT_MS = 30_000;     // 页面变换流水线超时
const PDD_PAGE_SEND_TIMEOUT_MS  = 30_000;    // 页面 fetch 重放超时
const PDD_MMS_ORIGIN            = "https://mms.pinduoduo.com";
const PDD_HIJACK_FLAG_TTL_MS    = 300_000;   // 置 flag 后 5 分钟内点提交才劫持
const PDD_BLOCK_RULE_BASE       = 910_000;   // DNR 规则 id 基数, ruleId = base + tabId % 1000
const PDD_EDIT_URL_FILTER       = "mms.pinduoduo.com/glide/mms/goodsCommit/action/edit";
const PDD_WEBREQUEST_PATTERN    = "https://mms.pinduoduo.com/glide/mms/goodsCommit/action/edit*";
const PDD_HIJACK_WAIT_MS        = 120_000;   // 页面侧等待结果（_pddHijackWait）
const PAGE_TRACE_MAX            = 60;        // localStorage 环形 trace 上限
```

错误码表：

```js
const PDD_ERROR_CODE = {
  TRANSFORM_TIMEOUT:   "PDD_TRANSFORM_TIMEOUT",
  TRANSFORM_ERROR:     "PDD_TRANSFORM_ERROR",
  REQUEST_BODY_EMPTY:  "PDD_REQUEST_BODY_EMPTY",
  SEND_NETWORK:        "PDD_SEND_NETWORK",
  PROXY_FALLBACK_FAIL: "PDD_PROXY_FALLBACK_FAIL",
  API_BIZ:             "PDD_API_BIZ",
  UNKNOWN:             "PDD_UNKNOWN",
};
```

证据：`evidence/sw_sw_hijack_goods_commit_51753.js`（常量+错误码+DNR 全文）、`evidence/8087_hijackWait_block.js`（120s 等待）。

---

## 3. 拦截机制（DNR block + webRequest 抓包）

### 3.1 挂/摘 DNR block 规则

```pseudo
enablePddEditBlock(tabId):
    ruleId = 910000 + tabId % 1000
    rule = {
        id: ruleId,
        priority: 2,
        action: { type: "block" },
        condition: {
            urlFilter: "mms.pinduoduo.com/glide/mms/goodsCommit/action/edit",
            resourceTypes: ["xmlhttprequest", "other"],
            tabIds: [tabId],                    // 只挡本 tab
        },
    }
    chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule] })
    pddBlockRuleByTab[tabId] = ruleId

disablePddEditBlock(tabId):
    removeRuleIds = [pddBlockRuleByTab[tabId]]  // 兜底再算一次 base+tabId%1000
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds })
```

### 3.2 webRequest 入口与三重校验

```pseudo
chrome.webRequest.onBeforeRequest.addListener(onEdit, { urls: [EDIT_PATTERN] }, ["requestBody"])

onEdit(details):
    flag = hijackFlags[details.tabId]
    if (!flag?.needHijack) return {}                       // 未置 flag：放行（正常提交）
    if (now - flag.timestamp > 300_000):                   // TTL 过期
        delete hijackFlags[tabId]; disablePddEditBlock(tabId); return {}
    if (processingTabIds.has(details.tabId)) return {}     // 防重入
    delete hijackFlags[tabId]; processingTabIds.add(tabId)

    goodsDetail = flag.goodsDetail
    try:
        bytes = details.requestBody.raw[0].bytes           // 空则 PDD_REQUEST_BODY_EMPTY 收尾
        body   = JSON.parse(TextDecoder("utf-8").decode(bytes))
        body2  = await transformRequestBodyWithTimeout(tabId, body, goodsDetail, 30_000)
                 // 改包失败 ⇒ 直接 finishHijackFailure，绝不发原始 body（willUseRawBody:false）
        sleep(2000)                                        // 等页面侧状态沉淀
        cookie = chrome.cookies.getAll({url: PDD_MMS_ORIGIN}).map(c=>`${c.name}=${c.value}`).join("; ")
        anti   = goodsDetail.anti_content || ""

        await disablePddEditBlock(tabId)                   // ★ 必须先摘 block 再重放，否则重放也被挡
        result = await sendPagePddEditRequest(tabId, details.url, body2, anti, 30_000)
        if (!result.success && shouldUseProxyFallback(result)):
            result = await sendProxyRequestOnce(buildProxyPayload(tabId, details.url, body2, anti, cookie))
        result.success ? finishHijackSuccess(tabId, goodsDetail, result.via)
                       : finishHijackFailure(tabId, goodsDetail, pickFailPayload(result))
    finally:
        processingTabIds.delete(tabId); disablePddEditBlock(tabId)
```

### 3.3 兜底判定

```pseudo
shouldUseProxyFallback(r):
    if (!r || r.success) return false
    if (r.networkError || r.authOrEnvError) return true
    s = Number(r.status)
    return s === 401 || s === 403 || s >= 500
        || r.errorCode === SEND_NETWORK || r.errorCode === PROXY_FALLBACK_FAIL
        || (!r.isBizFailure && r.errorCode !== API_BIZ)   // 未知错误也走兜底
```

> **本项目落地替换**：DNR + webRequest 是 MV3 扩展专属；本项目是 puppeteer/CDP，等价实现为 `page.setRequestInterception(true)`，在 `request.url().includes("/glide/mms/goodsCommit/action/edit")` 且 flag 有效时 `request.respond()` 或拦下后 `page.evaluate` 改包重放。**没有 DNR，不需要 block-再放行 的两段式，一次拦截即可**。§3.2 的 sleep(2000) 与「先摘 block」都是为了规避 DNR 时序，CDP 方案可省略。

证据：`evidence/sw_sw_hijack_goods_commit_51753.js`、`evidence/sw_webrequest_tail.js`、`evidence/sw_shouldUseProxyFallback_61112.js`、`evidence/sw_sw_dnr_88623.js` 系列。

---

## 4. transformRequestBody 四步流水线（核心，照抄）

```pseudo
transformRequestBody(commitBody, goodsDetail):     // commitBody = 拼多多原生提交体
    before = _pddSummarizeEditBody(commitBody)     // 快照: {type1,type2,skus,skusPriced,is_draft,goods_id,goods_commit_id}
    this.fillImageData(commitBody, goodsDetail)            // 步1: 图片/视频/装修
    this.fillSkuPriceData(commitBody, goodsDetail)         // 步2: SKU 价格/库存/货号
    this.fillShippingConfig(commitBody, goodsDetail)       // 步3: 运费/发货/两件折扣
    this.applyPddElecGoodsAttributes(commitBody)           // 步4: 电子发货属性
    after = _pddSummarizeEditBody(commitBody)
    localStorage.setItem("kdds_pdd_requestBody", JSON.stringify(commitBody))
    return commitBody                                 // SW 侧对比 before/after 做 type1Delta/skusPricedDelta 增量验证
```

### 4.1 步1 fillImageData：图片/视频/装修字段

```pseudo
fillImageData(e, t):                                  // e=commitBody, t=goodsDetail
    if (t.gallery?.length > 0):  e.gallery = t.gallery          // 整组替换（type1=主图, type2=详情图）
    if (t.floor_list?.length > 0): e.decorationDetail = t.floor_list   // 装修楼层
    if (t.preview_url):           e.decorationPreview = t.preview_url  // 装修预览
    if (t.video_upload?.check_comment === "通过"):               // 视频已转码通过才带上
        e.gallery.push({
            file_id: t.video_upload.id,
            height:   t.video_upload.extra_info.height,
            type:     6,                                          // 6 = 视频
            url:      t.video_upload.extra_info.video_cover_url,  // 封面
            video_url:t.video_upload.url,
            width:    t.video_upload.extra_info.width,
        })
```

### 4.2 步2 fillSkuPriceData：SKU 价格/库存/货号（最复杂）

```pseudo
fillSkuPriceData(e, t):
    skus      = e.skus
    priceDetail = t.price_detail        // 采集来的「页面已发布价格表」(稳定表)
    skuSort   = t.sku_sort || []        // 页面规格排序
    moving    = t.movingConfig || {}
    singleBuy = {                       // 单买价规则（movingConfig 优先）
        rule_type: moving.pdd_single_buy_rule_type ?? t.pdd_single_buy_rule_type,
        percent:   moving.pdd_single_buy_percent   ?? t.pdd_single_buy_percent,
        fixed_yuan:moving.pdd_single_buy_fixed_yuan?? t.pdd_single_buy_fixed_yuan,
    }
    skuPrice  = t.sku_price || {}       // 精确价格表（采集或手填）
    skuKey    = t.sku_key || {}         // 规格名→key 映射
    multiDim  = skuSort.length > 2                              // >2 规格值 ⇒ 多维模式
    stable    = (!multiDim && keys(skuKey).length>0) ? buildStablePriceDetailForFill(t) : null
    priceTable = (stable 非空) ? stable
                : (priceDetail 非空) ? priceDetail : null

    stockMode = getPddStockMode(t)      // 2 = 自定义库存
    stock = stockMode === 2 ? getPddCustomInventory(t)
                            : parseInt(moving.inventory ?? t.inventory) || 999   // 默认 999

    if (!skus) return
    e.out_goods_sn = resolveSafePddOutGoodsSn(t, moving)   // 商家编码，安全兜底

    if (skuSort.length === 0):                     // 无规格商品
        return fillNoSpecSkuPriceDataInRequest(e, t, skus, singleBuy)
    if (multiDim && keys(skuPrice).length === 0) return        // 多维但无价格表：不动
    hasTable = !multiDim && keys(skuPrice).length>0 && keys(skuKey).length>0
    if (!multiDim && !priceTable && !hasTable) return          // 一无所有：不动

    orderedKeys = hasTable ? getOrderedSkuKeyIdsWithPrice(t) : []
    singleFallback = resolveSingleSkuPriceFallback(t)          // 单 SKU 兜底价

    for sku in skus:
        if (!sku.spec?.length) continue
        specs = collectSpecTextsFromPddSku(sku)                // 规格文本数组
        dim1, dim2 = cleanSpecName(specs[0]), cleanSpecName(specs[1])

        priceRec = null
        if (multiDim):
            priceRec = findPriceDataForMultiDimensionalSku(skuPrice, skuKey, specs, skuSort)
        elif (orderedKeys 有效且长度匹配):                       // 行码占位模式
            priceRec = normalizeSkuPriceRecord(skuPrice[orderedKeys[i++]])
        else:                                                   // 二维降级链，逐级尝试:
            priceRec ||= findTwoDimPriceByCombinedSingleSpec(t, specs[0])      // a. 合并单规格串
            priceRec ||= findTwoDimPriceByFirstDimOrdinal(t, specs[0], cache)  // b. 首维序数
            priceRec ||= findPriceDataByPublishedSpec(t, specs)                // c. 已发布规格精确
            priceRec ||= findPriceDataForSkuFuzzy(priceTable, ...)             // d. 模糊
            priceRec ||= (hasTable && specs.length>=2) ? findTwoDimPriceFromSkuMatrixUnordered(t, specs) : null  // e. 无序矩阵
            priceRec ||= singleFallback?.priceData                             // f. 单 SKU 兜底

        if (priceRec):
            yuan     = extractPrice(priceRec)                          // 支持对象/数字/字符串
            [fen, yuanStr] = priceToFenAndYuan(yuan)                   // 团价（multi_price）
            single   = computePddSingleBuyYuan(yuan, singleBuy)        // 单买价
            sku.multi_price = fen;  sku.multi_price_in_yuan = yuanStr
            sku.price = singleFen;  sku.price_in_yuan = singleStr
            applyResolvedStockToCommitSku(sku, resolveSkuStockForFill(t, priceRec, stock))
                //   delete sku.quantity; sku.quantity_delta = n; sku.is_onsale = n>0 ? 1 : 0
            sku.thumb_url ??= 取采集缩略图
            sku.out_goods_sn ??= resolveSafePddOutGoodsSn(...)
        else:                                                          // 未命中 ⇒ 下架该 SKU
            sku.multi_price = 0; sku.multi_price_in_yuan = "0"
            sku.price = 0;       sku.price_in_yuan = "0"
            sku.quantity_delta = 0; sku.is_onsale = 0
    // 汇总统计 C = {total, ok, miss, via, missSamples} 写 trace
```

**单买价规则 computePddSingleBuyYuan：**

```pseudo
computePddSingleBuyYuan(priceYuan, cfg):
    if (cfg.rule_type === 2): return priceYuan + (cfg.fixed_yuan ?? 1)      // 固定加价（默认+1元）
    else:                     return priceYuan * (1 + (cfg.percent ?? 20)/100)  // 百分比（默认+20%）
```

**无规格商品 fillNoSpecSkuPriceDataInRequest：**

```pseudo
fillNoSpecSkuPriceDataInRequest(e, t, skus, singleBuy):
    yuan = t.price 或 price_detail 兜底
    skus[0].multi_price/multi_price_in_yuan = priceToFenAndYuan(yuan)
    skus[0].price/price_in_yuan             = priceToFenAndYuan(computePddSingleBuyYuan(yuan, singleBuy))
    applyResolvedStockToCommitSku(skus[0], stock || 999)
    applyPddMarketReferencePrice(e, t)      // market_price = max(各SKU多买价) + 1 元
```

### 4.3 步3 fillShippingConfig：运费/发货/两件折扣

```pseudo
fillShippingConfig(e, t):
    moving = t.movingConfig || {}
    if (moving.template):
        e.cost_template_id = moving.template
        e.is_default_template_id = 1
    if (moving.selectTime):
        e.shipment_limit_second = ("today"|"1"|"24h"|"2" → 86400;  "48h"|"3" → 172800)
    d = t.sku_multi_discount ?? moving.sku_multi_discount
    d = isNaN(d) ? 9.9 : d
    if (d < 5 || d > 9.9) d = 9.9            // 折扣夹在 [5, 9.9]
    e.two_pieces_discount = round(10 * d)    // 9.9折 → 99
```

### 4.4 步4 applyPddElecGoodsAttributes：电子发货属性

```pseudo
applyPddElecGoodsAttributes(e):
    if (!e 或 e 无 elec_goods_attributes 键) return            // 页面没开电子发货就不动
    v = e.elec_goods_attributes
    if (v == null || typeof v !== "object" || Array.isArray(v)) return
    v.time_type = 3        // 自动发货
    v.days_time  = 15      // 15 天
```

证据：`evidence/8087_transformRequestBody_def.js`（流水线+fillImageData+fillSkuPriceData 全文）、`evidence/8087_fillShippingConfig_def.js`、`evidence/8087_applyPddElecGoodsAttributes_def.js`、`evidence/8087_fillNoSpecSkuPriceDataInRequest_def.js`、`evidence/8087_applyPddMarketReferencePrice_def.js`、`evidence/8087_buildStablePriceDetailForFill_def.js`、`evidence/8087_getPddStockMode_def.js`、`evidence/8087_summarizeEditBody_def.js`。

---

## 5. 发送与兜底

### 5.1 页面内 fetch 重放（主通道）

```pseudo
_pddPageSendModifiedEdit(url, body, antiContent):
    resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Anti-Content": antiContent || "" },
        body: JSON.stringify(body),
        credentials: "include",                 // ★ 页面身份带 cookie
    })
    text = await resp.text()
    if (!text.trim())                return { networkError:true, authOrEnvError:true, errorCode:SEND_NETWORK }
    json = tryParse(text) || return { networkError:true, authOrEnvError:true, errorCode:SEND_NETWORK }  // 非 JSON
    if (resp.status === 401 || 403)  return { networkError:true, authOrEnvError:true, errorCode:SEND_NETWORK }
    if (json.success === true)       return { success:true, status:resp.status, result:json }
    return { isBizFailure:true, error_msg: json.error_msg || json.errorMsg, errorCode:API_BIZ }
```

### 5.2 云端代理兜底（觅千手自有云端，复刻需替换）

```pseudo
sendProxyRequestOnce(payload):
    // payload = { method:"POST", url, data:body,
    //             headers:{ "User-Agent", "Content-Type":"application/json",
    //                        "Cache-Control":"max-age=0", "Anti-Content",
    //                        "cookie", "Origin":"https://mms.pinduoduo.com", "Referer":tab.url } }
    resp = await fetch("https://safe.koudai89.com/plugin/api/move/proxyRequest", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })
    json = await resp.json()
    return json.data?.success === true ? { success:true, via:"proxy" }
                                       : { isBizFailure:true, error_msg:..., via:"proxy" }
```

> **本项目落地替换**：`safe.koudai89.com` 是觅千手自家云端，不可依赖。等价方案：本项目 puppeteer 页面内重放本身就是「同源+同 cookie+页面指纹」，覆盖了该兜底的大部分场景（云端兜底主要救「页面 fetch 被 CSRF/风控拦」）。若仍需兜底，走本项目 `gateway-proxy`（带完整浏览器指纹头，见项目请求头规则）由 Node 侧代发，Anti-Content 与 cookie 原样透传。

### 5.3 成功/失败收尾

```pseudo
finishHijackSuccess(tabId, goodsDetail, via):
    goodsDetail.fill_price_complete = true
    updateGoodsDetailInLocalStorage(tabId, goodsDetail)   // chrome.scripting.executeScript + btoa(unescape(encodeURIComponent(json)))
    disablePddEditBlock(tabId)
    notifyPageHijackResult(tabId, { success:true, detailMessage:"劫持填价成功 | via=" + via })
    sleep(300); chrome.tabs.reload(tabId)                 // ★ 重载页面刷新商品列表状态

finishHijackFailure(tabId, goodsDetail, payload):
    delete goodsDetail.fill_price_complete                // 不持久化 false
    updateGoodsDetailInLocalStorage(tabId, goodsDetail)
    disablePddEditBlock(tabId)
    notifyPageHijackResult(tabId, payload)                // biz→API_BIZ / abnormal→其余错误码
```

证据：`evidence/8087_summarizeEditBody_def.js`（_pddPageSendModifiedEdit 全文）、`evidence/sw_sendPagePddEditRequest_58940.js`、`evidence/sw_sendProxyRequestOnce_57433.js`、`evidence/sw_finish_success_failure_62294.js`。

---

## 6. Anti-Content 生成（m_062_8174，可原样移植）

拼多多提交接口要求 `Anti-Content` 请求头（JS 风控签名）。觅千手的做法：**借用拼多多自己的 webpack 模块生成签名，跨 world 用 localStorage 回传**。

```pseudo
// 在页面主世界注入 <script>：
waitForWebpackJsonp(50ms × 100 轮):                    // 等 window.webpackJsonp 出现
findWebpackRequire():
    for chunk of window.webpackJsonp:
        if (typeof chunk[3] === "function") return chunk[3]     // 标准 webpackJsonp 数组第 4 位是 require
    fallback1: window.__webpack_require__
    fallback2: 模拟 require：找 chunk[1]['fbeZ'] 直接取模块
window.sj = webpackRequire
window.getAntiContent = () => {
    var anti = window.sj('fbeZ');          // 拼多多内部的 Anti-Content 类
    var res  = new anti();
    res.updateServerTime(Date.now());      // 服务器时间校准
    return res.messagePack();
}

// isolated world 调用（跨 world 经 localStorage）：
injectScript(`window.__PDD_ANTI_RESULT__ = getAntiContent(); localStorage.setItem(...)`)
pollLocalStorage(50ms × 40, timeout 10s) → antiContent 字符串
```

**本项目落地**：puppeteer 的 `page.evaluate` 直接运行在页面主世界，**无需跨 world 回传**——`page.evaluate(() => { /* findWebpackRequire... */ return getAntiContent() })` 一步拿到。`sj('fbeZ')` 的模块 id `fbeZ` 是拼多多打包固定值，随平台改版可能变化；失效时在 webpackJsonp 各模块里找导出含 `updateServerTime`/`messagePack` 方法的模块即可重新定位。

证据：`rea-gm-modules/m_062_8174.js`（全文 8294B，未截取归档——模块完整，复刻时直接读原文）、`evidence/8087_anti_generator_def.js`、`evidence/8087_fetch_anti_*.js`（三处调用点）。

---

## 7. 消息协议表（MV3 版；本项目落地为进程内调用）

| 消息 type | 方向 | 载荷要点 | 超时 |
|---|---|---|---|
| `pdd_set_hijack_flag` | 页面→SW | `{goodsDetail}`；SW 存 `hijackFlags[tabId]={needHijack,goodsDetail,timestamp}` 并挂 DNR；goodsDetail 缺失则拒绝 | - |
| `pdd_transform_request_body` | SW→loader→页面 | loader 生成 `messageId = pdd_transform_${Date.now()}_${random}`，postMessage `{type:"pdd_transform_request", messageId, requestBody, goodsDetail, useLocalGoodsDetailFallback, source:"kdcm_extension_v3"}`；页面无 goodsDetail 时从 `localStorage.goodsDetail` 回退 | 30s |
| `pdd_transform_response` | 页面→loader→SW | 改好的 body；loader 以 messageId 配对回 sendResponse | 30s |
| `pdd_send_modified_request` | SW→loader→页面 | `{url, requestBody, antiContent}` → 页面 `_pddPageSendModifiedEdit` | 30s |
| `pdd_send_modified_response` | 页面→loader→SW | §5.1 的结果对象 | 30s |
| `pdd_hijack_result` | SW→loader→页面 | finishHijack 的 `{success, errorCode, userMessage, detailMessage, pddErrorMsg}`；页面 resolve `_pddHijackWait`（120s） | - |
| `pdd_save_to_indexeddb` | 页面→SW | 大值存档（goodsDetail 持久化） | 5s |

- **source 常量**：`kdcm_extension_v3`（loader→页面）、`kdcm_pdd_publisher`（页面→loader）。runtime 通道在 8087 模块内被显式拒绝（`use_postMessage_channel`）——**页面世界代码只信 postMessage**。
- **messageId 去重**：`window.__PDD_MSG_INFLIGHT` Set + `window.__PDD_PUBLISHER_INSTANCE` 单例，防重复监听。
- **publishUrls 白名单**：`goods/category`、`goods_add/index`、`goods_add/success` 三页才激活 S 类。

**本项目落地**：puppeteer 场景没有双 world 隔离（`page.evaluate` 直达页面世界），整张协议表坍缩为**进程内函数调用**：

```
置flag       → hijackState.set(tabId/page, goodsDetail)   // 不再需要 DNR
改包         → page.evaluate(transformRequestBody, body, goodsDetail)
重放         → page.evaluate(_pddPageSendModifiedEdit, url, body2, anti)
通知/收尾    → 直接函数返回值；page.reload()
```

证据：`src-mirror/script/content_script_loader_v3.js`（全文 10814B）、`evidence/8087_setupMessageListener.js`、`evidence/8087_pdd_transform_request_handler.js`、`evidence/8087_send_modified_request_branch.js`、`evidence/8087_messageListener_pdd_cases.js`。

---

## 8. 字段映射总表（goodsDetail → commitBody）

| # | goodsDetail 字段 | commitBody 字段 | 变换 | 备注 |
|---|---|---|---|---|
| 1 | `gallery[]` | `gallery` | 整组替换 | type1=主图，type2=详情图 |
| 2 | `floor_list[]` | `decorationDetail` | 整组替换 | 装修楼层（长图文） |
| 3 | `preview_url` | `decorationPreview` | 直传 | 装修预览图 |
| 4 | `video_upload`(check_comment==="通过") | `gallery.push({type:6,...})` | 构造 | file_id/url/width/height/封面 |
| 5 | `price_detail` / `sku_price`+`sku_key` | `skus[].multi_price`(+`_in_yuan`) | 分/元双写 | 匹配链见 §4.2 |
| 6 | 单买价规则（rule_type/percent/fixed_yuan） | `skus[].price`(+`_in_yuan`) | §4.2 公式 | 团价+1元 或 +20% |
| 7 | （匹配结果） | `skus[].quantity_delta` | delete quantity 后写 | 增量库存 |
| 8 | （匹配结果） | `skus[].is_onsale` | 1/0 | 未匹配⇒0 下架 |
| 9 | 采集缩略图 | `skus[].thumb_url` | 直传 | 未命中不清 |
| 10 | `out_goods_sn` 规则 | `skus[].out_goods_sn` + body 级 | resolveSafePddOutGoodsSn | 商家编码安全兜底 |
| 11 | `movingConfig.template` | `cost_template_id` + `is_default_template_id=1` | 直传 | 运费模板 |
| 12 | `movingConfig.selectTime` | `shipment_limit_second` | today/1/24h/2→86400；48h/3→172800 | 发货时效 |
| 13 | `sku_multi_discount` | `two_pieces_discount` | round(10×d)，d 夹 [5,9.9] 默认 9.9 | 两件折扣 |
| 14 | `elec_goods_attributes`(存在且非数组) | `time_type=3, days_time=15` | 常量 | 电子发货 |
| 15 | （计算） | `market_price` | max(各SKU多买价)+1 元 | 市场参考价 |
| 16 | `inventory`(movingConfig 优先) | `skus[].quantity_delta` 默认 | parseInt 默认 999；stockMode=2 走自定义 | 库存 |
| 17 | `goods_commit_id`/`goods_id`/`is_draft` | 原生自带 | 不动 | 快照统计用 |

> 原生 commitBody 的**其余全部字段（类目、属性、标题、SKU 结构 spec 列表、detail_gallery 等）原样保留**——这正是模式2 的本质：只换「会被搬家的数据」，不动「页面已生成的结构」。

---

## 9. 模式1 → 模式2 对接与本项目落地清单

### 9.1 分工切分（复用模式1 的前半段）

| 阶段 | 模式1（现有 `src/pdd-publish.ts`） | 模式2（新增） |
|---|---|---|
| 开页/登录态 | ✓ 复用 | 复用 |
| 类目搜索选择 | ✓ 复用 | 复用 |
| 标题/属性/主图上传 | ✓ 复用（gallery 字段除外） | 复用 |
| 规格表填写（建 SKU 结构） | ✓ 复用（只建结构不填价） | **复用，但价格列可留白** |
| SKU 价格/库存/货号 | UI 填表（慢、易错位） | **改包注入（本底稿 §4.2）** |
| 提交 | 页面点提交按钮 | **拦截改包重放（本底稿 §3/§5）** |

### 9.2 施工清单（按依赖顺序）

1. **antiContent 生成器**（§6）：`page.evaluate` 版 findWebpackRequire + `sj('fbeZ')`；独立函数，先做，可单独验收（console 打印 anti 串非空）。
2. **transformRequestBody 纯函数移植**（§4）：四步流水线 + 全部辅助函数，输入 `(commitBody, goodsDetail)` 输出新 body；纯逻辑无 DOM 依赖，可写单测（用 evidence 代码做 golden case）。
3. **拦截器**（§3 的 CDP 版）：`page.setRequestInterception(true)`，URL 匹配 `goodsCommit/action/edit`；拦下后解析 body → 调 2 → `page.evaluate` 重放（§5.1）→ 按结果收尾（§5.3：成功 `fill_price_complete` + `page.reload()`）。
4. **goodsDetail 组装层**：把模式1 的 product JSON + 采集数据组装成 §8 左列的 goodsDetail 结构（价格表生成 `price_detail`/`sku_price`+`sku_key`）。
5. **增量验证**（原生已有）：`_pddSummarizeEditBody` 前后快照，断言 `skusPriced` 增量 > 0、未命中 SKU 数为预期值；失败不发包（原生 `willUseRawBody:false` 原则必须保留）。
6. **兜底**（§5.2 替换版）：页面重放失败 → 网关代发（完整指纹头 + Anti-Content + cookie 透传）。
7. **回归**：`dev/patrol-publish.mjs` 加模式2 跑法；验收线沿用既定标准（同类目 10 连成功 / ≥3 类目 / 零风控 / 一键回退模式1）。

### 9.3 与原生实现的差异清单（刻意不照抄的部分）

| 原生 | 本项目 | 原因 |
|---|---|---|
| DNR block + webRequest + 摘规则两段式 | CDP request interception 一次拦 | 架构不同，CDP 更简单可靠 |
| postMessage 双 world 桥 + messageId 去重 | `page.evaluate` 直调 | puppeteer 无 world 隔离 |
| localStorage/IndexedDB 落库回传 | 进程内变量 + 模式1 已有存档 | 存储层本项目已有 |
| `safe.koudai89.com` 云端兜底 | 本项目 gateway-proxy 兜底 | 第三方云端不可依赖 |
| SW `chrome.cookies.getAll` | `page.evaluate(document.cookie)` + CDP cookie | 同源页面即可拿全量 |
| sleep(2000)/sleep(300) 等时序补偿 | 视真机调试保留或去除 | DNR 时序问题不存在于 CDP |

---

## 10. 风险与边界

- **`sj('fbeZ')` 模块 id 依赖拼多多打包**：平台改版可能换 id。失效特征：anti 为空/接口 403。恢复方法：遍历 webpackJsonp 模块找 `updateServerTime`+`messagePack` 特征。
- **提交接口路径**：`/glide/mms/goodsCommit/action/edit` 改版即失效，拦截匹配要保持前缀宽松（`goodsCommit/action/` 前缀 + 后缀白名单）。
- **改包失败绝不发原始包**（原生 `willUseRawBody:false` 铁律）：失败=商品按页面价格上架，比不上架更危险。
- **TTL 5 分钟**：置 flag 后超时未提交自动放行，避免「永远挡提交」的事故。
- **两件折扣夹值 [5,9.9]**、**库存默认 999**、**单买价默认 +20%**：这些默认值是觅千手调优过的风控安全值，照抄。
- **合规**：本方案只改「自己店铺自己提交」的请求，与 UI 自动化等价；Anti-Content 借用拼多多自家页面代码生成，不破解算法本身。

---

## 附：证据文件索引

`evidence/`（44 份，`_manifest.json` 有字节清单；源为 `Temp\mqs-swarm\extracted\`，重跑 `archive-evidence.mjs` 可从 Temp 再同步）：

- **8087 系列**（页面世界 S 类，模块 m_042_8087 = `_gm.js` 拼多多上架模块）：`transformRequestBody_def`（四步流水线）、`fillImageData_def`、`fillSkuPriceData_def`、`fillShippingConfig_def`、`applyPddElecGoodsAttributes_def`、`fillNoSpecSkuPriceDataInRequest_def`、`applyPddMarketReferencePrice_def`、`buildStablePriceDetailForFill_def`、`getOrderedSkuKeyIdsWithPrice_def`、`getPddStockMode_def`、`findPriceDataForMultiDimensionalSku_def`、`resolveSafePddOutGoodsSn_def`、`summarizeEditBody_def`（快照+页面重放+trace 全文）、`setupMessageListener`、`pdd_transform_request_handler`、`transform_request_body_handler`、`send_modified_request_branch`、`transform_call_site`、`hijackWait_block`、`messageListener_pdd_cases`、`localstorage_keys_table`、`anti_generator_def`、`fetch_anti_*`（3 处调用点）、`antiContent_passthrough`、`anti_content_172432`、`const_underscore_34301`、`testFillSkuPrice_diag`、`msg_listener_tail`
- **sw 系列**（Service Worker，`service_worker_new.js`）：`sw_hijack_goods_commit_51753`（常量+DNR+trace）、`webrequest_tail`（劫持主流程）、`webrequest_tail2`（收尾+proxy 分支）、`handlePddSetHijackFlag_87605`、`finish_success_failure_62294`、`sendPagePddEditRequest_58940`、`sendProxyRequestOnce_57433`、`shouldUseProxyFallback_61112`、`transform_timeout_55198`、`sw_dnr_*`（3 份）、`sw_webRequest_63874`、`sw_set_hijack_flag_74943`
- **未归档整文件**（复刻时直接读）：`C:\Users\Administrator\AppData\Local\Temp\mqs-swarm\rea-gm-modules\m_062_8174.js`（Anti-Content 全文）、`...\src-mirror\script\content_script_loader_v3.js`（桥协议全文）、`C:\Users\Administrator\mqs-swarm-docs-result\`（7 篇文档 + verify-facts.mjs 84 条断言）
