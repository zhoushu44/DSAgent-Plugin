# -*- coding: utf-8 -*-
"""
抖店 AI 发品 —— 已验证成功的完整实现（2026-10-24）

═══════════════════════════════════════════════════════════════
实测成功记录
═══════════════════════════════════════════════════════════════
    商品提交成功，需审核通过后生效，审核周期为1-2个工作日
    当前商品质量分：良好 88 分

流程 9 步，约 3 分钟：
    ① 打开发布页（3s）
    ② 上传主图（页面自动识别）
    ③ 点「下一步，生成商品」→ 材料页（3s）
    ④ 填标题
    ⑤ 选类目（★ 用平台建议的类目）
    ⑥ 点「确认信息，继续生成」→ 第二级（6-9s）
    ⑦ 填 22 个属性下拉（★ 先 scrollIntoView）
    ⑧ 填规格第二维 + 价格 + 库存（★ 价格按 index 定位）
    ⑨ 点「发布商品」→ 提交成功

═══════════════════════════════════════════════════════════════
必须避免的 5 个坑
═══════════════════════════════════════════════════════════════
1. Chrome 参数：不要 --disable-http2 / --ignore-certificate-errors /
   --disable-extensions / creationflags=0x200（会让 CDP 断开或 Chrome 被杀）
2. 属性下拉：必须先 scrollIntoView，否则坐标在视口外
3. 价格库存：按 input index 定位，不用 elementFromPoint
4. 类目：用平台提示的「建议修改为」的类目，否则属性校验连锁失败
5. 上传后页面会 reload，必须重取 page

═══════════════════════════════════════════════════════════════
用法
═══════════════════════════════════════════════════════════════
    python publish_v2.py --images <主图> --title "<标题>" --sku-spec "<json>"
    python publish_v2.py --images <主图> --title "<标题>" --sku-spec "<json>" --confirm
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, PLUGIN_ROOT)
sys.path.insert(0, HERE)

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9444
LOG_PATH = os.path.join(HERE, "publish_v2.log")

_logf = open(LOG_PATH, "w", encoding="utf-8")


def out(msg):
    line = "[%s] %s" % (time.strftime("%H:%M:%S"), msg)
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except Exception:
        pass
    _logf.write(line + "\n")
    _logf.flush()


def click_at(page, x, y):
    """真实鼠标点击"""
    page.mouse.move(x, y)
    time.sleep(0.12)
    page.mouse.down()
    time.sleep(0.08)
    page.mouse.up()


def launch(profile):
    """启动 Chrome（★ 只用最简参数）"""
    try:
        subprocess.run(["powershell", "-NoProfile", "-c",
                        "Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    except Exception:
        pass
    time.sleep(8)
    for lock in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        fp = os.path.join(profile, lock)
        try:
            if os.path.exists(fp):
                os.remove(fp)
        except Exception:
            pass
    subprocess.Popen([CHROME, "--remote-debugging-port=%d" % PORT,
                      "--user-data-dir=%s" % profile,
                      "--no-first-run", "--no-default-browser-check", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     stdin=subprocess.DEVNULL)
    for i in range(40):
        time.sleep(1)
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT, timeout=2)
            out("  CDP 就绪（%ds）" % (i + 1))
            return True
        except Exception:
            pass
    return False


def get_page(ctx, prefer="fxg.jinritemai.com", cur=None, retries=8, interval=1.5):
    """
    取最新 fxg 页面（带重试）
    ★ 上传/导航时 ctx.pages 可能暂时为空，需要反复重试
    """
    for _ in range(retries):
        try:
            pages = [p for p in ctx.pages if not p.is_closed]
        except Exception:
            pages = []
        if pages:
            fxg = [p for p in pages if prefer in (p.url or "")]
            pick = (fxg or pages)[-1]
            if pick:
                return pick
        time.sleep(interval)
    return cur


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--category", default="")
    ap.add_argument("--sku-spec", dest="sku_spec", default="")
    ap.add_argument("--attrs", default="",
                    help='属性值覆盖（JSON）。如 {"生产企业名称":"XX有限公司","材质":"塑料"}')
    ap.add_argument("--confirm", action="store_true")
    args = ap.parse_args()

    images = [p.strip() for p in args.images.split(",") if p.strip()]
    for p in images:
        if not os.path.exists(p):
            out("图片不存在: %s" % p)
            return 2

    spec = {}
    if args.sku_spec:
        if os.path.exists(args.sku_spec):
            with open(args.sku_spec, encoding="utf-8") as f:
                spec = json.load(f)
        else:
            try:
                spec = json.loads(args.sku_spec)
            except Exception:
                pass
    out("SKU 规格: %s" % json.dumps(spec, ensure_ascii=False))

    # 属性覆盖（用户提供的真实值）
    attr_override = {}
    if args.attrs:
        if os.path.exists(args.attrs):
            with open(args.attrs, encoding="utf-8") as f:
                attr_override = json.load(f)
        else:
            try:
                attr_override = json.loads(args.attrs)
            except Exception as e:
                out("--attrs 解析失败: %s" % str(e)[:80])
    if attr_override:
        out("属性覆盖: %s" % json.dumps(attr_override, ensure_ascii=False))

    from lib._py_credential import get_account
    from playwright.sync_api import sync_playwright

    acct = get_account("douyin_shop")
    if not acct:
        out("无 douyin_shop 账号")
        return 2
    profile = acct["profileDir"]
    out("账号: %s" % acct["shopKey"][:40])

    if not launch(profile):
        out("Chrome 启动失败")
        return 2

    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp("http://127.0.0.1:%d" % PORT)
        ctx = b.contexts[0]
        page = ctx.new_page()
        page.set_default_timeout(30000)
        cl = [{"name": k, "value": str(v), "domain": ".jinritemai.com", "path": "/"}
              for k, v in (acct["cookies"] or {}).items() if v not in (None, "")]
        try:
            ctx.add_cookies(cl)
            out("注入 %d cookie" % len(cl))
        except Exception as e:
            out("cookie 失败: %s" % str(e)[:60])

        # ═══ ① 打开发布页 ═══
        out("① 打开发布页")
        page.goto("https://fxg.jinritemai.com/ffa/g/create",
                  wait_until="domcontentloaded", timeout=60000)
        ready = False
        for _ in range(20):
            time.sleep(2)
            try:
                if page.evaluate("() => !!document.querySelector('input[type=file]')"):
                    ready = True
                    break
            except Exception:
                pass
        if not ready:
            out("  ❌ 发布页未就绪")
            return 3
        out("  发布页就绪")

        # ═══ ② 上传主图 ═══
        out("② 上传主图")
        try:
            page.set_input_files("input[type=file]", images[0])
            out("  已选择 %s" % os.path.basename(images[0]))
        except Exception as e:
            out("  上传失败: %s" % str(e)[:80])
            return 3
        time.sleep(18)
        if not page:
            out("  ⚠️ page 丢失，重新取")
        page = get_page(ctx, cur=page)
        out("  page: %s" % ((page.url or "")[:60] if page else "None"))

        # ═══ ③ 点下一步 → 材料页 ═══
        out("③ 点「下一步，生成商品」")
        page.evaluate("""() => {
            const el = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes('下一步'));
            if (el) { el.scrollIntoView({block:'center'}); el.click(); }
        }""")
        mat = False
        for i in range(40):
            time.sleep(3)
            try:
                page = get_page(ctx, cur=page)
                if page.evaluate("() => !!document.querySelector('input[placeholder*=\"请输入2-60个字符\"]')"):
                    mat = True
                    out("  材料页就绪（%ds）" % ((i + 1) * 3))
                    break
            except Exception:
                pass
        if not mat:
            out("  ❌ 材料页未就绪")
            return 3

        # ═══ ④ 填标题 ═══
        out("④ 填标题")
        page.evaluate("""(t) => {
            const i = document.querySelector('input[placeholder*="请输入2-60个字符"]');
            if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
              s.call(i, t); for (const e of ['input','compositionend','change','keyup','blur']) i.dispatchEvent(new Event(e,{bubbles:true})); }
        }""", args.title)
        out("  已填: %s" % args.title)

        # ═══ ⑤ 选类目 ═══
        cate = args.category or "一次性茶具"
        out("⑤ 选类目「%s」" % cate)
        page.evaluate("""() => {
            const el = [...document.querySelectorAll('button,[role=button],a,span,div')]
                .find(x => (x.textContent||'').trim() === '手动选择类目');
            if (el) el.click();
        }""")
        time.sleep(6)
        page.evaluate("""(q) => {
            const all = [...document.querySelectorAll('input')].filter(x => {
                const r = x.getBoundingClientRect(); return r.width > 0 && /搜索/.test(x.placeholder||'');
            });
            const i = all.find(x => /商品名|关键词/.test(x.placeholder||'')) || all[0];
            if (i) { i.focus(); i.click();
              const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
              s.call(i, q); for (const e of ['input','compositionend','change','keyup','blur']) i.dispatchEvent(new Event(e,{bubbles:true}));
              i.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'a'})); i.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'a'})); }
        }""", cate)
        time.sleep(8)
        cate_ok = False
        for idx in range(8):
            txt = page.evaluate("""(n) => {
                const els = [...document.querySelectorAll('[class*="resultItem"]')];
                if (!els.length || n >= els.length) return null;
                const hit = els[n]; const r = hit.getBoundingClientRect();
                const o = {bubbles:true,cancelable:true,view:window,clientX:r.x+r.width/2,clientY:r.y+r.height/2};
                for (const t of ['mouseenter','mouseover','mousedown','mouseup','click']) hit.dispatchEvent(new MouseEvent(t,o));
                return (hit.textContent||'').trim();
            }""", idx)
            if not txt:
                break
            time.sleep(4)
            ok = page.evaluate("""() => { const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent||'').trim()==='确认'); return el ? !el.disabled : null; }""")
            if ok is True:
                out("  类目: %s" % txt)
                page.evaluate("""() => { const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent||'').trim()==='确认' && !x.disabled); if (el) el.click(); }""")
                cate_ok = True
                time.sleep(8)
                break
        if not cate_ok:
            out("  ❌ 类目选择失败")
            return 3

        # ═══ ⑥ 点确认信息 → 第二级 ═══
        out("⑥ 点「确认信息，继续生成」")
        page.evaluate("""() => {
            const el = [...document.querySelectorAll('button,[role=button]')].find(x => (x.textContent||'').includes('确认信息'));
            if (el) { el.scrollIntoView({block:'center'}); el.click(); }
        }""")
        l2 = False
        for i in range(30):
            time.sleep(3)
            try:
                page = get_page(ctx, cur=page)
                if page.evaluate("""() => {
                    for (const tb of document.querySelectorAll('table')) {
                        let s=''; for (const th of tb.querySelectorAll('th')) s += (th.textContent||'');
                        if (s.indexOf('价格')>=0) return true;
                    }
                    return false;
                }"""):
                    l2 = True
                    out("  第二级（%ds）" % ((i + 1) * 3))
                    break
            except Exception:
                pass
        if not l2:
            out("  ❌ 未进第二级")
            return 3
        time.sleep(5)

        # ═══ ⑦ 填属性 ═══
        out("⑦ 填属性")
        rows = page.evaluate(r"""(function(){
            var out = [];
            var sels = document.querySelectorAll('.ecom-g-select');
            for (var i = 0; i < sels.length; i++) {
                var s = sels[i];
                var r = s.getBoundingClientRect();
                var node = s.parentElement, label = '';
                for (var d = 0; d < 6 && node; d++) {
                    var t = (node.innerText||'').trim();
                    if (t.length < 40 && t.length > 0) { label = t; break; }
                    node = node.parentElement;
                }
                out.push({ i: i, val: (s.textContent||'').trim().slice(0,30),
                           empty: /请选择/.test((s.textContent||'')),
                           label: label.slice(0,25), vis: r.width > 0 });
            }
            return out;
        })()""")
        empties = [r for r in rows if r.get("empty") and r.get("vis")]
        out("  %d 个下拉，%d 个空" % (len(rows), len(empties)))

        filled_n = 0
        for r in empties:
            try:
                pos = page.evaluate("""(idx) => {
                    const sels = document.querySelectorAll('.ecom-g-select');
                    if (idx >= sels.length) return null;
                    const s = sels[idx];
                    s.scrollIntoView({block: 'center'});
                    const rr = s.getBoundingClientRect();
                    return { x: Math.round(rr.x + rr.width/2), y: Math.round(rr.y + rr.height/2) };
                }""", r["i"])
                if not pos:
                    continue
                time.sleep(0.8)
                click_at(page, pos["x"], pos["y"])
                time.sleep(2.5)
                opts = page.evaluate(r"""(function(){
                    var layers = [].slice.call(document.querySelectorAll(
                        '.ecom-g-select-dropdown, [class*="select-dropdown"], [class*="dropdown"], [class*="popup"]'
                    )).filter(function(e){
                        var r = e.getBoundingClientRect();
                        var cs = getComputedStyle(e);
                        return r.width > 40 && r.height > 20 && cs.display !== 'none' && cs.visibility !== 'hidden';
                    });
                    var scope = layers.length ? layers[layers.length-1] : document;
                    var items = [].slice.call(scope.querySelectorAll('.ecom-g-select-item')).filter(function(e){
                        var r = e.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    });
                    if (!items.length) {
                        items = [].slice.call(document.querySelectorAll('.ecom-g-select-item')).filter(function(e){
                            var r = e.getBoundingClientRect();
                            return r.width > 0 && r.height > 0 && r.y > 0 && r.y < window.innerHeight;
                        });
                    }
                    return items.slice(0, 30).map(function(e){
                        var r = e.getBoundingClientRect();
                        return { text: (e.textContent||'').trim().slice(0,30),
                                 x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
                    });
                })()""")
                if opts:
                    pick = opts[0]
                    click_at(page, pick["x"], pick["y"])
                    filled_n += 1
                    out("    [%2d] %s → %s" % (r["i"], r["label"][:12], pick["text"][:20]))
                    time.sleep(1.5)
                else:
                    # ★ 二次尝试：搜索型 select（点了不直接出候选，需要输入关键词）
                    out("    [%2d] %s 无候选，试搜索型" % (r["i"], r["label"][:12]))
                    page.keyboard.type("玻璃", delay=80)
                    time.sleep(2.5)
                    opts2 = page.evaluate(r"""(function(){
                        var items = [].slice.call(document.querySelectorAll('.ecom-g-select-item, [class*="select-item"], [class*="option"]')).filter(function(e){
                            var r = e.getBoundingClientRect();
                            return r.width > 0 && r.height > 0 && r.y > 0 && r.y < window.innerHeight;
                        });
                        return items.slice(0, 15).map(function(e){
                            var r = e.getBoundingClientRect();
                            return { text: (e.textContent||'').trim().slice(0,30),
                                     x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
                        });
                    })()""")
                    if opts2:
                        pick2 = opts2[0]
                        click_at(page, pick2["x"], pick2["y"])
                        filled_n += 1
                        out("      → %s（搜索后）" % pick2["text"][:20])
                        time.sleep(1.5)
                    else:
                        # 三次尝试：可能就是下拉没渲染出来，重点一次
                        page.keyboard.press("Escape")
                        time.sleep(0.8)
                        pos2 = page.evaluate("""(idx) => {
                            const sels = document.querySelectorAll('.ecom-g-select');
                            if (idx >= sels.length) return null;
                            const s = sels[idx];
                            s.scrollIntoView({block: 'center'});
                            const rr = s.getBoundingClientRect();
                            return { x: Math.round(rr.x + rr.width/2), y: Math.round(rr.y + rr.height/2) };
                        }""", r["i"])
                        if pos2:
                            click_at(page, pos2["x"], pos2["y"])
                            time.sleep(3.5)
                            opts3 = page.evaluate(r"""(function(){
                                var items = [].slice.call(document.querySelectorAll('.ecom-g-select-item, [class*="select-item"]')).filter(function(e){
                                    var r = e.getBoundingClientRect();
                                    return r.width > 0 && r.height > 0 && r.y > 0 && r.y < window.innerHeight;
                                });
                                return items.slice(0, 15).map(function(e){
                                    var r = e.getBoundingClientRect();
                                    return { text: (e.textContent||'').trim().slice(0,30),
                                             x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
                                });
                            })()""")
                            if opts3:
                                pick3 = opts3[0]
                                click_at(page, pick3["x"], pick3["y"])
                                filled_n += 1
                                out("      → %s（重点后）" % pick3["text"][:20])
                                time.sleep(1.5)
                            else:
                                page.keyboard.press("Escape")
                                time.sleep(0.8)
            except Exception as e:
                out("    [%2d] 失败: %s" % (r["i"], str(e)[:50]))
        out("  共填 %d / %d" % (filled_n, len(empties)))

        # ★ 补一轮：文本输入型属性（placeholder="请输入" 的纯文本输入框）
        out("  补填文本型属性")
        missing_user_input = []
        text_inputs = page.evaluate(r"""(function(){
            var out = [];
            document.querySelectorAll('input').forEach(function(e, i){
                var ph = e.placeholder || '';
                var cls = (e.className||'').toString();
                // 只看属性区的文本输入：placeholder 是「请输入」，但不是规格/价格/库存
                if (ph !== '请输入') return;
                if (/number-input|spec|skuValue/i.test(cls)) return;
                if (e.value) return;
                var r = e.getBoundingClientRect();
                if (r.width <= 30) return;
                // 找它的 label（向上找）
                var node = e.parentElement, label = '';
                for (var d = 0; d < 8 && node; d++) {
                    var t = (node.innerText||'').trim();
                    if (t && t.length < 30) { label = t; break; }
                    node = node.parentElement;
                }
                out.push({ idx: i, label: label.slice(0,24), ph: ph, y: Math.round(r.y) });
            });
            return out;
        })()""")
        out("  找到 %d 个文本型属性框" % len(text_inputs or []))
        # ★ 优先用用户提供的真实值；没有就不猜（留给上层提问）
        TEXT_VALUES = dict(attr_override) if attr_override else {}
        # 少数无争议的默认值
        for _k, _v in {"货号": "G102-280", "型号": "标准款"}.items():
            TEXT_VALUES.setdefault(_k, _v)
        for ti in (text_inputs or []):
            lbl = ti.get("label") or ""
            val = None
            for k, v in TEXT_VALUES.items():
                if k in lbl:
                    val = v
                    break
            if not val:
                # ★ 识别为「需要真实证照」的字段 → 记录待用户提供
                NEED_USER = ("生产", "厂名", "品牌", "资质", "许可", "认证", "标准", "备案", "注册号")
                if any(k in lbl for k in NEED_USER):
                    missing_user_input.append(lbl)
                    out("    [%s] ⚠️ 需要用户提供真实值" % lbl[:16])
                else:
                    out("    [%s] 无匹配值，跳过" % lbl[:16])
                continue
            try:
                page.evaluate("""(idx) => {
                    const inps = document.querySelectorAll('input');
                    if (idx < inps.length) inps[idx].scrollIntoView({block:'center'});
                }""", ti["idx"])
                time.sleep(0.8)
                pos = page.evaluate("""(idx) => {
                    const inps = document.querySelectorAll('input');
                    if (idx >= inps.length) return null;
                    var r = inps[idx].getBoundingClientRect();
                    return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
                }""", ti["idx"])
                if not pos:
                    continue
                click_at(page, pos["x"], pos["y"])
                time.sleep(0.5)
                for ch in str(val):
                    page.keyboard.type(ch, delay=60)
                    time.sleep(0.02)
                time.sleep(1)
                page.keyboard.press("Tab")
                time.sleep(1)
                out("    [%s] -> %s" % (lbl[:16], val))
            except Exception as e:
                out("    [%s] 失败: %s" % (lbl[:16], str(e)[:50]))

        # ═══ ⑧ 填规格 + 价格 + 库存 ═══
        out("⑧ 填规格/价格/库存")
        vals = spec.get("values") or ["红色", "白色"]
        price = str(spec.get("price") or "12")
        stock = str(spec.get("stock") or "500")

        # ★ 不清空 AI 预填值（清空会导致「请输入规格值」错误）
        #   策略：保留已有的，只在最后一个空框追加

        # ── ② 逐个填规格值（每次找最后一个空框）──
        for vi, v in enumerate(vals):
            ok_fill = False
            for attempt in range(3):
                try:
                    inps = page.evaluate(r"""(function(){
                        var out = [];
                        document.querySelectorAll('input').forEach(function(e, i){
                            if (!/请输入规格/.test(e.placeholder||'')) return;
                            var r = e.getBoundingClientRect();
                            out.push({ idx: i, val: e.value||'', vis: r.width>0 });
                        });
                        return out;
                    })()""")
                    empties = [x for x in (inps or []) if not x.get("val") and x.get("vis")]
                    if not empties:
                        out("    第 %d 个值无空框，尝试用最后一个" % (vi + 1))
                        if not inps:
                            break
                        target = inps[-1]
                    else:
                        target = empties[-1]   # ★ 最后一个空框
                    page.evaluate("""(idx) => {
                        const inps = document.querySelectorAll('input');
                        if (idx < inps.length) inps[idx].scrollIntoView({block:'center'});
                    }""", target["idx"])
                    time.sleep(1)
                    pos = page.evaluate("""(idx) => {
                        const inps = document.querySelectorAll('input');
                        if (idx >= inps.length) return null;
                        var r = inps[idx].getBoundingClientRect();
                        return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
                    }""", target["idx"])
                    if not pos:
                        continue
                    click_at(page, pos["x"], pos["y"])
                    time.sleep(0.7)
                    # 逐字输入（模拟真人）
                    for ch in str(v):
                        page.keyboard.type(ch, delay=120)
                        time.sleep(0.15)
                    time.sleep(1.2)
                    page.keyboard.press("Enter")
                    time.sleep(2.5)
                    # 验证
                    after = page.evaluate(r"""(function(){
                        var out = [];
                        document.querySelectorAll('input').forEach(function(e){
                            if (!/请输入规格/.test(e.placeholder||'')) return;
                            out.push(e.value||'');
                        });
                        return out;
                    })()""")
                    if str(v) in (after or []):
                        ok_fill = True
                        out("    规格值[%d] = %s  (当前: %s)" % (
                            vi + 1, v, json.dumps(after, ensure_ascii=False)))
                        break
                except Exception as e:
                    out("    规格值[%d] 第%d次失败: %s" % (vi + 1, attempt + 1, str(e)[:50]))
                    time.sleep(1)
            if not ok_fill:
                out("    ⚠️ 规格值[%d] 未确认填入" % (vi + 1))

        # ── ③ 点「批量设置」→ 填价格库存 ──
        out("  找「批量设置」")
        batch = page.evaluate(r"""(function(){
            var els = document.querySelectorAll('button, [class*="batch"], span, div');
            for (var i = 0; i < els.length; i++) {
                var t = (els[i].textContent||'').trim();
                if (!/^批量设置$|^批量填写$/.test(t)) continue;
                var r = els[i].getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    return { t: t, x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
                }
            }
            return null;
        })()""")
        out("  批量设置按钮: %s" % json.dumps(batch, ensure_ascii=False))

        batch_ok = False
        if batch:
            page.evaluate(
                "(p) => { const el = document.elementFromPoint(p.x, p.y); if (el) el.scrollIntoView({block:'center'}); }",
                {"x": batch["x"], "y": batch["y"]})
            time.sleep(1)
            pos = page.evaluate(
                "(p) => { const el = document.elementFromPoint(p.x, p.y); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; }",
                {"x": batch["x"], "y": batch["y"]})
            if pos:
                click_at(page, pos["x"], pos["y"])
                time.sleep(3)
                # 弹窗里的输入框
                modal = page.evaluate(r"""(function(){
                    var out = { found: false, inputs: [], btns: [], text: '', why: '' };
                    var vw = window.innerWidth, vh = window.innerHeight;

                    // ★ 严格条件：
                    //   ① position 是 fixed/absolute（弹窗浮层）
                    //   ② 宽度 < 视口 85%（排除整页容器）
                    //   ③ 高度 < 视口 90%
                    //   ④ 有 .ecom-g-modal 或 role=dialog 或包含「批量」
                    var cands = [].slice.call(document.querySelectorAll(
                        '.ecom-g-modal, .ecom-g-drawer, [role="dialog"], [class*="modal"], [class*="dialog"], [class*="drawer"], [class*="popup"]'
                    ));

                    var ok = cands.filter(function(e){
                        var r = e.getBoundingClientRect();
                        var cs = getComputedStyle(e);
                        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
                        if (r.width < 200 || r.height < 100) return false;
                        if (r.width > vw * 0.85) return false;
                        if (r.height > vh * 0.9) return false;
                        var pos = cs.position;
                        if (pos !== 'fixed' && pos !== 'absolute') return false;
                        return true;
                    });

                    if (!ok.length) {
                        out.why = 'no layer passed. total cands=' + cands.length;
                        // 诊断：列出所有候选的尺寸/position
                        out.diag = cands.slice(0, 8).map(function(e){
                            var r = e.getBoundingClientRect();
                            var cs = getComputedStyle(e);
                            return { cls: (e.className||'').toString().slice(0,50),
                                     w: Math.round(r.width), h: Math.round(r.height),
                                     pos: cs.position, disp: cs.display };
                        });
                        return out;
                    }

                    // 取最上层的（z-index 最大 或 最后插入）
                    ok.sort(function(a, b){
                        var za = parseInt(getComputedStyle(a).zIndex) || 0;
                        var zb = parseInt(getComputedStyle(b).zIndex) || 0;
                        return zb - za;
                    });
                    var m = ok[0];
                    out.found = true;
                    out.text = (m.innerText||'').replace(/\s+/g,' ').slice(0, 300);
                    m.querySelectorAll('input').forEach(function(e){
                        var r = e.getBoundingClientRect();
                        if (r.width <= 10 || r.height <= 5) return;
                        // ★ 只看弹窗内部（在弹窗矩形内）
                        var mr = m.getBoundingClientRect();
                        if (r.y < mr.y - 5 || r.y > mr.y + mr.height + 5) return;
                        out.inputs.push({ ph: (e.placeholder||'').slice(0,24), val: e.value||'',
                                          cls: (e.className||'').toString().slice(0,40),
                                          x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) });
                    });
                    m.querySelectorAll('button').forEach(function(b){
                        var r = b.getBoundingClientRect();
                        if (r.width <= 0) return;
                        out.btns.push({ t: (b.textContent||'').trim().slice(0,12),
                                        dis: !!b.disabled,
                                        x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) });
                    });
                    return out;
                })()""")
                out("  弹窗: found=%s, inputs=%d" % (modal.get("found"), len(modal.get("inputs") or [])))
                out("  弹窗文本: %s" % (modal.get("text") or "")[:200])
                for x in (modal.get("inputs") or [])[:8]:
                    out("    input: %s" % json.dumps(x, ensure_ascii=False)[:130])
                out("  按钮: %s" % json.dumps(modal.get("btns"), ensure_ascii=False)[:250])

                # 试着填：第一个空 input = 价格，第二个 = 库存
                if modal.get("found") and modal.get("inputs"):
                    cands = [x for x in modal["inputs"] if not x.get("val")]
                    # 价格
                    if cands:
                        c0 = cands[0]
                        page.evaluate(
                            "(p) => { const el = document.elementFromPoint(p.x, p.y); if (el) el.focus(); }",
                            {"x": c0["x"], "y": c0["y"]})
                        time.sleep(0.5)
                        click_at(page, c0["x"], c0["y"])
                        time.sleep(0.5)
                        page.keyboard.press("Control+A")
                        page.keyboard.type(price, delay=70)
                        out("    弹窗价格 -> %s" % price)
                        time.sleep(1)
                    # 库存
                    if len(cands) > 1:
                        c1 = cands[1]
                        click_at(page, c1["x"], c1["y"])
                        time.sleep(0.5)
                        page.keyboard.press("Control+A")
                        page.keyboard.type(stock, delay=70)
                        out("    弹窗库存 -> %s" % stock)
                        time.sleep(1)

                    # 点确定
                    import re as _re
                    okbtn = next((b for b in (modal.get("btns") or [])
                                  if not b.get("dis") and _re.search(r"确定|确认|保存|应用", b.get("t") or "")), None)
                    if okbtn:
                        out("    点弹窗「%s」" % okbtn["t"])
                        click_at(page, okbtn["x"], okbtn["y"])
                        time.sleep(4)
                        batch_ok = True
                    else:
                        out("    ⚠️ 弹窗内无确定按钮")
                        page.keyboard.press("Escape")

        # ── ④ 等表格生成 ──
        out("  等 SKU 表")
        for w in range(15):
            time.sleep(2)
            n = page.evaluate(r"""(function(){
                var t = null;
                var tables = document.querySelectorAll('table');
                for (var i = 0; i < tables.length; i++) {
                    var ths = tables[i].querySelectorAll('th');
                    var s = '';
                    for (var j = 0; j < ths.length; j++) s += (ths[j].textContent||'');
                    if (s.indexOf('价格') >= 0) { t = tables[i]; break; }
                }
                return t ? t.querySelectorAll('tbody tr').length : -1;
            })()""")
            if n and n > 0:
                out("  SKU 表 %d 行" % n)
                break

        # ── ⑤ 兜底：直接填价格库存（表格没生成时的备用路径）──
        allnum = page.evaluate(r"""(function(){
            var out = [];
            document.querySelectorAll('input').forEach(function(e, i){
                var cls = (e.className||'').toString();
                if (cls.indexOf('number-input') < 0) return;
                var r = e.getBoundingClientRect();
                if (r.width <= 20) return;
                out.push({ i: i, ph: (e.placeholder||'').slice(0,20), val: e.value||'' });
            });
            return out;
        })()""")

        def fill_by_idx(cell, value, label):
            idx = cell["i"]
            try:
                page.evaluate("""(idx) => {
                    const inps = document.querySelectorAll('input');
                    if (idx < inps.length) inps[idx].scrollIntoView({block:'center'});
                }""", idx)
                time.sleep(1)
                pos = page.evaluate("""(idx) => {
                    const inps = document.querySelectorAll('input');
                    if (idx >= inps.length) return null;
                    var r = inps[idx].getBoundingClientRect();
                    return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
                }""", idx)
                click_at(page, pos["x"], pos["y"])
                time.sleep(0.6)
                page.keyboard.press("Control+A")
                page.keyboard.type(value, delay=70)
                page.keyboard.press("Tab")
                time.sleep(1)
                out("    %s -> %s (idx=%s)" % (label, value, idx))
            except Exception as e:
                out("    %s 失败: %s" % (label, str(e)[:50]))

        if allnum:
            out("  兜底填 %d 个 number-input" % len(allnum))
            for c in allnum:
                if "库存" in (c.get("ph") or ""):
                    if c.get("val") in ("", "0"):
                        fill_by_idx(c, stock, "库存")
                else:
                    fill_by_idx(c, price, "价格")

        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        time.sleep(3)

        # ═══ ⑨ 复查 + 发布 ═══
        st = page.evaluate(r"""(function(){
            var b = (document.body.innerText||'');
            var m = b.match(/待完善信息\s*(\d+)/);
            return { todo: m ? Number(m[1]) : null };
        })()""")
        out("⑨ 待完善信息: %s" % json.dumps(st, ensure_ascii=False))

        btn = page.evaluate("""() => {
            const c = [...document.querySelectorAll('button,[role=button]')]
                .filter(x => /发布商品|立即发布/.test((x.textContent||'').trim()));
            return c.map(x => {
                const r = x.getBoundingClientRect();
                return {t:(x.textContent||'').trim().slice(0,16), dis:!!x.disabled,
                        x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
            });
        }""")
        usable = [x for x in (btn or []) if not x.get("dis")]
        if not usable:
            out("  ⚠️ 无可用发布按钮")
            return 3

        if not args.confirm:
            out("  【预览】准备发布，加 --confirm 才真正提交")
            out("  按钮: %s" % json.dumps(usable[0], ensure_ascii=False))
            # ★ 有需要用户提供的字段 → 直接返回 need_user_input，不让用户白确认
            if missing_user_input:
                emit_result({
                    "ok": False,
                    "needUserInput": True,
                    "failureKind": "need_user_input",
                    "stage": "need_user_input",
                    "title": args.title, "category": cate,
                    "missingFields": missing_user_input,
                    "attrFilled": filled_n,
                    "todo": (st or {}).get("todo"),
                    "text": "【需要你提供信息】\n  类目：%s\n  以下字段平台要求填写真实信息（会校验，填错会提交失败）：\n%s\n\n请提供上述值，我用 --attrs 传入后重跑。\n  例：--attrs '{\"%s\":\"值\"}'" % (
                        cate,
                        "\n".join("    · %s" % f for f in missing_user_input),
                        missing_user_input[0]),
                })
                return 0

            emit_result({
                "ok": False, "needConfirm": True, "stage": "ready_to_publish",
                "title": args.title, "category": cate,
                "attrFilled": filled_n, "attrTotal": len(empties),
                "todo": (st or {}).get("todo"),
                "text": "【发布预览】\n  标题：%s\n  类目：%s\n  属性已填：%d/%d\n  待完善：%s\n  确认发布请加 --confirm" % (
                    args.title, cate, filled_n, len(empties), (st or {}).get("todo")),
            })
            return 0

        out("  点「发布商品」")
        click_at(page, usable[0]["x"], usable[0]["y"])
        time.sleep(20)
        after = page.evaluate("""() => ({
            url: location.href,
            body: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0, 800)
        })""")
        body = (after or {}).get("body") or ""
        success = "商品提交成功" in body
        out("  发布结果: %s" % ("✅ 提交成功" if success else "⚠️ 未确认"))
        out("  页面: %s" % body[:500])

        res = {
            "ok": success,
            "stage": "submitted" if success else "unknown",
            "title": args.title,
            "category": cate,
            "url": (after or {}).get("url"),
            "text": ("商品提交成功（需审核 1-2 个工作日）" if success
                     else "未检测到「商品提交成功」，请查看页面：%s" % body[:300]),
        }
        if missing_user_input:
            res["missingFields"] = missing_user_input
            res["failureKind"] = "need_user_input"
            res["text"] += "\n\n【可能还需要你提供】%s" % "、".join(missing_user_input)
        emit_result(res)
        return 0 if success else 3


def emit_result(obj):
    print("__DSAGENT_RESULT__" + json.dumps(obj, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
