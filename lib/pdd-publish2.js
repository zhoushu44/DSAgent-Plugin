import { parseProduct, validateProduct } from './services/product-schema.js';
import { pddPublish, } from './pdd-publish.js';
/**
 * 把统一商品数据映射为拼多多发布选项。
 * 导出以便单测：映射是纯函数，不触碰浏览器/网络。
 */
export function toPddOptions(p, extra) {
    const opts = {
        title: p.title,
        images: p.images,
    };
    if (p.detailImages?.length)
        opts.detailImages = p.detailImages;
    if (p.category)
        opts.category = p.category;
    if (p.price)
        opts.price = p.price;
    if (p.stock)
        opts.stock = p.stock;
    if (p.itemNo)
        opts.itemNo = p.itemNo;
    if (p.specs?.length) {
        opts.specs = p.specs.map(d => ({
            name: d.name,
            values: d.values.map(v => ({ value: v.value, image: v.image })),
        }));
    }
    if (p.skus?.length) {
        opts.skuRows = p.skus.map(s => ({
            specs: s.specs,
            price: s.price,
            stock: s.stock,
            itemNo: s.itemNo,
        }));
    }
    if (p.attributes?.length) {
        opts.attributes = p.attributes.map(a => ({ name: a.name, value: a.value }));
    }
    const account = String(extra.account ?? '').trim() || p.account;
    if (account)
        opts.account = account;
    if (extra.agentId)
        opts.agentId = extra.agentId;
    if (extra.attrModel)
        opts.attrModel = extra.attrModel;
    if (extra.costTemplate)
        opts.costTemplate = extra.costTemplate;
    if (extra.deliveryTime != null)
        opts.deliveryTime = extra.deliveryTime;
    if (extra.confirm === true)
        opts.confirm = true;
    // ★ 2026-10-29 组件化：把外部注入的 DOM 填规格函数透传给 pddPublish
    //   （publish.mjs 挂的 sku-component.asDomFillSpecs；不传则段4 走旧 fillSkuSpecMulti）
    if (typeof extra.domFillSpecs === 'function') {
        opts.domFillSpecs = extra.domFillSpecs;
    }
    if (extra.editGoodsId != null && String(extra.editGoodsId).trim())
        opts.editGoodsId = String(extra.editGoodsId).trim();
    return opts;
}
/**
 * 发布拼多多商品（统一数据入口）。
 * 流程：解析统一数据 → 本地校验 → 映射为发布选项 → 交给 pddPublish 执行。
 */
export async function pddPublish2(store, opts) {
    const parsed = parseProduct(opts.product);
    if (parsed.error || !parsed.product) {
        return { ok: false, failureKind: 'api_error', text: parsed.error || '商品数据解析失败。' };
    }
    const invalid = validateProduct(parsed.product);
    if (invalid) {
        return { ok: false, failureKind: 'api_error', text: `商品数据校验未通过：${invalid}` };
    }
    const pddOpts = toPddOptions(parsed.product, opts);
    if (opts.mode2) {
        // 模式2：动态 import 规避编译期/运行时循环依赖，在使用点加载劫持引擎。
        // costTemplate 传模板名（字符串）时原样透传：模式2 movingConfig.template 期望的是
        // 模板 ID，由 buildGoodsDetailFromProduct 负责把模板名解析为 ID（模式1 的 fillShippingAndFreight
        // 走 UI 搜索模板名，两者数据形态不同，故此处不做转换）。
        const mode2 = await import('./pdd-mode2.js');
        pddOpts.hijack = {
            goodsDetail: mode2.buildGoodsDetailFromProduct(parsed.product, {
                costTemplate: opts.costTemplate,
                deliveryTime: opts.deliveryTime,
                // ★ 2026-10-21：外部规格池（规格值→spec_id），供改包行数重建写 spec_id。
                //   来源：店铺历史商品采集（collect_spec_pool.mjs → spec-pool.json）。
                specIds: opts.specIds,
            }),
        };
        // PDD_MODE2_TRACE=1 时把拦截链路 trace 打到 console（排查 via=page 失败原因用）
        if (process.env.PDD_MODE2_TRACE === '1') {
            pddOpts.hijack.onTrace = (step, data) => {
                try {
                    console.log(`[pdd-mode2][trace] ${step}`, data ? JSON.stringify(data) : '');
                }
                catch { /* 忽略 */ }
            };
        }
    }
    return pddPublish(store, pddOpts);
}
//# sourceMappingURL=pdd-publish2.js.map