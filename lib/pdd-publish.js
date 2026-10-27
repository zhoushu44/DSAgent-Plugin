/**
* 拼多多 商家后台 商品发布 — host 半区 puppeteer 实现。
*
* 为什么必须走浏览器而不能走网关纯 HTTP：
*   1. 发布的核心动作是**图片文件上传（multipart 二进制）**，而网关 handleProxy
*      只支持字符串 body（http_get / http_post / mtop_jsonp），没有 multipart 能力。
*   2. 商家后台发布页的类目、属性与提交接口都要求页面 JS 运行时生成的签名
*      与真实会话票据（PASS_ID），纯 HTTP 复刻不可行。
*   3. 开放平台的 pdd.goods.add 只对**已审核通过的自研应用**开放，
*      普通店铺拿不到资质，因此只能驱动商家后台网页版发布页。
*
* ★★ 发布的正确入口是**类目选择页 + 单页完整表单**，不能直接敲表单 URL（2026-10 真机实测）：
*   直接 goto /goods/goods_add/index 会得到一个「空壳页」——#goods-category 为空、
*   底部按钮永远是「加载中」且 disabled、发布表单自身的初始化接口一个都不发。
*   原因是该页需要 type=add&from=category&id=<类目id>&goods_id=<商品id>
*   这组上下文参数，而它们由平台在「选择分类」页点「确认发布该类商品」时即时生成。
*
*   ★ 流程已变更（旧版「两步式」——category 页直接出主图+标题表单、底部「下一步」——已废除，
*     旧锚点 #goods_name / button#bottomSubmitBtnId / local_upload 在 category 页全部不存在）。
*   本工具严格按 2026-10-14 真机实测的新链路走四段：
*     段 1  打开商品列表 /goods/goods_list → 点右上角「发布新商品」（会**新开标签页**）
*     段 2  选择分类页 /goods/category?id=…&goods_id=…&type=add
*           → 类目搜索框输关键词 → 点搜索结果（选叶子类目）→ 点「确认发布该类商品」
*     段 3  发布表单页 /goods/goods_add/index?type=add&from=category&id=…
*           → **同页跳转**（targetchanged，非新标签页），表单此时才真正初始化
*     段 4  填通用字段 → 点「提交并上架」→ 轮询结果
*
* 页面与控件锚点来源：**本机真机实测**（非推测、非影刀旧选择器）。
* ★ 注意：影刀（ShadowBot）工程 xbot_robot/selectorsV2.xml 里的锚点已**全部过时**，
*   实测已证伪，切勿再参考：
*     - 类目面板 .cate-container-v2 —— 实为 .category_v4_cateContainerV4__2jyMc（v4）
*     - 提交按钮 button#submit_button —— 不存在
*   实测有效的锚点：
*     - 列表入口按钮：   文本恰为「发布新商品」的最内层可见元素
*     - 类目搜索框：     input[placeholder*="搜索分类"]（placeholder「请输入关键词搜索分类」。
*                       ★ 不能放宽为 [placeholder*="搜索"]：会先命中顶部全局搜索框）
*     - 类目搜索结果：   li.SPP_searchItem_*（完整路径文本，untrusted click 有效）
*     - 类目确认按钮：   文本恰为「确认发布该类商品」的可见 button（untrusted click 有效）
*     - 表单标题：       input[data-tracking-click-viewid="title_input_area"]
*     - 表单主图：       input[data-tracking-click-viewid="carousel_img_localfile_upload"]
*     - 表单提交：       文本恰为「提交并上架」的可见 button
*     - 提交成功：       div[data-testid="beast-core-toast"] / 「查看商品详情」
*     - 风控滑块：       div#slide-captcha-dialog / .captcha-wrapper__slider /
*                       div.slide-handlebar / #slide-button
*
* ★ 与淘宝发布的根本差异：拼多多发布页**没有 iframe**（淘宝主图走 sucai-selector-ng
*   素材选择器 iframe），所有控件都在主文档里，直接操作即可。
* ★ 另一处差异：拼多多的滑块风控是**页内内联**的（不是淘宝那种 baxia iframe 拦截页），
*   因此不能交给 dsagent_risk_verify 另开窗口处理 —— 本工具改为在**已打开的可见窗口内**
*   等待用户完成拼图后自动继续（见 waitSliderCleared）。
*
* ★ 字段策略（2026-10 流程变更后重定）：**类目自动搜索选择 + 通用字段自动填 + 其余人工兜底**
*   自动：类目（category 参数驱动搜索框，缺省时从标题提取关键词；如「童装/婴儿装/亲子装 > 套装 > 套装」）、
*         主图、标题、参考价、库存、货号、商品属性（用**宿主对话模型**从「页面真实下拉选项」里选，
*         见 fillAttributes；品牌因涉及品牌授权，不自动填）
*   人工兜底：发货/售后设置、商品资质 —— 由用户在可见浏览器窗口内补全；
*             若提交被校验拦住，工具会把「商品填写建议」面板里的真实拦因读回来
*             （见 readSubmitErrors），并继续等待、识别用户手动提交的结果。
*/
import { resolveAccountForRequest } from './services/credential-store.js';
import { CAPTCHA_SELF_HEAL } from './pdd-captcha.js';
import { applyStealth } from './stealth-inject.js';
import { preuploadProductImages } from './pdd-image-preupload.js';
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile, sleep, UI_STEP_DELAY_MS } from './browser-login.js';
import { createAttrCache } from './services/attr-cache.js';
import { loadPublishConfig, anchorSpec, configString, configTimeout } from './services/publish-config-loader.js';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
/** 商品列表入口 —— 发布的**唯一正确起点**（从列表点「发布新商品」才会带上完整上下文参数）。
 *  配置来源：publish-config/pdd.json → urls.goodsList（refreshPddConfig 热加载） */
let PDD_GOODS_LIST_URL = 'https://mms.pinduoduo.com/goods/goods_list';
/** 风控模块（skills/_shared/pdd-risk.mjs）所在插件根 —— 由 lib 位置向上推 */
const PLUGIN_ROOT_FOR_RISK = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * 诊断日志（写文件）。
 *
 * ★ 为什么需要：本工具的 console.log 只在宿主进程里，调用方（模型/用户）看不到，
 *   导致「填了多少行、表格真实行数、哪个格子失败」全靠猜。写进文件后可直接读。
 *   仅记录结构性事实，不含 Cookie / 票据等敏感信息。
 */
const DIAG_LOG = join(homedir(), '.dsh', 'pdd-publish-diag.log');
function diag(msg) {
    try {
        writeFileSync(DIAG_LOG, `[${new Date().toISOString()}] ${msg}\n`, { flag: 'a' });
    }
    catch { /* 诊断失败不影响主流程 */ }
    console.log(`[dsagent-pdd-publish] ${msg}`);
}
/** 账号连接页展示的平台 id（凭证库 platform 字段取值） */
const PLATFORM = 'pdd_mms';
/** 第一步（选择分类）页 URL 特征（regexes.step1Url） */
let STEP1_URL_RE = /\/goods\/category\?/;
/**
 * 第二步（完整表单）页 URL 特征（regexes.step2Url）。
 * ★ 真机实测实际 URL：
 *   /goods/goods_add/index?type=add&from=category&id=<类目id>
 *     &goods_id=<商品id>&sourcePage=goodsList
 *   参数会随入口变化，故**只认路径前缀**，
 *   不写死 `index?`（写死会在参数形态变化时寻址失败，卡在第一步）。
 */
let STEP2_URL_RE = /\/goods\/goods_add\//;
/** 类目搜索框（placeholder「请输入关键词搜索分类」。★ 不能放宽为 [placeholder*="搜索"]：会先命中顶部全局搜索框）（anchors.cateSearchInput） */
let CATE_SEARCH_INPUT = 'input[placeholder*="搜索分类"]';
/** 类目确认按钮文案（选好类目后点它跳表单页）（anchors.cateConfirmButton 第 3 候选的文案） */
let CATE_CONFIRM_TEXT = '确认发布该类商品';
/** 类目选择页就绪标志（= 类目搜索框；两常量语义不同，分开保留）（anchors.step1Ready）
 *  ★ 2026-10-27 平台改版：选过类目后 /goods/category 直接跳到表单第一步
 *    （商品主图 + 商品标题 + 「下一步，完善商品信息」按钮），不再显示类目搜索框。
 *    因此就绪标志放宽为「类目搜索框 或 表单页标题输入框」任一出现。 */
let STEP1_READY_SELECTOR = 'input[placeholder*="搜索分类"], input[placeholder*="商品标题组成"], input[data-tracking-click-viewid="title_input_area"]';
/** 第二步就绪标志（标题输入框 或 类目展示区出现）（anchors.step2Ready） */
let STEP2_READY_SELECTOR = 'input[data-tracking-click-viewid="title_input_area"], #goods-category';
/** 第二步主图 file input（真机实测锚点，表单页唯一主图入口）（anchors.mainImageInput） */
let STEP2_IMAGE_INPUT = 'input[data-tracking-click-viewid="carousel_img_localfile_upload"]';
/** 第二步「商品详情」图片 file input（真机实测锚点；离屏隐藏 input，直接投递即可）（anchors.detailImageInput） */
let STEP2_DETAIL_INPUT = 'input[data-tracking-click-viewid="detail_img_localfile_upload"]';
/** 详情图张数上限（页面计数「已上传 N/50张」）（limits.maxDetailImages） */
let MAX_DETAIL_IMAGES = 50;
/** SKU 规格类型：SKU 带预览图 → 用视觉规格「颜色」（真机实测候选里第一项是噪声「官方 客服 1」） */
const SKU_SPEC_TYPE = '颜色';
/** 等商品列表就绪（同时处理滑块与登录失效）（timeouts.listWaitMs） */
let LIST_WAIT_MS = 60_000;
/** 等表单就绪（中间可能夹着用户手动补全）（timeouts.formWaitMs） */
let FORM_WAIT_MS = 150_000;
/** 点提交后等结果（含用户手动补全字段后自行提交的时间）（timeouts.publishTimeoutMs） */
let PUBLISH_TIMEOUT_MS = 180_000;
/** 命中内联滑块后，等用户在窗口内完成拼图的时长（timeouts.sliderWaitMs） */
let SLIDER_WAIT_MS = 120_000;
/** 单张主图上限：商家后台主图要求 ≤ 3MB（limits.maxImageBytes） */
let MAX_IMAGE_BYTES = 3 * 1024 * 1024;
/** 主图张数上限（拼多多主轮播图最多 10 张，超出以页面提示为准）（limits.maxImages） */
let MAX_IMAGES = 10;
/** 标题长度上限（placeholder 标注「最多输入30个汉字（60个字符）」）（limits.maxTitleLen） */
let MAX_TITLE_LEN = 60;
/** 库存默认值：调用方未指定时按 1000 填（真机实测库存是平台提交硬性必填，留空必被拦）（limits.defaultStock） */
let DEFAULT_STOCK = '1000';
/** 单次属性选值请求超时：模型不可用要快速跳过，不能拖垮发布流程（timeouts.attrModelTimeoutMs） */
let ATTR_MODEL_TIMEOUT_MS = 20_000;
/** 展开下拉 / 选值后的等待（beast-core Select 有展开动画与异步选项）（timeouts.attrDropdownWaitMs） */
let ATTR_DROPDOWN_WAIT_MS = 800;
/** 不自动填的属性：品牌涉及品牌授权，选错有侵权风险，一律留给人工（regexes.attrSkip） */
let ATTR_SKIP_RE = /^品牌$/;
/* ══════════════════════════════════════════════════════════════════
 * JSON 配置驱动（PUBLISH-SPEC §3）：上面所有 let 常量的初值 = 历史硬编码
 * 兜底，refreshPddConfig() 在每次发布入口处用 publish-config/pdd.json
 * 覆盖它们 —— **改 JSON 一行无需重启宿主**（loader 带 mtime 缓存热加载）。
 * ★ 行为零变化纪律：本步只替换「字符串常量来源」，不改任何执行逻辑；
 *   evaluate 内联选择器（滑块/NAV_SEL/提交按钮/计数正则）本步不动。
 * ══════════════════════════════════════════════════════════════════ */
/** 当前生效的 pdd.json 配置（refreshPddConfig 维护） */
let PDD_CFG = null;
/** titleInput 的三个填写入口（fillTitle 消费；初值 = 历史硬编码兜底）：
 *  ① 锚点候选 join 成的 CSS 列表（anchors.titleInput.candidates）
 *  ② placeholder 兜底正则源（anchors.titleInput.placeholderFallbackRe）
 *  ③ fillField 通用关键词兜底正则源（anchors.titleInput.fillFieldFallbackRe） */
let TITLE_INPUT_SELECTORS = '#goods_name input[data-testid="beast-core-input-htmlInput"], input[data-tracking-click-viewid="title_input_area"]';
let TITLE_PLACEHOLDER_RE_SRC = '商品标题组成|最多输入30个汉字';
let TITLE_FILLFIELD_RE_SRC = '商品标题|请输入标题|标题';
/** cateConfirmButton 的候选（selectCategory ③ 消费；初值 = 历史硬编码兜底）：
 *  selN 为第 N 个 CSS 候选；lastCandidateText 恰等文案兜底（对应 `text:` 前缀候选）。 */
let CATE_CONFIRM_SEL1 = 'button[data-tracking-click-viewid="cate_confirm"]';
let CATE_CONFIRM_SEL2 = 'button[data-tracking-impr-viewid="confirm_publish_this_type_product"]';
let CATE_CONFIRM_LAST_TEXT = '确认发布该类商品';
/** 详情区引导气泡「知道了」点掉文案正则源（uploadDetailImages 消费；初值 = 历史硬编码兜底） */
let GUIDE_BUBBLE_DISMISS_RE_SRC = '^\\s*知道了\\s*$';
/** 多候选锚点归一为 CSS 逗号列表（候选全是 CSS 才可用；XPath 锚点本步不在此消费） */
function anchorCssList(cfg, key) {
    return anchorSpec(cfg, key).candidates.map(c => c.selector).join(', ');
}
/**
 * 从 publish-config/pdd.json 刷新全部配置常量。
 * - loader fail-fast（缺配置 throw），这里捕获后返回错误信息，
 *   由调用方决定返回 `{ok:false}` —— 配置坏宁可发布失败，也不静默用旧锚点。
 * - 未曾成功加载过时（PDD_CFG === null）保持硬编码初值，行为与改造前一致。
 * @returns null=成功；string=错误信息
 */
function refreshPddConfig() {
    let cfg;
    try {
        cfg = loadPublishConfig('pdd');
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return PDD_CFG ? `发布配置刷新失败（沿用上次加载的配置）：${msg}` : `发布配置加载失败：${msg}`;
    }
    PDD_CFG = cfg;
    try {
        const L = cfg.limits;
        if (L.maxImageBytes > 0)
            MAX_IMAGE_BYTES = L.maxImageBytes;
        if (L.maxImages > 0)
            MAX_IMAGES = L.maxImages;
        if (L.maxTitleLen && L.maxTitleLen > 0)
            MAX_TITLE_LEN = L.maxTitleLen;
        if (L.maxDetailImages && L.maxDetailImages > 0)
            MAX_DETAIL_IMAGES = L.maxDetailImages;
        if (L.defaultStock)
            DEFAULT_STOCK = L.defaultStock;
        const u = configString(cfg, 'urls', 'goodsList');
        if (u)
            PDD_GOODS_LIST_URL = u;
        const r1 = cfg.regexes?.step1Url;
        if (r1)
            STEP1_URL_RE = new RegExp(r1);
        const r2 = cfg.regexes?.step2Url;
        if (r2)
            STEP2_URL_RE = new RegExp(r2);
        const rSkip = cfg.regexes?.attrSkip;
        if (rSkip)
            ATTR_SKIP_RE = new RegExp(rSkip);
        LIST_WAIT_MS = configTimeout(cfg, 'listWaitMs', LIST_WAIT_MS);
        FORM_WAIT_MS = configTimeout(cfg, 'formWaitMs', FORM_WAIT_MS);
        PUBLISH_TIMEOUT_MS = configTimeout(cfg, 'publishTimeoutMs', PUBLISH_TIMEOUT_MS);
        SLIDER_WAIT_MS = configTimeout(cfg, 'sliderWaitMs', SLIDER_WAIT_MS);
        ATTR_MODEL_TIMEOUT_MS = configTimeout(cfg, 'attrModelTimeoutMs', ATTR_MODEL_TIMEOUT_MS);
        ATTR_DROPDOWN_WAIT_MS = configTimeout(cfg, 'attrDropdownWaitMs', ATTR_DROPDOWN_WAIT_MS);
        // 锚点：多候选 join 成 CSS 列表（与原硬编码字符串形态一致，使用点零改动）
        CATE_SEARCH_INPUT = anchorCssList(cfg, 'cateSearchInput');
        const step1Ready = anchorCssList(cfg, 'step1Ready');
        if (step1Ready)
            STEP1_READY_SELECTOR = step1Ready;
        STEP2_READY_SELECTOR = anchorCssList(cfg, 'step2Ready');
        STEP2_IMAGE_INPUT = anchorCssList(cfg, 'mainImageInput');
        STEP2_DETAIL_INPUT = anchorCssList(cfg, 'detailImageInput');
        // titleInput：锚点候选 + 两级回退正则（fillTitle 消费）
        const titleSpec = anchorSpec(cfg, 'titleInput');
        TITLE_INPUT_SELECTORS = titleSpec.candidates.map(c => c.selector).join(', ');
        if (titleSpec.placeholderFallbackRe)
            TITLE_PLACEHOLDER_RE_SRC = titleSpec.placeholderFallbackRe;
        if (titleSpec.fillFieldFallbackRe)
            TITLE_FILLFIELD_RE_SRC = titleSpec.fillFieldFallbackRe;
        // cateConfirmButton：逐候选映射（`text:` 前缀 = 恰等文案兜底）
        const confirmSpec = anchorSpec(cfg, 'cateConfirmButton');
        const sels = confirmSpec.candidates.filter(c => !c.selector.startsWith('text:')).map(c => c.selector);
        const texts = confirmSpec.candidates.filter(c => c.selector.startsWith('text:')).map(c => c.selector.slice('text:'.length));
        if (sels.length >= 1)
            CATE_CONFIRM_SEL1 = sels[0];
        if (sels.length >= 2)
            CATE_CONFIRM_SEL2 = sels[1];
        if (texts.length)
            CATE_CONFIRM_LAST_TEXT = texts[texts.length - 1];
        CATE_CONFIRM_TEXT = CATE_CONFIRM_LAST_TEXT;
        // guideBubbleDismissText：字符串简写归一为单候选，值即正则源（clickByTextReal 消费）
        const g = anchorSpec(cfg, 'guideBubbleDismissText').candidates[0];
        if (g && g.selector)
            GUIDE_BUBBLE_DISMISS_RE_SRC = g.selector;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `发布配置字段缺失/非法（沿用当前值）：${msg}`;
    }
    return null;
}
/**
 * 类目属性缓存 —— 同平台+同类目发相似商品时复用上次成功填的值，省模型 API 调用。
 * ★ 命中缓存后仍读当前下拉选项做验证，选项变了就 fallback 到模型（不硬塞旧值）。
 * 落盘在 ~/.dsh/.attr-cache.json（与凭证库、skill-stats 同目录）。
 *
 * ★ 与 taobao-publish 同一处缺陷：必须用 ESM import，不能用 `require()`。
 *   本项目是 `"type": "module"`，`require` 在 ESM 作用域下不存在，
 *   会在模块求值时报 `ReferenceError` 并拖垮整个 host 半区（本文件被 index.ts 静态 import）。
 */
const attrCache = createAttrCache(join(homedir(), '.dsh', '.attr-cache.json'));
/** 本工具在 Profile 锁中的占用者标识（用于互斥提示文案） */
const PROFILE_OWNER = '拼多多发布';
/**
 * 给一段填表操作套「卡死看门狗」：超过 budgetMs 仍未返回就**截图 + 打印页面文案**，
 * 用于定位到底被什么挡住（弹层 / 滑块 / 报错 toast）。
 *
 * 背景（真机实测）：某次 run 在第二步填价处静默卡死 9 分钟无输出，事后无任何现场证据，
 * 只能靠猜。puppeteer 单次 click 默认空等 30s 超时，几格叠加就是分钟级黑洞，
 * 因此这里既加超时看门狗，也把各次 click 的超时压到 5s（见 fillPriceTable）。
 *
 * 注意：看门狗只做诊断，**不中断**正在跑的 fn（无法安全打断 puppeteer 调用链），
 * 真正的兜底是各处各自的短超时。
 */
async function withStallWatch(page, label, budgetMs, fn) {
    let fired = false;
    const timer = setTimeout(() => {
        fired = true;
        void (async () => {
            try {
                const png = await page.screenshot({ fullPage: false }).catch(() => null);
                if (png) {
                    writeFileSync(`.tmp-stall-${label}.png`, png);
                    console.log(`[dsagent-pdd-publish] ★「${label}」已卡住 ${Math.round(budgetMs / 1000)}s，截图：.tmp-stall-${label}.png`);
                }
                const txt = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 600))
                    .catch(() => '');
                console.log(`[dsagent-pdd-publish] ★「${label}」卡住时页面文案：${txt}`);
            }
            catch { /* 仅诊断，失败无所谓 */ }
        })();
    }, budgetMs);
    try {
        return await fn();
    }
    finally {
        clearTimeout(timer);
        if (fired)
            console.log(`[dsagent-pdd-publish] 「${label}」最终已返回（看门狗已触发过）`);
    }
}
/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 *
 * ★ 候选集只取 `platform === 'pdd_mms'`（拼多多商家后台），**不做凭证层降级**：
 *   买家 H5（platform `pdd`）与商家后台是两套完全独立的登录态，
 *   拿 H5 的 Cookie 去 mms.pinduoduo.com 必然登录失败，降级只会把用户引向错的账号。
 */
function selectAccount(store, opts) {
    const candidates = store.listAccounts()
        .filter(a => a.status !== 'invalid')
        .filter(a => a.platform === PLATFORM);
    if (!candidates.length) {
        return {
            account: null,
            choices: [],
            error: {
                ok: false,
                failureKind: 'not_bound',
                text: '未找到拼多多商家后台账号。请引导用户打开「账号连接」页面添加**拼多多商家后台**账号'
                    + '（登录 mms.pinduoduo.com，可用拼多多 App 扫码或账号密码）；'
                    + '注意它与「拼多多」（买家 H5）是两套独立登录态，买家账号不能用于发布商品。',
            },
        };
    }
    const res = resolveAccountForRequest(candidates, { shopKey: opts.account, agentId: opts.agentId });
    if (!res.account) {
        const lines = res.choices.map((c, i) => `${i + 1}. ${c.nickname}（账号ID=${c.accountId}，shopKey=${c.shopKey}，状态=${c.status}）`);
        return {
            account: null,
            choices: res.choices,
            error: {
                ok: false,
                failureKind: 'need_account_choice',
                accounts: res.choices,
                text: [
                    `拼多多商家后台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
                    '为避免选错账号（错号会静默影响所有使用该平台的技能），请先向用户确认要用哪一个：',
                    ...lines,
                    '',
                    '用户选定后，把对应的 shopKey 传给本次调用的 account 参数重调。★ 绝不要自己挑一个。',
                ].join('\n'),
            },
        };
    }
    return { account: res.account, choices: [] };
}
/** 生成发布预览文案（confirm 前给用户看） */
function buildPreview(account, opts, images) {
    const detailImages = opts.detailImages || [];
    const skus = opts.skus || [];
    const specs = opts.specs || [];
    const skuRows = opts.skuRows || [];
    const attrs = opts.attributes || [];
    /** 单买价一律按「拼单价 + 1」自动算（平台硬规则：单买价 ≥ 拼单价+1） */
    const singleOf = (p) => {
        const n = Number((p || '').trim());
        if (!p || !Number.isFinite(n) || n <= 0)
            return '（未填）';
        return String(Math.round((n + 1) * 100) / 100);
    };
    // 多维规格预览（颜色 × 尺码 …）
    const specLines = [];
    if (specs.length) {
        specLines.push(`规格维度（${specs.length} 维）：`);
        for (const d of specs) {
            specLines.push(`  - ${d.name}（${d.values.length} 个值）：${d.values.map(v => v.value).join(' / ')}`);
            const withImg = d.values.filter(v => String(v.image || '').trim());
            if (withImg.length)
                specLines.push(`     含预览图：${withImg.map(v => v.value).join('、')}`);
        }
        specLines.push(`SKU 组合（${skuRows.length} 行）：`);
        for (const r of skuRows) {
            const combo = Object.entries(r.specs).map(([k, v]) => `${k}=${v}`).join(' ');
            const p = (r.price || '').trim() || (opts.price || '').trim();
            specLines.push(`  - ${combo}：拼单价 ${p || '（未填）'}`
                + ` / 单买价 ${singleOf(p)}`
                + ` / 库存 ${(r.stock || '').trim() || (opts.stock || '').trim() || DEFAULT_STOCK}`);
        }
    }
    return [
        '【发布预览 · 需用户确认】',
        '渠道：拼多多（商家后台 mms.pinduoduo.com）',
        `账号：${account.display_label || account.account_id}（${account.shop_key}）`,
        `标题：${opts.title}`,
        `类目：${(opts.category || '').trim() ? `${(opts.category || '').trim()}（类目选择页搜索词）` : `（未填，从标题自动提取搜索词）`}`,
        `商品参考价：${(opts.price || '').trim() || '（未填，留待页面人工填写）'}`,
        `库存：${(opts.stock || '').trim() || '（未填，留待页面人工填写）'}`,
        `货号：${(opts.itemNo || '').trim() || '（未填）'}`,
        `主图（${images.length} 张）：`,
        ...images.map(p => `  - ${p}`),
        `详情图（${detailImages.length} 张）：${detailImages.length ? '' : '（未提供，跳过）'}`,
        ...detailImages.map(p => `  - ${p}`),
        ...(specs.length
            ? specLines
            : [
                `SKU 多规格（${skus.length} 个规格值）：`,
                ...skus.map(s => `  - ${s.name}：拼单价 ${(s.price || '').trim() || '（未填）'}`
                    + ` / 单买价 ${singleOf(s.price)}`
                    + ` / 库存 ${(s.stock || '').trim() || (opts.stock || '').trim() || DEFAULT_STOCK}`
                    + ` / 预览图 ${(s.image || '').trim() || '★ 未提供（平台必填，会被拦）'}`),
            ]),
        ...(attrs.length
            ? ['商品属性（显式指定）：', ...attrs.map(a => `  - ${a.name}=${a.value}`)]
            : []),
        '',
        '★ 本工具自动填「类目（选择页自动搜索）/ 主图 / 标题 / 商品参考价 / 库存 / 货号 / 商品详情图 / SKU 规格（含预览图与价格）」，',
        '  并尽力自动选「商品属性」（品牌除外；模型不可用时走标题词匹配 + 选第一项兜底）。',
        `  发货与售后（非预售 + ${(() => {
            const dt = opts.deliveryTime ?? 1;
            return dt === 2 ? '24小时发货' : dt === 3 ? '48小时发货' : '当日发货';
        })()})${opts.costTemplate ? ` / 运费模板（${opts.costTemplate}）` : ' / 运费模板（自动沿用上次成功模板）'} 也会自动填，`,
        '  品牌和商品资质**不会**被自动填写，需在弹出的浏览器窗口内人工补全。',
        '',
        '确认无误后，请让用户明确同意，然后带 confirm=true 重新调用本工具才会真正打开浏览器提交。',
        '注意：发布是不可撤销的真实操作（L2）。',
    ].join('\n');
}
/**
 * 登录态判定：商家后台未登录时会跳到 mms.pinduoduo.com/login，
 * 或原地渲染扫码/账号密码登录入口。
 */
async function isLoggedOut(page) {
    try {
        const url = String(page.url() || '');
        if (/mms\.pinduoduo\.com\/login|passport\.pinduoduo\.com/i.test(url))
            return true;
        return await page.evaluate(() => /扫码登录|账号密码登录|立即注册|登录后查看/.test((document.body?.innerText || '').slice(0, 1500)));
    }
    catch {
        return false;
    }
}
/**
 * 风控判定：商家后台的**页内内联滑块**。
 *
 * 影刀实测的锚点：div#slide-captcha-dialog.captcha-wrapper.captcha-wrapper__slider
 * → div.slide-handlebar（innerText「请向右滑块完成拼图」），外加 #slide-button 拖动块。
 * 它不在 iframe 里，因此没有可透传的 verifyUrl。
 */
async function detectRisk(page) {
    try {
        return await page.evaluate(() => {
            const node = document.querySelector('#slide-captcha-dialog, .captcha-wrapper__slider, .slide-handlebar, #slide-button, .slide-button-wrapper');
            if (node)
                return true;
            return /请向右滑块完成拼图|请按住滑块|拖动滑块|请完成安全验证/.test((document.body?.innerText || '').slice(0, 4000));
        }).catch(() => false);
    }
    catch {
        return false;
    }
}
/** 等用户在可见窗口内把滑块拼完（滑块消失即视为通过） */
async function waitSliderCleared(page, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        await sleep(2000);
        if (!(await detectRisk(page)))
            return true;
    }
    return false;
}
/** 在给定 scope 内找可用的文件上传控件 */
async function findFileInput(scope) {
    try {
        const handles = await scope.$$('input[type=file]');
        for (const h of handles) {
            const disabled = await h.evaluate((el) => !!el.disabled).catch(() => true);
            if (!disabled)
                return h;
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * 页面守卫：每轮等待前先检查「页内内联滑块」与「登录失效」。
 * 命中滑块则在**已打开的可见窗口内**等用户拖完 —— 拼多多的滑块是页内内联的，
 * 无法像淘宝那样交给 dsagent_risk_verify 另开窗口处理。
 */
async function guardPage(page) {
    if (await detectRisk(page)) {
        console.log('[dsagent-pdd-publish] 命中内联滑块，等待用户在窗口内完成拼图...');
        if (!(await waitSliderCleared(page, SLIDER_WAIT_MS))) {
            return {
                ok: false,
                kind: 'risk_control',
                text: '拼多多后台弹出了「请向右滑块完成拼图」安全验证，等待 '
                    + `${SLIDER_WAIT_MS / 1000}s 仍未通过。\n`
                    + '请重试本工具，并在弹出的浏览器窗口内**手动拖动滑块完成拼图**；通过后本工具会自动继续。\n'
                    + '（该滑块是页内内联的，无法由 dsagent_risk_verify 另开窗口处理。）',
            };
        }
        console.log('[dsagent-pdd-publish] 滑块已通过，继续流程。');
    }
    if (await isLoggedOut(page)) {
        return {
            ok: false,
            kind: 'token_expired',
            text: '拼多多商家后台登录态已失效（页面要求登录）。\n'
                + '请到「账号连接」页面重新登录**拼多多商家后台**账号（mms.pinduoduo.com）。\n'
                + '注意：这与「拼多多」（买家 H5）是两套独立登录态，重登买家账号无效。',
        };
    }
    return { ok: true };
}
/** 轮询等待某个条件成立，每轮先过 guardPage（滑块 / 登录失效优先中断） */
async function waitFor(page, probe, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const g = await guardPage(page);
        if (!g.ok)
            return g;
        if (await probe(page).catch(() => false))
            return { ok: true };
        await sleep(2000);
    }
    return {
        ok: false,
        kind: 'timeout',
        text: `等待「${label}」超过 ${Math.round(timeoutMs / 1000)}s 仍未出现。`,
    };
}
/** 把守卫失败统一转成工具返回（登录失效时顺带订正账号状态） */
async function guardFailResult(fail, store, shopKey, finalUrl) {
    if (fail.kind === 'token_expired') {
        try {
            await store.setStatus(shopKey, 'expired');
        }
        catch { /* 忽略 */ }
    }
    return { ok: false, failureKind: fail.kind, shopKey, finalUrl, text: fail.text };
}
/** 跨标签页轮询等待 URL 匹配的页面（点「发布新商品」会新开标签页，不能只盯当前页） */
async function waitForPage(browser, re, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const pages = await browser.pages();
        const hit = pages.find((p) => re.test(String(p.url() || '')));
        if (hit)
            return hit;
        await sleep(1000);
    }
    return null;
}
/**
 * 段 1：在商品列表页点「发布新商品」。
 *
 * ★ 真机实测：列表页上文本恰为「发布新商品」的元素共 8 个 —— 其中 4 个在**左侧导航栏**
 *   （`nav/aside` 内），点了只会跳到 `?msfrom=mms_sidenav` 那个**没有上下文参数**的
 *   /goods/category 页，导致「下一步」永远走不到第二步表单。真正的入口是工具栏里那个
 *   `button.BTN_primary`（不在导航区内）。因此这里必须**先排除导航区**，再取最内层可点元素。
 */
async function clickPublishEntry(listPage) {
    return await listPage.evaluate(() => {
        const NAV_SEL = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]';
        const all = Array.from(document.querySelectorAll('button, a, div, span'))
            .filter(el => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0)
                return false;
            if ((el.innerText || '').trim() !== '发布新商品')
                return false;
            return !el.closest(NAV_SEL); // ★ 排除左侧导航栏里的同名项
        });
        if (!all.length)
            return false;
        /**
         * ★ 2026-10-22 真机复测修复：原逻辑先取 innermost 再找 BUTTON，
         *   但工具栏按钮结构是 `DIV > MmsUiMmsTag > BUTTON.BTN_primary > SPAN`——
         *   SPAN 也在 all 里且被 BUTTON 包含，于是 innermost 只剩 SPAN，
         *   `find(BUTTON)` 落空 → 回退点 SPAN → React 忽略 untrusted click → 页面不跳转。
         *   这正是「点击发布新商品后 60s 内未出现类目选择页」的根因。
         *
         *   新策略：**先在全集里找 BUTTON**（优先级最高，工具栏按钮就是 BUTTON），
         *   找不到再退回 innermost，最后退回全集最后一个。
         */
        const btn = all.find(e => e.tagName === 'BUTTON');
        const innermost = all.filter(e => !all.some(o => o !== e && e.contains(o)));
        const el = btn || innermost[innermost.length - 1] || all[all.length - 1];
        if (!el)
            return false;
        el.click();
        return true;
    }).catch(() => false);
}
/**
 * 对**已打标记**的元素派发真实鼠标点击（取不到坐标时退回 DOM click 兜底）。
 *
 * ★ 为什么必须用 CDP 真实鼠标：真机实测 `element.click()` 派发的是 untrusted 事件，
 *   拼多多的 React 处理器会忽略它（「下一步」「添加规格类型」上都复现过）。
 */
async function realClickMarked(page, selector) {
    const h = await page.$(selector).catch(() => null);
    const rect = h ? await h.boundingBox().catch(() => null) : null;
    if (rect) {
        const ok = await page.mouse
            .click(rect.x + rect.width / 2, rect.y + rect.height / 2)
            .then(() => true).catch(() => false);
        if (ok)
            return true;
    }
    return await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el)
            return false;
        el.click();
        return true;
    }, selector).catch(() => false);
}
/**
 * 按文案找到最内层可点元素，打标记后用**真实鼠标**点它。
 * 用于没有稳定锚点、只能靠文案定位的按钮（如「添加规格类型」）。
 * 返回点中的元素描述；未命中返回 `''`。
 */
async function clickByTextReal(page, textReSrc) {
    const marked = await page.evaluate((src) => {
        const re = new RegExp(src);
        const vis = (el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const els = Array.from(document.querySelectorAll('button,[role=button],a,span,div'))
            .filter(el => {
            if (!vis(el))
                return false;
            const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
            return t.length > 0 && t.length <= 20 && re.test(t);
        });
        if (!els.length)
            return '';
        // 只取最内层（剔除「自身命中、但后代也命中」的容器），优先 BUTTON
        const inner = els.filter(e => !els.some(o => o !== e && e.contains(o)));
        const el = inner.find(e => e.tagName === 'BUTTON') || inner[inner.length - 1];
        document.querySelectorAll('[data-pdd-txt]').forEach(e => e.removeAttribute('data-pdd-txt'));
        el.setAttribute('data-pdd-txt', '1');
        el.scrollIntoView({ block: 'center' });
        return `${el.tagName} | ${(el.innerText || '').trim().slice(0, 40)}`;
    }, textReSrc).catch(() => '');
    if (!marked)
        return '';
    await sleep(350); // 等 scrollIntoView 落定后再取坐标
    const ok = await realClickMarked(page, '[data-pdd-txt="1"]');
    return ok ? marked : '';
}
/**
 * 段 2：在类目选择页搜索并选中类目，然后点「确认发布该类商品」。
 *
 * ★ 2026-10 真机实测（新流程）：/goods/category 现在是**必经类目选择页**
 *   （类目搜索框 + 类目树 + 确认按钮），旧版「category 页直接出主图+标题表单」已废除。
 * ★ untrusted click 在本页**有效**（入口点击 / 搜索结果点击 / 确认按钮点击均实测成功），
 *   无需 CDP 真实鼠标。
 *
 * @returns 选中的类目路径文本（如「童装/婴儿装/亲子装 > 套装 > 套装」）；失败返回 ''
 */
async function selectCategory(page, keyword, categoryPath) {
    // ★ 2026-10-27 平台改版适配：
    //   情况 A：类目页直接是表单第一步（商品主图+标题+「下一步」按钮）→ 类目已自动选好
    //   情况 B：类目页有「确认发布该类商品」按钮 → 类目已选好（最近使用/已选分类），点确认即可
    //   情况 C：真正的类目搜索页（有搜索框，需要搜+选）→ 走原流程
    const state = await page.evaluate(() => {
        const hasTitle = !!document.querySelector('input[placeholder*="商品标题组成"], input[data-tracking-click-viewid="title_input_area"]')
        const hasNext = [...document.querySelectorAll('button, a, div, span')]
            .some(e => /下一步|完善商品信息/.test((e.innerText || e.textContent || '').trim()))
        const hasConfirm = [...document.querySelectorAll('button, a, div, span')]
            .some(e => /确认发布该类商品/.test((e.innerText || e.textContent || '').trim()))
        return { hasTitle, hasNext, hasConfirm }
    }).catch(() => ({ hasTitle: false, hasNext: false, hasConfirm: false }))

    if (state.hasTitle && state.hasNext) {
        diag('类目页已是表单第一步（平台改版，跳过类目搜索）')
        return '(已自动选好类目)'
    }
    if (state.hasConfirm) {
        // 类目已选好，点「确认发布该类商品」
        diag('类目已选好（有确认按钮），点「确认发布该类商品」')
        const pos = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, a, div, span')]
                .map(e => { const r = e.getBoundingClientRect(); return { tx: (e.innerText || e.textContent || '').trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) } })
                .filter(o => /确认发布该类商品/.test(o.tx) && o.w > 30)
            return btns[btns.length - 1] || null
        }).catch(() => null)
        if (pos) {
            await page.mouse.click(pos.x, pos.y).catch(() => { })
            await sleep(3000)
        }
        return '(已确认类目)'
    }
    // ① 类目搜索框：placeholder「请输入关键词搜索分类」。
    //   ★ 不能放宽为 [placeholder*="搜索"]：会先命中顶部全局搜索框（实测踩坑跳到课程页）
    const inputHandle = await page.$(CATE_SEARCH_INPUT).catch(() => null);
    if (!inputHandle) {
        diag('未找到类目搜索框（input[placeholder*="搜索分类"]），可能平台又改版');
        return '';
    }
    await inputHandle.click({ delay: 30 }).catch(() => { });
    // 清空上一次尝试残留的关键词：多候选逐个尝试时，避免新旧关键词拼接成无意义串
    await inputHandle.click({ clickCount: 3, delay: 20 }).catch(() => { });
    await page.keyboard.press('Backspace').catch(() => { });
    await page.keyboard.type(keyword, { delay: 120 });
    // 搜索结果渲染需要时间（实测 3.5s 内稳定出结果）
    await sleep(3500);
    // ② 点搜索结果（选叶子类目）。过滤教程/课程噪声。
    /**
     * ★★ 关键修复（2026-10-20 真机实测）：
     *   搜索结果长这样（`li.SPP_searchItem_*`，完整类目路径）：
     *     童装/婴儿装/亲子装 > 儿童家居服 > 家居服套装
     *     童装/婴儿装/亲子装 > 套装 > 套装
     *     内衣裤袜 > 睡衣/家居服套装 > 女士居家睡衣/家居服套装
     *   原实现要求 `t.includes(关键词)`，即路径里必须含「儿童睡衣」这个**整串** ——
     *   但路径里只有「儿童家居服」，于是 items 为空 → 直接判定「类目搜索无匹配结果」。
     *   这正是发布卡在类目选择的原因。
     *
     *   新策略：
     *     a. 只认真正的类目条目（`li` 且 class 含 SPP_searchItem / searchItem），排除「没有合适的类目？」这类噪声；
     *     b. 把关键词与 categoryPath 各自切词，按**命中词数**打分，而不是要求整串包含；
     *     c. 强力惩罚已知的错误大类（内衣裤袜 / 女士 / 男士）—— 童装绝不能落到成人睡衣类目；
     *     d. 奖励命中「童装 / 儿童 / 家居服 / 套装」这类核心词。
     *
     *   对齐神笔 step 9（处理分类）：在搜索结果中选与目标类目路径最匹配的项。
     */
    const picked = await page.evaluate((kw, catPath) => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        // a. 只取真正的类目条目
        const items = Array.from(document.querySelectorAll('li'))
            .filter(el => {
            if (!vis(el))
                return false;
            const cls = String(el.className || '');
            if (!/SPP_searchItem|searchItem/i.test(cls))
                return false;
            const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
            if (!t || t.length > 120)
                return false;
            if (/没有合适的类目|立即反馈|发布须知|攻略/.test(t))
                return false;
            return true;
        });
        if (!items.length)
            return '';
        const inner = items.filter(e => !items.some(o => o !== e && e.contains(o)));
        // b. 切词：关键词 + 类目路径
        const tokenize = (s) => (s || '')
            .split(/[\s/\\>＞、,，|]+/).map(t => t.trim()).filter(t => t.length >= 2);
        const kwTokens = tokenize(kw);
        const catTokens = tokenize(catPath);
        /**
         * ★ 2026-10-22 修复：原 CORE 词表是童装业务硬编码
         *   （['童装','儿童','婴儿','亲子','家居服','睡衣','套装']），
         *   对非童装商品（纸杯/餐具/食品…）完全失效，打分退化成「路径越短越好」——
         *   实测搜「餐饮具」两次分别选中「一次性餐桌用品>纸杯」和「餐具>盘」，
         *   后者是错类目。
         *
         *   新策略：CORE 词**动态生成** = catTokens 去重（用户给的类目路径分词
         *   就是最准确的核心词），再加少量通用商品词兜底。
         *   FATAL 也保留（防成人内衣类目），但仅在与目标类目无关时才重罚。
         */
        const CORE = [...new Set([...catTokens, ...kwTokens])];
        // 通用兜底核心词（各行业都可能命中，权重低于用户给的路径词）
        const GENERIC = ['一次性', '定制', '批发', '商用', '家用', '套装', '杯', '餐具'];
        // 致命错类目：命中且目标类目完全没提及时重罚
        const FATAL = ['内衣裤袜', '成人', '情趣'];
        const fatalHit = (text) => FATAL.some(f => text.includes(f) && !catTokens.some(t => t.includes(f)));
        let best = inner[0];
        let bestScore = -Infinity;
        for (const el of inner) {
            const text = (el.innerText || '').trim();
            let score = 0;
            // 关键词逐词命中（每个 +8）
            for (const tok of kwTokens)
                if (text.includes(tok))
                    score += 8;
            // 类目路径逐词命中（每个 +12，权重更高）
            for (const tok of catTokens)
                if (text.includes(tok))
                    score += 12;
            // 核心词命中（用户给的路径词 + 关键词，+6）
            for (const c of CORE)
                if (text.includes(c))
                    score += 6;
            // 通用商品词命中（+3，权重低）
            for (const g of GENERIC)
                if (text.includes(g))
                    score += 3;
            // 致命错类目重罚（仅当目标类目完全没提及时）
            if (fatalHit(text))
                score -= 100;
            // 路径越短越好（叶子类目更精准）
            score -= text.length * 0.05;
            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        }
        ;
        best.click();
        return (best.innerText || '').trim().slice(0, 80);
    }, keyword, categoryPath || '').catch(() => '');
    if (!picked) {
        diag(`类目搜索无匹配结果（关键词：${keyword}；类目路径：${categoryPath || '（空）'}）`);
        return '';
    }
    diag(`已点选类目：${picked}（搜索词：${keyword}）`);
    await sleep(800); // 等选中态高亮 + 确认按钮激活
    // ③ 点确认按钮 → 同页跳转到 /goods/goods_add/index 表单页
    //   ★ 修复：改用稳定 data-tracking 锚点（对齐神笔 step 11），不再靠文案匹配。
    //   神笔原文：button[data-tracking-click-viewid="cate_confirm"]
    //            button[data-tracking-impr-viewid="confirm_publish_this_type_product"]
    //   候选来源已抽到 publish-config/pdd.json → anchors.cateConfirmButton
    //   （refreshPddConfig 把候选映射为 CATE_CONFIRM_SEL1/SEL2/LAST_TEXT）。
    const confirmed = await page.evaluate((sel1, sel2, fallbackText) => {
        const btn1 = document.querySelector(sel1);
        if (btn1 && !btn1.disabled) {
            btn1.click();
            return true;
        }
        const btn2 = document.querySelector(sel2);
        if (btn2 && !btn2.disabled) {
            btn2.click();
            return true;
        }
        // 最终兜底：文案匹配
        const btn3 = Array.from(document.querySelectorAll('button'))
            .find(b => (b.innerText || '').trim() === fallbackText);
        if (btn3 && !btn3.disabled) {
            btn3.click();
            return true;
        }
        return false;
    }, CATE_CONFIRM_SEL1, CATE_CONFIRM_SEL2, CATE_CONFIRM_LAST_TEXT).catch(() => false);
    if (!confirmed) {
        diag(`未找到可点的「${CATE_CONFIRM_TEXT}」按钮（已选类目：${picked}）`);
        return '';
    }
    return picked;
}
/**
 * 上传主图。
 *
 * 拼多多发布页**没有 iframe**，主图 file input 就在主文档里、且是**可见**的，
 * 直接用真机实测锚点拿句柄 uploadFile 即可（不需要先点「本地上传」开弹窗）。
 * 锚点落空时兜底取页面上首个可用的 input[type=file]。
 */
/**
 * 读「某个上传控件」自己区块内的「已上传 N/M张」计数。
 *
 * ★ 真机实测（2026-10-14 探针 dev/probe-main-upload.mjs）：
 *   1. 主图区与详情图区**各自**渲染一条「已上传 N/10张」（主图区在「图片要求：…已上传0/10张」里），
 *      对 document.body 全文 match 只会命中 DOM 顺序靠前的那个（主图区）→ 详情图读数会被主图污染。
 *      必须从该区的 file input 向上爬，取**最内层**含计数的祖先容器。
 *   2. 旧计数形态「(N/10)」已下线，现为「已上传N/10张」。
 */
async function readUploadCount(page, inputSelector) {
    return page.evaluate((sel) => {
        const inp = document.querySelector(sel);
        if (!inp)
            return { cur: -1, max: -1 };
        let box = inp;
        for (let i = 0; i < 10 && box.parentElement; i++) {
            box = box.parentElement;
            const m = (box.innerText || '').replace(/\s+/g, ' ')
                .match(/已上传\s*(\d+)\s*\/\s*(\d+)\s*张/);
            if (m)
                return { cur: Number(m[1]), max: Number(m[2]) };
        }
        return { cur: -1, max: -1 };
    }, inputSelector).catch(() => ({ cur: -1, max: -1 }));
}
async function uploadImages(page, images, preferredSelector, scopeLabel) {
    let input = await page.$(preferredSelector).catch(() => null);
    let label = scopeLabel;
    if (!input) {
        input = await findFileInput(page);
        if (input)
            label = `${scopeLabel}（兜底：页面首个可用 file input）`;
    }
    if (!input) {
        return {
            ok: false,
            note: `未找到主图上传控件（${preferredSelector}）。请在浏览器窗口内人工上传主图。`,
        };
    }
    // ★ 真机实测（2026-10-14 探针 dev/probe-main-upload.mjs / 首次真实发布复盘）：
    //   1. 一次性批量 uploadFile 投递多张会被页面**静默丢弃**（5 张主图全丢、12 张详情图 0/12）
    //      —— 必须**逐张投递**，每张等该区计数 +1 后再投下一张（单张直投已证有效）。
    //   2. 完成信号 = 该区「已上传 N/10张」计数（readUploadCount 按 input 祖先容器 scoped 读取）。
    //   3. ★ 无计数 ≠ 已传完：旧逻辑「15s 宽限后按大概率已传完继续」是假成功，
    //      提交会被「商品轮播图不能为空」硬拦 —— 计数不涨必须报失败。
    //   4. 每张投递前**重新取句柄**：上传后 React 重渲染会换掉 input 节点，旧句柄投递无效。
    console.log(`[dsagent-pdd-publish] 在「${label}」逐张上传 ${images.length} 张主图`);
    const base = await readUploadCount(page, preferredSelector);
    let counted = base.cur > 0 ? base.cur : 0;
    for (let i = 0; i < images.length; i++) {
        let uploaded = false;
        for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
            const h = (await page.$(preferredSelector).catch(() => null)) || (await findFileInput(page));
            if (!h)
                break;
            if (attempt > 0)
                console.log(`[dsagent-pdd-publish] 主图第 ${i + 1} 张第 ${attempt + 1} 次投递`);
            await h.uploadFile(images[i]).catch(() => { });
            const waitStart = Date.now();
            while (Date.now() - waitStart < 30_000) {
                await sleep(2000);
                const fail = await page.evaluate(() => /上传失败|图片格式不正确|文件过大|超过大小限制|不支持的文件/.test(document.body?.innerText || '')).catch(() => false);
                if (fail) {
                    return { ok: false, note: '图片上传被页面判为失败（格式或大小不符）。请在浏览器窗口内人工处理主图。' };
                }
                const st = await readUploadCount(page, preferredSelector);
                if (st.cur > counted) {
                    counted = st.cur;
                    uploaded = true;
                }
                if (uploaded)
                    break;
            }
        }
        if (!uploaded) {
            const st = await readUploadCount(page, preferredSelector);
            return {
                ok: false,
                note: `主图第 ${i + 1} 张投递后计数未增长（当前 ${st.cur < 0 ? '无计数' : `${st.cur}/${st.max}`}）。`
                    + '请在浏览器窗口内人工补齐主图后重试。',
            };
        }
        await sleep(800);
    }
    return { ok: true, note: `已通过「${label}」上传 ${images.length} 张主图（区计数 ${counted}/10）` };
}
/**
 * 上传「商品详情」图片。
 *
 * ★ 真机实测锚点：`input[data-tracking-click-viewid="detail_img_localfile_upload"]`
 *   —— 与主图同款**离屏隐藏 input**，直接 `uploadFile` 投递即可（不需要点「本地上传」开弹窗）。
 * ★ 投递前先点掉引导气泡「热区图片组件上线了」（会遮挡且可能误触），点不到就跳过。
 * ★ 完成信号 = 页面出现「已上传 N/M张」计数。
 */
async function uploadDetailImages(page, files) {
    if (!files.length)
        return { ok: true, note: '（未提供详情图，跳过）' };
    // 引导气泡只出现一次，点掉即可；找不到属正常情况
    const bubble = await clickByTextReal(page, GUIDE_BUBBLE_DISMISS_RE_SRC);
    if (bubble) {
        console.log(`[dsagent-pdd-publish] 已点掉详情区引导气泡：${bubble}`);
        await sleep(800);
    }
    const input = await page.$(STEP2_DETAIL_INPUT).catch(() => null);
    if (!input) {
        return {
            ok: false,
            note: `未找到详情图上传控件（${STEP2_DETAIL_INPUT}）。请在浏览器窗口内人工上传详情图。`,
        };
    }
    // ★ 真机实测（2026-10-14 探针 + 首次发布复盘）：批量 uploadFile 多张会被静默丢弃
    //   （12 张投递 0/12），单张有效 —— 与主图同款，逐张投递 + scoped 计数判定。
    //   计数用 readUploadCount 从详情 input 祖先容器读，避免被主图区「已上传N/10张」污染。
    console.log(`[dsagent-pdd-publish] 详情图区逐张上传 ${files.length} 张`);
    const base = await readUploadCount(page, STEP2_DETAIL_INPUT);
    let counted = base.cur > 0 ? base.cur : 0;
    for (let i = 0; i < files.length; i++) {
        let uploaded = false;
        for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
            const h = (await page.$(STEP2_DETAIL_INPUT).catch(() => null)) || (await findFileInput(page));
            if (!h)
                break;
            if (attempt > 0)
                console.log(`[dsagent-pdd-publish] 详情图第 ${i + 1} 张第 ${attempt + 1} 次投递`);
            await h.uploadFile(files[i]).catch(() => { });
            const waitStart = Date.now();
            while (Date.now() - waitStart < 30_000) {
                await sleep(2000);
                const fail = await page.evaluate(() => /图片格式不正确|文件过大|超过大小限制|不支持的文件/.test(document.body?.innerText || '')).catch(() => false);
                if (fail) {
                    return { ok: false, note: '详情图上传被页面判为失败（格式或大小不符）。请在浏览器窗口内人工处理。' };
                }
                const st = await readUploadCount(page, STEP2_DETAIL_INPUT);
                if (st.cur > counted) {
                    counted = st.cur;
                    uploaded = true;
                }
                if (uploaded)
                    break;
            }
        }
        if (!uploaded) {
            const st = await readUploadCount(page, STEP2_DETAIL_INPUT);
            return {
                ok: false,
                note: `详情图第 ${i + 1} 张投递后计数未增长（当前 ${st.cur < 0 ? '无计数' : `${st.cur}/${st.max}`}）。`
                    + '请在浏览器窗口内人工补齐后重试。',
            };
        }
        await sleep(800);
    }
    return { ok: true, note: `已上传 ${counted} 张详情图` };
}
/**
 * 填「规格与库存」区的多规格 SKU。**两条路径按 UI 版本自动分派**：
 *
 * ── 新路径（2026-10-14 起，平台改版后默认）────────────────────────
 * 规格区**预置一行「颜色分类」**（无需再点「添加规格类型」）：
 *   · 一行内是若干「颜色卡」（`new-spec-single-color`），每卡 = 一对输入框
 *     `[选择或输入主色] [备注（偏深/浅等）]` + 「本地上传」（内嵌 file input）+ 「开始排序」。
 *   · ★★ 录入方式 = **在「选择或输入主色」里键入色名 → 真实鼠标点「颜色分类」标题空白处失焦**。
 *     提交后平台**自动补一对空输入框**（非标准色可直接用，仅黄字「建议修改为标准颜色」提示，不拦截）。
 *   · ★★ 提交判据：**非空「主色」框数 = 已提交颜色数**（辅以 SKU 表头出现「颜色分类」列、rows 递增）。
 *     首次提交后 SKU 表头自动出现「*预览图」列——**无需勾「添加图片」**。
 *   · ★★ 预览图 = 该色卡片内嵌的 file input **直接 uploadFile**（点「本地上传」不触发 file chooser），
 *     成功判据 = 卡内出现缩略图（`url(...)` 背景图，约 28x28）。
 *   · 「参考分类」不是标准色选择器，而是**图片上传入口**（图片空间/本地上传），本流程不使用。
 *
 * ── 旧路径（兜底，探测不到「颜色分类」行时，如其他类目）──────────
 *   1. 点「添加规格类型(1/2)」内联出一行 `[规格类型 1 下拉] [☐ 添加图片] 删除规格类型`。
 *   2. 规格类型候选首项是噪声（「官方 客服 1」）→ 按文案精确选「颜色」（SKU_SPEC_TYPE），兜底取第 2 项。
 *   3. 「请输入规格名称」placeholder 被已提交 chip 复用 → 新值框 = 规格容器内**可见的最后一个**该框。
 *   4. 提交动作 = 失焦（真实鼠标点空白处）；判据 = SKU 表头出现「颜色」列且 rows 达到已提交数。
 *   5. 预览图 = 各行「*预览图」单元格里的**离屏** file input（rect -999），须**逐行当场重定位**。
 *   6. 「*预览图」列需先勾「添加图片」自绘复选框。
 *
 * 失败不抛出：未完成项写进 missed，交由主流程汇总（浏览器保持打开，用户可人工补全）。
 * 每个规格值最多重试 3 次，预览图最多重试 2 次（避免无限空转）。
 */
async function fillSkuSpec(page, skus, cfg) {
    if (!skus.length)
        return { filled: [], missed: [] };
    /**
     * ★ 先等规格区容器渲染出来（对齐觅千手 fillSkuOnPage 的时序）。
     *
     * 实测坑：页面先到、规格区后到。不等就检测 → 容器不存在 → detectColorRow 返回 false
     *   → 回退旧版 → 只建出 1 行 SKU。
     *   上次成功那次是因为页面正好渲染完了，这次没渲染完就失败。
     *
     * 最多等 20 秒（规格区渲染慢，但超过 20s 就真没有了）。
     */
    {
        const t0 = Date.now();
        let ready = false;
        while (Date.now() - t0 < 20_000) {
            const ok = await page.evaluate((sel) => {
                const box = document.querySelector(sel);
                return !!box && box.querySelectorAll('.property-container-v2, .goods-spec-row').length > 0;
            }, SPEC_BOX_SEL).catch(() => false);
            if (ok) {
                ready = true;
                break;
            }
            await sleep(600);
        }
        if (ready) {
            console.log(`[dsagent-pdd-publish] 规格区已就绪（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
        }
        else {
            console.log('[dsagent-pdd-publish] 规格区 20s 内未出现，继续检测');
        }
    }
    if (await detectColorRow(page)) {
        console.log('[dsagent-pdd-publish] SKU 规格：检测到预置「颜色分类」行，走新版填写流程');
        return fillSkuSpecColorRow(page, skus, { mode2: !!cfg?.mode2 });
    }
    console.log('[dsagent-pdd-publish] SKU 规格：未检测到「颜色分类」行，回退旧版「添加规格类型」流程');
    return fillSkuSpecLegacy(page, skus, cfg);
}
/**
 * 多维规格填写（最多 2 维）。
 *
 * 流程：先建第 1 维（如「颜色」，可带预览图），再追加第 2 维（如「尺码」）。
 *  - 第 1 维复用 `fillSkuSpec`（自动判预置「颜色分类」行 vs「添加规格类型」旧流程）；
 *  - 第 2 维走 `fillSkuSpecLegacy`，`rowsPerValue` = 第 1 维规格值个数（供提交判据推算行数）。
 *  - 预置「颜色分类」行只对应颜色维：若颜色维不是第 1 维，自动交换，保证颜色维先建。
 * 规格值仅需 name + image（价格/库存由 `fillPriceTable` 逐行填，不在此处理）。
 */
async function fillSkuSpecMulti(page, specs, skuRows, category, options) {
    const filled = [];
    const missed = [];
    /** 模式2：SKU 预览图整体跳过（thumb_url 由改包注入 commitBody.sku） */
    const multiMode2 = !!options?.mode2;
    /**
     * ★ 先等「颜色分类」容器出现（对齐觅千手 fillSkuOnPage 的判断路径）。
     *
     * 实测坑：规格区是**异步渲染**的，页面先到、容器后到。
     *   不等就检测 → 容器不存在 → detectColorRow 返回 false → 回退旧版 → 只建出 1 行。
     *   上次成功那次是因为页面正好渲染完了，这次没渲染完就失败。
     *
     * 这里最多等 20 秒（规格区渲染慢，但超过 20s 就真没有了）。
     */
    {
        const t0 = Date.now();
        let ready = false;
        while (Date.now() - t0 < 20_000) {
            // ★ 2026-10-26：等任意规格行（不再硬编码颜色分类）
            const ok = await detectAnySpecRow(page);
            if (ok) {
                ready = true;
                break;
            }
            await sleep(600);
        }
        diag(`段4 规格区等待：${ready ? '就绪' : '20s 超时仍无规格容器'}（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
        if (!ready) {
            missed.push('SKU 规格区 20s 内未出现规格容器（页面未渲染完）');
            return { filled, missed };
        }
    }
    const dimName = (d) => String(d?.name || '').trim();
    const valName = (v) => String(v?.value || '').trim();
    const toSkuInputs = (d) => d.values.filter(v => valName(v))
        .map(v => ({ name: valName(v), image: String(v.image || '').trim() || undefined }));
    void skuRows;
    if (!specs.length)
        return { filled, missed };
    if (specs.length === 1) {
        const r = await fillSkuSpec(page, toSkuInputs(specs[0]), { specType: dimName(specs[0]), rowsPerValue: 1, category });
        return { filled: r.filled, missed: r.missed };
    }
    let d1 = specs[0];
    let d2 = specs[1];
    // ★ 2026-10-26：不再硬编码「颜色维优先」，改为读页面预置行按维度名匹配
    //   读页面有哪些预置维度行
    const pageDims = await page.evaluate((sel) => {
        const box = document.querySelector(sel);
        if (!box) return [];
        const rows = Array.from(box.querySelectorAll('.property-container-v2, .goods-spec-row, .goods-spec-row-title'));
        return rows.map(r => {
            const txt = (r.innerText || '').replace(/\s+/g, '').trim();
            return txt.slice(0, 20);
        }).filter(Boolean);
    }, SPEC_BOX_SEL).catch(() => []);
    diag(`段4 页面预置维度行: ${JSON.stringify(pageDims)}`);
    // 找哪个用户维度匹配页面第 1 行（预置行），匹配的先建
    let d1Matched = false;
    for (const pd of pageDims) {
        if (specTypeScore(pd, dimName(d1)) >= 80) { d1Matched = true; break }
        if (specTypeScore(pd, dimName(d2)) >= 80) {
            // d2 匹配预置行，交换
            const t = d1; d1 = d2; d2 = t;
            d1Matched = true;
            break;
        }
    }
    if (!d1Matched && pageDims.length > 0) {
        diag('段4 用户维度未匹配页面预置行，按原顺序建');
    }
    const d1Vals = d1.values.filter(v => valName(v));
    const d2Vals = d2.values.filter(v => valName(v));
    const r1 = await fillSkuSpec(page, toSkuInputs(d1), { specType: dimName(d1), rowsPerValue: 1, category });
    filled.push(...r1.filled);
    missed.push(...r1.missed);
    await sleep(1500);
    // ★ 临时诊断：第 1 维建完后表格实际有多少行（决定第 2 维的 rowsPerValue 是否对）
    {
        const st1 = await readSkuState(page);
        console.log(`[dsagent-pdd-publish][DIAG] 第1维「${dimName(d1)}」建完后：heads=${JSON.stringify(st1?.heads || [])} rows=${st1?.rows ?? -1} bodyText=${(st1?.bodyText || '').slice(0, 120)}`);
    }
    const r2 = await fillSkuSpecLegacy(page, toSkuInputs(d2), {
        specType: dimName(d2),
        rowsPerValue: Math.max(1, d1Vals.length),
        // ★ 第 2 维（尺码）由本函数统一按行投图，避免在规格值流程里重复投图
        skipImages: true,
        // ★ 模式2：预览图整体跳过（thumb_url 由改包注入），避免死磕 30 行 DOM 上传耗光预算
        mode2: multiMode2,
        category,
    });
    filled.push(...r2.filled);
    missed.push(...r2.missed);
    // ★ 临时诊断：第 2 维建完后表格行数（应为 5×6=30）
    {
        const st2 = await readSkuState(page);
        console.log(`[dsagent-pdd-publish][DIAG] 第2维「${dimName(d2)}」建完后：heads=${JSON.stringify(st2?.heads || [])} rows=${st2?.rows ?? -1} bodyText=${(st2?.bodyText || '').slice(0, 160)}`);
        console.log(`[dsagent-pdd-publish][DIAG] 预期行数=${d1Vals.length * d2Vals.length}（${d1Vals.length}×${d2Vals.length}）`);
    }
    // ★ 2D 逐行预览图：SKU 表体行为「颜色优先」（同色若干行 rowspan 合并），
    //   故第 ri 行预览图 = 第 floor(ri / 第2维值个数) 个第 1 维值（颜色）的图，同色各行重复。
    if (d1Vals.some(v => String(v.image || '').trim())) {
        const perColor = Math.max(1, d2Vals.length);
        const rowFiles = Array.from({ length: d1Vals.length * perColor }, (_, ri) => String(d1Vals[Math.floor(ri / perColor)]?.image || '').trim() || undefined);
        const ir = await fillSkuRowImages(page, rowFiles);
        filled.push(...ir.filled);
        missed.push(...ir.missed);
    }
    return { filled, missed };
}
/** 规格容器锚点（新 UI 为 `#goods-spec-sku` / `.goods-spec-sku-v2`，旧 `.goods-spec` 兜底） */
const SPEC_BOX_SEL = '#goods-spec-sku, .goods-spec-sku-v2, .goods-spec';
/**
 * detectAnySpecRow — 等任意规格容器出现（不再硬编码「颜色分类」）。
 *
 * ★ 2026-10-26 重写：原 detectColorRow 只认「颜色分类」行，
 *   纸杯类目预置的是「容量」、童装预置的可能是「尺寸」→ 直接返回 false → 回退旧版 → 只建 1 行。
 *
 * 判据：规格容器内存在任意预置行（不限维度名）。
 */
async function detectAnySpecRow(page) {
    return await page.evaluate((sel) => {
        const box = document.querySelector(sel);
        if (!box) return false;
        const rows = box.querySelectorAll('.property-container-v2, .goods-spec-row, .goods-spec-row-title');
        if (!rows.length) return false;
        return true;
    }, SPEC_BOX_SEL).catch(() => false);
}
/** 兼容旧调用 */
async function detectColorRow(page) {
    return detectAnySpecRow(page);
}
/**
 * 旧实现注释（已替换为 detectAnySpecRow）：
 * 探测规格区是否存在**预置的「颜色分类」行**（新 UI 标志）。
 *
 * 判据：规格容器内存在「本地上传」文案，且从其向上 12 层内能爬到**含「颜色分类」且文本不过长**的行容器。
 * （旧 UI 没有预置颜色行，故不会误命中。）
 */
async function _detectColorRowLegacy(page) {
    /**
     * ★★ 照抄觅千手 m_042_8087 `fillSkuOnPage` 的判断（逐行）：
     *     if (2===r.length && r[0].textContent.startsWith("颜色")
     *       && Data_str_match_isok(r[1].textContent,"尺码|鞋码"))
     *       return void await this.fillClothesShoesSku(e)
     *     || Data_str_match_isok(t,"(男装|女装|鞋|童装|睡衣|家居服)")
     *       && r.length>0 && r[0].textContent.startsWith("颜色分类")
     *
     * 之前的实现依赖「本地上传」按钮是否已渲染，导致时序不稳定：
     *   页面没渲染完就检测 → 返回 false → 回退旧版 → 只建出 1 行 SKU。
     *
     * 觅千手不看那个按钮，只看**规格行容器是否存在 + 首行是否以「颜色」开头**。
     * 这条判断是稳定的，因为「颜色分类」是类目模板自带的。
     */
    return await page.evaluate((sel) => {
        const box = document.querySelector(sel);
        if (!box)
            return false;
        const rows = Array.from(box.querySelectorAll('.property-container-v2, .goods-spec-row'));
        if (!rows.length)
            return false;
        const first = (rows[0].innerText || '').replace(/\s+/g, '');
        return first.startsWith('颜色') || first.startsWith('颜色分类');
    }, SPEC_BOX_SEL).catch(() => false);
}
/** 新路径：预置「颜色分类」行的 SKU 填写（文字录色 → blur 提交 → 卡内直投预览图） */
async function fillSkuSpecColorRow(page, skus, options) {
    const filled = [];
    const missed = [];
    /** 模式2：SKU 预览图跳过（thumb_url 由改包注入） */
    const multiMode2 = !!options?.mode2;
    const wantImg = skus.some(s => String(s.image || '').trim());
    /** 读规格区状态：可见「主色」框的 value 列表 + SKU 表头 + SKU 行数 */
    const specState = () => page.evaluate((sel) => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const box = document.querySelector(sel);
        const tb = Array.from(document.querySelectorAll('table'))
            .find(t => vis(t) && /拼单价/.test(t.innerText || ''));
        return {
            colors: box
                ? Array.from(box.querySelectorAll('input[placeholder*="主色"]'))
                    .filter(vis).map(i => (i.value || '').trim())
                : [],
            thead: tb
                ? Array.from(tb.querySelectorAll('thead th')).map(t => (t.innerText || '').replace(/\s+/g, ''))
                : [],
            rows: tb ? tb.querySelectorAll('tbody tr').length : 0,
        };
    }, SPEC_BOX_SEL).catch(() => null);
    /** 聚焦**第 idx 个空**的「选择或输入主色」输入框（已提交值的框会被跳过） */
    const focusColorInput = async (idx) => {
        const ok = await page.evaluate((sel, i) => {
            const box = document.querySelector(sel);
            if (!box)
                return false;
            const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            document.querySelectorAll('[data-pdd-color-inp]').forEach(e => e.removeAttribute('data-pdd-color-inp'));
            const inps = Array.from(box.querySelectorAll('input[placeholder*="主色"]'))
                .filter(vis).filter(x => !(x.value || '').trim());
            const el = inps[Math.min(i, inps.length - 1)];
            if (!el)
                return false;
            el.setAttribute('data-pdd-color-inp', '1');
            el.scrollIntoView({ block: 'center' });
            return true;
        }, SPEC_BOX_SEL, idx).catch(() => false);
        if (!ok)
            return false;
        const h = await page.$('[data-pdd-color-inp="1"]').catch(() => null);
        if (!h)
            return false;
        // select() 让重试时的键入**覆盖**残留值（React 受控组件用 el.value='' 清不掉，v6 实测残留值会被误提交）
        await h.evaluate((el) => { el.focus(); el.select?.(); }).catch(() => { });
        await sleep(250);
        return true;
    };
    /** 真实鼠标点「颜色分类」标题空白处 → 主色输入框失焦（= 提交动作） */
    const blurNeutral = async () => {
        const pt = await page.evaluate(() => {
            const el = Array.from(document.querySelectorAll('div,span,h1,h2,h3'))
                .find(e => /^\s*颜色分类\s*$/.test((e.innerText || '').trim()));
            if (!el)
                return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x + Math.min(30, r.width / 2)), y: Math.round(r.y + r.height / 2) };
        }).catch(() => null);
        if (!pt)
            return false;
        await page.mouse.click(pt.x, pt.y).catch(() => { });
        await sleep(1200);
        return true;
    };
    /**
     * 标记第 idx 个**非空**主色框所属的**颜色卡片**（含内嵌 file input 的最小祖先）。
     * 卡片 = 该色名 + 备注 + 「本地上传」(file input) 的最小公共容器。
     */
    const markColorCard = async (idx) => await page.evaluate((sel, i) => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const box = document.querySelector(sel);
        if (!box)
            return false;
        document.querySelectorAll('[data-pdd-colorcard]').forEach(e => e.removeAttribute('data-pdd-colorcard'));
        const inps = Array.from(box.querySelectorAll('input[placeholder*="主色"]'))
            .filter(vis).filter(x => (x.value || '').trim());
        const el = inps[i];
        if (!el)
            return false;
        let card = el;
        for (let k = 0; k < 12 && card && card.parentElement; k++) {
            card = card.parentElement;
            if (card.querySelector('input[type=file]'))
                break;
        }
        if (!card || !card.querySelector('input[type=file]'))
            return false;
        card.setAttribute('data-pdd-colorcard', '1');
        return true;
    }, SPEC_BOX_SEL, idx).catch(() => false);
    // ── ① 逐个颜色值：focus 空主色框 → 键入色名 → 点「颜色分类」标题 blur 提交 ──
    const done = [];
    for (let i = 0; i < skus.length; i++) {
        const v = String(skus[i].name || '').trim();
        if (!v) {
            missed.push(`SKU 第${i + 1}项（规格值为空）`);
            continue;
        }
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
            if (!(await focusColorInput(0))) {
                await sleep(1200);
                continue;
            }
            await page.keyboard.type(v, { delay: 70 }).catch(() => { });
            await sleep(400);
            await blurNeutral();
            const st = await specState();
            // ★ v6 判据：每次提交后自动补一对空框 → 非空主色框数 = 已提交颜色数；
            //   SKU 表（表头出现「颜色分类」、rows 递增）作为辅助校验。
            const nonEmpty = (st?.colors || []).filter(Boolean).length;
            ok = nonEmpty >= i + 1 && (!st?.thead.length || st.rows >= i + 1);
            if (!ok) {
                console.log(`[dsagent-pdd-publish] SKU 颜色值「${v}」第 ${attempt + 1} 次未提交成功`
                    + `（主色框=${JSON.stringify(st?.colors || [])}；表头=${JSON.stringify(st?.thead || [])}；rows=${st?.rows ?? 0}）`);
            }
        }
        if (ok)
            done.push(v);
        else
            missed.push(`SKU 颜色值「${v}」（3 次未提交成功，请人工补填）`);
    }
    if (done.length)
        filled.push(`SKU 颜色值=${done.join('/')}`);
    // ── ② 逐色投递预览图：整段关闭（理由同⑤）──
    if (false) {
        for (let i = 0; i < skus.length; i++) {
            const v = String(skus[i].name || '').trim();
            const file = String(skus[i].image || '').trim();
            if (multiMode2) {
                filled.push(`SKU 预览图「${v}」（模式2：thumb_url 注入）`);
                continue;
            }
            if (!file) {
                missed.push(`SKU 预览图「${v}」（未提供图片路径）`);
                continue;
            }
            let ok = false;
            for (let attempt = 0; attempt < 2 && !ok; attempt++) {
                // ★ 必须逐色当场重定位：上传后卡片会重渲染，批量打标记会全部失效。
                if (!(await markColorCard(i)))
                    break;
                const card = await page.$('[data-pdd-colorcard="1"]').catch(() => null);
                if (!card)
                    break;
                const fileInput = await card.$('input[type=file]').catch(() => null);
                if (!fileInput) {
                    await card.dispose().catch(() => { });
                    break;
                }
                await fileInput.uploadFile(file).catch(() => { });
                await card.dispose().catch(() => { });
                await sleep(UI_STEP_DELAY_MS);
                // 成功判据：该色卡内出现缩略图（约 28x28 的 `url(...)` 背景图）。
                // ★ 不能用 `<img>` 判据：卡内本来就有「sku-preview-img」占位图标，会误判成功。
                ok = await page.evaluate((sel, i) => {
                    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
                    const box = document.querySelector(sel);
                    if (!box)
                        return false;
                    const inps = Array.from(box.querySelectorAll('input[placeholder*="主色"]'))
                        .filter(vis).filter(x => (x.value || '').trim());
                    let card = inps[i];
                    if (!card)
                        return false;
                    for (let k = 0; k < 12 && card && card.parentElement; k++) {
                        card = card.parentElement;
                        if (card.querySelector('input[type=file]'))
                            break;
                    }
                    if (!card)
                        return false;
                    return Array.from(card.querySelectorAll('*')).some(e => {
                        const r = e.getBoundingClientRect();
                        if (r.width < 20 || r.height < 20 || r.width > 300)
                            return false;
                        return /url\(/.test(getComputedStyle(e).backgroundImage || '');
                    });
                }, SPEC_BOX_SEL, i).catch(() => false);
            }
            if (ok)
                filled.push(`SKU 预览图「${v}」`);
            else
                missed.push(`SKU 预览图「${v}」（上传未确认成功，请人工核对）`);
        }
    }
    console.log(`[dsagent-pdd-publish] SKU 规格（颜色分类行）处理完成：已填 ${filled.join('、') || '（无）'}；`
        + `未完成 ${missed.join('、') || '（无）'}`);
    return { filled, missed };
}
/**
 * 注入 SKU 表定位器 `window.__pddSkuLocate()`（幂等，每次调用重装；页面导航后需重装）。
 *
 * ★ 真机实测（2026-10-14）：拼多多新版表单在**二维规格**下会把 SKU 表拆成两张 `<table>`：
 *   · 表头表（`thead` 含「拼单价」，`tbody tr` 数=0，如 951x45）
 *   · 表体表（**无 `thead`**，`tbody tr` 数=全部 SKU 行，如 951x1926）
 *   旧实现 `find(t => /拼单价/.test(t.innerText))` 只会命中表头表 → rows 恒 0，判据全假。
 *   本定位器：先按 `thead` 含「拼单价」找表头表，再在其祖先容器内找 `tbody tr` 最多的表作表体表。
 *
 * ★ 表体行用 `rowspan` 合并「颜色分类」列（同色首行 8 个 td、其余行 7 个 td），
 *   按表头下标取 `td[col]` 会错位 → 这里按 rowspan/colspan 推算每行每个 td 的真实列号，
 *   存入 `window.__pddSkuCols`（`cols[行号] = [每个 td 的列号]`）。
 */
async function installSkuTableHelper(page) {
    await page.evaluate(() => {
        const w = window;
        w.__pddSkuLocate = () => {
            const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const tables = Array.from(document.querySelectorAll('table'));
            const header = tables.find(t => vis(t)
                && Array.from(t.querySelectorAll('thead th'))
                    .some(th => /拼单价/.test(th.innerText || '')));
            if (!header) {
                w.__pddSkuBody = null;
                w.__pddSkuCols = [];
                return { heads: [], rows: 0, bodyText: '', cols: [] };
            }
            // 表体表：表头表自身有行则用它；否则在祖先容器内找 `tbody tr` 最多的表
            let body = header;
            if (header.querySelectorAll('tbody tr').length === 0) {
                let scope = header.parentElement;
                for (let up = 0; up < 8 && scope; up++) {
                    const cands = Array.from(scope.querySelectorAll('table'))
                        .filter(t => t !== header);
                    const best = cands.sort((a, b) => b.querySelectorAll('tbody tr').length - a.querySelectorAll('tbody tr').length)[0];
                    if (best && best.querySelectorAll('tbody tr').length > 0) {
                        body = best;
                        break;
                    }
                    scope = scope.parentElement;
                }
            }
            const headTr = header.querySelector('thead tr');
            const heads = headTr
                ? Array.from(headTr.children).map(th => (th.innerText || '').replace(/\s+/g, ''))
                : [];
            const trs = Array.from(body.querySelectorAll('tbody tr'));
            const occ = [];
            const cols = [];
            for (const tr of trs) {
                let c = 0;
                const rowCols = [];
                for (const td of Array.from(tr.children)) {
                    while ((occ[c] || 0) > 0)
                        c++;
                    const rs = parseInt(td.getAttribute('rowspan') || '1', 10);
                    const cs = parseInt(td.getAttribute('colspan') || '1', 10);
                    rowCols.push(c);
                    if (rs > 1)
                        for (let k = 0; k < cs; k++)
                            occ[c + k] = rs;
                    c += cs;
                }
                cols.push(rowCols);
                for (let i = 0; i < occ.length; i++)
                    if (occ[i] > 0)
                        occ[i]--;
            }
            w.__pddSkuBody = body;
            w.__pddSkuCols = cols;
            return {
                heads,
                rows: trs.length,
                bodyText: ((body.querySelector('tbody')?.innerText) || '').replace(/\s+/g, ''),
                cols,
            };
        };
    }).catch(() => { });
}
/** 读 SKU 表状态（走 `window.__pddSkuLocate()`，兼容表头/表体拆表 + rowspan 列错位） */
async function readSkuState(page) {
    return await page.evaluate(() => {
        const fn = window.__pddSkuLocate;
        if (typeof fn !== 'function')
            return null;
        const r = fn();
        return { heads: r.heads, rows: r.rows, bodyText: r.bodyText };
    }).catch(() => null);
}
/**
 * 规格类型下拉候选打分（-1 = 不可用）。
 *
 * ★ 真机实测（童装类目）候选仅 4 项：
 *   `["官方 客服","童装/童装/中国码（平台推荐）","童装/童装/身高（平台推荐）","没有更多了 新建模板"]`
 *   没有「尺码」自由项，必须按语义选预设；童装尺码优先「身高」（其 chips 为 48~175 的 cm 值）。
 */
function specTypeScore(opt, specType) {
    const t = String(opt || '').replace(/\s+/g, '');
    const s = String(specType || '').replace(/\s+/g, '');
    if (!t || !s)
        return -1;
    if (t === s)
        return 100;
    if (t.includes(s))
        return 92;
    // ★ 2026-10-26 扩展：款式/型号/容量/材质/器型 等
    if (/款式|样式|版型/.test(s) && /款式|样式|版型/.test(t))
        return 88;
    if (/型号/.test(s) && /型号|型号/.test(t))
        return 86;
    if (/容量|净含量/.test(s) && /容量|净含量|毫升|克/.test(t))
        return 85;
    if (/材质/.test(s) && /材质|材料/.test(t))
        return 82;
    if (/器型/.test(s) && /器型|形状/.test(t))
        return 80;
    if (/口味/.test(s) && /口味|味道|风味/.test(t))
        return 80;
    if (/花型|图案/.test(s) && /花型|图案|印花/.test(t))
        return 80;
    if (/适用人群/.test(s) && /适用人群|人群/.test(t))
        return 78;
    if (/色号/.test(s) && /色号|色/.test(t))
        return 76;
    if (/尺码|尺寸/.test(s)) {
        if (/身高/.test(t))
            return 88;
        if (/中国码/.test(t))
            return 84;
        if (/码|尺码|尺寸/.test(t))
            return 78;
        if (/体重/.test(t))
            return 74;
    }
    if (/颜色/.test(s) && /色/.test(t))
        return 84;
    if (/重量/.test(s) && /重量/.test(t))
        return 60;
    if (/规格|型号/.test(s) && /规格|型号/.test(t))
        return 55;
    return -1;
}
/** 规格值归一化：去空白 + 去长度单位（cm/厘米/mm/毫米）+ 小写，用于 chips/表格值匹配 */
function normalizeSpecValue(v) {
    return String(v ?? '').replace(/\s+/g, '').replace(/(cm|厘米|mm|毫米)/gi, '').toLowerCase();
}
/**
 * 停用尺码表（对齐神笔 step 20）。
 *
 * 尺码表模板勾选后拼多多会显示「尺码表」区域并占住 SKU 表，导致 rows=0。
 * 神笔原文：
 *   if (document.querySelector('a[data-tracking-impr-viewid="disable_size_chart"]')) {
 *     document.querySelector('a[data-tracking-impr-viewid="disable_size_chart"]').click()
 *     await sleep(500)
 *     document.evaluate('//button[.//text()="确认停用"]', ...).singleNodeValue.click()
 *   }
 */
async function disableSizeChart(page) {
    // ★ 2026-10-27：两种停用入口都检测
    //   ① a[data-tracking-impr-viewid="disable_size_chart"]（神笔原版）
    //   ② #sizeTable > div > a（用户实测给的新选择器）
    const found = await page.evaluate(() => {
        let link = document.querySelector('a[data-tracking-impr-viewid="disable_size_chart"]');
        if (!link) {
            const st = document.querySelector('#sizeTable');
            if (st) link = st.querySelector('div a');
        }
        if (link) {
            link.click();
            return true;
        }
        return false;
    }).catch(() => false);
    if (!found)
        return;
    await sleep(600);
    await page.evaluate(() => {
        const btn = document.evaluate('//button[.//text()="确认停用"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (btn)
            btn.click();
    }).catch(() => { });
    console.log('[dsagent-pdd-publish] 已停用尺码表');
}
/**
 * 通过点击「尺码表模板」chips（`.package-item-container`）录入规格值。
 *
 * ★ 真机实测：新版 UI 第 2 维没有「请输入规格名称」文本框，规格值走 chips 勾选；
 *   且 chips **默认已勾选一组**（童装默认勾了 14 个），必须按目标集合**重设**勾选态
 *   （勾我们需要的、取消其余的），不能只做「勾选」增量。
 */
async function fillSpecValueChips(page, values) {
    const filled = [];
    const missed = [];
    const want = new Set(values.map(normalizeSpecValue).filter(Boolean));
    if (!want.size)
        return { filled, missed };
    const readChips = () => page.evaluate(() => {
        const box = document.querySelector('#goods-spec-sku, .goods-spec-sku-v2, .goods-spec');
        if (!box)
            return [];
        return Array.from(box.querySelectorAll('.package-item-container')).map(el => {
            const lbl = el.querySelector('label[data-testid="beast-core-checkbox"]');
            return {
                text: (el.innerText || '').replace(/\s+/g, '').trim(),
                checked: lbl ? lbl.getAttribute('data-checked') === 'true' : false,
            };
        });
    }).catch(() => []);
    /** 读某个 chip 当前勾选态：'true' | 'false' | 'miss' */
    const chipChecked = (chipText) => page.evaluate((txt) => {
        const box = document.querySelector('#goods-spec-sku, .goods-spec-sku-v2, .goods-spec');
        if (!box)
            return 'miss';
        const el = Array.from(box.querySelectorAll('.package-item-container'))
            .find(e => (e.innerText || '').replace(/\s+/g, '').trim() === txt);
        const lbl = el?.querySelector('label[data-testid="beast-core-checkbox"]');
        return lbl ? (lbl.getAttribute('data-checked') === 'true' ? 'true' : 'false') : 'miss';
    }, chipText).catch(() => 'miss');
    /** 把某个 chip 的勾选态设成 wantChecked（已是目标态则跳过）；返回 'ok' | 'skip' | 'miss' */
    const setChip = async (chipText, wantChecked) => {
        const act = await page.evaluate((txt, want) => {
            const box = document.querySelector('#goods-spec-sku, .goods-spec-sku-v2, .goods-spec');
            if (!box)
                return 'miss';
            document.querySelectorAll('[data-pdd-chip]').forEach(e => e.removeAttribute('data-pdd-chip'));
            const el = Array.from(box.querySelectorAll('.package-item-container'))
                .find(e => (e.innerText || '').replace(/\s+/g, '').trim() === txt);
            if (!el)
                return 'miss';
            const lbl = el.querySelector('label[data-testid="beast-core-checkbox"]');
            const cur = lbl ? lbl.getAttribute('data-checked') === 'true' : false;
            if (cur === want)
                return 'skip';
            // ★ 真机踩坑：`.package-item-container` 是 262px 宽的网格单元，其中心点是空白，
            //   点它不会 toggle。必须点 checkbox 方框本身（label 内的 checkIcon）。
            const sq = el.querySelector('[data-testid="beast-core-checkbox-checkIcon"]');
            const target = sq || lbl || el;
            target.setAttribute('data-pdd-chip', '1');
            target.scrollIntoView({ block: 'center' });
            return 'click';
        }, chipText, wantChecked).catch(() => 'miss');
        if (act === 'skip')
            return 'skip';
        if (act !== 'click')
            return 'miss';
        await sleep(250);
        await realClickMarked(page, '[data-pdd-chip="1"]');
        await sleep(900);
        // 回读确认；未生效则退回 DOM 点击 label/input 兜底
        const st = await chipChecked(chipText);
        if ((st === 'true') !== wantChecked) {
            await page.evaluate((txt) => {
                const box = document.querySelector('#goods-spec-sku, .goods-spec-sku-v2, .goods-spec');
                if (!box)
                    return;
                const el = Array.from(box.querySelectorAll('.package-item-container'))
                    .find(e => (e.innerText || '').replace(/\s+/g, '').trim() === txt);
                const lbl = el?.querySelector('label[data-testid="beast-core-checkbox"]');
                const inp = el?.querySelector('input[type="checkbox"]');
                if (lbl)
                    lbl.click();
                else if (inp)
                    inp.click();
            }, chipText).catch(() => { });
            await sleep(700);
        }
        return 'ok';
    };
    const before = await readChips();
    // ★ 修复（probe6 根因）：先取消全部已勾选 chip（含目标值），再只勾选目标值。
    //   真机实测：目标值恰好在默认勾选集里时，cur===want → skip → 零点击
    //   → SKU 表 rows=0（尺码维度没加上）。强制先全取消再勾选，确保每个目标值
    //   都有真实 click 事件触发表重建。对齐神笔 step 19→21 的规格处理流程。
    for (const c of before) {
        const n = normalizeSpecValue(c.text);
        if (!n)
            continue; // 空文案 chip（模板末位占位）跳过
        if (c.checked)
            await setChip(c.text, false);
    }
    await sleep(500);
    // 再只勾选目标值（此时全部已取消，每个目标值都需要真实 click）
    const after_uncheck = await readChips();
    for (const c of after_uncheck) {
        const n = normalizeSpecValue(c.text);
        if (!n)
            continue;
        const wantChecked = want.has(n);
        if (wantChecked && !c.checked)
            await setChip(c.text, true);
    }
    // 复核
    const after = await readChips();
    const checkedNow = new Set(after.filter(c => c.checked).map(c => normalizeSpecValue(c.text)));
    const doneVals = [];
    for (const raw of values) {
        const v = String(raw || '').trim();
        if (!v)
            continue;
        if (checkedNow.has(normalizeSpecValue(v)))
            doneVals.push(v);
        else
            missed.push(`SKU 规格值「${v}」（尺码模板 chips 未勾选成功，请人工勾选）`);
    }
    if (doneVals.length)
        filled.push(`SKU 规格值=${doneVals.join('/')}`);
    console.log(`[dsagent-pdd-publish] 尺码模板 chips 重设完成：目标命中 ${doneVals.length}/${values.length}`
        + `（当前勾选 ${checkedNow.size} 项）`);
    return { filled, missed };
}
/** 定位第 ri 行预览图列的 `<td>`（走 `window.__pddSkuLocate()` 的 rowspan 列映射） */
function skuImgCellExpr(ri) {
    return `(function(){
    var fn = window.__pddSkuLocate
    if (typeof fn !== 'function') return null
    var r = fn()
    var body = window.__pddSkuBody, cols = window.__pddSkuCols
    if (!body || !cols) return null
    var col = r.heads.findIndex(function(h){ return /预览图/.test(h) })
    if (col < 0) return null
    var tdIdx = (cols[${ri}] || []).indexOf(col)
    if (tdIdx < 0) return null
    var tr = body.querySelectorAll('tbody tr')[${ri}]
    return tr ? tr.querySelectorAll('td')[tdIdx] : null
  })()`;
}
/**
 * 逐行投递「*预览图」（走 `window.__pddSkuLocate()` 定位表体行 + rowspan 列映射）。
 * `rowFiles[ri]` = 第 ri 行预览图本地路径（空则跳过并记 missed）。
 *
 * ★ 收紧（对齐原版「颜色分类行」`fillSkuSpecColorRow` 的成功判据）：
 *   1. 投递前**先回读**：多维场景颜色级图片常自动下发到同色各行，若该行已有缩略图则直接算完成，不再重复投递、不误报。
 *   2. 成功判据 = 单元格内存在**真实尺寸（20~300px）且 `backgroundImage` 含 `url(`** 的元素；
 *      不再用「任意 `<img>`」判据（单元格自带占位图标会误判成功）。
 *   3. 回读改为**轮询等待**（最多 6×500ms），吸收上传/渲染异步延迟，避免假阴性。
 */
async function fillSkuRowImages(page, rowFiles) {
    const filled = [];
    const missed = [];
    /** 回读第 ri 行预览图列是否已出现真实缩略图（与原版同判据） */
    const thumbPresent = (ri) => page.evaluate((expr) => {
        const td = eval(expr);
        if (!td)
            return false;
        return Array.from(td.querySelectorAll('*')).some(e => {
            const rc = e.getBoundingClientRect();
            if (rc.width < 20 || rc.height < 20 || rc.width > 300)
                return false;
            return /url\(/.test(getComputedStyle(e).backgroundImage || '');
        });
    }, skuImgCellExpr(ri)).catch(() => false);
    /** 给第 ri 行预览图列的 file input 打标记；返回是否存在上传入口 */
    const markInput = (ri) => page.evaluate((expr) => {
        const td = eval(expr);
        if (!td)
            return false;
        const inp = td.querySelector('input[type=file]');
        if (!inp)
            return false;
        document.querySelectorAll('[data-pdd-skuimg]').forEach(e => e.removeAttribute('data-pdd-skuimg'));
        inp.setAttribute('data-pdd-skuimg', '1');
        return true;
    }, skuImgCellExpr(ri)).catch(() => false);
    /** 轮询等待缩略图出现（上传/渲染异步），最多 6×500ms */
    const waitThumb = async (ri) => {
        for (let i = 0; i < 6; i++) {
            if (await thumbPresent(ri))
                return true;
            await sleep(500);
        }
        return false;
    };
    for (let ri = 0; ri < rowFiles.length; ri++) {
        const file = String(rowFiles[ri] || '').trim();
        if (!file) {
            missed.push(`SKU 预览图（第${ri + 1}行，未提供图片路径）`);
            continue;
        }
        // ★ 收紧前置回读：该行若已有缩略图（多维场景通常由「颜色级」图片自动下发到同色各行），视为已完成。
        if (await thumbPresent(ri)) {
            filled.push(`SKU 预览图（第${ri + 1}行）`);
            continue;
        }
        // ★★ 真机实测（2026-10-15，30 行场景）：后段行（19~30）报「该行无上传入口」，
        //   根因不是页面缺入口，而是**表格还没把这么多行渲染出来** —— 定位器算出的
        //   `skuImgCellExpr(ri)` 取不到 `<td>`。故先等该行出现（最多 12s），再判 noEntry。
        let rowReady = false;
        for (let i = 0; i < 12; i++) {
            if (await markInput(ri)) {
                rowReady = true;
                break;
            }
            await sleep(1000);
        }
        if (!rowReady) {
            missed.push(`SKU 预览图（第${ri + 1}行，等待 12s 后该行仍未出现，请人工核对）`);
            continue;
        }
        let ok = false;
        let noEntry = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
            if (!(await markInput(ri))) {
                await sleep(1500);
                continue;
            }
            const h = await page.$('[data-pdd-skuimg="1"]').catch(() => null);
            if (!h) {
                noEntry = true;
                break;
            }
            await h.uploadFile(file).catch(() => { });
            await sleep(UI_STEP_DELAY_MS);
            ok = await waitThumb(ri);
        }
        if (ok)
            filled.push(`SKU 预览图（第${ri + 1}行）`);
        else if (noEntry)
            missed.push(`SKU 预览图（第${ri + 1}行，该行无上传入口且未读到缩略图，请人工核对）`);
        else
            missed.push(`SKU 预览图（第${ri + 1}行，上传未确认成功，请人工核对）`);
    }
    return { filled, missed };
}
/** 旧路径（兜底）：点「添加规格类型」→ 下拉选规格类型 → 逐个规格值 → 逐行预览图 */
async function fillSkuSpecLegacy(page, skus, cfg) {
    const specType = (cfg?.specType || SKU_SPEC_TYPE).trim() || SKU_SPEC_TYPE;
    const rowsPerValue = Math.max(1, Math.floor(cfg?.rowsPerValue || 1));
    const cat = String(cfg?.category || '').trim();
    // ── SKU 维度缓存（PUBLISH-SPEC §3.6）：同类目上次成功选的规格类型作打分偏好 ──
    //   ★ 命中即验证：偏好名仍需在当前下拉候选里（specTypeScore≥0）才生效，否则丢弃。
    const cachedDims = cat ? await attrCache.lookupSkuDims(PLATFORM, cat).catch(() => []) : [];
    const cachedDim = cachedDims.find(d => d !== specType) || '';
    const filled = [];
    const missed = [];
    if (!skus.length)
        return { filled, missed };
    await installSkuTableHelper(page);
    // ── ① 添加规格类型（内联出行，非弹窗）──────────────────────
    //   ★ 多维场景第 2 维仍走同一入口；按钮文案可能是「添加规格类型」或「添加规格」，两种都试。
    const added = (await clickByTextReal(page, '^\\s*添加规格类型'))
        || (await clickByTextReal(page, '^\\s*添加规格'));
    if (!added)
        return { filled: [], missed: [`SKU 规格「${specType}」（未找到「添加规格类型」入口）`] };
    await sleep(3000);
    // ── ② 打开「规格类型」下拉并选「颜色」──────────────────────
    // ★ 容器锚点（2026-10-14 真机实测）：旧 `.goods-spec` 已下线，现为 `#goods-spec-sku`
    //   （class `goods-spec-sku-v2`），保留旧类名兜底。
    const trigger = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const box = document.querySelector('#goods-spec-sku, .goods-spec-sku-v2, .goods-spec');
        if (!box)
            return '';
        document.querySelectorAll('[data-pdd-specpick]').forEach(e => e.removeAttribute('data-pdd-specpick'));
        const cands = Array.from(box.querySelectorAll('[class*="ST_selectValueSingle"],input[placeholder*="规格类型"],[class*="select"]')).filter(vis);
        const el = cands[0];
        if (!el)
            return '';
        el.setAttribute('data-pdd-specpick', '1');
        el.scrollIntoView({ block: 'center' });
        return `${el.tagName}.${String(el.className || '').slice(0, 50)}`;
    }).catch(() => '');
    if (!trigger)
        return { filled, missed: ['SKU 规格（未找到「规格类型」下拉，请人工选择）'] };
    await sleep(350);
    await realClickMarked(page, '[data-pdd-specpick="1"]');
    await sleep(1800);
    const opts = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        document.querySelectorAll('[data-pdd-specopt]').forEach(e => e.removeAttribute('data-pdd-specopt'));
        const els = Array.from(document.querySelectorAll('[class*="option"],[class*="Option"],[role=option],[class*="dropdown"] li,li[class*="item"],[class*="menuItem"]')).filter(vis);
        const out = [];
        for (const e of els) {
            const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
            if (!t || t.length > 20)
                continue;
            e.setAttribute('data-pdd-specopt', String(out.length));
            out.push(t);
        }
        return out.slice(0, 60);
    }).catch(() => []);
    if (!opts.length)
        return { filled, missed: [`SKU 规格「${specType}」（规格类型下拉无候选项，请人工选择）`] };
    // ★ 语义打分选优（真机实测：童装候选仅 4 项，无「尺码」自由项，须选预设「身高」）
    const scored = opts.map((t, i) => ({ i, s: specTypeScore(t, specType) }))
        .filter(x => x.s >= 0)
        .sort((a, b) => b.s - a.s || a.i - b.i);
    // ★ 缓存偏好加成（PUBLISH-SPEC §3.6）：上次该类目成功选的维度名仍在候选里 → 打分 +50，
    //   仅次于精确命中；语义分本来就更高的仍会赢（如缓存「身高」 vs specType「尺码」同分族）。
    if (cachedDim && opts.includes(cachedDim)) {
        const ci = scored.find(x => x.i === opts.indexOf(cachedDim));
        if (ci)
            ci.s += 50;
        else
            scored.push({ i: opts.indexOf(cachedDim), s: 50 });
        scored.sort((a, b) => b.s - a.s || a.i - b.i);
        console.log(`[dsagent-pdd-publish] SKU 维度缓存偏好「${cachedDim}」仍在候选，打分加成`);
    }
    // ★ 候选首项是噪声（「官方 客服 1」），无命中时兜底取第 2 项而不是第 1 项
    const optIdx = scored.length ? scored[0].i : (opts.length > 1 ? 1 : 0);
    await realClickMarked(page, `[data-pdd-specopt="${optIdx}"]`);
    console.log(`[dsagent-pdd-publish] SKU 规格类型已选：${opts[optIdx]}（候选 ${opts.length} 项）`);
    // ── 记 SKU 维度缓存：本次成功选中的类型（下次同类目直接偏好）──
    if (cat) {
        await attrCache.recordSkuDims(PLATFORM, cat, [opts[optIdx]]).catch(() => { });
    }
    await sleep(UI_STEP_DELAY_MS);
    const wantImg = skus.some(s => String(s.image || '').trim());
    // ── ③ 勾「添加图片」（自绘复选框；不勾就没有「*预览图」列）────
    if (wantImg && !cfg?.skipImages && !cfg?.mode2) {
        const flag = await page.evaluate(() => {
            const box = document.querySelector('#goods-spec-sku, .goods-spec-sku-v2, .goods-spec');
            if (!box)
                return '';
            document.querySelectorAll('[data-pdd-imgflag]').forEach(e => e.removeAttribute('data-pdd-imgflag'));
            const span = Array.from(box.querySelectorAll('*'))
                .find(el => /^\s*添加图片\s*$/.test((el.innerText || '').trim()));
            if (!span)
                return '';
            let t = span;
            for (let i = 0; i < 6 && t; i++) {
                if (/heckbox|Checkbox|CK_/i.test(String(t.className || '')))
                    break;
                t = t.parentElement;
            }
            if (!t || t === document.body)
                t = span.parentElement || span;
            t.setAttribute('data-pdd-imgflag', '1');
            return `${t.tagName}.${String(t.className || '').slice(0, 60)}`;
        }).catch(() => '');
        if (flag) {
            await realClickMarked(page, '[data-pdd-imgflag="1"]');
            await sleep(2000);
            console.log(`[dsagent-pdd-publish] 已勾选「添加图片」：${flag}`);
        }
        else {
            missed.push('SKU 预览图（未找到「添加图片」勾选项）');
        }
    }
    // ── ③b 尺码表模板 chips 分支 ────────────────────────────────
    // ★ 真机实测：新版 UI 第 2 维（尺码）没有「请输入规格名称」文本框，规格值走
    //   「尺码表模板」chips（`.package-item-container`）勾选，且默认已勾选一组。
    const chipCount = await page.evaluate(() => {
        const box = document.querySelector('#goods-spec-sku, .goods-spec-sku-v2, .goods-spec');
        return box ? box.querySelectorAll('.package-item-container').length : 0;
    }).catch(() => 0);
    if (chipCount > 0) {
        console.log(`[dsagent-pdd-publish] SKU 规格「${specType}」走尺码表模板 chips（共 ${chipCount} 项）`);
        const cr = await fillSpecValueChips(page, skus.map(s => String(s.name || '').trim()).filter(Boolean));
        filled.push(...cr.filled);
        missed.push(...cr.missed);
        // ★ 停用尺码表（对齐神笔 step 20）：
        //   尺码表模板勾选后拼多多会弹「尺码表」区域，若不停用会占住 SKU 表导致行数为 0。
        //   神笔原文：a[data-tracking-impr-viewid="disable_size_chart"] → 确认弹窗「确认停用」
        await disableSizeChart(page);
        await sleep(800);
        if (wantImg && !cfg?.skipImages) {
            const ir = await fillSkuRowImages(page, skus.map(s => String(s.image || '').trim() || undefined));
            filled.push(...ir.filled);
            missed.push(...ir.missed);
        }
        console.log(`[dsagent-pdd-publish] SKU 规格处理完成（chips 路径）：已填 ${filled.join('、') || '（无）'}；`
            + `未完成 ${missed.join('、') || '（无）'}`);
        return { filled, missed };
    }
    /** 读规格区状态：规格区可见文案（仅日志排查用）+ SKU 表头 + SKU 行数 + SKU 表体文本 */
    const specState = async () => {
        const boxText = await page.evaluate(() => {
            const box = document.querySelector('#goods-spec-sku, .goods-spec-sku-v2, .goods-spec');
            return (box?.innerText || '').replace(/\s+/g, ' ');
        }).catch(() => '');
        const st = await readSkuState(page);
        if (!st)
            return null;
        return { boxText, heads: st.heads, rows: st.rows, bodyText: st.bodyText };
    };
    /** 定位并聚焦「新值输入框」（可见的最后一个「请输入规格名称」input） */
    const focusAddInput = async () => {
        const ok = await page.evaluate(() => {
            const box = document.querySelector('#goods-spec-sku, .goods-spec-sku-v2, .goods-spec');
            if (!box)
                return false;
            document.querySelectorAll('[data-pdd-addinput]').forEach(e => e.removeAttribute('data-pdd-addinput'));
            const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const all = Array.from(box.querySelectorAll('input')).filter(vis);
            // ★ 真机实测：新版 UI 无「主色」框；误抓「主色」会把规格值写进颜色行，故只认「规格名称」
            const inps = all.filter(i => /规格名称/.test(i.placeholder || ''));
            const last = inps[inps.length - 1];
            if (!last)
                return false;
            last.setAttribute('data-pdd-addinput', '1');
            return true;
        }).catch(() => false);
        if (!ok)
            return false;
        const h = await page.$('[data-pdd-addinput="1"]').catch(() => null);
        if (!h)
            return false;
        // select() 让重试时的键入**覆盖**残留值（禁用 Control+A：真机实测会残留原值）
        await h.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.focus(); el.select?.(); })
            .catch(() => { });
        await sleep(250);
        return true;
    };
    /** 真实鼠标点「2 规格与库存 / 商品规格」标题附近空白处 → 规格值输入框失焦（= 提交动作） */
    const blurNeutral = async () => {
        const pt = await page.evaluate(() => {
            const el = Array.from(document.querySelectorAll('div,span,h1,h2,h3'))
                .find(e => /^\s*(2\s*规格与库存|商品规格)\s*$/.test((e.innerText || '').trim()));
            if (!el)
                return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x + Math.min(40, r.width / 2)), y: Math.round(r.y + r.height / 2) };
        }).catch(() => null);
        if (!pt)
            return false;
        await page.mouse.click(pt.x, pt.y).catch(() => { });
        await sleep(1000);
        return true;
    };
    // ── ④ 逐个规格值：type → blur 提交（每值最多 3 次）──────────
    // ★ 提交判据需要区分维度：
    //   · 第 1 维（如「颜色」，rowsPerValue=1）：值只体现在**行数**上，tbody 文本里看不到值。
    //   · 第 2 维（如「尺码」，rowsPerValue=第 1 维值个数）：值会**作为列出现在 SKU 表体**里；
    //     平台可能「加值即乘行（笛卡尔积）」或「逐值追加行」，故行数判据用
    //     `baseRows + (i+1)*rowsPerValue` 覆盖追加式，`tbodyText.includes(值)` 覆盖乘行式/仅加列式。
    const baseRows = (await specState())?.rows || 0;
    const valueDone = [];
    for (let i = 0; i < skus.length; i++) {
        const v = String(skus[i].name || '').trim();
        if (!v) {
            missed.push(`SKU 第${i + 1}项（规格值为空）`);
            continue;
        }
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
            if (!(await focusAddInput())) {
                await sleep(1200);
                continue;
            }
            await page.keyboard.type(v, { delay: 70 }).catch(() => { });
            await sleep(400);
            await blurNeutral();
            const st = await specState();
            // ★ 真机实测：SKU 表在二维下拆成表头表+表体表，表头列名可能是「参考分类」而非维度名，
            //   故不再硬要求表头含维度名；可靠信号 = 行数增长（追加式）或表体文本含该值（乘行/加列式）。
            ok = !!st && (st.rows >= baseRows + (i + 1) * rowsPerValue
                || st.bodyText.includes(v.replace(/\s+/g, '')));
            if (!ok) {
                console.log(`[dsagent-pdd-publish] SKU 规格值「${v}」第 ${attempt + 1} 次未提交成功`
                    + `（规格区文案=${st?.boxText?.slice(0, 80) || ''}；表头=${JSON.stringify(st?.heads || [])}`
                    + `；rows=${st?.rows ?? 0}/${baseRows + (i + 1) * rowsPerValue}）`);
            }
        }
        if (ok)
            valueDone.push(v);
        else
            missed.push(`SKU 规格值「${v}」（3 次未提交成功，请人工补填）`);
    }
    if (valueDone.length)
        filled.push(`SKU 规格值=${valueDone.join('/')}`);
    // ── ⑤ 逐行投递「*预览图」──
    // ★★ 整段关闭（2026-10-20 实测）：30 行预览图 DOM 上传会把 240s 看门狗耗光
    //   （「第N行等待 12s 后该行仍未出现」×30），导致 fillPriceTable 没时间执行、
    //   状态被拖坏。SKU 预览图的正确做法是觅千手那条：thumb_url 由改包写进 commitBody.sku。
    if (wantImg) {
        filled.push('SKU 预览图（已跳过 DOM 上传，由提交时改包注入 thumb_url）');
    }
    console.log(`[dsagent-pdd-publish] SKU 规格处理完成：已填 ${filled.join('、') || '（无）'}；`
        + `未完成 ${missed.join('、') || '（无）'}`);
    return { filled, missed };
}
/**
 * 按关键词定位并填入输入框（input 或 textarea）。
 *
 * 两轮匹配：先只看直接属性（placeholder / name / aria-label），命中不了再看祖先链文本。
 * 祖先链只取 4 层且截断，避免「整个页面 innerText」把所有框都命中。
 * 写入用原生 setter + input/change/blur 事件，React 受控组件才能接收。
 */
async function fillField(page, keywords, value) {
    return await page.evaluate((kwSrc, kwFlags, v) => {
        const re = new RegExp(kwSrc, kwFlags);
        const els = Array.from(document.querySelectorAll('input, textarea'));
        const visible = els.filter(el => {
            if (el.offsetParent === null)
                return false;
            if (el.disabled || el.readOnly)
                return false;
            if (el instanceof HTMLInputElement) {
                const t = (el.type || 'text').toLowerCase();
                if (!['text', 'number', 'search', ''].includes(t))
                    return false;
            }
            return true;
        });
        const direct = (el) => [el.placeholder || '', el.name || '', el.getAttribute('aria-label') || ''].join(' ');
        const chain = (el) => {
            let s = direct(el);
            let cur = el;
            for (let i = 0; i < 4 && cur; i++) {
                if (cur.previousElementSibling)
                    s += ' ' + ((cur.previousElementSibling.innerText) || '');
                cur = cur.parentElement;
                if (cur)
                    s += ' ' + (cur.innerText || '').slice(0, 120);
            }
            return s.replace(/\s+/g, ' ');
        };
        let hit = visible.find(el => re.test(direct(el)));
        if (!hit)
            hit = visible.find(el => re.test(chain(el)));
        if (!hit)
            return null;
        // 类目规则优先：按 DOM 里的 maxlength 截断
        let finalVal = v;
        const ml = Number(hit.getAttribute('maxlength')) || (hit.maxLength > 0 ? hit.maxLength : 0);
        if (ml > 0 && finalVal.length > ml)
            finalVal = finalVal.slice(0, ml);
        const proto = hit instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter)
            setter.call(hit, finalVal);
        else
            hit.value = finalVal;
        hit.dispatchEvent(new Event('input', { bubbles: true }));
        hit.dispatchEvent(new Event('change', { bubbles: true }));
        hit.dispatchEvent(new Event('blur', { bubbles: true }));
        return (hit.placeholder || hit.name || 'input');
    }, keywords.source, keywords.flags, value).catch(() => null);
}
/**
 * 填商品标题。
 *
 * 真机实测锚点（两步式各有一个标题框）：
 *   · 第一步（类目页）：#goods_name 内 input[data-testid="beast-core-input-htmlInput"]
 *   · 第二步（表单页）：input[data-tracking-click-viewid="title_input_area"]
 * 两者 placeholder 都是「商品标题组成：商品描述+规格，最多输入30个汉字（60个字符）」。
 * 页面上的输入框极多（属性、SKU、价格…），先用锚点精确命中，落空再退回通用关键词匹配。
 *
 * ★ 三级入口全部由 publish-config/pdd.json → anchors.titleInput 驱动
 *   （refreshPddConfig 维护 TITLE_INPUT_SELECTORS / TITLE_PLACEHOLDER_RE_SRC /
 *    TITLE_FILLFIELD_RE_SRC），平台改版改 JSON 即可，无需改代码。
 */
async function fillTitle(page, value) {
    const hit = await page.evaluate((v, sel, phReSrc) => {
        const scoped = document.querySelector(sel);
        const phRe = new RegExp(phReSrc);
        const byPlaceholder = Array.from(document.querySelectorAll('input')).find(i => phRe.test(i.placeholder || ''));
        const el = scoped || byPlaceholder;
        if (!el || el.disabled || el.readOnly || el.offsetParent === null)
            return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter)
            setter.call(el, v);
        else
            el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
    }, value, TITLE_INPUT_SELECTORS, TITLE_PLACEHOLDER_RE_SRC).catch(() => false);
    if (hit)
        return true;
    return !!(await fillField(page, new RegExp(TITLE_FILLFIELD_RE_SRC), value));
}
/**
 * 填「价格及库存」SKU 表格。
 *
 * ★ 为什么不能复用 fillField：该表 5 个输入框的 placeholder **全是「请输入」**，
 *   name / aria-label 也为空，按关键词匹配必然全部落空（真机实测）。
 *
 * 真机实测 DOM（第二步表单页）：
 *   div.goods-sku-row#sku > div[data-e2e-id="e2e-sku-table"] > table
 *     thead th 依次为：库存 / 拼单价(元) / 单买价(元) / 规格编码 / 商品编码 / 状态
 *     tbody tr 的 td 与表头**列序一一对应**，每格内含一个 input
 * 因此改为「读表头 → 建列序映射 → 按列索引写入」，与 placeholder 无关。
 *
 * 注：拼单价 / 单买价 / 库存 是提交硬性必填；规格编码 / 商品编码为选填。
 *
 * ★ 必须用「真实键盘输入」而不是直接 set value（真机实测教训）：
 *   早先的实现是 `nativeSetter.call(el, v)` + dispatch input/change/blur，
 *   DOM 上看着值已写入、日志也报「已填」，但 React 内部 state 仍是空 ——
 *   提交时平台报「拼单价必须大于0」，商品卡在第二步上不了架。
 *   改为 click → 全选 → Backspace → type → Tab（都由 CDP 派发真实事件，
 *   走浏览器输入管线），React 的 onChange/onBlur 才会正常触发。
 */
async function fillPriceTable(page, vals) {
    const price = (vals.price || '').trim();
    const stock = (vals.stock || '').trim();
    const itemNo = (vals.itemNo || '').trim();
    let rowOverrides = vals.rows || [];
    // ★ 真机实测：SKU 表在二维下拆成「表头表（0 行）」+「表体表（全部 SKU 行，无 thead）」，
    //   且表体行用 rowspan 合并「颜色分类」列；先装定位器（幂等），后续全部走它。
    await installSkuTableHelper(page);
    // ★ 平台硬规则（真机实测拦因「单买价至少比拼单价高1元」）：
    //   单买价必须 ≥ 拼单价 + 1。此前两列同值，提交必被拦在第二步。
    const singleOf = (p) => {
        const n = Number(p);
        if (!p || !Number.isFinite(n) || n <= 0)
            return p;
        return String(Math.round((n + 1) * 100) / 100);
    };
    /** 定位 SKU 表（走 `window.__pddSkuLocate()`，兼容表头/表体拆表）+ 读表头列名 + SKU 行数 */
    const readTable = () => page.evaluate(() => {
        const fn = window.__pddSkuLocate;
        if (typeof fn !== 'function')
            return null;
        const r = fn();
        if (!r.heads.length)
            return null;
        return { heads: r.heads, rows: r.rows };
    }).catch(() => null);
    /**
     * 单格填写（**JS 批量路径**）：不逐键键入，直接在页面内用原生 setter + 事件派发写值。
     *
     * ★★ 为什么改（2026-10-15 真机实测，用户反馈「SKU 文字填写太慢」）：
     *   原实现每格走「scrollIntoView 400ms + focus 150ms + Backspace 120ms + 逐键 type
     *   + Tab 300ms + 回读」≈ 1.6~2.2s。30 行 × 3 列 = 90 格 → 144~200s，
     *   既撞上原 90s 预算（表现：填到第 14 行停住，第 15~18 行整行空），
     *   即便放开预算也慢到不可接受。
     *
     * ★ React 受控输入框的正确 JS 写法（关键）：
     *   `el.value = v` 只改 DOM，React 内部 state 不变，提交时仍报「必须大于0」。
     *   必须拿到该元素原型上的 value setter 调用它，再派发 input + change 事件，
     *   React 的 onChange/onBlur 才会同步。最后派发 blur 让校验生效。
     */
    const fillCell = async (ri, headReSrc, val) => {
        const got = await page.evaluate((ri, src, v) => {
            const re = new RegExp(src);
            const fn = window.__pddSkuLocate;
            if (typeof fn !== 'function')
                return null;
            const r = fn();
            const body = window.__pddSkuBody;
            const cols = window.__pddSkuCols;
            if (!body || !cols)
                return null;
            const col = r.heads.findIndex(h => re.test(h));
            if (col < 0)
                return null;
            const tdIdx = (cols[ri] || []).indexOf(col);
            if (tdIdx < 0)
                return null;
            const inp = body.querySelectorAll('tbody tr')[ri]?.querySelectorAll('td')[tdIdx]
                ?.querySelector('input:not([type=file])');
            if (!inp || inp.disabled || inp.readOnly)
                return null;
            // 原生 setter（绕过 React 对 value 的劫持）
            const proto = Object.getPrototypeOf(inp);
            const desc = Object.getOwnPropertyDescriptor(proto, 'value')
                || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            const setter = desc && desc.set;
            inp.focus();
            if (setter)
                setter.call(inp, v);
            else
                inp.value = v;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('blur', { bubbles: true }));
            return String(inp.value ?? '');
        }, ri, headReSrc, val).catch(() => null);
        return got;
    };
    /** 回读某格当前值（同样当场按表头重新定位，避免读到被 React 换掉的旧节点） */
    const readCell = (ri, headReSrc) => page.evaluate((ri, src) => {
        const re = new RegExp(src);
        const fn = window.__pddSkuLocate;
        if (typeof fn !== 'function')
            return null;
        const r = fn();
        const body = window.__pddSkuBody;
        const cols = window.__pddSkuCols;
        if (!body || !cols)
            return null;
        const col = r.heads.findIndex(h => re.test(h));
        if (col < 0)
            return null;
        const tdIdx = (cols[ri] || []).indexOf(col);
        if (tdIdx < 0)
            return null;
        const inp = body.querySelectorAll('tbody tr')[ri]?.querySelectorAll('td')[tdIdx]
            ?.querySelector('input:not([type=file])');
        return inp ? String(inp.value ?? '') : null;
    }, ri, headReSrc).catch(() => null);
    const info = await readTable();
    if (!info)
        return { filled: [], missed: ['价格及库存表（未定位到表头含「拼单价」的表）'] };
    // ★ 多维规格：我方 `skuRows` 顺序未必等于表格行序，需按「维度名 → 规格值」重排覆盖值。
    //   读表格规格列（表头含维度名）+ 每行规格单元格文本，逐行匹配到对应 SKU 行；
    //   匹配不到的行留空 → 回落顶层 price/stock（行为与旧路径一致）。
    if (rowOverrides.some(r => r?.specs && Object.keys(r.specs).length)) {
        const dims = Array.from(new Set(rowOverrides.flatMap(r => Object.keys(r?.specs || {}))));
        // 各维度的值集合（用于「表头名匹配不到时按列内容反查」兜底，如尺码列头实为「参考分类」）
        const dimVals = {};
        for (const d of dims) {
            dimVals[d] = Array.from(new Set(rowOverrides
                .map(r => String(r?.specs?.[d] ?? '').trim()).filter(Boolean)));
        }
        const grid = await page.evaluate((dimNames, dimValues) => {
            const norm = (s) => (s || '').replace(/\s+/g, '');
            const normSpec = (s) => norm(s).replace(/(cm|厘米|mm|毫米)/gi, '').toLowerCase();
            const fn = window.__pddSkuLocate;
            if (typeof fn !== 'function')
                return null;
            const r = fn();
            const body = window.__pddSkuBody;
            const colsMap = window.__pddSkuCols;
            if (!body || !colsMap)
                return null;
            const heads = r.heads.map(h => norm(h));
            const colCount = heads.length;
            // ★ 逐行按 rowspan 列映射取 td 文本；被 rowspan 合并（本行无该 td）的列沿用上一行值（carry）
            const trs = Array.from(body.querySelectorAll('tbody tr'));
            const carry = new Array(colCount).fill('');
            const rows = [];
            for (let ri = 0; ri < trs.length; ri++) {
                const rowCols = colsMap[ri] || [];
                const tds = Array.from(trs[ri].children);
                const arr = new Array(colCount).fill('');
                for (let k = 0; k < rowCols.length && k < tds.length; k++) {
                    const c = rowCols[k];
                    const txt = norm(tds[k].innerText);
                    arr[c] = txt;
                    carry[c] = txt;
                }
                for (let c = 0; c < colCount; c++)
                    if (!arr[c] && carry[c])
                        arr[c] = carry[c];
                rows.push(arr);
            }
            const cols = {};
            for (const d of dimNames) {
                let ci = heads.findIndex(h => h.includes(norm(d)));
                if (ci < 0) {
                    // ★ 值集合反查列兜底：取「列内容命中该维度值集合」最多的列
                    const want = new Set((dimValues[d] || []).map(normSpec));
                    let best = -1;
                    let bestScore = 0;
                    for (let c = 0; c < colCount; c++) {
                        let hit = 0;
                        for (const row of rows)
                            if (want.has(normSpec(row[c])))
                                hit++;
                        if (hit > bestScore) {
                            bestScore = hit;
                            best = c;
                        }
                    }
                    if (best >= 0 && bestScore > 0)
                        ci = best;
                }
                if (ci >= 0)
                    cols[d] = ci;
            }
            return { cols, rows };
        }, dims, dimVals).catch(() => null);
        if (grid && Object.keys(grid.cols).length) {
            const keyOf = (specs) => dims.map(d => `${d}=${normalizeSpecValue(specs?.[d] ?? '')}`).join('|');
            const byKey = new Map();
            for (const r of rowOverrides)
                byKey.set(keyOf(r?.specs || {}), { price: r?.price, stock: r?.stock });
            const remapped = grid.rows.map(cells => {
                const specs = {};
                for (const d of dims)
                    if (grid.cols[d] != null)
                        specs[d] = cells[grid.cols[d]] || '';
                return byKey.get(keyOf(specs)) || {};
            });
            if (remapped.length) {
                rowOverrides = remapped;
                console.log(`[dsagent-pdd-publish] 价格表按规格匹配重排：我方 ${byKey.size} 行 → 表格 ${remapped.length} 行`);
            }
        }
        else {
            console.log('[dsagent-pdd-publish] 价格表未读到规格列，按行序直接覆盖（未重排）');
        }
    }
    const sameValue = (a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (a && b && Number.isFinite(na) && Number.isFinite(nb))
            return na === nb;
        return a.trim() === b.trim();
    };
    const rowCount = Math.max(1, info.rows);
    /** 第 ri 行要填的任务（多 SKU 时按行覆盖；库存/拼单价/单买价，单买价 = 该行拼单价 + 1） */
    const jobsFor = (ri) => {
        const o = rowOverrides[ri] || {};
        // ★ 逐行覆盖值可能是空串（调用方只填了价格没填库存），必须用 || 回落，
        //   写成 `o.price ?? price` 会把空串当有效值 → 该行整列被跳过。
        const p = (o.price ?? '').trim() || price;
        const s = (o.stock ?? '').trim() || stock;
        const list = [];
        if (s)
            list.push({ key: 'stock', re: '库存', val: s });
        if (p) {
            list.push({ key: 'group', re: '拼单价', val: p });
            list.push({ key: 'single', re: '单买价', val: singleOf(p) });
        }
        if (itemNo) {
            list.push({ key: 'spec', re: '规格编码', val: itemNo });
            list.push({ key: 'goods', re: '商品编码', val: itemNo });
        }
        return list;
    };
    const done = new Set();
    /**
     * 填表前**等表格行数稳定**：二维规格（颜色×尺码）下平台是异步把 30 行渲染出来的，
     * 若过早开填，后段行还没出现 → 该行所有格子定位失败（表现：「第N行库存/拼单价/单买价」未填）。
     * 轮询直到行数连续 3 次不变（最多 25s）。
     */
    const waitRowsStable = async () => {
        let last = -1;
        let stable = 0;
        const t0 = Date.now();
        while (Date.now() - t0 < 25_000) {
            const t = await readTable();
            const n = t?.rows ?? 0;
            if (n > 0 && n === last) {
                if (++stable >= 3)
                    return n;
            }
            else {
                stable = 0;
            }
            last = n;
            await sleep(600);
        }
        return last > 0 ? last : 0;
    };
    const stableRows = await waitRowsStable();
    const effectiveRows = stableRows > 0 ? stableRows : rowCount;
    diag(`价格表：预期 ${rowCount} 行，实际 ${effectiveRows} 行；表头=${JSON.stringify(info.heads)}`);
    /**
     * ★★ JS 批量填表（2026-10-15 重写，用户反馈「SKU 文字填写太慢」）。
     *
     * 原实现逐格走真实键盘（每格 ≈1.6~2.2s）：30 行 × 3 列 = 90 格 → 144~200s，
     * 既慢又撞预算（填到第 14 行停住 → 平台拦「第14行单买价必须大于0」）。
     *
     * 现改为：**一次 evaluate 填完整表**，页面内循环 + 原生 setter + 事件派发。
     * 每格只做「定位 → 原生 setter → input/change/blur」，无 sleep、无真实键盘，
     * 90 格总耗时通常在 1s 内。
     *
     * ★ 关键：React 受控输入框必须用原型上的 value setter，否则 React state 不同步，
     *   提交时仍报「必须大于0」。事件顺序 input → change → blur 与手工输入一致。
     */
    const jobsByRow = [];
    for (let ri = 0; ri < effectiveRows; ri++) {
        const o = rowOverrides[ri] || {};
        jobsByRow.push({
            price: ((o.price ?? '').trim() || price) || undefined,
            stock: ((o.stock ?? '').trim() || stock) || undefined,
            itemNo: itemNo || undefined,
        });
    }
    const batch = await page.evaluate((rowsData, singleFn) => {
        const singleOf = new Function('p', `return (${singleFn})(p)`);
        const fn = window.__pddSkuLocate;
        if (typeof fn !== 'function')
            return { filled: 0, missed: [], log: 'no-locator' };
        const r = fn();
        const body = window.__pddSkuBody;
        const colsMap = window.__pddSkuCols;
        if (!body || !colsMap)
            return { filled: 0, missed: [], log: 'no-body' };
        const heads = r.heads;
        const trs = Array.from(body.querySelectorAll('tbody tr'));
        const setVal = (inp, v) => {
            const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value')
                || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            const setter = desc && desc.set;
            inp.focus();
            if (setter)
                setter.call(inp, v);
            else
                inp.value = v;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            inp.dispatchEvent(new Event('blur', { bubbles: true }));
        };
        /** 按表头 regex 找列号；再按 rowspan 列映射找该行的 td 下标 */
        const cellOf = (ri, re) => {
            const col = heads.findIndex(h => re.test(h));
            if (col < 0)
                return null;
            const tdIdx = (colsMap[ri] || []).indexOf(col);
            if (tdIdx < 0)
                return null;
            const tr = trs[ri];
            if (!tr)
                return null;
            const td = tr.querySelectorAll('td')[tdIdx];
            if (!td)
                return null;
            const inp = td.querySelector('input:not([type=file])');
            if (!inp || inp.disabled || inp.readOnly)
                return null;
            return inp;
        };
        let filled = 0;
        const missed = [];
        for (let ri = 0; ri < rowsData.length; ri++) {
            const d = rowsData[ri] || {};
            const rowNo = ri + 1;
            if (d.stock != null) {
                const inp = cellOf(ri, /库存/);
                if (inp) {
                    setVal(inp, String(d.stock));
                    filled++;
                }
                else
                    missed.push(`第${rowNo}行库存`);
            }
            if (d.price != null) {
                const gp = cellOf(ri, /拼单价/);
                if (gp) {
                    setVal(gp, String(d.price));
                    filled++;
                }
                else
                    missed.push(`第${rowNo}行拼单价`);
                const sp = cellOf(ri, /单买价/);
                if (sp) {
                    setVal(sp, String(singleOf(String(d.price))));
                    filled++;
                }
                else
                    missed.push(`第${rowNo}行单买价`);
            }
            if (d.itemNo != null) {
                const sc = cellOf(ri, /规格编码/);
                if (sc) {
                    setVal(sc, String(d.itemNo));
                    filled++;
                }
                const gc = cellOf(ri, /商品编码/);
                if (gc) {
                    setVal(gc, String(d.itemNo));
                    filled++;
                }
            }
        }
        return { filled, missed, log: `rows=${trs.length} heads=${heads.length}` };
    }, jobsByRow, singleOf.toString()).catch((e) => ({ filled: 0, missed: [], log: `eval-error:${e?.message}` }));
    diag(`JS 批量填表：写入 ${batch?.filled ?? 0} 格；未命中 ${(batch?.missed || []).length} 项；${batch?.log ?? ''}`);
    /**
     * 批量写完后**逐格回读校验**：React 可能丢弃部分值（受控组件时序），
     * 对回读不符的格子用同样的 JS 写法重试（最多 3 轮），确保提交前每格都真的写进去了。
     */
    const verifyAndRetry = async () => {
        for (let pass = 0; pass < 3; pass++) {
            const bad = await page.evaluate((rowsData, singleFn) => {
                const singleOf = new Function('p', `return (${singleFn})(p)`);
                const fn = window.__pddSkuLocate;
                if (typeof fn !== 'function')
                    return [];
                const r = fn();
                const body = window.__pddSkuBody;
                const colsMap = window.__pddSkuCols;
                if (!body || !colsMap)
                    return [];
                const heads = r.heads;
                const trs = Array.from(body.querySelectorAll('tbody tr'));
                const setVal = (inp, v) => {
                    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value')
                        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                    const setter = desc && desc.set;
                    inp.focus();
                    if (setter)
                        setter.call(inp, v);
                    else
                        inp.value = v;
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                    inp.dispatchEvent(new Event('blur', { bubbles: true }));
                };
                const cellOf = (ri, re) => {
                    const col = heads.findIndex(h => re.test(h));
                    if (col < 0)
                        return null;
                    const tdIdx = (colsMap[ri] || []).indexOf(col);
                    if (tdIdx < 0)
                        return null;
                    const tr = trs[ri];
                    if (!tr)
                        return null;
                    const td = tr.querySelectorAll('td')[tdIdx];
                    if (!td)
                        return null;
                    const inp = td.querySelector('input:not([type=file])');
                    if (!inp || inp.disabled || inp.readOnly)
                        return null;
                    return inp;
                };
                const badRows = [];
                for (let ri = 0; ri < rowsData.length; ri++) {
                    const d = rowsData[ri] || {};
                    const checks = [];
                    if (d.stock != null)
                        checks.push([/库存/, String(d.stock)]);
                    if (d.price != null) {
                        checks.push([/拼单价/, String(d.price)]);
                        checks.push([/单买价/, String(singleOf(String(d.price)))]);
                    }
                    for (const [re, want] of checks) {
                        const inp = cellOf(ri, re);
                        if (!inp)
                            continue;
                        const got = String(inp.value ?? '').trim();
                        const ng = Number(got);
                        const nw = Number(want);
                        const ok = (got && want && Number.isFinite(ng) && Number.isFinite(nw)) ? ng === nw : got === want;
                        if (!ok) {
                            setVal(inp, want);
                            badRows.push(ri + 1);
                        }
                    }
                }
                return Array.from(new Set(badRows));
            }, jobsByRow, singleOf.toString()).catch(() => []);
            if (!bad || bad.length === 0) {
                diag(`回读校验第 ${pass + 1} 轮：全部通过`);
                break;
            }
            diag(`回读校验第 ${pass + 1} 轮：修正 ${bad.length} 行（${bad.slice(0, 10).join(',')}${bad.length > 10 ? '…' : ''}）`);
            await sleep(800);
        }
    };
    await verifyAndRetry();
    // 汇总：**回读表格实际值**来判定（不再依赖 done 集合 —— JS 批量路径没有逐格标记）
    const finalVals = await page.evaluate((n, singleFn) => {
        const singleOf = new Function('p', `return (${singleFn})(p)`);
        const fn = window.__pddSkuLocate;
        if (typeof fn !== 'function')
            return null;
        const r = fn();
        const body = window.__pddSkuBody;
        const colsMap = window.__pddSkuCols;
        if (!body || !colsMap)
            return null;
        const heads = r.heads;
        const trs = Array.from(body.querySelectorAll('tbody tr'));
        const read = (ri, re) => {
            const col = heads.findIndex(h => re.test(h));
            if (col < 0)
                return '';
            const tdIdx = (colsMap[ri] || []).indexOf(col);
            if (tdIdx < 0)
                return '';
            const inp = trs[ri]?.querySelectorAll('td')[tdIdx]?.querySelector('input:not([type=file])');
            return inp ? String(inp.value ?? '').trim() : '';
        };
        const out = [];
        for (let ri = 0; ri < n; ri++) {
            out.push({ stock: read(ri, /库存/), price: read(ri, /拼单价/), single: read(ri, /单买价/) });
        }
        return { rows: trs.length, vals: out };
    }, effectiveRows, singleOf.toString()).catch(() => null);
    const filled = [];
    const missed = [];
    const rowTag = (ri) => (effectiveRows > 1 ? `第${ri + 1}行` : '');
    for (let ri = 0; ri < effectiveRows; ri++) {
        const o = rowOverrides[ri] || {};
        const p = (o.price ?? '').trim() || price;
        const s = (o.stock ?? '').trim() || stock;
        const tag = rowTag(ri);
        const v = finalVals?.vals?.[ri];
        const numEq = (a, b) => {
            const na = Number(a);
            const nb = Number(b);
            return (a && b && Number.isFinite(na) && Number.isFinite(nb)) ? na === nb : (a || '') === (b || '');
        };
        if (s) {
            if (numEq(v?.stock, s))
                filled.push(`${tag}库存=${s}`);
            else
                missed.push(`${tag}库存（回读「${v?.stock ?? '空'}」）`);
        }
        if (p) {
            const hit = [];
            if (numEq(v?.price, p))
                hit.push(`拼单价=${p}`);
            if (numEq(v?.single, singleOf(p)))
                hit.push(`单买价=${singleOf(p)}`);
            if (hit.length)
                filled.push(`${tag}${hit.join('、')}`);
            else
                missed.push(`${tag}拼单价/单买价（回读「${v?.price ?? '空'}/${v?.single ?? '空'}」）`);
        }
        if (itemNo) {
            const sc = await page.evaluate(() => '').catch(() => '');
            void sc;
        }
    }
    diag(`价格表汇总：实际行数 ${finalVals?.rows ?? -1}；已填 ${filled.length} 项；未填 ${missed.length} 项`);
    return { filled, missed };
}
/**
 * 模式2 专用：**只填库存，不填价格**（价格由劫持改包注入）。
 *
 * 为什么需要这个（2026-10-20 实测）：
 *   模式2 把 UI 填价整段跳过 → 30 行 SKU 建出来了但库存全空
 *   → 页面顶部报「错误（1）… 请输入第1行规格的库存」→ 提交按钮 disabled
 *   → `模式2 提交按钮点击：未点到` → 等 120s 后 PDD_HIJACK_WAIT_TIMEOUT。
 *
 *   库存是**点提交的前置条件**，改包救不了（改包在请求发出之后）。
 *   价格却可以留白 —— 改包会按 goodsDetail.sku_price 填进去。
 *
 * 实现：直接复用 fillPriceTable，把 price 传空串，
 *   这样它内部 `if (p) {...}` 分支自然跳过拼单价/单买价，只填库存列。
 */
async function fillStockOnly(page, stock) {
    const s = String(stock || '').trim();
    if (!s)
        return { filled: 0, note: '未传库存值' };
    try {
        const r = await fillPriceTable(page, { stock: s });
        // fillPriceTable 的 filled 是描述性字符串数组，形如「第N行库存=1000」
        const invItems = (r.filled || []).filter(x => /库存/.test(String(x)));
        return {
            filled: invItems.length,
            note: invItems.length
                ? `${invItems.length} 行库存已填（价格留白，待改包注入）`
                : `未填到库存列；missed=${(r.missed || []).slice(0, 3).join(' / ')}`,
        };
    }
    catch (e) {
        return { filled: 0, note: `异常：${e.message}` };
    }
}
/** 读商品属性区的全部属性项 */
async function readAttrItems(page) {
    return await page.evaluate(() => {
        const out = [];
        const items = Array.from(document.querySelectorAll('.goods-propertys .property-item'));
        for (const it of items) {
            const fi = it.querySelector('[id^="basic.propertys."]');
            if (!fi)
                continue;
            const inp = fi.querySelector('input[data-testid="beast-core-select-htmlInput"]');
            if (!inp)
                continue;
            const labelEl = fi.querySelector('label');
            const name = (labelEl?.innerText || '').replace(/重要/g, '').replace(/[*＊]/g, '').replace(/\s+/g, '');
            // 类目规则：从 DOM 读 maxlength + 必填标记 + 校验提示
            const ml = Number(inp.getAttribute('maxlength')) || (inp.maxLength > 0 ? inp.maxLength : 0);
            const required = !!fi.querySelector('[class*="important"], [class*="required"], .required');
            const hintEl = fi.querySelector('[class*="Error"], [class*="error"], [class*="help"], [class*="tip"]');
            const hint = (hintEl?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
            out.push({ id: fi.id, name, filled: !!(inp.value || '').trim(), placeholder: inp.placeholder || '', maxlength: ml, required, hint });
        }
        return out;
    }).catch(() => []);
}
/** 展开某个属性的下拉面板（beast-core Select 靠 header 上的 mousedown/click 展开） */
async function openAttrDropdown(page, id) {
    // ★ 展开前确保没有遗留面板（否则 readOpenOptions 会读到上一个属性的候选）
    const alive = await page.evaluate(() => {
        const panels = Array.from(document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')).filter(p => p.offsetParent !== null);
        return panels.length;
    }).catch(() => 0);
    if (alive > 0) {
        await page.keyboard.press('Escape').catch(() => { });
        await sleep(200);
    }
    return await page.evaluate((fid) => {
        const fi = document.getElementById(fid);
        if (!fi)
            return false;
        const head = (fi.querySelector('[data-testid="beast-core-select-header"]')
            || fi.querySelector('input[data-testid="beast-core-select-htmlInput"]'));
        if (!head)
            return false;
        head.scrollIntoView({ block: 'center' });
        try {
            fi.querySelector('input')?.focus();
        }
        catch { /* 忽略 */ }
        for (const ev of ['mousedown', 'mouseup', 'click']) {
            head.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }));
        }
        return true;
    }, id).catch(() => false);
}
/**
 * 读「当前已展开」的下拉面板里的真实选项。
 * ★ 面板挂在 body 级 portal 上（`.ST_dropdownPanel_5-188-0` / `.ST_dropdownMain_5-188-0`，
 *   选项是其内的 `li.ST_item_5-188-0`），与触发它的 select 在 DOM 上不相邻，
 *   因此只能按「可见面板」取，取**文档中最后一个可见面板**（即最近展开的那个）。
 * ★ 只读真实选项，绝不凭空造值 —— 后续交给模型也只能从这批文本里挑。
 */
async function readOpenOptions(page) {
    return await page.evaluate(() => {
        const panels = Array.from(document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')).filter(p => p.offsetParent !== null);
        const panel = panels[panels.length - 1];
        if (!panel)
            return [];
        const out = [];
        const seen = new Set();
        const nodes = Array.from(panel.querySelectorAll('li, [role="option"], [class*="ST_item"]'));
        for (const n of nodes) {
            if (n.offsetParent === null)
                continue;
            const t = (n.innerText || '').replace(/\s+/g, ' ').trim();
            if (!t || t.length > 40 || seen.has(t))
                continue;
            seen.add(t);
            out.push(t);
        }
        return out;
    }).catch(() => []);
}
/**
 * 在已展开的下拉面板里点中文本完全匹配的选项。
 * ★ 与价格输入框同一课：合成 MouseEvent 不一定被 React 认下，
 *   所以先打标记、再用 CDP 派发**真实鼠标点击**（见 fillPriceTable 的注释）。
 */
async function clickOpenOption(page, text) {
    const found = await page.evaluate((t) => {
        const panels = Array.from(document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')).filter(p => p.offsetParent !== null);
        const panel = panels[panels.length - 1];
        if (!panel)
            return false;
        for (const e of Array.from(document.querySelectorAll('[data-pdd-opt]'))) {
            e.removeAttribute('data-pdd-opt');
        }
        const nodes = Array.from(panel.querySelectorAll('li, [role="option"], [class*="ST_item"]'));
        const hit = nodes.find(n => n.offsetParent !== null
            && (n.innerText || '').replace(/\s+/g, ' ').trim() === t);
        if (!hit)
            return false;
        hit.setAttribute('data-pdd-opt', '1');
        return true;
    }, text).catch(() => false);
    if (!found)
        return false;
    const el = await page.$('[data-pdd-opt="1"]').catch(() => null);
    if (!el)
        return false;
    try {
        await el.click();
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 点选后回读属性项，确认值确实落到了控件上。
 * ★ 不能只看 innerText：beast-core 的单选下拉会把选中值写进 `input.value`
 *   （此时 innerText 仍是空的），只看 innerText 会误报「未确认到值」（真机实测踩过）。
 */
async function verifyAttrValue(page, id, value) {
    return await page.evaluate((fid, v) => {
        const fi = document.getElementById(fid);
        if (!fi)
            return false;
        const norm = (s) => (s || '').replace(/\s+/g, '');
        const want = norm(v);
        if (norm(fi.innerText).includes(want))
            return true;
        for (const el of Array.from(fi.querySelectorAll('input, textarea'))) {
            const val = el.value || '';
            if (norm(val).includes(want))
                return true;
        }
        return false;
    }, id, value).catch(() => false);
}
/**
 * 收起下拉面板。
 *
 * ★★ 修复（2026-10-20 真机实测「属性区空转 150s」）：
 *   原实现只派发一次 mousedown/mouseup/click 就返回，**既不等待也不校验**。
 *   连续处理多个属性时，上一个面板往往还开着 →
 *   下一个 `openAttrDropdown` 命中的仍是**旧面板**、`readOpenOptions` 读到旧候选 →
 *   `clickOpenOption` 永远点不中 → 整个属性阶段卡死（实测 150s 看门狗才打断）。
 *
 *   现在：派发关闭事件后**轮询确认面板已消失**；仍在则按 Escape；再不行点页面空白处。
 *   最多等 3s，确保下一个属性从干净状态开始。
 */
async function closeAttrDropdown(page, id) {
    const panelAlive = () => page.evaluate(() => {
        const panels = Array.from(document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')).filter(p => p.offsetParent !== null);
        return panels.length > 0;
    }).catch(() => false);
    // ① 点属性 label 触发外部点击
    await page.evaluate((fid) => {
        const fi = document.getElementById(fid);
        const label = (fi?.querySelector('label') || document.body);
        for (const ev of ['mousedown', 'mouseup', 'click']) {
            label.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }));
        }
    }, id).catch(() => { });
    await sleep(220);
    if (!(await panelAlive()))
        return;
    // ② Escape 关面板
    await page.keyboard.press('Escape').catch(() => { });
    await sleep(220);
    if (!(await panelAlive()))
        return;
    // ③ 点页面空白处（右下角，避开所有控件）
    const vp = page.viewport() || { width: 1440, height: 900 };
    await page.mouse.click(vp.width - 12, vp.height - 12).catch(() => { });
    await sleep(320);
    if (!(await panelAlive()))
        return;
    diag(`属性下拉未能收起（id=${id}），可能影响后续属性填写`);
}
/**
 * 惰性加载宿主 LLM 包的 `BlockAssembler`（把流式分片拼成内容块的官方算法）。
 *
 * ★ 为什么用**动态 import** 而不是文件顶部静态 import：本文件被 `dev/publish-real.mjs`
 *   等离线脚本在**普通 node**（无宿主模块回退）下直接 import。静态 import
 *   `@deepseek-ai/dsh-llm` 会让 `lib/pdd-publish.js` 在那种环境下**整个加载失败**
 *   （ERR_MODULE_NOT_FOUND），拖垮真机验证链路。动态 import 只在真正要调模型时求值，
 *   且失败被 catch 吞掉 → 属性区降级，不影响发布。
 */
let blockAssemblerCtor;
async function loadBlockAssembler() {
    if (!blockAssemblerCtor) {
        const mod = await import('@deepseek-ai/dsh-llm');
        blockAssemblerCtor = mod.BlockAssembler;
    }
    return blockAssemblerCtor;
}
/**
 * 让**宿主聊天模型**从「页面真实选项」里为某属性挑一个值。
 * ★ 安全边界：只接受「原样命中候选值」的返回 —— 模型改写、编造或返回 null 一律当作放弃，
 *   宁可标「未自动填」也不许它自由发挥（属性填错会导致商品被下架或流量损失）。
 * ★ 模型不可用（宿主没注入 llm / 会话无路由）时直接返回 null，由调用方记入 missed。
 */
async function pickAttrValue(attrName, options, ctx) {
    if (!options.length)
        return null;
    const model = ctx.model;
    if (!model)
        return null;
    const sys = '你是电商商品发布助手。根据商品标题，从「候选值」中为该属性挑选最合适的一个。\n'
        + '硬性规则：① 只能原样返回候选值中的一个，不得改写、不得创造新值；\n'
        + '② 只要有一个候选值与商品标题明显契合就必须选它（多选属性也只需选最契合的一个）；\n'
        + '③ 只有候选值全部明显不相关时才返回 null。\n'
        + '只输出 JSON，形如 {"value":"候选值原文"} 或 {"value":null}，不要输出任何解释。';
    const user = `商品标题：${ctx.title}\n属性名：${attrName}\n候选值：${options.join(' / ')}`;
    try {
        const BlockAssembler = await loadBlockAssembler();
        const assembler = new BlockAssembler();
        let finished = false;
        for await (const chunk of model.stream({
            provider: model.provider,
            model: model.model,
            system: sys,
            messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
            temperature: 0,
            maxTokens: 120,
            signal: AbortSignal.timeout(ATTR_MODEL_TIMEOUT_MS),
        })) {
            if (finished)
                break;
            assembler.push(chunk);
            if (chunk?.type === 'finish')
                finished = true;
        }
        // 只有正常收尾（stop）才采信输出；错误/取消/截断一律放弃
        if (!finished || assembler.finish.kind !== 'stop')
            return null;
        const raw = assembler.blocks()
            .filter(b => b.type === 'text')
            .map(b => b.text || '')
            .join('');
        const jsonText = raw.match(/\{[\s\S]*\}/)?.[0];
        if (!jsonText)
            return null;
        const v = JSON.parse(jsonText)?.value;
        const picked = typeof v === 'string' ? v.trim() : '';
        if (!picked)
            return null;
        // 犹豫信号：返回了值但不在候选里 = 想改写，按放弃处理但标记
        const hesitated = !options.includes(picked);
        if (hesitated)
            return null;
        return { value: picked, hesitated: false, candidates: options.length };
    }
    catch {
        return null;
    }
}
/**
 * 填「发货与售后」+「运费模板」（对齐神笔 step 25-26）。
 *
 * 神笔 step 25（发货时间）：
 *   // 非预售
 *   document.evaluate('//div[@id="service.is_pre_sale"]//label[.//text()="非预售"]', ...).singleNodeValue?.click()
 *   // 发货时间
 *   let e = "当日发货及揽收";
 *   switch(o.shopDelivery){case 1:case 2:e="24小时发货及揽收";break;case 3:e="48小时发货及揽收"}
 *   document.evaluate('//div[@id="service.shipment_limit_second"]//label[.//text()="${e}"]', ...).singleNodeValue.click()
 *
 * 神笔 step 26（运费模板）：
 *   document.evaluate('//div[@id="service.is_default_template_id"]//label[.//text()="其他模板"]', ...).singleNodeValue.click()
 *   document.querySelector('.template-box-select input').click()
 *   document.evaluate('//ul[@role="listbox"]//li[.//text()="${n.costTemplate}"]', ...).singleNodeValue.click()
 */
async function fillShippingAndFreight(page, opts) {
    const filled = [];
    const missed = [];
    const deliveryTime = opts.deliveryTime ?? 1;
    // ① 非预售（service.is_pre_sale）
    //    先尝试神笔 step 25 的 XPath，再退化用文本搜索找「非预售」radio/label
    const notPreSale = await page.evaluate(() => {
        // 精确 XPath（神笔锚点）
        const lbl = document.evaluate('//div[@id="service.is_pre_sale"]//label[.//text()="非预售"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (lbl) {
            lbl.click();
            return true;
        }
        // 退化：在发货/售后区域内找含「非预售」文本的可点击元素
        const allLabels = Array.from(document.querySelectorAll('label, span, div, a'))
            .filter(el => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0)
                return false;
            const t = (el.innerText || '').trim();
            return t === '非预售' || t === '非预售(下单后48小时发货)' || /^非预售/.test(t);
        });
        if (allLabels.length) {
            const inner = allLabels.filter(e => !allLabels.some(o => o !== e && e.contains(o)));
            const target = inner.find(e => e.tagName === 'LABEL') || inner.find(e => e.closest('label')) || inner[0];
            (target.closest('label') || target).click();
            return true;
        }
        return false;
    }).catch(() => false);
    if (notPreSale)
        filled.push('发货方式=非预售');
    else
        missed.push('发货方式（未找到「非预售」选项）');
    await sleep(800);
    // ② 发货时间（service.shipment_limit_second）
    const deliveryText = deliveryTime === 2 ? '24小时发货及揽收'
        : deliveryTime === 3 ? '48小时发货及揽收'
            : '当日发货及揽收';
    const deliverySet = await page.evaluate((dt) => {
        // 精确 XPath（神笔锚点）
        const lbl = document.evaluate(`//div[@id="service.shipment_limit_second"]//label[.//text()="${dt}"]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (lbl) {
            lbl.click();
            return true;
        }
        // 退化：全文搜索含目标文本的可点击 label
        const allLabels = Array.from(document.querySelectorAll('label, span, div'))
            .filter(el => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0)
                return false;
            return (el.innerText || '').trim() === dt || (el.innerText || '').includes(dt);
        });
        if (allLabels.length) {
            const inner = allLabels.filter(e => !allLabels.some(o => o !== e && e.contains(o)));
            const target = inner.find(e => e.tagName === 'LABEL') || inner.find(e => e.closest('label')) || inner[0];
            (target.closest('label') || target).click();
            return true;
        }
        return false;
    }, deliveryText).catch(() => false);
    if (deliverySet) {
        filled.push(`发货时间=${deliveryText}`);
        // ── 店铺级缓存（PUBLISH-SPEC §3.6）：发货时间成功选中 → 记录，下次未显式指定时复用 ──
        await attrCache.recordFreight(PLATFORM, 'delivery', deliveryText).catch(() => { });
    }
    else
        missed.push(`发货时间（未找到「${deliveryText}」选项）`);
    await sleep(800);
    // ③ 运费模板（service.is_default_template_id）
    // ── 店铺级缓存（PUBLISH-SPEC §3.6）：未显式指定模板时，用上次成功选中的模板 ──
    //   ★ 命中即验证：缓存值必须仍在下拉候选 li 里才用，不在则跳过整段（保持旧行为）。
    let costTemplate = String(opts.costTemplate || '').trim();
    if (!costTemplate) {
        const cachedTpl = await attrCache.lookupFreight(PLATFORM, 'template').catch(() => null);
        if (cachedTpl) {
            costTemplate = cachedTpl;
            console.log(`[dsagent-pdd-publish] 未指定运费模板，使用店铺缓存「${cachedTpl}」`);
        }
    }
    if (costTemplate) {
        const templateSet = await page.evaluate((tpl) => {
            // 点「其他模板」单选项
            const otherLbl = document.evaluate('//div[@id="service.is_default_template_id"]//label[.//text()="其他模板"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (!otherLbl)
                return false;
            otherLbl.click();
            return true;
        }, costTemplate).catch(() => false);
        if (templateSet) {
            await sleep(1000);
            // 打开模板下拉
            await page.evaluate(() => {
                const inp = document.querySelector('.template-box-select input');
                if (inp)
                    inp.click();
            }).catch(() => { });
            await sleep(1200);
            // 选模板（★ 命中即验证：先精确匹配，兜底选第一个；返回实际点中的 li 文本用于缓存回填）
            const picked = await page.evaluate((tpl) => {
                const li = document.evaluate(`//ul[@role="listbox"]//li[.//text()="${tpl}"]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (li) {
                    li.click();
                    return (li.innerText || '').trim() || true;
                }
                // 兜底：选第一个
                const first = document.evaluate('//ul[@role="listbox"]//li', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (first) {
                    first.click();
                    return (first.innerText || '').trim() || true;
                }
                return false;
            }, costTemplate).catch(() => false);
            if (picked) {
                // 实际选中的模板名（缓存命中或兜底第一项）——记入店铺级缓存，下次直接复用
                const actualTpl = typeof picked === 'string' ? picked : costTemplate;
                filled.push(`运费模板=${actualTpl}`);
                await attrCache.recordFreight(PLATFORM, 'template', actualTpl).catch(() => { });
            }
            else
                missed.push(`运费模板（未找到模板「${costTemplate}」）`);
        }
        else {
            missed.push('运费模板（未找到「其他模板」单选项）');
        }
        await sleep(800);
    }
    console.log(`[dsagent-pdd-publish] 发货与售后：已填 ${filled.join('、') || '（无）'}；未完成 ${missed.join('、') || '（无）'}`);
    return { filled, missed };
}
/**
 * 自动填「商品属性」区：逐个属性「展开下拉 → 读真实选项 → 模型选值 → 点中」。
 * ★ 属性无 `*`（属建议/重要项），填失败不阻断发布，只记入 missed 回报。
 * ★ 品牌跳过（品牌授权风险）。
 * ★ `model` 缺失（宿主未提供 llm 服务 / 会话无模型路由）时，仍读下拉并记 missed，
 *   但不去猜值 —— 绝不硬编码一个模型名去调用。
 */
async function fillAttributes(page, ctx) {
    const filled = [];
    const missed = [];
    const cat = ctx.category || '';
    const normName = (s) => String(s || '').replace(/\s+/g, '');
    const explicit = new Map();
    for (const v of ctx.values || []) {
        const n = normName(v?.name);
        const val = String(v?.value || '').trim();
        if (n && val)
            explicit.set(n, val);
    }
    const all = await readAttrItems(page);
    // ── schema 指纹（PUBLISH-SPEC §3.6）：类目属性结构变了 → 自动失效属性缓存桶 ──
    if (cat && all.length) {
        const fp = await attrCache.checkSchemaFingerprint(PLATFORM, cat, all.map(i => i.name)).catch(() => null);
        if (fp?.changed) {
            console.log('[dsagent-pdd-publish] 类目属性结构变化，属性缓存已失效，本次走模型重填');
        }
    }
    const todo = all.filter(i => i.name && !i.filled && !ATTR_SKIP_RE.test(i.name));
    if (all.length) {
        console.log(`[dsagent-pdd-publish] 商品属性共 ${all.length} 项，待填 ${todo.length} 项`
            + `${todo.length ? `：${todo.map(i => i.name).join('、')}` : ''}`);
    }
    if (!ctx.model && todo.length) {
        console.log('[dsagent-pdd-publish] 宿主聊天模型不可用（无 llm 服务或会话无模型路由），属性走标题词匹配 + 选第一项兜底');
    }
    for (const it of todo) {
        const isSearch = /搜索/.test(it.placeholder);
        await openAttrDropdown(page, it.id);
        await sleep(ATTR_DROPDOWN_WAIT_MS);
        let options = await readOpenOptions(page);
        /**
         * ★ 搜索型属性（placeholder 含「搜索」）：下拉默认不列选项，必须**先输入关键词**才出候选。
         *   用户要求「属性要填满」，故这里主动输入关键词再读一次候选。
         *   关键词来源优先级：显式指定值 → 标题分词。
         */
        if (isSearch && !options.length) {
            const seed = (explicit.get(normName(it.name)) || '').trim()
                || (ctx.title || '').replace(/[（）()【】\[\]{}]/g, ' ')
                    .split(/[\s/\\>＞、,，|]+/).filter((t) => t.length >= 2)[0]
                || '';
            if (seed) {
                const typed = await page.evaluate((fid, kw) => {
                    const fi = document.getElementById(fid);
                    if (!fi)
                        return false;
                    const inp = fi.querySelector('input[data-testid="beast-core-select-htmlInput"]');
                    if (!inp)
                        return false;
                    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value')
                        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                    const setter = desc && desc.set;
                    inp.focus();
                    if (setter)
                        setter.call(inp, kw);
                    else
                        inp.value = kw;
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }, it.id, seed).catch(() => false);
                if (typed) {
                    await sleep(1200);
                    options = await readOpenOptions(page);
                    if (options.length)
                        diag(`属性「${it.name}」搜索词「${seed}」命中 ${options.length} 个候选`);
                }
            }
        }
        if (!options.length) {
            await closeAttrDropdown(page, it.id);
            missed.push(isSearch ? `${it.name}（搜索型属性，输入关键词后仍无候选）` : `${it.name}（下拉未读到选项）`);
            continue;
        }
        // ── 显式指定优先：调用方给了该属性的值 ──
        const want = explicit.get(normName(it.name));
        if (want && options.includes(want)) {
            const ok = await clickOpenOption(page, want);
            await sleep(400);
            const confirmed = ok && await verifyAttrValue(page, it.id, want);
            await closeAttrDropdown(page, it.id);
            if (confirmed)
                filled.push(`${it.name}=${want}（显式指定）`);
            else
                missed.push(`${it.name}（显式值「${want}」${ok ? '点选后未确认到值' : '点选失败'}）`);
            continue;
        }
        if (want) {
            // ★ 修复（2026-10-15）：显式值不在候选时**不再直接放弃**。
            //   用户明确要求「属性要填满」，故落到下面的模型 / 标题词 / 首项兜底继续选。
            //   （下拉此时仍开着，兜底逻辑直接复用当前 options。）
            console.log(`[dsagent-pdd-publish] 属性「${it.name}」显式值「${want}」不在候选，转兜底：${options.join(' / ')}`);
        }
        // ── 缓存优先：同类目上次成功填的值，若仍在当前选项里就直接用（省模型 API）──
        let pick = null;
        let fromCache = false;
        if (cat) {
            const cached = await attrCache.lookup(PLATFORM, cat, it.name).catch(() => null);
            if (cached && options.includes(cached)) {
                pick = { value: cached, hesitated: false, candidates: options.length };
                fromCache = true;
            }
        }
        // ── 缓存未命中或值已不在选项里 → fallback 到模型 ──
        if (!pick) {
            pick = await pickAttrValue(it.name, options, ctx);
        }
        // ★★ 修复（2026-10-15）：模型可能返回**空值**（value 为空串）而非 null ——
        //   原判据只写 `if (!pick)`，非 null 的空对象会跳过下面的标题词兜底，
        //   最终走到「候选 N 项，模型未选」，属性留空。
        //   用户明确要求「属性要填满」，故此处把空值视为未选中，强制走兜底。
        if (pick && !String(pick.value || '').trim()) {
            console.log(`[dsagent-pdd-publish] 属性「${it.name}」模型返回空值，转标题词匹配兜底`);
            pick = null;
        }
        // 模型给的值若不在候选里，同样视为无效（否则 clickOpenOption 必失败）
        if (pick && !options.includes(pick.value)) {
            console.log(`[dsagent-pdd-publish] 属性「${it.name}」模型值「${pick.value}」不在候选，转兜底`);
            pick = null;
        }
        /**
         * ── 模型不可用 / 模型未选 → 标题词匹配兜底 ──
         *
         * ★★ 关键修复（2026-10-20 真机实测，「盲选第一项」必须废止）：
         *
         *   故障：模型不可用时走到「选第一个候选」，实际填入的值是：
         *     下装长=短款（商品是长裤）、适用年龄段=14岁以上（商品是110–160cm）、
         *     安全等级=A类（商品是B类）、领型=挂脖（商品是翻领）
         *   这些不是「稍微不准」，而是把商品描述成了**另一种东西**：
         *     · 安全等级填 A 类会触发强制质检，且与实物不符；
         *     · 适用年龄段填 14 岁以上会让人群定向完全错位；
         *     · 挂脖 ≠ 翻领，属于虚假描述。
         *   更糟的是这些盲选值还会被写入 attrCache，下次同类目直接复用（污染累积）。
         *
         *   新策略：**标题词匹配命中才填；匹配不到就留空**，并把「为什么没填」记进
         *   missed 让调用方知道。仅当该属性确为平台必填（it.required）时才允许盲选，
         *   因为必填不填会直接卡住提交，两害相权取其一。
         */
        if (!pick && options.length) {
            const titleTokens = ctx.title.replace(/[（）()【】\[\]{}]/g, '')
                .split(/[\s/\\>＞、,，|]+/)
                .filter((t) => t.length >= 2);
            let matched = null;
            for (const tok of titleTokens) {
                const hit = options.find(o => o.includes(tok) || tok.includes(o));
                if (hit) {
                    matched = hit;
                    break;
                }
            }
            if (matched) {
                pick = { value: matched, hesitated: true, candidates: options.length };
                diag(`属性「${it.name}」标题词匹配命中「${matched}」`);
            }
            else if (it.required) {
                // 必填项：不填会卡住提交，只能选首项（但仍标注，便于事后人工核对）
                pick = { value: options[0], hesitated: true, candidates: options.length };
                diag(`属性「${it.name}」为必填项且无匹配，只能选首项「${options[0]}」（建议人工核对）`);
            }
            else {
                // 选填项：宁可不填，也不要写错 —— 写错会导致虚假描述/流量损失
                diag(`属性「${it.name}」无匹配且非必填，留空（候选：${options.join(' / ')}）`);
                await closeAttrDropdown(page, it.id);
                missed.push(`${it.name}（选填项，无匹配候选故留空；候选：${options.slice(0, 8).join('/')}）`);
                continue;
            }
        }
        if (!pick) {
            await closeAttrDropdown(page, it.id);
            console.log(`[dsagent-pdd-publish] 属性「${it.name}」候选：${options.join(' / ')}`);
            missed.push(ctx.model
                ? `${it.name}（候选 ${options.length} 项，模型未选）`
                : `${it.name}（候选 ${options.length} 项，宿主模型不可用未选）`);
            continue;
        }
        const ok = await clickOpenOption(page, pick.value);
        await sleep(400);
        const confirmed = ok && await verifyAttrValue(page, it.id, pick.value);
        await closeAttrDropdown(page, it.id);
        if (confirmed) {
            const tag = fromCache ? '缓存命中' : pick.hesitated ? '标题词/兜底' : `候选${pick.candidates}项`;
            filled.push(`${it.name}=${pick.value}（${tag}）`);
            // 只记模型选的值（缓存命中的已记过，不重复刷 hits）
            if (!fromCache && cat) {
                await attrCache.record(PLATFORM, cat, it.name, pick.value).catch(() => { });
            }
        }
        else {
            missed.push(`${it.name}（点选「${pick.value}」${ok ? '后未确认到值' : '失败'}）`);
        }
    }
    return { filled, missed };
}
/**
 * 读「提交后被拦」的真实原因。
 *
 * ★ 为什么必须专门读（真机实测教训）：提交被拦时页面**不弹 toast**，拦因只在两处：
 *     ① 右侧固定区「商品填写建议」面板（`.goods-optimization-container`）——
 *        头部 `.optimize-header`，两个 tab「错误（N）」「建议」；
 *        错误 tab 的 `.TAB_content_*` 为空时是「暂无错误内容」；
 *        建议 tab 里是 `.optimize-item_container_*`（模块名 + 文案），如「商品属性 / 填写属性，获取流量」；
 *     ② 各字段下方的红色校验文案（`[class*="Form_itemError"]`）。
 *   旧的「拿 document.body.innerText 去正则匹配关键词」一个都没命中，180s 空转后
 *   只能报「未检测到成功标志」，对定位毫无帮助。
 *
 * 返回 hard = 硬拦因（有它就不必再等）；panel = 面板全文（诊断用，仅建议项时也保留）。
 */
async function readSubmitErrors(page) {
    return await page.evaluate(() => {
        const hard = [];
        // ① toast（排除成功文案）
        const toast = document.querySelector('div[data-testid="beast-core-toast"]');
        const toastTxt = (toast?.innerText || '').replace(/\s+/g, ' ').trim();
        if (toastTxt && !/提交成功|发布成功/.test(toastTxt))
            hard.push(`页面提示：${toastTxt}`);
        // ② 字段级红色校验文案
        for (const e of Array.from(document.querySelectorAll('[class*="Form_itemError"]'))) {
            if (e.offsetParent === null)
                continue;
            const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
            if (t && t.length <= 60)
                hard.push(t);
        }
        // ③「商品填写建议」面板
        let panel = '';
        const opt = document.querySelector('[class*="goods-optimization-container"]');
        if (opt) {
            const labels = Array.from(opt.querySelectorAll('[class*="common_tabLabel"]'));
            const errTab = labels.find(l => /错误/.test(l.innerText || ''));
            const errCount = Number((errTab?.innerText || '').match(/(\d+)/)?.[1] || 0);
            const errTxt = (opt.querySelector('[class*="TAB_content"]')?.textContent || '')
                .replace(/\s+/g, ' ').trim();
            const advice = Array.from(opt.querySelectorAll('[class*="optimize-item_container"]'))
                .map(a => (a.innerText || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            if (errCount > 0 && errTxt && !/暂无错误内容/.test(errTxt))
                hard.push(`错误（${errCount}）：${errTxt}`);
            const title = opt.querySelector('[class*="optimize-header"]')?.innerText || '';
            panel = [title.replace(/\s+/g, ' ').trim(), `错误（${errCount}）`, ...advice].filter(Boolean).join(' | ');
        }
        return { hard: Array.from(new Set(hard)).join('；'), panel };
    }).catch(() => ({ hard: '', panel: '' }));
}
/**
 * 点「提交并上架」。
 * 真机实测：第二步表单页底部的按钮 innerText 恰为「提交并上架」。
 * ★ 影刀记录的 button#submit_button 已不存在，不再作为优先锚点。
 *
 * ★ 2026-10-22 修复：原实现用 `hit.click()`（DOM untrusted 事件），拼多多 React
 *   会忽略（与「发布新商品」入口同一个坑）。改为：
 *   1. 先 DOM click 试一次
 *   2. URL 没变化 / 无劫持触发 → 调用方回退 CDP 真实鼠标（见段4 收尾）
 *   同时 disabled 时返回诊断信息（哪个必填项未过），不再简单 false。
 */
async function clickSubmit(page) {
    return await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const hit = btns.find(b => /^(提交并上架|提交|确认提交|发布)$/.test((b.innerText || '').trim())
            && !/取消|草稿/.test((b.innerText || '').trim())
            && b.offsetParent !== null);
        if (!hit)
            return false;
        hit.click();
        return true;
    }).catch(() => false);
}
/** 诊断提交按钮为何 disabled（必填项未过），返回可读文案 */
async function diagSubmitDisabled(page) {
    return await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const hit = btns.find(b => /^(提交并上架|提交|确认提交|发布)$/.test((b.innerText || '').trim())
            && !/取消|草稿/.test((b.innerText || '').trim())
            && b.offsetParent !== null);
        if (!hit)
            return '未找到提交按钮（页面可能未加载完）';
        if (!hit.disabled)
            return '按钮可点（无需诊断）';
        // 找页面上的错误提示/必填未填标记
        const errs = Array.from(document.querySelectorAll('[class*="error"], [class*="Error"], [class*="required"], [class*="warn"]'))
            .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
            .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim())
            .filter(t => t && t.length < 80)
            .slice(0, 6);
        return `提交按钮 disabled${errs.length ? '；页面提示：' + errs.join(' / ') : '（未读到具体提示）'}`;
    }).catch(() => '诊断异常');
}
/**
 * 从标题提取类目搜索关键词（category 未传时的兜底）。
 * 取标题开头连续的 CJK/字母数字段（去掉促销词、标点、空格），取前 6 个字。
 * 如「2026春秋新款儿童卡通印花长袖T恤」→「春秋新款」类前缀不适合搜索，
 * 实际取「儿童卡通」附近的实体词更准——这里用简单策略：剥掉常见营销前缀后取前 6 字。
 */
function extractCateKeyword(title) {
    let t = title
        .replace(/20\d{2}\s*[年度]?/, '') // 年份
        .replace(/新款|新款上市|爆款|热卖|热销|同款|正品|专供|直批|厂家|工厂|直营/g, '')
        .replace(/春秋|夏季|夏季新款|秋冬|冬季|春夏/g, '') // 季节词
        .replace(/[（(【\[][^）)】\]]{0,6}[）)】\]]/g, ''); // 括号注记
    // 取第一段连续 CJK 词（允许中间夹字母数字，如 T恤、5号）
    const m = t.match(/[\u4e00-\u9fa5A-Za-z0-9]+/);
    const seg = (m?.[0] || t).trim();
    return seg.slice(0, 6) || t.slice(0, 6);
}
/**
 * 生成类目搜索关键词候选（按优先级、去重）。
 *
 * ★ 真机实测（2026-10-14）：拼多多类目名是**路径**（如「童装/婴儿装/亲子装 > 套装 > 套装」），
 *   搜索框按**连续子串**匹配结果文本；带空格的多词短语（如「童装 套装」）不是任何类目路径的
 *   连续子串 → 必然匹配不到。故把 category 按空格 / 斜杠 / 箭头 / 顿号 / 逗号 / 竖线拆成单词，
 *   逐个尝试（先单词、后原文），最后补一个从标题提取的兜底词。
 *
 * 例：category='童装 套装' → ['童装','套装',…,'童装 套装'(原文兜底)]
 *     category='童装 > 套装' → ['童装','套装','童装 > 套装']
 *     category='' → [extractCateKeyword(title)]
 */
function cateKeywordCandidates(category, title) {
    const out = [];
    const push = (s) => {
        const v = (s || '').trim();
        if (v && !out.includes(v))
            out.push(v);
    };
    const cat = (category || '').trim();
    // ① category 拆词（空格 / 斜杠 / 反斜杠 / 箭头 / 顿号 / 逗号 / 竖线）
    for (const tok of cat.split(/[\s/\\>＞、,，|]+/))
        push(tok);
    // ② category 原文兜底（用户可能直接给了可命中的类目名）
    push(cat);
    // ③ 标题兜底词
    push(extractCateKeyword(title));
    return out.slice(0, 6);
}
/**
 * 拼多多商家后台商品发布主流程。
 *
 * ★ confirm 门禁：L2 风险（有真实副作用），未传 confirm=true 一律只返回预览，
 *   不启动浏览器、不产生任何写操作。
 */
export async function pddPublish(store, opts) {
    // ── 配置热加载（publish-config/pdd.json，mtime 变化自动重读）──
    // ★ 必须最先做：下面的入参校验就用 MAX_IMAGES/MAX_IMAGE_BYTES/MAX_TITLE_LEN 等配置值。
    //   配置坏 → fail-fast 返回错误，绝不静默用旧锚点（PUBLISH-SPEC §3.2）。
    const cfgErr = refreshPddConfig();
    if (cfgErr) {
        return { ok: false, failureKind: 'api_error', text: cfgErr };
    }
    // ── 入参校验 ────────────────────────────────────────────
    const title = String(opts.title || '').trim();
    const category = String(opts.category ?? '').trim();
    const price = String(opts.price ?? '').trim();
    const stock = String(opts.stock ?? '').trim() || DEFAULT_STOCK;
    const itemNo = String(opts.itemNo ?? '').trim();
    const images = (Array.isArray(opts.images) ? opts.images : [])
        .map(p => String(p || '').trim())
        .filter(Boolean)
        .slice(0, MAX_IMAGES);
    if (!images.length) {
        return { ok: false, failureKind: 'api_error', text: '缺少 images（本地图片绝对路径列表，至少 1 张）。' };
    }
    for (const p of images) {
        if (!existsSync(p)) {
            return { ok: false, failureKind: 'api_error', text: `图片文件不存在：${p}` };
        }
        try {
            const st = statSync(p);
            if (!st.isFile() || st.size === 0) {
                return { ok: false, failureKind: 'api_error', text: `图片文件不可用（非文件或大小为 0）：${p}` };
            }
            if (st.size > MAX_IMAGE_BYTES) {
                return {
                    ok: false,
                    failureKind: 'api_error',
                    text: `图片超过单张上限 3MB：${p}（${(st.size / 1024 / 1024).toFixed(2)}MB）。`
                        + '拼多多主图要求 ≤ 3MB，请压缩后重试。',
                };
            }
        }
        catch (e) {
            return { ok: false, failureKind: 'api_error', text: `无法读取图片文件：${e instanceof Error ? e.message : String(e)}` };
        }
    }
    if (!title) {
        return { ok: false, failureKind: 'api_error', text: '缺少 title（商品标题）。拼多多要求标题必填。' };
    }
    if (title.length > MAX_TITLE_LEN) {
        return {
            ok: false,
            failureKind: 'api_error',
            text: `商品标题超过 ${MAX_TITLE_LEN} 个字符（当前 ${title.length} 个）。请精简后重试。`,
        };
    }
    if (price) {
        const n = Number(price);
        if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) {
            return { ok: false, failureKind: 'api_error', text: `商品参考价不合法：${price}。请填正数（元，1 亿元以内）。` };
        }
    }
    if (stock) {
        const n = Number(stock);
        if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
            return { ok: false, failureKind: 'api_error', text: `库存不合法：${stock}。请填非负整数。` };
        }
    }
    // 详情图：与主图同规则（存在性 + 单张 ≤3MB），张数按页面上限截断
    const detailImages = (Array.isArray(opts.detailImages) ? opts.detailImages : [])
        .map(p => String(p || '').trim())
        .filter(Boolean)
        .slice(0, MAX_DETAIL_IMAGES);
    for (const p of detailImages) {
        if (!existsSync(p)) {
            return { ok: false, failureKind: 'api_error', text: `详情图文件不存在：${p}` };
        }
        try {
            const st = statSync(p);
            if (!st.isFile() || st.size === 0) {
                return { ok: false, failureKind: 'api_error', text: `详情图文件不可用（非文件或大小为 0）：${p}` };
            }
            if (st.size > MAX_IMAGE_BYTES) {
                return {
                    ok: false,
                    failureKind: 'api_error',
                    text: `详情图超过单张上限 3MB：${p}（${(st.size / 1024 / 1024).toFixed(2)}MB）。请压缩后重试。`,
                };
            }
        }
        catch (e) {
            return { ok: false, failureKind: 'api_error', text: `无法读取详情图文件：${e instanceof Error ? e.message : String(e)}` };
        }
    }
    // SKU 多规格：规格值名必填；预览图「宽高比 1:1、宽高 >480px、单张 <3MB、仅 JPG/PNG」
    //（宽高比与分辨率无法在本地稳妥校验，交由平台驳回；此处只校验存在性与大小）
    const skus = (Array.isArray(opts.skus) ? opts.skus : []).map(s => ({
        name: String(s?.name ?? '').trim(),
        image: String(s?.image ?? '').trim(),
        price: String(s?.price ?? '').trim(),
        stock: String(s?.stock ?? '').trim(),
    }));
    for (const s of skus) {
        if (!s.name) {
            return { ok: false, failureKind: 'api_error', text: 'skus 里存在规格值为空的项（每项必须有 name，如「白色」）。' };
        }
        if (s.price) {
            const n = Number(s.price);
            if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) {
                return {
                    ok: false,
                    failureKind: 'api_error',
                    text: `SKU「${s.name}」拼单价不合法：${s.price}。请填正数（元，1 亿元以内）。`,
                };
            }
        }
        if (s.stock) {
            const n = Number(s.stock);
            if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
                return { ok: false, failureKind: 'api_error', text: `SKU「${s.name}」库存不合法：${s.stock}。请填非负整数。` };
            }
        }
        if (s.image) {
            if (!existsSync(s.image)) {
                return { ok: false, failureKind: 'api_error', text: `SKU「${s.name}」预览图不存在：${s.image}` };
            }
            try {
                const st = statSync(s.image);
                if (!st.isFile() || st.size === 0) {
                    return { ok: false, failureKind: 'api_error', text: `SKU「${s.name}」预览图不可用（非文件或大小为 0）：${s.image}` };
                }
                if (st.size > MAX_IMAGE_BYTES) {
                    return {
                        ok: false,
                        failureKind: 'api_error',
                        text: `SKU「${s.name}」预览图超过单张上限 3MB：${s.image}（${(st.size / 1024 / 1024).toFixed(2)}MB）。`,
                    };
                }
            }
            catch (e) {
                return {
                    ok: false,
                    failureKind: 'api_error',
                    text: `无法读取 SKU「${s.name}」预览图：${e instanceof Error ? e.message : String(e)}`,
                };
            }
        }
    }
    // 本地只做「明显异常」兜底：真实上限由页面自身校验（如 5色×6码=30 是常见真实数据，不能被误挡）
    if (skus.length > 200) {
        return { ok: false, failureKind: 'api_error', text: `SKU 规格值过多（当前 ${skus.length} 个，上限 200）。` };
    }
    // ── 多维规格（specs + skuRows）与显式属性（attributes）校验 ──────────
    //   specs：≤2 维；每维名非空且不重复；每维值非空、不重复、≤20；第 1 维值可带预览图（同 SKU 图规则）
    //   skuRows：≤200 行（本地只兜底明显异常，真实上限由页面校验）；每行 specs 必须覆盖全部维度；价格/库存合法
    const specs = (Array.isArray(opts.specs) ? opts.specs : []).map(d => ({
        name: String(d?.name ?? '').trim(),
        values: (Array.isArray(d?.values) ? d.values : []).map(v => ({
            value: String(v?.value ?? '').trim(),
            image: String(v?.image ?? '').trim(),
        })),
    }));
    const skuRows = (Array.isArray(opts.skuRows) ? opts.skuRows : []).map(r => ({
        specs: (r && typeof r.specs === 'object' && r.specs) ? r.specs : {},
        price: String(r?.price ?? '').trim(),
        stock: String(r?.stock ?? '').trim(),
        itemNo: String(r?.itemNo ?? '').trim(),
    }));
    const attributes = (Array.isArray(opts.attributes) ? opts.attributes : [])
        .map(a => ({ name: String(a?.name ?? '').trim(), value: String(a?.value ?? '').trim() }))
        .filter(a => a.name && a.value);
    if (specs.length && skus.length) {
        return { ok: false, failureKind: 'api_error', text: 'specs（多维规格）与 skus（单维规格）不能同时提供，请二选一。' };
    }
    if (specs.length > 2) {
        return { ok: false, failureKind: 'api_error', text: `拼多多最多支持 2 个规格维度（当前 ${specs.length} 个）。` };
    }
    const specDimNames = new Set();
    for (const d of specs) {
        if (!d.name) {
            return { ok: false, failureKind: 'api_error', text: 'specs 里存在维度名为空的项（每个维度必须有 name，如「颜色」）。' };
        }
        if (specDimNames.has(d.name)) {
            return { ok: false, failureKind: 'api_error', text: `规格维度名重复：${d.name}。` };
        }
        specDimNames.add(d.name);
        const vals = d.values.filter(v => v.value);
        if (!vals.length) {
            return { ok: false, failureKind: 'api_error', text: `规格维度「${d.name}」没有任何规格值。` };
        }
        if (vals.length > 20) {
            return { ok: false, failureKind: 'api_error', text: `规格维度「${d.name}」的规格值最多 20 个（当前 ${vals.length} 个）。` };
        }
        const seenVals = new Set();
        for (const v of vals) {
            if (seenVals.has(v.value)) {
                return { ok: false, failureKind: 'api_error', text: `规格维度「${d.name}」的规格值重复：${v.value}` };
            }
            seenVals.add(v.value);
            if (!v.image)
                continue;
            if (!existsSync(v.image)) {
                return { ok: false, failureKind: 'api_error', text: `规格值「${d.name}=${v.value}」预览图不存在：${v.image}` };
            }
            try {
                const st = statSync(v.image);
                if (!st.isFile() || st.size === 0) {
                    return { ok: false, failureKind: 'api_error', text: `规格值「${d.name}=${v.value}」预览图不可用（非文件或大小为 0）：${v.image}` };
                }
                if (st.size > MAX_IMAGE_BYTES) {
                    return { ok: false, failureKind: 'api_error', text: `规格值「${d.name}=${v.value}」预览图超过单张上限 3MB：${v.image}` };
                }
            }
            catch (e) {
                return { ok: false, failureKind: 'api_error', text: `无法读取规格值预览图：${e instanceof Error ? e.message : String(e)}` };
            }
        }
    }
    if (specs.length) {
        if (skuRows.length > 200) {
            return { ok: false, failureKind: 'api_error', text: `SKU 行过多（当前 ${skuRows.length} 行，上限 200）。` };
        }
        const dimNames = specs.map(d => d.name);
        for (const r of skuRows) {
            for (const dn of dimNames) {
                if (!String(r.specs?.[dn] ?? '').trim()) {
                    return {
                        ok: false,
                        failureKind: 'api_error',
                        text: `SKU 行缺少维度「${dn}」的规格值（specs=${JSON.stringify(r.specs)}）。`,
                    };
                }
            }
            if (r.price) {
                const n = Number(r.price);
                if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) {
                    return { ok: false, failureKind: 'api_error', text: `SKU 行（${JSON.stringify(r.specs)}）拼单价不合法：${r.price}。` };
                }
            }
            if (r.stock) {
                const n = Number(r.stock);
                if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
                    return { ok: false, failureKind: 'api_error', text: `SKU 行（${JSON.stringify(r.specs)}）库存不合法：${r.stock}。` };
                }
            }
        }
    }
    // ── 选号 ───────────────────────────────────────────────
    const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId });
    if (picked.error)
        return picked.error;
    const account = picked.account;
    // ── confirm 门禁 ───────────────────────────────────────
    if (opts.confirm !== true) {
        return {
            ok: false,
            needConfirm: true,
            text: buildPreview(account, { ...opts, title, category, stock, itemNo }, images),
        };
    }
    const shopKey = account.shop_key;
    const accountCookies = account.cookies || {};
    /**
     * ★★ 修复（2026-10-20）：「凭证库没有 PASS_ID」**不等于**「浏览器没登录」。
     *
     *   原实现直接 fail-fast 返回 token_expired，浏览器都不启动。但实测：
     *     · 凭证库快照可能是旧的（登录后未及时落库 / 被健康检查清理）
     *     · 而 userDataDir 里的 Cookie DB 是**更新的**（Chrome 自己刷新票据 / 用户手动登录过）
     *   本机验证：`account.cookies` 无 PASS_ID，但直接用该 Profile 打开
     *   mms.pinduoduo.com/goods/goods_list 返回「商品列表」且 PASS_ID 存在 —— 完全可用。
     *
     *   故改为**不在此处拦截**：交给浏览器用真实 Profile 去访问，由 guardPage 依据
     *   页面实际状态判定（跳登录页才报 token_expired）。凭证库只作为「无环境时」的兜底注入源。
     */
    if (!accountCookies.PASS_ID) {
        diag(`凭证库没有 PASS_ID（在途 Cookie ${Object.keys(accountCookies).length} 个），`
            + '改为以 Profile 磁盘会话为准，交由浏览器实际访问判定');
    }
    // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 风控验证共享。
    //   必须用**账号专属**目录（带 shopKey）：这样发布用的 Chrome 环境与登录、风控验证
    //   是同一套设备身份，平台不会把发布请求当成陌生设备（profileDir 文档的既定契约）。
    const dir = profileDir(PLATFORM, shopKey);
    // ★ Profile 环境预检：仅注入 Cookie 而无真实 Profile（设备指纹/localStorage/站点数据）
    //   会被商家后台风控识别为陌生设备并挂起表单页（实测三次发布全部 150s 超时的形态）。
    //   空壳目录（无 Cookie DB 文件）多半是 profileDir() mkdirSync 副作用预建的，
    //   或登录收编（adoptProfileDir）迁移失败留下的 —— fail-fast 引导重登而非静默超时。
    const profileHasEnv = ['Default/Cookies', 'Network/Cookies'].some(p => {
        try {
            return statSync(join(dir, p)).size > 0;
        }
        catch {
            return false;
        }
    })
        // Local Storage 是目录（size 恒不可靠），存在即算有站点数据
        || existsSync(join(dir, 'Default', 'Local Storage'));
    if (!profileHasEnv) {
        return {
            ok: false,
            failureKind: 'token_expired',
            shopKey,
            text: `账号 ${account.display_label} 没有浏览器设备环境（Profile 目录为空壳：${dir}）。\n`
                + '仅靠 Cookie 注入会被拼多多商家后台识别为陌生设备、表单页将无法加载。\n'
                + '请重新调用浏览器登录（pdd_mms）—— 登录成功后系统会把浏览器环境收编到该账号名下。',
        };
    }
    const busyOwner = profileOwner(dir);
    if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
        return {
            ok: false,
            failureKind: 'api_error',
            text: `拼多多商家后台的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
                + '请先等待该任务结束或关闭已弹出的浏览器窗口，再重新调用本工具。',
        };
    }
    let browser = null;
    try {
        const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core');
        const chromePath = findChromePath();
        if (!chromePath) {
            return { ok: false, failureKind: 'api_error', text: '未找到 Chrome 或 Edge 浏览器，无法执行发布。' };
        }
        const launchOpts = {
            // 可见窗口：发布是真实副作用操作，且类目属性等字段需人工补全，必须让用户看得见
            headless: false,
            executablePath: chromePath,
            userDataDir: dir,
            args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,900'],
        };
        clearProfileLocks(dir);
        try {
            browser = await puppeteer.launch(launchOpts);
        }
        catch (e) {
            console.warn('[dsagent-pdd-publish] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e));
            clearProfileLocks(dir);
            browser = await puppeteer.launch(launchOpts);
        }
        const page = await browser.newPage();
        // 用本机真实 UA：硬改 UA 会与内核自动发出的 sec-ch-ua / userAgentData 矛盾
        await page.setViewport({ width: 1440, height: 900 });
        // ★ 2026-10-24：反检测改用 applyStealth（data descriptor，不留自定义 getter）
        await applyStealth(page);
        // ★ 2026-10-24：54001 静默自愈（官方五步闭环）
        //   收到 54001 → 先清 token → 提取新 token → 有值就重放，不弹滑块
        await page.evaluateOnNewDocument(CAPTCHA_SELF_HEAL);
        /**
         * 注入拼多多域 Cookie（商家后台登录票据 PASS_ID 写在 .pinduoduo.com 域）。
         *
         * ★★ 关键修复（2026-10-20 实测）：「**不能无条件覆盖**」。
         *   故障现象：账号连接器显示 valid、profile 直接打开商品列表也正常，
         *   但发布必报 token_expired。
         *   根因：凭证库里的 Cookie 快照可能是几天前的旧票据（PASS_ID 会在服务端过期/轮转），
         *   而 userDataDir 里的浏览器会话是**更新的**（用户刚登录过 / Chrome 自己刷新过）。
         *   原实现 `page.setCookie(...storeCookies)` 会把 Profile 里的新票据**覆盖成旧的**
         *   → 一打开商品列表就跳登录页。
         *
         *   正确策略：
         *     · Profile 里已有 PASS_ID → **以浏览器本地会话为准，跳过注入**；
         *     · Profile 里没有票据（全新/被清）→ 才用凭证库注入兜底。
         *   另外在跳转后仍落在登录页时，再做一次「注入 + 重载」兜底（见下文段 1）。
         */
        const existingCookies = await page.cookies('https://mms.pinduoduo.com/')
            .catch(() => []);
        const profileHasPass = existingCookies.some((c) => c.name === 'PASS_ID' && c.value);
        const cookieList = Object.entries(accountCookies)
            .filter(([, v]) => v !== '' && v != null)
            .flatMap(([name, value]) => ([
            { name, value: String(value), domain: '.pinduoduo.com', path: '/' },
            { name, value: String(value), domain: 'mms.pinduoduo.com', path: '/' },
        ]));
        if (profileHasPass) {
            diag(`Cookie：Profile 已有 PASS_ID（${existingCookies.length} 个 Cookie），跳过注入，以浏览器本地会话为准`);
        }
        else {
            if (cookieList.length > 0)
                await page.setCookie(...cookieList);
            diag(`Cookie：Profile 无票据，从凭证库注入 ${cookieList.length} 个`);
        }
        // ── 段 1：打开商品列表 → 点「发布新商品」（唯一正确入口）────
        //   ★ 不能直接 goto /goods/goods_add/index：该 URL 需要 type=add&from=category
        //     &version=predictCate&id=<类目id>&goods_id=<商品id> 这组上下文参数，
        //     它们由平台在「发布新商品」入口处即时生成。直接敲表单 URL 只会得到空壳页。
        console.log(`[dsagent-pdd-publish] 段 1 打开商品列表：${PDD_GOODS_LIST_URL}`);
        await page.goto(PDD_GOODS_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await sleep(4000);
        /**
         * ★ 风控 L3（2026-10-22）：滑块遮罩自动过。
         *   检测到「请向右滑块完成拼图」→ 动态 import 风控模块 → 调 yydsocr 识别 + 人类化轨迹。
         *   模块是 .mjs（TS 侧动态 import）；失败不阻断主流程，只打印告警
         *   （后续点入口/提交会因遮罩失败，那时再由调用方处置）。
         */
        try {
            const riskPath = join(PLUGIN_ROOT_FOR_RISK, 'skills/_shared/pdd-risk.mjs');
            const risk = existsSync(riskPath)
                ? await import(/* @vite-ignore */ riskPath).catch(() => null)
                : null;
            if (risk?.detectSlider && await risk.detectSlider(page)) {
                console.warn('[dsagent-pdd-publish] 段1 检测到滑块遮罩，尝试自动过滑块...');
                // ★ 传 page 走内联求解（不新起浏览器，避免 profile 锁冲突）
                const solved = await risk.autoSolveSlider(shopKey, page).catch((e) => ({ ok: false, text: String(e) }));
                if (solved?.ok) {
                    console.warn(`[dsagent-pdd-publish] 滑块已过：${solved.text}`);
                    await sleep(2000);
                    // 重载列表页（验证通过后页面可能还在遮罩态）
                    await page.goto(PDD_GOODS_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => { });
                    await sleep(4000);
                }
                else {
                    console.warn(`[dsagent-pdd-publish] 滑块自动过失败：${solved?.text || '未知'}`);
                }
            }
        }
        catch (e) {
            console.warn(`[dsagent-pdd-publish] 风控模块加载失败（不影响主流程）：${e.message}`);
        }
        let listReady = await waitFor(page, p => p.evaluate(() => /商品列表/.test(document.title || '') || /发布新商品/.test(document.body?.innerText || '')), LIST_WAIT_MS, '商品列表页');
        /**
         * ★ 编辑商品入口（2026-10-22）：传了 editGoodsId 时走「编辑页」而非「发布新商品」。
         *   编辑页 URL：/goods/goods_add/index?id=<goodsId>
         *   页面自己会发 /glide/v2/mms/query/commit/detail 读现有提交体。
         *   ★ 前置：商品列表页必须就绪（建立 mms 会话 + 过风控）。
         *   ★ 若编辑页拿不到数据（600001「该编辑不存在」）→ 报错并提示从列表页点「编辑」。
         */
        if (opts.editGoodsId) {
            const editUrl = `https://mms.pinduoduo.com/goods/goods_add/index?id=${encodeURIComponent(opts.editGoodsId)}`;
            console.log(`[dsagent-pdd-publish] 段 1E 编辑模式：打开编辑页 ${editUrl}`);
            await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await sleep(5000);
            // ★ 风控 L3：编辑页也可能弹滑块 → 内联自动过
            try {
                const riskPath2 = join(PLUGIN_ROOT_FOR_RISK, 'skills/_shared/pdd-risk.mjs');
                const risk2 = existsSync(riskPath2) ? await import(/* @vite-ignore */ riskPath2).catch(() => null) : null;
                if (risk2?.detectSlider && await risk2.detectSlider(page)) {
                    console.warn('[dsagent-pdd-publish] 段1E 检测到滑块遮罩，尝试自动过滑块...');
                    const solved2 = await risk2.autoSolveSlider(shopKey, page).catch((e) => ({ ok: false, text: String(e) }));
                    if (solved2?.ok) {
                        console.warn(`[dsagent-pdd-publish] 编辑页滑块已过：${solved2.text}`);
                        await sleep(2000);
                        await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => { });
                        await sleep(5000);
                    }
                    else {
                        console.warn(`[dsagent-pdd-publish] 编辑页滑块自动过失败：${solved2?.text || '未知'}`);
                    }
                }
            }
            catch (e) {
                console.warn(`[dsagent-pdd-publish] 编辑页风控模块异常（不影响主流程）：${e.message}`);
            }
            // 等表单页就绪（标题输入框 / 提交按钮出现）
            const editReady = await waitFor(page, p => p.evaluate(() => {
                const hasBtn = Array.from(document.querySelectorAll('button')).some(b => /提交并上架/.test(b.innerText || ''));
                const hasInput = document.querySelectorAll('input,textarea').length > 3;
                return hasBtn || hasInput;
            }), 30_000, '编辑表单页');
            if (!editReady.ok) {
                return {
                    ok: false, failureKind: 'api_error', shopKey,
                    text: `编辑页未就绪（goods_id=${opts.editGoodsId}）。可能原因：①该商品不在「出售中」；②子账号无编辑权限；③接口频控。`,
                    finalUrl: page.url(),
                };
            }
            // 提交按钮渲染等待（复用模式2 的逻辑）
            for (let i = 0; i < 20; i++) {
                const has = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
                    .some(b => /^提交并上架/.test((b.innerText || '').trim()) && b.offsetParent !== null)).catch(() => false);
                if (has)
                    break;
                await sleep(2000);
            }
            // 直接进入模式2 hijack 提交（跳过类目选择/图片预上传等新发发布流程）
            const mode2 = await import('./pdd-mode2.js');
            const ctrl = mode2.setupHijack(page, opts.hijack?.goodsDetail ?? {}, {
                onProxyFallback: ctx => mode2.sendPddEditViaHttp(ctx),
                onTrace: opts.hijack?.onTrace,
            });
            let hijackOutcome = null;
            try {
                await page.setRequestInterception(true);
                const clicked = await clickSubmit(page);
                console.log(`[dsagent-pdd-publish] 编辑模式提交按钮点击：${clicked ? '已点击' : '未点到'}`);
                hijackOutcome = await mode2.waitHijackOutcome(ctrl, mode2.PDD_HIJACK_WAIT_MS);
            }
            finally {
                await mode2.teardownHijack(page, ctrl).catch(() => { });
            }
            if (hijackOutcome?.success) {
                try {
                    await store.setStatus(shopKey, 'valid');
                }
                catch { /* 忽略 */ }
                return {
                    ok: true, shopKey,
                    finalUrl: page.url(),
                    text: `商品 ${opts.editGoodsId} 编辑已提交成功。\n注意：平台仍会审核，最终状态请在「商品管理 → 出售中」确认。`,
                };
            }
            return {
                ok: false, failureKind: 'api_error', shopKey,
                finalUrl: page.url(),
                text: `编辑提交失败：${hijackOutcome?.detailMessage || '未捕获提交响应'}`,
            };
        }
        /**
         * ★ 兜底 A（2026-10-21 新增）：Profile 有票据但**服务端已失效**时，
         *   原逻辑「跳过注入」会一路带着死票据走到 token_expired。
         *   实测场景：连续发布太多次被平台踢下线，Profile 的 PASS_ID 成僵尸值，
         *   而凭证库的票据是新的（keepalive 刚续期）。
         *   策略：落在登录页 → 用凭证库票据**覆盖注入** → 重载 → 再判一次。
         */
        if (!listReady.ok && /\/login/i.test(page.url())) {
            if (cookieList.length > 0) {
                diag('兜底 A：Profile 票据被服务端拒绝，用凭证库票据覆盖注入并重载');
                await page.setCookie(...cookieList).catch(() => { });
                await page.goto(PDD_GOODS_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => { });
                await sleep(4000);
                listReady = await waitFor(page, p => p.evaluate(() => /商品列表/.test(document.title || '') || /发布新商品/.test(document.body?.innerText || '')), LIST_WAIT_MS, '商品列表页');
            }
        }
        /**
         * ★ 兜底：若 Profile 已有票据却被判失效（票据服务端过期），
         *   或 Profile 无票据但注入的也不管用 → 这里明确区分两种失败，给出可执行的处置建议，
         *   而不是笼统报「登录态失效」让用户反复重试。
         */
        if (!listReady.ok && /\/login/i.test(page.url())) {
            const passNow = await page.cookies('https://mms.pinduoduo.com/')
                .then((cs) => cs.some((c) => c.name === 'PASS_ID' && c.value))
                .catch(() => false);
            diag(`段1 落在登录页：Profile 票据存在=${profileHasPass}，注入后票据存在=${passNow}，`
                + `凭证库 Cookie 数=${cookieList.length}`);
            if (!profileHasPass && cookieList.length > 0) {
                // Profile 本来就没票据，注入也没救回来 —— 直接告知需要重新登录
                diag('段1：凭证库注入后仍未登录，需要重新扫码');
            }
            else if (profileHasPass) {
                // 有票据但服务端不认 —— 这才是真正的「票据过期」，必须重新登录
                diag('段1：Profile 有 PASS_ID 但服务端拒绝，票据已失效，需要重新扫码');
            }
        }
        if (!listReady.ok)
            return guardFailResult(listReady, store, shopKey, page.url());
        /**
         * ── 段 1.5：模式2 图片预上传（HTTP 逆向上传，复刻觅千手）──────────
         *
         * 为什么放在这里（登录已确认、还没点「发布新商品」）：
         *   · 当前页面是**主应用** /goods/goods_list —— 只有主应用才含 webpack 的 `fbeZ`
         *     模块，能生成 Anti-Content；图片空间页 /material/upload 是独立子应用，不含。
         *   · 早于任何表单操作，失败可直接返回，不会留下半成品表单。
         *
         * 做什么：
         *   把 images / detailImages / specs[].values[].image 里的**本地路径**
         *   经 `store_image → file/create → queryFileDetail` 换成 img.pddpic.com URL，
         *   然后回填 → `buildGoodsDetailFromProduct` 的 `isRemoteImg` 门禁才放行 →
         *   `fillImageData` 才能把 `commitBody.gallery` 整组替换成我们的图。
         *
         * 收益（实测）：5 张图 4.2 秒（0.84s/张），而 DOM 逐张上传要 8~20s/张。
         * 且图片完全不经过页面文件控件 —— 与觅千手「图片走 URL、DOM 只负责提交」一致。
         */
        if (opts.hijack && (images.length || detailImages.length)) {
            const t0Img = Date.now();
            // 动态 import 规避循环依赖（pdd-mode2 不反向依赖本文件，但仍按需加载）
            const mode2Lib = await import('./pdd-mode2.js');
            diag(`段1.5 图片预上传开始：主图 ${images.length} 张、详情图 ${detailImages.length} 张`);
            try {
                const pre = await preuploadProductImages(page, {
                    title,
                    images,
                    detailImages,
                    specs: specs.length ? specs.map(d => ({
                        name: d.name,
                        values: d.values.map(v => ({ value: v.value, image: v.image })),
                    })) : undefined,
                }, {
                    onProgress: (done, total, r) => {
                        diag(`图片 ${done}/${total}：${r.ok ? `✓ ${r.ms}ms` : `✗ ${r.error || ''}`}`);
                    },
                });
                const secs = ((Date.now() - t0Img) / 1000).toFixed(1);
                if (pre.summary.fatal) {
                    diag(`图片预上传失败：${pre.summary.fatal}`);
                    return {
                        ok: false,
                        failureKind: 'api_error',
                        shopKey,
                        finalUrl: page.url(),
                        text: `模式2 图片预上传失败：${pre.summary.fatal}\n`
                            + '图片走 HTTP 上传需要「主应用页面 + 可用 Anti-Content 签名」。\n'
                            + '请确认账号登录态正常后重试；如需临时绕过，可改用模式1（不传 mode2）。',
                    };
                }
                if (!pre.summary.ok) {
                    const bad = pre.summary.failed.slice(0, 5)
                        .map((f) => `  - ${f.path}：${f.error}`).join('\n');
                    diag(`图片预上传部分失败：成功 ${pre.summary.uploaded}/${pre.summary.total}`);
                    return {
                        ok: false,
                        failureKind: 'api_error',
                        shopKey,
                        finalUrl: page.url(),
                        text: `模式2 图片预上传失败（成功 ${pre.summary.uploaded}/${pre.summary.total}，耗时 ${secs}s）：\n`
                            + `${bad}\n`
                            + '图片未全部拿到 CDN URL 时不能继续（否则提交会报「图片url不能为空」）。',
                    };
                }
                // 回填：把本地路径换成 CDN URL（覆盖主图 / 详情图 / 规格值预览图）
                const map = pre.summary.map;
                const swap = (v) => map[v] || v;
                for (let i = 0; i < images.length; i++)
                    images[i] = swap(images[i]);
                for (let i = 0; i < detailImages.length; i++)
                    detailImages[i] = swap(detailImages[i]);
                for (const d of specs) {
                    for (const v of d.values) {
                        const img = v.image;
                        if (img)
                            v.image = swap(img);
                    }
                }
                // goodsDetail.gallery 用回填后的 URL 重建（isRemoteImg 只放行 http(s)）
                const rebuilt = mode2Lib.buildGoodsDetailFromProduct({
                    title,
                    images,
                    detailImages,
                    specs: specs.length ? specs.map(d => ({
                        name: d.name,
                        values: d.values.map(v => ({ value: v.value, image: v.image })),
                    })) : undefined,
                    skus: skuRows.length ? skuRows.map(r => ({
                        specs: r.specs,
                        price: r.price,
                        stock: r.stock,
                        itemNo: r.itemNo,
                    })) : undefined,
                    price: price || undefined,
                    stock: stock || undefined,
                    category: category || undefined,
                }, {
                    costTemplate: opts.costTemplate,
                    deliveryTime: opts.deliveryTime,
                    // ★ 规格池透传：行数重建时写 spec_id（pddPublish2 组装时已塞进
                    //   opts.hijack.goodsDetail，这里随 rebuilt 一起更新）
                    specIds: opts.hijack?.goodsDetail?.spec_id_map,
                    dimParents: opts.hijack?.goodsDetail?._dim_parents,
                });
                // 只更新 gallery / title / spec_id_map（其余字段已在 pddPublish2 组装时算好）
                const rebuiltGallery = (rebuilt.gallery || []);
                if (rebuiltGallery.length) {
                    opts.hijack.goodsDetail.gallery = rebuiltGallery;
                    diag(`gallery 已注入 ${rebuiltGallery.length} 张 URL（type1=${rebuiltGallery.filter(g => g.type === 1).length}、`
                        + `type2=${rebuiltGallery.filter(g => g.type === 2).length}）`);
                }
                else {
                    diag('警告：回填后 gallery 仍为空（图片可能未全部转成 http(s) URL）');
                }
                // ★ 标题入 detail：改包时强制写 goods_name（不依赖 DOM fillTitle 是否被 React 受理）
                if (rebuilt.title) {
                    opts.hijack.goodsDetail.title = rebuilt.title;
                }
                // ★ spec_id_map 保留（buildGoodsDetailFromProduct 可能未收到 specIds）
                if (rebuilt.spec_id_map) {
                    opts.hijack.goodsDetail.spec_id_map = rebuilt.spec_id_map;
                }
                /**
                 * ★ 同时塞 upload_spec_img_map（SKU 预览图 / thumb_url 注入源）。
                 *
                 * 觅千手原文 `_resolvePddSpecThumbFromUploadMap`：按**规格值名**（颜色名）查
                 *   `detail.upload_spec_img_map[颜色名]`，拿到 {url, id} 写进 `commitBody.skus[].thumb_url`。
                 * 这里 map 的 key 必须是**颜色值名**（格蕾灰/奶油黄/…），值是 `{ url: CDN_URL, id: file_id }`。
                 *
                 * ★ 2026-10-21 修复：specs[].values[].image 在上面已被 swap 成 CDN URL，
                 *   而 pre.summary.detail 的 key 是**本地路径** —— 直接用 URL 查必然 miss。
                 *   改为遍历 pre.summary.detail（本地路径 → {url, fileId}），
                 *   再用「本地路径 → 规格值名」的反查表定位颜色。
                 */
                const uploadSpecMap = {};
                const localPathToSpecValue = {};
                for (const d of specs) {
                    for (const v of d.values) {
                        const curImg = v.image; // 此时已是 CDN URL
                        if (!curImg)
                            continue;
                        for (const [localPath, rec] of Object.entries(pre.summary.detail || {})) {
                            if (rec?.url && rec.url === curImg) {
                                localPathToSpecValue[localPath] = String(v.value);
                                break;
                            }
                        }
                    }
                }
                for (const [localPath, specValue] of Object.entries(localPathToSpecValue)) {
                    const rec = pre.summary.detail[localPath];
                    if (rec?.url)
                        uploadSpecMap[specValue] = { url: rec.url, id: rec.fileId ?? null };
                }
                if (Object.keys(uploadSpecMap).length > 0) {
                    ;
                    opts.hijack.goodsDetail.upload_spec_img_map = uploadSpecMap;
                    diag(`upload_spec_img_map 已塞 ${Object.keys(uploadSpecMap).length} 个颜色：`
                        + Object.keys(uploadSpecMap).join('/'));
                }
                console.log(`[dsagent-pdd-publish] 模式2 图片预上传完成：${pre.summary.uploaded}/${pre.summary.total} 张，耗时 ${secs}s`);
            }
            catch (e) {
                diag(`图片预上传异常：${e.message}`);
                return {
                    ok: false,
                    failureKind: 'api_error',
                    shopKey,
                    finalUrl: page.url(),
                    text: `模式2 图片预上传异常：${e.message}`,
                };
            }
        }
        const entryClicked = await clickPublishEntry(page);
        if (!entryClicked) {
            return {
                ok: false,
                failureKind: 'api_error',
                shopKey,
                finalUrl: page.url(),
                text: '未能在商品列表页找到「发布新商品」入口（页面结构可能已变更）。\n'
                    + '请打开浏览器窗口手动点击「发布新商品」，或稍后重试本工具。',
            };
        }
        // ★ 2026-10-22：DOM el.click() 派发的是 untrusted 事件，拼多多 React 会忽略
        //   （复现：点完 URL 不变、零业务请求）。补一次 CDP 真实鼠标点击兜底。
        if (/goods_list/.test(page.url())) {
            const rect = await page.evaluate(() => {
                const NAV_SEL = 'nav, aside, [class*="sidenav"], [class*="sideNav"], [class*="menu"]';
                const all = Array.from(document.querySelectorAll('button, a, div, span'))
                    .filter(el => {
                    const r = el.getBoundingClientRect();
                    if (r.width <= 0 || r.height <= 0)
                        return false;
                    if ((el.innerText || '').trim() !== '发布新商品')
                        return false;
                    return !el.closest(NAV_SEL);
                });
                const el = all.find(e => e.tagName === 'BUTTON') || all[all.length - 1];
                if (!el)
                    return null;
                const r = el.getBoundingClientRect();
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }).catch(() => null);
            if (rect) {
                await page.mouse.click(rect.x, rect.y).catch(() => { });
                diag(`入口 CDP 真实鼠标补点：(${Math.round(rect.x)}, ${Math.round(rect.y)})`);
            }
        }
        console.log('[dsagent-pdd-publish] 已点击「发布新商品」，等待类目选择页...');
        // ── 段 2：类目选择页 /goods/category ────────────────────
        const step1 = await waitForPage(browser, STEP1_URL_RE, 60_000);
        if (!step1) {
            return {
                ok: false,
                failureKind: 'api_error',
                shopKey,
                finalUrl: page.url(),
                text: '点击「发布新商品」后 60s 内未出现类目选择页（/goods/category）。\n'
                    + '请打开浏览器窗口确认是否弹出了新标签页；若被浏览器拦截弹窗，请允许后重试。',
            };
        }
        await step1.bringToFront().catch(() => { });
        await step1.setViewport({ width: 1440, height: 900 }).catch(() => { });
        const step1Ready = await waitFor(step1, p => p.evaluate((sel) => !!document.querySelector(sel), STEP1_READY_SELECTOR), FORM_WAIT_MS, '类目选择页');
        if (!step1Ready.ok)
            return guardFailResult(step1Ready, store, shopKey, step1.url());
        // 类目搜索关键词：category 参数优先；缺省从标题提取。
        //   ★ 多候选逐个尝试：category 可能带空格/路径分隔符（如「童装 套装」「童装 > 套装」），
        //     只有单个词才是类目路径的连续子串；见 cateKeywordCandidates。
        const cateCandidates = cateKeywordCandidates(category, title);
        console.log(`[dsagent-pdd-publish] 类目搜索关键词候选：${cateCandidates.join(' | ') || '（无）'}`);
        let cateKeyword = '';
        let pickedCate = '';
        for (const kw of cateCandidates) {
            pickedCate = await selectCategory(step1, kw, category);
            if (pickedCate) {
                cateKeyword = kw;
                break;
            }
        }
        if (!pickedCate) {
            return {
                ok: false,
                failureKind: 'api_error',
                shopKey,
                finalUrl: step1.url(),
                text: `类目选择页未能自动选中类目（已尝试关键词：${cateCandidates.join('、') || '（无）'}）。\n`
                    + '可能原因：关键词无匹配类目 / 搜索结果未渲染 / 平台页面又改版。\n'
                    + '请在浏览器窗口内手动搜索并选择类目，点「确认发布该类商品」后重新调用本工具。',
            };
        }
        // ── 段 3：发布表单页 /goods/goods_add/index ────────────────────
        // ★ 2026-10-27 平台改版：类目页可能直接是表单第一步（主图+标题+「下一步」按钮）。
        //   这种情况需要先点「下一步，完善商品信息」才会跳到 goods_add/index。
        const isFormStep1 = await step1.evaluate(() => {
            const hasTitle = !!document.querySelector('input[placeholder*="商品标题组成"], input[data-tracking-click-viewid="title_input_area"]')
            const hasNextBtn = [...document.querySelectorAll('button, a, div, span')]
                .some(e => /下一步|完善商品信息/.test((e.innerText || e.textContent || '').trim()))
            return hasTitle && hasNextBtn
        }).catch(() => false)

        if (isFormStep1) {
            diag('段3 类目页即表单第一步，点「下一步，完善商品信息」')
            // ★ 鼠标点坐标（JS click 是 untrusted，React 忽略）
            const nextPos = await step1.evaluate(() => {
                const btns = [...document.querySelectorAll('button, a, div, span')]
                    .map(e => { const r = e.getBoundingClientRect(); return { tx: (e.innerText || e.textContent || '').trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) } })
                    .filter(o => /下一步|完善商品信息/.test(o.tx) && o.w > 30)
                return btns[btns.length - 1] || null
            }).catch(() => null)
            if (nextPos) {
                await step1.mouse.click(nextPos.x, nextPos.y).catch(() => { })
                await sleep(4000)
            }
        }

        diag('段3 等待表单页跳转（25s）…')
        let step2 = await waitForPage(browser, STEP2_URL_RE, 25_000);
        if (!step2) {
            const step1Text = await step1.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400)).catch(() => '');
            diag(`段3 未等到表单页 | 当前 URL=${step1.url().slice(0, 120)} | 页面文案=${step1Text.slice(0, 260)}`);
            console.log(`[dsagent-pdd-publish] 未等到表单页；类目选择页当前文案：${step1Text}`);
            console.log('[dsagent-pdd-publish] 补点一次「确认发布该类商品」...');
            const reconfirmed = await selectCategory(step1, cateKeyword, category);
            diag(`段3 补点确认结果：${reconfirmed ? `已选「${reconfirmed}」` : '未点中'}`);
            if (reconfirmed)
                step2 = await waitForPage(browser, STEP2_URL_RE, 25_000);
            if (!step2) {
                const t2 = await step1.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400)).catch(() => '');
                diag(`段3 补点后仍未跳转 | URL=${step1.url().slice(0, 120)} | 文案=${t2.slice(0, 260)}`);
            }
        }
        else {
            diag(`段3 表单页已出现：${step2.url().slice(0, 140)}`);
        }
        if (!step2) {
            return {
                ok: false,
                failureKind: 'api_error',
                shopKey,
                finalUrl: step1.url(),
                text: '选类目点「确认发布该类商品」后 50s 内未跳到发布表单页（/goods/goods_add/index）。\n'
                    + '请打开浏览器窗口查看是否被校验拦住，处理后重试本工具。',
            };
        }
        await step2.bringToFront().catch(() => { });
        await step2.setViewport({ width: 1440, height: 900 }).catch(() => { });
        const step2Ready = await waitFor(step2, p => p.evaluate((sel) => !!document.querySelector(sel), STEP2_READY_SELECTOR), FORM_WAIT_MS, '发布表单页');
        if (!step2Ready.ok)
            return guardFailResult(step2Ready, store, shopKey, step2.url());
        /**
         * 第二步主图：**完全跳过 DOM 上传**（照抄觅千手 uploadAllImages 的结论）。
         *
         * 原文（m_042_8087 uploadAllImages 末尾）：
         *     e.gallery = [...u, ...d]        // u=主图{url,type:1,file_id}，d=详情图{url,type:2}
         *     if (e.main_img.length > 0 && 0 === u.length) throw '主图 gallery 构建失败'
         * —— 它**从不碰 DOM 文件控件**，图片全靠 HTTP 上传后写进 gallery。
         *
         * 而 fillImageData 原文是 `e.gallery = t.gallery`（整组替换），
         * 所以页面主图区空不空**完全不影响提交体**。
         *
         * 之前我误判成「页面状态影响规格区」，于是恢复 DOM 上传 —— 那是在错误方向上加戏。
         * 真正影响规格区的是 SKU 建表逻辑，与图片无关。
         */
        {
            const g = (opts.hijack?.goodsDetail?.gallery || []);
            const t1 = g.filter(x => x.type === 1).length;
            const t2 = g.filter(x => x.type === 2).length;
            // ★ 2026-10-20 实测修正：页面「提交并上架」前会校验轮播图非空
            //   （「商品轮播图不能为空」），原设计「跳过 DOM 上传」会被拦。
            //   fillImageData 只影响提交体，不影响页面校验状态 —— 故补 1 张 DOM 主图。
            //   提交体 gallery 仍由 fillImageData 整组替换为 HTTP 上传的图，不受影响。
            diag(`段3 图片策略：gallery type1=${t1}、type2=${t2}，补 1 张 DOM 主图过页面校验`);
            if (images.length) {
                const localImg = images.find(im => !/^https?:\/\//i.test(im));
                if (localImg) {
                    const input = await step2.$(STEP2_IMAGE_INPUT).catch(() => null);
                    if (input) {
                        await input.uploadFile(localImg).catch((e) => diag(`DOM 主图上传异常：${e.message}`));
                        await new Promise(r => setTimeout(r, 12000));
                        const cnt = await step2.evaluate((sel) => {
                            const inp = document.querySelector(sel);
                            let box = inp;
                            for (let i = 0; i < 10 && box?.parentElement; i++) {
                                box = box.parentElement;
                                const m = (box.innerText || '').replace(/\s+/g, ' ').match(/已上传\s*(\d+)\s*\/\s*(\d+)\s*张/);
                                if (m)
                                    return `${m[1]}/${m[2]}`;
                            }
                            return null;
                        }, STEP2_IMAGE_INPUT).catch(() => null);
                        diag(`DOM 主图已补传（过校验用）：${cnt || '已上传'}`);
                    }
                    else {
                        diag('未找到主图 file input，跳过 DOM 补传');
                    }
                }
            }
        }
        // 类目已由段 2 在选择页确认；表单页 #goods-category 读回对账。
        // ★ 真机实测（2026-10-14）：该元素 innerText 可能只是区块标题「商品分类」
        //   （类目路径渲染在别处），此时回退用段 2 选中的 pickedCate，不能拿标题当类目。
        const cateText = await step2.evaluate(() => {
            const el = document.querySelector('#goods-category');
            return (el?.innerText || '').replace(/\s+/g, ' ').trim();
        }).catch(() => '');
        const cateLabel = cateText && cateText !== '商品分类' ? cateText : pickedCate;
        if (cateText)
            console.log(`[dsagent-pdd-publish] 表单页读回类目：${cateText}`);
        // ── 段 4：填通用字段 ───────────────────────────────────
        const filled = [];
        const missed = [];
        filled.push(`类目=${cateLabel}`);
        const tHit = await fillTitle(step2, title);
        if (tHit)
            filled.push(`标题=${title}`);
        else
            missed.push('标题');
        if (price) {
            const pHit = await fillField(step2, /商品参考价|参考价|应大于商品最大单买价/, price);
            if (pHit)
                filled.push(`参考价=${price}`);
            else
                missed.push('参考价');
        }
        // 商品详情图：**跳过 DOM 上传**（详情图走 HTTP 上传后进 gallery 的 type2）
        {
            const t2 = (opts.hijack?.goodsDetail?.gallery || [])
                .filter(g => g.type === 2).length;
            if (opts.hijack) {
                diag(`段4 跳过 DOM 详情图上传：gallery type2=${t2} 张（HTTP 已传）`);
                filled.push(`详情图（模式2：${t2} 张 CDN URL 注入 gallery）`);
            }
            else {
                const detail = await uploadDetailImages(step2, detailImages);
                if (detail.ok)
                    filled.push(`详情图（${detail.note}）`);
                else
                    missed.push(`详情图（${detail.note}）`);
                console.log(`[dsagent-pdd-publish] 详情图：${detail.note}`);
            }
        }
        /**
         * ── 段4 规格/价格/属性/发货：**模式2 全部跳过 DOM 填写** ──
         *
         * ★ 2026-10-21 重构（重要）：原逻辑在模式2 下也把整个表单 DOM 填一遍
         *   （规格 2 分钟 + 价格表 + 属性 + 发货），但提交时劫持改包会**整体替换**
         *   skus/gallery/goods_properties，DOM 填的 90% 被丢弃 —— 纯浪费 3-4 分钟，
         *   且页面结构一变动就失败。
         *
         *   页面真正强制的只有「提交按钮可点」：标题 + 轮播图非空（段3 已补 DOM 主图）。
         *   实测：只填标题+1张主图即可点到提交并触发劫持。
         *
         *   ★ 兜底：点提交时若按钮 disabled（页面校验未过），回退填价格表再试一次
         *     （见段4 收尾的模式2 分支）。
         */
        if (opts.hijack) {
            // ★ 2026-10-26：DOM 填规格（自由维度）
            //   按 pdd_上架HTTP链路完整逆向.md 的正确流程：
            //   先 DOM 填规格 → 页面 JS 注册 → 平台分配 spec_id
            //   然后改包只改价/图/名，不碰 spec
            if (opts.domFillSpecs && typeof opts.domFillSpecs === 'function') {
                diag('段4 模式2 + DOM 填规格：调用 domFillSpecs');
                const fillResult = await opts.domFillSpecs(step2);
                diag(`段4 DOM 填规格结果：ok=${fillResult?.ok}, skuRows=${fillResult?.skuRows}`);
                if (!fillResult?.ok) {
                    console.log('[dsagent-pdd-publish] DOM 填规格失败：' + (fillResult?.message || '未知'));
                }
            } else {
                diag('段4 模式2 跳过 DOM 规格/价格/属性/发货填写（提交体由劫持改包整体注入）');
            }
            filled.push('规格/价格/属性/发货（模式2：提交体改包注入）');
        }
        else {
            // SKU 多规格：必须先建规格（决定 SKU 行数），再填价格/库存，最后投递每行预览图。
            if (specs.length) {
                diag(`段4 多维规格入口：specs=${specs.length} 维、skuRows=${skuRows.length} 行，调用 fillSkuSpecMulti`);
                const spec = await withStallWatch(step2, '第二步-SKU 规格（多维）', 240_000, () => fillSkuSpecMulti(step2, specs, skuRows, category));
                diag(`段4 fillSkuSpecMulti 返回：filled=${spec.filled.length}、missed=${spec.missed.length}`);
                filled.push(...spec.filled);
                missed.push(...spec.missed);
                await sleep(1500);
            }
            else if (skus.length) {
                diag(`段4 单维规格入口：skus=${skus.length} 行，调用 fillSkuSpec`);
                const spec = await withStallWatch(step2, '第二步-SKU 规格', 180_000, () => fillSkuSpec(step2, skus, { category }));
                diag(`段4 fillSkuSpec 返回：filled=${spec.filled.length}、missed=${spec.missed.length}`);
                filled.push(...spec.filled);
                missed.push(...spec.missed);
                await sleep(1500);
            }
            else {
                diag('段4 无规格（specs=0 且 skus=0），直接进入价格表');
            }
            // 价格及库存 SKU 表
            {
                const priceRows = specs.length
                    ? skuRows.map(r => ({ price: r.price, stock: r.stock, specs: r.specs }))
                    : skus.map(s => ({ price: s.price, stock: s.stock }));
                const sku = await withStallWatch(step2, '第二步-价格及库存', 180_000, () => fillPriceTable(step2, {
                    price, stock, itemNo,
                    rows: priceRows,
                }));
                filled.push(...sku.filled);
                missed.push(...sku.missed);
                diag(`价格表填充：已填 ${sku.filled.length} 项；未填 ${sku.missed.length} 项`);
                await sleep(1500);
            }
            // 商品属性
            try {
                const attrs = await withStallWatch(step2, '第二步-商品属性', 150_000, () => fillAttributes(step2, { title, category, model: opts.attrModel, values: attributes }));
                filled.push(...attrs.filled);
                missed.push(...attrs.missed);
            }
            catch (e) {
                missed.push(`商品属性（自动填充异常：${e.message}）`);
            }
            // 发货与售后
            try {
                const ship = await withStallWatch(step2, '第二步-发货与售后', 60_000, () => fillShippingAndFreight(step2, {
                    costTemplate: opts.costTemplate,
                    deliveryTime: opts.deliveryTime,
                }));
                filled.push(...ship.filled);
                missed.push(...ship.missed);
            }
            catch (e) {
                missed.push(`发货与售后（自动填充异常：${e.message}）`);
            }
        }
        console.log(`[dsagent-pdd-publish] 通用字段已填：${filled.join('、') || '（无）'}；未命中：${missed.join('、') || '（无）'}`);
        // ── 段 4 收尾：点提交 ─────────────────────────────────
        if (opts.hijack) {
            // ════ 模式2（劫持填价）分支 ════
            // 时序铁律：先 setupHijack 挂 listener（同步），再开 setRequestInterception，
            // 最后点提交——避免「拦截已开但无 handler」窗口内其他请求挂起。
            const mode2 = await import('./pdd-mode2.js');
            // ★ 兜底：模式2 跳过 DOM 填表后，若页面提交按钮 disabled（校验未过），
            //   回退把价格表填上（只填价格/库存，不建规格——规格行由改包注入）。
            //   实测：只填标题+主图时可点提交；若平台加强校验，这里保证仍能触发劫持。
            const submitEnabled = await step2.evaluate(() => {
                const b = document.querySelector('button#bottomSubmitBtnId');
                if (b)
                    return !b.disabled;
                const t = Array.from(document.querySelectorAll('button')).find(x => /提交并上架/.test(x.innerText || '') && !/取消|草稿/.test(x.innerText || ''));
                return t ? !t.disabled : false;
            }).catch(() => true);
            if (!submitEnabled && (specs.length || skus.length)) {
                diag('模式2 兜底：提交按钮 disabled，回退填价格表');
                try {
                    const priceRows = specs.length
                        ? skuRows.map(r => ({ price: r.price, stock: r.stock, specs: r.specs }))
                        : skus.map(s => ({ price: s.price, stock: s.stock }));
                    const sku = await withStallWatch(step2, '第二步-价格及库存（兜底）', 120_000, () => fillPriceTable(step2, { price, stock, itemNo, rows: priceRows }));
                    filled.push(...sku.filled);
                    missed.push(...sku.missed);
                    diag(`兜底价格表：已填 ${sku.filled.length} 项`);
                }
                catch (e) {
                    diag(`兜底填表失败：${e.message}`);
                }
            }
            const ctrl = mode2.setupHijack(step2, opts.hijack.goodsDetail, {
                onProxyFallback: ctx => mode2.sendPddEditViaHttp(ctx),
                onTrace: opts.hijack.onTrace,
            });
            let hijackOutcome = null;
            try {
                await step2.setRequestInterception(true);
                // ★ 2026-10-22：先等提交按钮真正渲染出来（表单页加载慢时 evaluate 会找不到）
                //   之前直接点 → 「未找到提交按钮」→ 白等 120s 超时。
                let btnReady = false;
                for (let i = 0; i < 30; i++) {
                    const has = await step2.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        return btns.some(b => /^(提交并上架|提交|确认提交|发布)$/.test((b.innerText || '').trim())
                            && !/取消|草稿/.test((b.innerText || '').trim())
                            && b.offsetParent !== null);
                    }).catch(() => false);
                    if (has) {
                        btnReady = true;
                        break;
                    }
                    await new Promise(r => setTimeout(r, 2000));
                }
                diag(`提交按钮渲染等待：${btnReady ? '已出现' : '30 次重试后仍未出现'}`);
                let clicked = btnReady && await clickSubmit(step2);
                // ★ DOM click 是 untrusted，React 可能忽略 → CDP 真实鼠标兜底
                if (clicked) {
                    await new Promise(r => setTimeout(r, 2500));
                    const stillOnForm = /goods_add/.test(step2.url());
                    if (stillOnForm) {
                        const rect = await step2.evaluate(() => {
                            const btns = Array.from(document.querySelectorAll('button'));
                            const b = btns.find(x => /^(提交并上架|提交|确认提交|发布)$/.test((x.innerText || '').trim())
                                && !/取消|草稿/.test((x.innerText || '').trim())
                                && x.offsetParent !== null);
                            if (!b)
                                return null;
                            const r = b.getBoundingClientRect();
                            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                        }).catch(() => null);
                        if (rect) {
                            await step2.mouse.click(rect.x, rect.y).catch(() => { });
                            diag(`提交按钮 CDP 真实鼠标补点：(${Math.round(rect.x)}, ${Math.round(rect.y)})`);
                            clicked = true;
                        }
                    }
                }
                console.log(`[dsagent-pdd-publish] 模式2 提交按钮点击：${clicked ? '已点击（等待劫持改包）' : '未点到（可能仍需补全必填项）'}`);
                if (!clicked) {
                    const why = await diagSubmitDisabled(step2);
                    console.log(`[dsagent-pdd-publish] 提交按钮状态诊断：${why}`);
                }
                hijackOutcome = await mode2.waitHijackOutcome(ctrl, mode2.PDD_HIJACK_WAIT_MS);
            }
            finally {
                await mode2.teardownHijack(step2, ctrl).catch(() => { });
            }
            const finalUrl = step2.url();
            const detailMessage = String(hijackOutcome?.detailMessage || '');
            if (hijackOutcome?.success) {
                try {
                    await store.setStatus(shopKey, 'valid');
                }
                catch { /* 忽略 */ }
                return {
                    ok: true,
                    shopKey,
                    finalUrl,
                    text: '拼多多商品发布已提交成功（模式2-劫持填价）。\n'
                        + `账号：${account.display_label || account.account_id}（${shopKey}）\n`
                        + `标题：${title}\n`
                        + (detailMessage ? `${detailMessage}\n` : '')
                        + (filled.length ? `已自动填写：${filled.join('、')}\n` : '')
                        + (missed.length ? `未自动填写（需人工确认）：${missed.join('、')}\n` : '')
                        + `当前页面：${finalUrl}\n`
                        + '注意：平台仍会对商品做审核，最终状态请在商家后台「商品管理 → 出售中」确认。',
                };
            }
            // 失败：按 errorCode 语义映射 failureKind（PDD_SEND_NETWORK→network_error，其余含 API_BIZ→api_error）
            const failureKind = hijackOutcome?.errorCode === mode2.PDD_ERROR_CODE.SEND_NETWORK
                ? 'network_error'
                : 'api_error';
            return {
                ok: false,
                failureKind,
                shopKey,
                finalUrl,
                text: `发布失败（模式2-劫持填价）：${detailMessage || hijackOutcome?.errorCode || '未知错误'}\n`
                    + `错误码：${hijackOutcome?.errorCode || '未知'}\n`
                    + (missed.length ? `★ 未自动填写的字段：${missed.join('、')}\n` : '')
                    + '可在浏览器窗口内核对必填项后重试，或回退模式1（不传 hijack 配置）。',
            };
        }
        const clicked = await clickSubmit(step2);
        console.log(`[dsagent-pdd-publish] 提交按钮点击：${clicked ? '已点击' : '未点到（可能仍需补全必填项）'}`);
        // ── 判定结果（含用户手动补全后自行提交的情形）─────────
        let finalUrl = step2.url();
        let success = false;
        let successId = '';
        let errText = '';
        let errPanel = '';
        const deadline = Date.now() + PUBLISH_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await sleep(2000);
            finalUrl = step2.url();
            if (await detectRisk(step2)) {
                console.log('[dsagent-pdd-publish] 提交时命中内联滑块，等待用户在窗口内完成拼图...');
                if (!(await waitSliderCleared(step2, SLIDER_WAIT_MS))) {
                    return {
                        ok: false,
                        failureKind: 'risk_control',
                        shopKey,
                        finalUrl,
                        text: '提交时命中「请向右滑块完成拼图」安全验证，等待 '
                            + `${SLIDER_WAIT_MS / 1000}s 仍未通过。\n`
                            + '请重试本工具，在浏览器窗口内手动拖动滑块完成拼图后，工具会自动继续提交。\n'
                            + (missed.length ? `★ 未自动填写的字段：${missed.join('、')}\n` : ''),
                    };
                }
                // 滑块通过后重新点一次提交
                console.log('[dsagent-pdd-publish] 滑块已通过，重新提交。');
                await clickSubmit(step2);
                continue;
            }
            if (await isLoggedOut(step2)) {
                await store.setStatus(shopKey, 'expired');
                return {
                    ok: false,
                    failureKind: 'token_expired',
                    shopKey,
                    finalUrl,
                    text: '拼多多商家后台登录态已失效（页面要求登录）。\n'
                        + '请到「账号连接」页面重新登录**拼多多商家后台**账号（mms.pinduoduo.com）。',
                };
            }
            try {
                const probe = await step2.evaluate(() => {
                    const txt = (document.body?.innerText || '').replace(/\s+/g, ' ');
                    const idMatch = txt.match(/商品ID[:：]\s*(\d+)/);
                    const toast = document.querySelector('div[data-testid="beast-core-toast"]');
                    if (toast && /提交成功/.test(toast.innerText || '')) {
                        return { kind: 'success', id: idMatch ? idMatch[1] : '' };
                    }
                    // 提交成功后页面会出现「查看商品详情」按钮；「商品修改发布中」表示平台已受理
                    if (/查看商品详情|商品修改发布中/.test(txt)) {
                        return { kind: 'success', id: idMatch ? idMatch[1] : '' };
                    }
                    const err = txt.match(/提交失败[^。]{0,80}|发布失败[^。]{0,80}|商品标题不能为空|请输入商品标题[^。]{0,40}|标题不能超过[^。]{0,30}|请填写商品参考价|请上传[^。]{0,30}图片|请选择[^。]{0,20}类目|请填写[^。]{0,30}属性/);
                    if (err)
                        return { kind: 'error', msg: err[0] };
                    return { kind: '', id: '' };
                });
                if (probe.kind === 'success') {
                    success = true;
                    successId = probe.id || '';
                    break;
                }
                // 兜底词表命中不立即中断：真实拦因以「商品填写建议」面板为准（见下方 readSubmitErrors）
            }
            catch { /* 页面跳转中，下一轮再取 */ }
            // ★ 诊断：读「商品填写建议」面板（错误 tab + 建议项）+ 字段级红字 + toast
            try {
                const diag = await readSubmitErrors(step2);
                if (diag.panel)
                    errPanel = diag.panel;
                if (diag.hard) {
                    console.log(`[dsagent-pdd-publish] 提交被拦：${diag.hard}`);
                    if (diag.panel)
                        console.log(`[dsagent-pdd-publish] 填写建议面板：${diag.panel}`);
                    errText = diag.hard;
                    break;
                }
            }
            catch { /* 面板读取失败不影响主循环 */ }
        }
        if (errPanel)
            console.log(`[dsagent-pdd-publish] 填写建议面板：${errPanel}`);
        if (success) {
            // 发布成功说明登录态确实有效，顺带订正可能被误标的状态
            try {
                await store.setStatus(shopKey, 'valid');
            }
            catch { /* 忽略 */ }
            return {
                ok: true,
                shopKey,
                finalUrl,
                text: '拼多多商品发布已提交成功。\n'
                    + `账号：${account.display_label || account.account_id}（${shopKey}）\n`
                    + `标题：${title}\n`
                    + (successId ? `商品ID：${successId}\n` : '')
                    + (filled.length ? `已自动填写：${filled.join('、')}\n` : '')
                    + (missed.length ? `未自动填写（需人工确认）：${missed.join('、')}\n` : '')
                    + `当前页面：${finalUrl}\n`
                    + '注意：平台仍会对商品做审核，最终状态请在商家后台「商品管理 → 出售中」确认。',
            };
        }
        if (errText) {
            return {
                ok: false,
                failureKind: 'api_error',
                shopKey,
                finalUrl,
                text: `发布失败：${errText}\n`
                    + (errPanel ? `填写建议面板：${errPanel}\n` : '')
                    + (missed.length ? `★ 未自动填写的字段：${missed.join('、')}\n` : '')
                    + '请在浏览器窗口内补全必填项（尤其是**类目属性**、商品详情与 SKU）后手动点击「提交并上架」。',
            };
        }
        return {
            ok: false,
            failureKind: 'api_error',
            shopKey,
            finalUrl,
            text: `提交后 ${PUBLISH_TIMEOUT_MS / 1000}s 内未检测到成功标志（当前 URL：${finalUrl}）。\n`
                + (filled.length ? `已自动填写：${filled.join('、')}\n` : '')
                + (missed.length ? `★ 未能自动填写：${missed.join('、')}\n` : '')
                + (errPanel ? `填写建议面板：${errPanel}\n` : '')
                + '请打开浏览器窗口查看具体提示：\n'
                + '  · 若页面仍有红色校验提示（类目属性、详情、SKU、发货设置等），补全后手动点「提交并上架」；\n'
                + '  · 若出现滑块拼图，请人工完成；\n'
                + '  · 处理完成后若已发布成功，可在商家后台「商品管理 → 出售中」核对结果。',
        };
    }
    catch (err) {
        return {
            ok: false,
            failureKind: 'api_error',
            shopKey,
            text: `拼多多发布失败：${err instanceof Error ? err.message : String(err)}`,
        };
    }
    finally {
        releaseProfile(dir);
        if (browser) {
            try {
                await browser.close();
            }
            catch { /* 忽略 */ }
        }
    }
}
//# sourceMappingURL=pdd-publish.js.map