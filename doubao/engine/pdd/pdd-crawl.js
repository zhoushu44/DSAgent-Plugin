/**
 * 拼多多数据采集 — host 半区 puppeteer 实现。
 *
 * 为什么必须走浏览器而不能走网关纯 HTTP（dev/probe-pdd-*.mjs 已实测排除）：
 *   拼多多 H5 业务接口（/proxy/api/**）要求 `anti_content` 签名参数，
 *   该值由页面 JS 在运行时生成，Cookie 注入式纯 HTTP 请求恒被拒：
 *     - /proxy/api/search              → 54001（anti_content 校验失败）
 *     - /proxy/api/... recommend / top → 403 error_code=40003
 *
 * 取数分两路（缺一不可，dev/probe-pdd-search4x.mjs 实测）：
 *   ① XHR 拦截 —— 首页推荐流（feed）的商品来自 /proxy/api/api/alexa/cells/hub/v3，
 *      由页面自身发出，自带 anti_content 签名，host 侧只收响应体。
 *   ② SSR 内联解析 —— 搜索页（search_result.html）**首屏不发搜索 XHR**，
 *      商品直接内联在 window.rawData.stores.store.data.ssrListData.list 里。
 *      只等 XHR 会永远空手而归（这是本模块早期的真 bug）。
 *
 * ★ 平台侧限制（实测，非本模块可修）：搜索接口对该账号返回 error_code=40002
 *   （「系统繁忙」，429/200 均见）且为**持久限流**（冷却 240s 零请求后仍空）。
 *   此时 SSR 里 isNoResultList=true、hasError=true，页面显示「系统繁忙 请稍后再试」。
 *   同一账号的 feed / user/me / search_hotquery 均 200 → 是搜索接口被限，非账号封禁。
 *   故 search 模式必须把 SSR 状态如实回报给模型，并引导改用 mode=feed。
 *
 * ★ 前提：匿名浏览器访问拼多多商品页/搜索页一律强制跳登录页，
 *   因此本技能要求凭证库中已存在 pdd 账号（否则返回 not_bound 引导扫码登录）。
 */
import { resolveAccountForRequest, credentialPlatform } from './services/credential-store.js';
import { applyStealth } from './stealth-inject.js';
import { clearProfileLocks, findChromePath, profileDir, profileOwner, releaseProfile, tryAcquireProfile } from './browser-login.js';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/**
 * 把插件内的绝对路径转成 file:// URL 供动态 import 使用。
 *
 * ★ 2026-10-27 修（真实缺陷，非测试限制）：
 *   `await import(join(PLUGIN_ROOT, 'skills/_shared/pdd-risk.mjs'))` 直接把
 *   Windows 路径（`C:\...`）传给 import()，Node 报
 *   `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'c:'`。
 *   而被 `.catch(() => null)` 吞掉 → riskMod=null →
 *   **账号锁、冷却检查、孤儿进程清理全部静默失效**。
 *   实测探针确认：riskMod = NULL。
 */
const toFileUrl = (p) => pathToFileURL(p).href;
/**
 * 风控模块（skills/_shared/pdd-risk.mjs）所在**插件根**。
 *
 * ★ 2026-10-27 修（P2-13 排查时发现）：原来照抄 pdd-publish.ts 的 `'..', '..'`
 *   （上推两层）是**错的**。安装位置的插件自带 skills 目录：
 *
 *     node_modules/@dsagent/dsagent-plugin/
 *       ├─ lib/pdd-crawl.js        ← 本文件编译后在这
 *       └─ skills/_shared/pdd-risk.mjs
 *
 *   从 lib/ 出发只需上推**一层**就是插件根。上推两层会指到
 *   `node_modules/@dsagent`，那里没有 skills → import 恒失败，
 *   而调用处都有 `.catch(() => null)` 兜底 → **静默失效**。
 *
 *   pdd-publish.ts 里既有的两处 import 正是踩了这个坑：滑块自动过
 *   在发布链路里从未真正接入过，只是没报错而已。
 */
const PLUGIN_ROOT_FOR_RISK = join(dirname(fileURLToPath(import.meta.url)), '..');
const H5_BASE = 'https://mobile.yangkeduo.com';
const CRAWL_WAIT_MS = 30_000;
/** 单次采集返回的商品上限，避免把超大响应灌给模型 */
const MAX_GOODS = 100;
/** 拦截到的响应体上限（防止超大 JSON 拖垮内存） */
const MAX_BODY_CHARS = 400_000;
/** 移动端 UA：目标站点是 H5 站，桌面 UA 更容易被风控 */
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
/**
 * ★ 2026-10-27 新增：滚动分页节流。
 *
 * 背景：scrollTo 会触发页面自身的分页请求（feed 的 /proxy/api/api/alexa/cells/hub/v3
 * 分页、search 的 SSR 补齐）。此前循环里每 2 秒滚一次，等于 2 秒一个分页请求，
 * 连续打 30 秒 → 15 次分页 → 极易触发 40002「系统繁忙」。
 *
 * 实测依据：拼多多按「接口前缀 + 账号」分级风控，H5 的 /proxy/api/ 域虽然比
 * 商家后台宽松，但连续分页仍会被限。4~6 秒一次滚动（带抖动）与商家后台的
 * 账号级节流参数（4.0s + 0~2.0s jitter）对齐。
 */
const SCROLL_INTERVAL_MS = 4000;
const SCROLL_JITTER_MS = 2000;
/** 本工具在 Profile 锁中的占用者标识（用于互斥提示文案） */
const PROFILE_OWNER = '拼多多采集';
/**
 * 账号选择：复用凭证库四级选择链（① 显式 shopKey ② 会话绑定 ③ 平台默认 ④ 自动兜底）。
 * 第 ④ 级多账号时不静默选号，返回候选让模型问用户。
 */
function selectAccount(store, opts) {
    // ★ 2026-11-04 修：账号过滤必须走 credentialPlatform() 归一化。
    //
    //   原来写死 `a.platform === 'pdd'`，但「账号连接」页存进来的 platform 是
    //   **前端别名** `pinduoduo`（见 lib/services/credential-store.js L198-201 的
    //   别名表：pinduoduo→pdd）。写死比较导致 candidates 恒为空 → 明明已绑定
    //   账号却返回 not_bound，让用户反复去扫码。
    //
    //   findByPlatform（credential-store L1165）用的是 `credentialPlatform(item.platform) === target`，
    //   这里对齐成同一套写法。
    const candidates = store.listAccounts()
        .filter(a => credentialPlatform(a.platform) === 'pdd' && a.status !== 'invalid');
    if (!candidates.length) {
        return {
            account: null,
            choices: [],
            error: {
                ok: false,
                failureKind: 'not_bound',
                text: '未找到拼多多账号。拼多多页面在未登录时会强制跳转登录页，无法采集。'
                    + '请引导用户打开「账号连接」页面添加拼多多账号（扫码登录）后再重试。',
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
                    `拼多多平台有 ${res.choices.length} 个可用账号，当前会话未绑定具体账号。`,
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
/** 价格归一：拼多多接口价格多为「分」的整数，统一转成元 */
function normalizePrice(v) {
    if (v == null || v === '')
        return '';
    if (typeof v === 'string' && v.includes('.'))
        return v;
    const n = Number(v);
    if (!Number.isFinite(n))
        return String(v);
    return (n / 100).toFixed(2);
}
/** 单条商品字段归一（兼容接口的 snake_case / camelCase 两套命名） */
function normalizeGoods(raw) {
    const goodsId = String(raw.goods_id ?? raw.goodsId ?? raw.goods_id_str ?? '');
    // 价格字段实测来源（首页推荐流 /proxy/api/api/alexa/cells/hub/v3，单位一律为「分」）：
    //   group.price=381（拼团价，页面展示价）/ normal_price=481（单买价）/ market_price=1806（市场价）
    // 详情页（/api/caterham/query/goods_detail_with_tags）另有 min_group_price / min_normal_price。
    const price = normalizePrice(raw.price
        ?? raw.min_group_price
        ?? raw.group_price
        ?? raw.min_on_sale_group_price
        ?? raw.group?.price
        ?? raw.min_normal_price
        ?? raw.normal_price
        ?? raw.market_price
        ?? raw.price_str);
    const sales = String(raw.sales_tip ?? raw.salesTip ?? raw.sales ?? raw.cnt ?? raw.sold_quantity ?? raw.soldQuantity ?? '');
    return {
        goodsId,
        goodsName: String(raw.goods_name ?? raw.goodsName ?? raw.short_name ?? raw.title ?? ''),
        price,
        sales,
        mallId: String(raw.mall_id ?? raw.mallId ?? ''),
        mallName: String(raw.mall_name ?? raw.mallName ?? ''),
        thumbUrl: String(raw.thumb_url ?? raw.thumbUrl ?? raw.hd_thumb_url ?? raw.image_url ?? ''),
        linkUrl: goodsId ? `${H5_BASE}/goods.html?goods_id=${goodsId}` : '',
    };
}
/** 递归找出 JSON 里所有「商品对象」（含 goods_id / goods_name 字段的对象） */
function extractGoods(node, out, depth = 0) {
    if (node == null || depth > 8 || out.length >= MAX_GOODS)
        return;
    if (Array.isArray(node)) {
        for (const item of node) {
            if (out.length >= MAX_GOODS)
                return;
            extractGoods(item, out, depth + 1);
        }
        return;
    }
    if (typeof node === 'object') {
        const rec = node;
        // ★ 商品对象必须在这里判、不能只判「数组元素」：
        //   search 接口商品在 items[] 里（数组元素），但首页推荐流在 goods_list[].data 里（对象的属性值），
        //   只判数组元素会整批漏掉推荐流。
        if ('goods_id' in rec || 'goodsId' in rec || 'goods_name' in rec || 'goodsName' in rec) {
            const g = normalizeGoods(rec);
            if (g.goodsId || g.goodsName)
                out.push(g);
            return;
        }
        for (const v of Object.values(rec))
            extractGoods(v, out, depth + 1);
    }
}
/** 从拦截到的响应体里解析商品（JSON 直解；失败则不解析，不抛错） */
function parseGoods(body, out) {
    const text = body.trim();
    if (!text || (text[0] !== '{' && text[0] !== '['))
        return;
    try {
        extractGoods(JSON.parse(text), out);
    }
    catch { /* 非 JSON 或截断，忽略 */ }
}
/** 去重（同一商品可能在多个接口里出现） */
function dedupe(items) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
        const key = it.goodsId || it.goodsName;
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        out.push(it);
    }
    return out;
}
/**
 * 读取搜索页 SSR 状态，并把内联商品并入 out。
 *
 * ★ 为什么必须单独读 SSR：search_result.html 首屏**不发**搜索 XHR，
 *   商品数据直接内联在 window.rawData.stores.store.data.ssrListData.list。
 *   只监听 /proxy/api/ 响应会永远拿不到搜索结果（本模块早期的真 bug）。
 *
 * 返回 null 表示页面没有 SSR 数据（例如被重定向到登录页）。
 */
async function readSearchSsr(page, out) {
    try {
        const raw = await page.evaluate(() => {
            const w = window;
            const d = w.rawData?.stores?.store?.data;
            if (!d)
                return null;
            const s = d.ssrListData || {};
            const list = Array.isArray(s.list) ? s.list : [];
            return {
                searchKey: String(s.searchKey || ''),
                isNoResultList: s.isNoResultList === true,
                hasError: s.hasError === true,
                isRisk: s.isRisk === true,
                listLen: list.length,
                list,
                expansionList: Array.isArray(s.expansionList) ? s.expansionList : [],
            };
        });
        if (!raw)
            return null;
        // SSR 条目结构与 XHR 一致（含 goods_id / goods_name），复用同一提取器
        extractGoods(raw.list, out);
        extractGoods(raw.expansionList, out);
        return {
            searchKey: raw.searchKey,
            isNoResultList: raw.isNoResultList,
            hasError: raw.hasError,
            isRisk: raw.isRisk,
            listLen: raw.listLen,
        };
    }
    catch {
        return null;
    }
}
/**
 * 拼多多采集主流程。
 *
 * 纯读操作（无副作用），因此不需要 confirm 门禁。
 */
export async function pddCrawl(store, opts) {
    // ── 入参校验 ────────────────────────────────────────────
    // 三态模式：feed（首页推荐流，实测唯一稳定可用）/ goods（单品详情）/ search（关键词搜索）
    // 未显式传 mode 时按入参推断：有 goodsId → goods；有关键词 → search；都没有 → feed。
    const keyword = String(opts.keyword || '').trim();
    const goodsId = String(opts.goodsId || '').trim();
    const modeRaw = String(opts.mode || '').trim();
    const mode = modeRaw === 'goods' || modeRaw === 'feed' || modeRaw === 'search'
        ? modeRaw
        : goodsId ? 'goods' : keyword ? 'search' : 'feed';
    const limitRaw = Number.parseInt(String(opts.limit ?? '20'), 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1), MAX_GOODS);
    if (mode === 'search' && !keyword) {
        return { ok: false, failureKind: 'api_error', text: '缺少 keyword（搜索关键词）。mode=search 时必填。' };
    }
    if (mode === 'goods' && !goodsId) {
        return { ok: false, failureKind: 'api_error', text: '缺少 goodsId（商品 ID）。mode=goods 时必填。' };
    }
    // ── 选号 ───────────────────────────────────────────────
    const picked = selectAccount(store, { account: opts.account, agentId: opts.agentId });
    if (picked.error)
        return picked.error;
    const account = picked.account;
    const shopKey = account.shop_key;
    const accountCookies = account.cookies || {};
    // ★ 互斥锁按 Profile 目录划分（browser-login 统一持有），与登录 / 风控验证共享。
    //   按目录加锁才能拦住「采集与登录窗口同时启动」这类跨模块撞锁（后者会 clearProfileLocks
    //   删掉前者正在使用的 SingletonLock，把会话搞崩）。
    const dir = profileDir('pdd', shopKey);
    const busyOwner = profileOwner(dir);
    if (!tryAcquireProfile(dir, PROFILE_OWNER)) {
        return {
            ok: false,
            failureKind: 'api_error',
            text: `拼多多的浏览器环境正被「${busyOwner || '其他任务'}」占用。`
                + '请先等待该任务结束或关闭已弹出的浏览器窗口，再重新调用本工具。',
        };
    }
    // ★ 2026-10-27 修（P2-13）：再拿一道「账号级」文件锁。
    //
    //   背景：拼多多的风控评分是**账号级**的，两个浏览器同时操作同一个号
    //   （哪怕一个打 H5 买家态、一个打商家后台）会让出口频率翻倍，极易触发风控。
    //
    //   而此前有两套互不相通的锁：
    //     · 插件侧 `tryAcquireProfile(dir)` —— 进程内存 Map，只有插件主进程内的
    //       模块（pdd-crawl / pdd-publish / 登录 / 风控验证）能互相看到；
    //     · skills 侧 `tryAcquireAccountLock(shopKey)` —— 文件锁，只有各技能的
    //       Node 子进程（pdd-works / pdd-shop / pdd-promo...）能互相看到。
    //   两者维度不同（目录 vs shopKey）、存储不同（内存 vs 文件），
    //   于是「采集正在跑」时 `pdd-shop` 照样能起来 —— 双浏览器打同一个号。
    //
    //   修法：采集也去拿 skills 侧那个账号文件锁，让**账号维度**只有一个权威锁。
    //   Profile 目录锁保留（它防的是同进程内 Chrome userDataDir 独占冲突）。
    let releaseAccountLock = null;
    let accountLockHeartbeat = null;
    // ★ 2026-11-05：迁移到统一风控闸门 pdd-guard（与其他 pdd 技能同一套准入）
    //   原实现是手写四件套（checkCooldown + tryAcquireAccountLock + 心跳 + release），
    //   能力等价但缺账号级节流 —— 滚动间隔是进程内 setTimeout，跨进程/并发失效。
    //   ⚠️ 闸门内部已持锁，不要再自己 tryAcquireAccountLock（会自己锁死自己）。
    let crawlGuard = null;
    try {
        const guardMod = await import(toFileUrl(join(PLUGIN_ROOT_FOR_RISK, 'skills/_shared/pdd-guard.mjs'))).catch(() => null);
        if (guardMod?.openTask) {
            crawlGuard = await guardMod.openTask('pdd-crawl', shopKey, { lockWaitMs: 300_000 });
            if (crawlGuard.blocked) {
                releaseProfile(dir);
                return {
                    ok: false,
                    failureKind: 'rate_limit',
                    shopKey,
                    mode,
                    text: `账号 ${shopKey} 当前不可执行：${crawlGuard.reason}。\n期间请勿重复调用（会延长封禁）。`,
                };
            }
            crawlGuard.startHeartbeat();
        }
        else {
            // 闸门不可用时降级到原来的手写逻辑
            const riskMod = await import(toFileUrl(join(PLUGIN_ROOT_FOR_RISK, 'skills/_shared/pdd-risk.mjs'))).catch(() => null);
            if (riskMod?.checkCooldown) {
                const cd = riskMod.checkCooldown(shopKey);
                if (cd?.cooling) {
                    releaseProfile(dir);
                    return {
                        ok: false,
                        failureKind: 'rate_limit',
                        shopKey,
                        mode,
                        text: `账号 ${shopKey} 命中平台频控，冷却剩余 ${riskMod.fmtRemain ? riskMod.fmtRemain(cd.remainMs) : Math.ceil(cd.remainMs / 60000) + ' 分钟'}（${cd.reason || ''}）。`,
                    };
                }
            }
            if (riskMod?.tryAcquireAccountLock) {
                const lock = await riskMod.tryAcquireAccountLock(shopKey, 'pdd-crawl', 300_000);
                if (!lock.ok) {
                    releaseProfile(dir);
                    return {
                        ok: false,
                        failureKind: 'rate_limit',
                        text: `账号 ${shopKey} 正被其他拼多多任务占用${lock.holder ? `（${lock.holder}）` : ''}。`,
                    };
                }
                releaseAccountLock = () => { try {
                    riskMod.releaseAccountLock(shopKey);
                }
                catch { /* ignore */ } };
                accountLockHeartbeat = setInterval(() => {
                    try {
                        riskMod.heartbeatAccountLock(shopKey, 'pdd-crawl');
                    }
                    catch { /* ignore */ }
                }, 180_000);
            }
        }
    }
    catch { /* 风控模块缺失不影响主流程，退化为只有 Profile 锁 */ }
    // feed 模式指向首页（推荐流接口 /proxy/api/api/alexa/cells/hub/v3 由首页自身发出）
    const targetUrl = mode === 'goods'
        ? `${H5_BASE}/goods.html?goods_id=${encodeURIComponent(goodsId)}`
        : mode === 'feed'
            ? `${H5_BASE}/`
            : `${H5_BASE}/search_result.html?search_key=${encodeURIComponent(keyword)}`;
    let browser = null;
    try {
        const puppeteer = await import(/* @vite-ignore */ 'puppeteer-core');
        const chromePath = findChromePath();
        if (!chromePath) {
            return { ok: false, failureKind: 'api_error', text: '未找到 Chrome 或 Edge 浏览器，无法执行采集。' };
        }
        const launchOpts = {
            // 可见窗口：拼多多风控较严，出现滑块/安全验证时用户可人工处理
            headless: false,
            executablePath: chromePath,
            userDataDir: dir,
            args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,900'],
        };
        // ★ 2026-10-27（P2-13 后续）：启动前清「孤儿 chrome + Profile 锁」。
        //
        //   原来只有 clearProfileLocks(dir)（删锁文件），但锁能删、占用它的进程
        //   还在的话立刻被重建。必须先杀孤儿进程。
        //   pdd-proc-clean 的安全边界：只杀命令行含 --user-data-dir 且指向本
        //   Profile 的 chrome 进程，绝不碰用户日常浏览器。
        try {
            const procClean = await import(toFileUrl(join(PLUGIN_ROOT_FOR_RISK, 'skills/_shared/pdd-proc-clean.mjs'))).catch(() => null);
            if (procClean?.cleanProfileForLaunch)
                procClean.cleanProfileForLaunch(dir, { quiet: true });
            else
                clearProfileLocks(dir);
        }
        catch {
            clearProfileLocks(dir);
        }
        try {
            browser = await puppeteer.launch(launchOpts);
        }
        catch (e) {
            console.warn('[dsagent-pdd-crawl] 首次启动失败，清理 Profile 锁后重试:', e instanceof Error ? e.message : String(e));
            clearProfileLocks(dir);
            browser = await puppeteer.launch(launchOpts);
        }
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
        await page.setUserAgent(MOBILE_UA);
        await applyStealth(page);
        // ★ 2026-10-27 修：PASS_ID 优先级铁律 —— 浏览器本地会话 > 凭证库快照。
        //
        //   原实现无条件 page.setCookie(...storeCookies) 会把 Profile 里的新票据
        //   覆盖成几天前的旧票（PASS_ID 会在服务端过期/轮转），一打开页面就跳登录页，
        //   然后把「本来只是需要刷新票据」误报成 token_expired，让用户反复重新登录。
        //
        //   正确逻辑：Profile 里已有有效 PASS_ID → 跳过注入，以浏览器为准；
        //             没有才注入凭证库快照。
        const existingCookies = await page.cookies('https://mobile.yangkeduo.com').catch(() => []);
        const profileHasPass = existingCookies.some((c) => c.name === 'PASS_ID' && c.value);
        let injected = 0;
        if (profileHasPass) {
            console.log(`[dsagent-pdd-crawl] Profile 已有 PASS_ID，跳过凭证库注入（以浏览器会话为准，账号 ${shopKey}）`);
        }
        else {
            // 注入拼多多域 Cookie（H5 站登录态在 .yangkeduo.com）
            const cookieList = Object.entries(accountCookies)
                .filter(([, v]) => v !== '' && v != null)
                .map(([name, value]) => ({ name, value: String(value), domain: '.yangkeduo.com', path: '/' }));
            if (cookieList.length > 0)
                await page.setCookie(...cookieList);
            injected = cookieList.length;
            console.log(`[dsagent-pdd-crawl] Profile 无 PASS_ID，已注入 ${injected} 个 yangkeduo.com Cookie（账号 ${shopKey}）`);
        }
        // ── 拦截页面自身的业务接口响应 ──────────────────────────
        // 页面请求自带 anti_content 签名，host 侧只负责把响应体收下来。
        const goods = [];
        const sourceUrls = [];
        let riskHint = '';
        /** 业务接口返回的 error_code（用于把「系统繁忙」等平台侧限制讲清楚） */
        const bizCodes = new Set();
        page.on('response', async (res) => {
            try {
                const url = String(res.url());
                if (!/\/proxy\/api\//.test(url))
                    return;
                const status = res.status();
                const body = await res.text();
                if (sourceUrls.length < 20)
                    sourceUrls.push(`${status} ${url.split('?')[0]}`);
                // 平台侧业务错误码优先于 HTTP 状态码：拼多多限流时常见 200/429 + error_code=40002
                try {
                    const ec = JSON.parse(body)?.error_code;
                    if (typeof ec === 'number' && ec !== 0)
                        bizCodes.add(ec);
                }
                catch { /* 非 JSON，忽略 */ }
                if (status >= 400) {
                    if (status === 403 || status === 429)
                        riskHint = `接口返回 HTTP ${status}`;
                    return;
                }
                if (body && body.length <= MAX_BODY_CHARS)
                    parseGoods(body, goods);
            }
            catch { /* 响应体读取失败（跳转/被中断），忽略 */ }
        });
        // ★ 2026-11-05：打开页面前过闸门 beforeCall（账号级时间槽，落盘跨进程）
        //   原来滚动间隔是进程内 setTimeout（4~6s），跨进程/并发时失效。
        //   这里在唯一入口占一个槽，配合下面的滚动间隔形成双层保护。
        if (crawlGuard?.beforeCall) {
            const pre = await crawlGuard.beforeCall(targetUrl);
            if (!pre.allow) {
                releaseProfile(dir);
                return {
                    ok: false,
                    failureKind: 'rate_limit',
                    shopKey,
                    mode,
                    text: `账号 ${shopKey} 当前不可执行：${pre.reason}。`,
                };
            }
        }
        console.log(`[dsagent-pdd-crawl] 打开页面：${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        // 登录态失效会跳登录页；给模型一个明确的失败类型而不是空等
        const landedUrl = page.url();
        if (/login\.html|login\?/i.test(landedUrl)) {
            // ★ 2026-10-27 修：区分「真的登录态失效」与「被风控打到登录页」。
            //
            //   原实现只要 URL 命中 login 就 store.setStatus('expired') + 报 token_expired，
            //   让用户反复重新登录。但拼多多的风控（54001 滑块连续失败 / 40002 高频）
            //   也会把页面踢到登录页，此时账号并未过期，重新登录只会刷新风控基线。
            //
            //   判别依据：
            //     · 本轮已见到业务错误码（54001/40002 等）→ 是风控，不是过期
            //     · 页面 DOM 里有滑块/安全验证遮罩 → 是风控
            //     · 两者都没有且 URL 在登录页 → 才判定真的过期
            const riskControlled = bizCodes.size > 0;
            const sliderVisible = await page.evaluate(() => {
                const ms = Array.from(document.querySelectorAll('[class*="Modal"], [class*="modal"], [class*="MDL"], [class*="Dialog"], [class*="captcha"], [class*="Captcha"], [class*="verify"], [class*="Verify"]'))
                    .filter(m => { const r = m.getBoundingClientRect(); return r.width > 200 && r.height > 150; });
                return ms.some(m => /滑块|拼图|安全验证|向右/.test((m.innerText || '').slice(0, 60)));
            }).catch(() => false);
            if (riskControlled || sliderVisible) {
                const codeHint = bizCodes.size ? `业务错误码：${[...bizCodes].join(', ')}。` : '';
                return {
                    ok: false,
                    failureKind: 'risk_control',
                    shopKey,
                    mode,
                    sourceUrls,
                    text: `拼多多把页面重定向到了 ${landedUrl}，但这不是登录态失效——`
                        + `${codeHint}${sliderVisible ? '页面存在滑块/安全验证遮罩。' : ''}`
                        + `该账号被平台风控，Cookie 可能仍然有效。\n`
                        + `★ 不要引导用户重新登录（那只会刷新风控基线，问题依旧）。\n`
                        + `建议：打开浏览器窗口人工完成滑块/安全验证，完成后重试；`
                        + `若搜索接口持续返回 40002，改用 mode=feed（首页推荐流，实测稳定可用）。`,
                };
            }
            await store.setStatus(shopKey, 'expired');
            return {
                ok: false,
                failureKind: 'token_expired',
                shopKey,
                text: `拼多多登录态已失效（页面被重定向到 ${landedUrl}，且无滑块遮罩、无业务错误码）。请到「账号连接」页面重新登录拼多多后重试。`,
            };
        }
        // ── 等数据回流 ────────────────────────────────────────
        // search 模式首屏商品内联在 SSR（不发 XHR），必须先读一次 SSR 再滚动；
        // feed 模式商品来自 XHR，滚动触发分页。
        // 连续 2 轮无新增即认为已到底，提前结束。
        let ssrState = mode === 'search' ? await readSearchSsr(page, goods) : null;
        const deadline = Date.now() + CRAWL_WAIT_MS;
        let stagnant = 0;
        let lastCount = 0;
        while (Date.now() < deadline && goods.length < limit && stagnant < 2) {
            // ★ 2026-10-27 修：滚动分页节流。
            //   原实现固定 2 秒滚一次 → 30 秒内 15 次分页请求 → 极易触发 40002。
            //   改为 4~6 秒一次（与商家后台账号级节流参数对齐），带随机抖动。
            const scrollGap = SCROLL_INTERVAL_MS + Math.floor(Math.random() * SCROLL_JITTER_MS);
            const nextScrollAt = Date.now() + scrollGap;
            if (mode === 'search' || mode === 'feed') {
                try {
                    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                }
                catch { /* 页面跳转中，忽略 */ }
            }
            // 搜索页可能异步补齐 SSR / 用户点「刷新」后重渲染，滚动期间再读几次
            if (mode === 'search' && goods.length < limit) {
                ssrState = (await readSearchSsr(page, goods)) ?? ssrState;
            }
            if (goods.length === lastCount)
                stagnant += 1;
            else {
                stagnant = 0;
                lastCount = goods.length;
            }
            const sleepMs = nextScrollAt - Date.now();
            if (sleepMs > 0)
                await new Promise(r => setTimeout(r, sleepMs));
        }
        const items = dedupe(goods).slice(0, limit);
        if (!items.length) {
            // ★ search / goods 接口被平台限流（实测 error_code=40002「系统繁忙」）：
            //   搜索页 SSR 里 isNoResultList=true 且 hasError=true，页面显示「系统繁忙 请稍后再试」；
            //   goods 详情接口同样 429 + 40002。这是平台侧持久限流，
            //   同一账号的 feed / user/me / search_hotquery 仍 200（非账号封禁），本地无法绕过。
            //   40002 是跨模式可靠信号；SSR 状态仅 search 模式可得。
            const throttled = bizCodes.has(40002)
                || (mode === 'search'
                    && (ssrState?.hasError === true || (ssrState?.isNoResultList === true && riskHint !== '')));
            const codeHint = bizCodes.size ? `业务错误码：${[...bizCodes].join(', ')}。` : '';
            const hint = throttled
                ? `拼多多接口返回「系统繁忙」（error_code=40002），该账号的${mode === 'goods' ? '商品详情' : '搜索'}接口当前被平台限流。`
                : riskHint
                    ? `${riskHint}。`
                    : '页面可能仍停留在登录页、被风控拦截，或页面结构已变更。';
            // search / goods 接口实测有账号级持久频控（页面自身请求也被限），feed 稳定可用 → 明确给出回退建议
            //
            // ★ 2026-10-27 补：feed 失败时按账号候选数分流提示。
            //   实测（dev 脚本，空 Cookie mock）：feed 在 Cookie 为空时返回 0 条，
            //   此时页面停在首页（不跳登录页）、也无业务错误码 → 归为 parse_error。
            //   原文案只说「若已登录仍无数据」，没覆盖「没登录/没绑定」的情形。
            //
            //   ⚠ 注意：pddCandidateCount === 0 这个分支**正常不可达** ——
            //   selectAccount 在 candidates 为空时已提前返回 not_bound，走不到这里。
            //   保留它是为了防御「运行间隙账号被删/状态变 invalid」的竞态，
            //   以及让文案与真实条件保持对应。不要因为"测不到"就删掉。
            // ★ 2026-11-04 修：同 selectAccount，必须走 credentialPlatform() 归一化，
            //   否则统计恒为 0，兜底文案会说「没有可用账号」（与事实相反）。
            const pddCandidateCount = store.listAccounts()
                .filter(a => credentialPlatform(a.platform) === 'pdd' && a.status !== 'invalid').length;
            const fallback = mode === 'feed'
                ? (pddCandidateCount === 0
                    ? '当前凭证库没有可用的拼多多（pdd）账号，而 feed 模式也需要登录态才能返回商品流。'
                        + '请到「账号连接」页面扫码登录一个拼多多买家号后重试。'
                        + '（注意：pdd_mms 商家后台账号与 pdd 买家态是两套独立登录态，不能互相替代。）'
                    : '该账号已绑定但 feed 仍未取到数据，可能是平台接口调整，请把上面的接口清单反馈给用户。')
                : '该账号的 search / goods 接口正处于平台频控中（页面自身请求也返回「系统繁忙」）。'
                    + '请改用 mode=feed（首页推荐流，实测稳定可用）取商品数据，或等待平台解除限流后重试。';
            // ★ 2026-10-27 修：40002 是「不可本地修复」的平台侧限流，且**重试无效**
            //   （实测冷却 240s 零请求后仍空）。必须在文案里明确写出「不要重试」，
            //   否则模型收到含义不明的失败会反复重试，反而加重风控。
            const noRetry = throttled
                ? '\n★ 不要重试当前 mode：40002 是接口级持久限流，重试无法解除，只会延长封禁。'
                : '';
            return {
                ok: false,
                failureKind: throttled ? 'risk_control' : 'parse_error',
                shopKey,
                mode,
                sourceUrls,
                text: `未从拼多多页面采集到商品数据。${hint}${codeHint}\n`
                    + `当前页面：${page.url()}\n`
                    + (ssrState ? `搜索页 SSR：关键词「${ssrState.searchKey}」、内联商品 ${ssrState.listLen} 条`
                        + `、isNoResultList=${ssrState.isNoResultList}、hasError=${ssrState.hasError}\n` : '')
                    + (sourceUrls.length ? `已拦截接口：\n${sourceUrls.map(u => `  - ${u}`).join('\n')}` : '未拦截到任何 /proxy/api/ 接口。')
                    + (throttled
                        ? '\n建议：' + fallback + noRetry
                        : '\n建议：打开浏览器窗口确认是否出现滑块/安全验证，人工完成后重试；' + fallback),
            };
        }
        // 取到数据说明登录态确实有效，顺带订正可能被误标的状态
        try {
            await store.setStatus(shopKey, 'valid');
        }
        catch { /* 忽略 */ }
        const lines = items.map((it, i) => {
            const meta = [it.price ? `¥${it.price}` : '', it.sales ? `销量 ${it.sales}` : '',
                it.mallName ? `店铺 ${it.mallName}` : ''].filter(Boolean).join(' | ');
            return `${i + 1}. ${it.goodsName || '（无标题）'}\n   商品ID：${it.goodsId}${meta ? `\n   ${meta}` : ''}\n   链接：${it.linkUrl}`;
        });
        return {
            ok: true,
            shopKey,
            mode,
            count: items.length,
            goods: items,
            sourceUrls,
            text: [
                `拼多多${mode === 'goods' ? '商品详情' : mode === 'feed' ? '首页推荐流' : `关键词「${keyword}」搜索结果`}采集完成，共 ${items.length} 条。`,
                `账号：${account.display_label || account.account_id}（${shopKey}）`,
                '',
                ...lines,
            ].join('\n'),
        };
    }
    catch (err) {
        return {
            ok: false,
            failureKind: 'api_error',
            shopKey,
            text: `拼多多采集失败：${err instanceof Error ? err.message : String(err)}`,
        };
    }
    finally {
        // ★ P2-13：账号锁与 Profile 锁都要释放（顺序无关，各自独立）
        // ★ 2026-11-05：优先用闸门收尾（放锁 + 打印汇总）；降级路径才走手写释放
        if (crawlGuard?.close) {
            try {
                await crawlGuard.close();
            }
            catch { /* ignore */ }
        }
        if (accountLockHeartbeat) {
            try {
                clearInterval(accountLockHeartbeat);
            }
            catch { /* ignore */ }
        }
        if (releaseAccountLock) {
            try {
                releaseAccountLock();
            }
            catch { /* ignore */ }
        }
        releaseProfile(dir);
        if (browser) {
            try {
                await browser.close();
            }
            catch { /* 忽略 */ }
            // ★ 2026-10-27：close 后兜底杀孤儿 chrome + 删锁，避免残留占用 Profile
            //   导致下次 launch 报指不到原因的 Failed to launch。
            try {
                const procClean = await import(toFileUrl(join(PLUGIN_ROOT_FOR_RISK, 'skills/_shared/pdd-proc-clean.mjs'))).catch(() => null);
                procClean?.cleanProfileForLaunch?.(dir, { quiet: true });
            }
            catch { /* ignore */ }
        }
    }
}
//# sourceMappingURL=pdd-crawl.js.map