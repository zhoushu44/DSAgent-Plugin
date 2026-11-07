# -*- coding: utf-8 -*-
"""
类目 schema 按需抓取 + 本地缓存（前置模块）

设计（用户要求「用到再抓，抓了就存」）：
    调用 get_schema(cid) 时：
      ① 先查本地缓存  <workspace>/artifacts/douyin-schema/<cid>.json
      ② 命中 → 直接返回（毫秒级）
      ③ 未命中 → HTTP 抓取 → 写缓存 → 返回
      ④ 抓取失败 → 返回错误，不写缓存

缓存内容（精简版，只留上架要用的）：
    {
      "cid", "cachedAt", "source",
      "catName",
      "attrs": [ {id, label, required, options:[{value_id, value_name}], ui_type} ],
      "specDims": [ {cp_id, id, name, kind, candidates?} ],
      "skuColumns": [key...]
    }

用法：
    from schema_cache import SchemaCache
    sc = SchemaCache(cdp)                    # cdp = NativeCDP 实例（已连到 fxg 页面）
    schema = sc.get("1000010127")            # 自动 缓存/抓取
    full   = sc.get_full("1000010127")       # 要完整 model 时
"""
import json
import os
import time


DEFAULT_CACHE_DIR = os.path.join(
    os.path.expanduser("~"), "Desktop", "童装", "artifacts", "douyin-schema")


class SchemaCache:
    def __init__(self, cdp, cache_dir=None, log=None):
        self.cdp = cdp
        self.dir = cache_dir or DEFAULT_CACHE_DIR
        self.log = log or (lambda m: None)
        os.makedirs(self.dir, exist_ok=True)
        self.stats = {"hit": 0, "miss": 0, "fail": 0}

    # ─────────── 路径 ───────────
    def _path(self, cid):
        return os.path.join(self.dir, "%s.json" % str(cid))

    def _path_full(self, cid):
        return os.path.join(self.dir, "%s.full.json" % str(cid))

    # ─────────── 读取 ───────────
    def load(self, cid):
        """只读缓存，不抓"""
        p = self._path(cid)
        if not os.path.exists(p):
            return None
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def load_full(self, cid):
        p = self._path_full(cid)
        if not os.path.exists(p):
            return None
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    # ─────────── 抓取 ───────────
    def fetch(self, cid):
        """HTTP 抓 getSchema（页面内 fetch，带签名）"""
        cid_lit = json.dumps(str(cid))
        r = self.cdp.eval("""(async function(){
            var c = """ + cid_lit + """;
            try {
                const r = await fetch('/product/tproduct/getSchema?category_id=' + c, {credentials:'include'});
                const j = await r.json();
                return { st: j && j.st, msg: j && j.msg, data: (j && j.data) || null };
            } catch(e) { return { err: String(e).slice(0, 150) }; }
        })()""", await_promise=True, timeout=45)
        if not r:
            return None, "eval 返回空"
        if r.get("err"):
            return None, r["err"]
        if not r.get("data") or not r["data"].get("model"):
            return None, "st=%s msg=%s" % (r.get("st"), r.get("msg"))
        return r["data"], None

    # ─────────── 精简 ───────────
    @staticmethod
    def _slim(cid, full):
        """把完整 model 压成上架需要的精简结构"""
        m = full.get("model") or {}

        # 属性
        attrs = []
        for it in (m.get("category_properties") or {}).get("items") or []:
            if not isinstance(it, dict):
                continue
            opts = []
            for o in it.get("options") or []:
                if isinstance(o, dict):
                    opts.append({"value_id": o.get("value_id"), "value_name": o.get("value_name")})
                else:
                    opts.append({"value_id": None, "value_name": str(o)})
            attrs.append({
                "id": it.get("id"),
                "label": it.get("label"),
                "required": bool(it.get("required")),
                "options": opts,
                "ui_type": (it.get("additions") or {}).get("ui_type") or "",
                "prop_group": ((it.get("additions") or {}).get("prop_group") or {}).get("code") or "",
            })

        # 规格维度
        dims = []
        sd = m.get("spec_detail") or {}
        sd_items = sd.get("items") or []
        for d in sd.get("value") or []:
            if not isinstance(d, dict):
                continue
            item = {"cp_id": d.get("cp_id"), "id": d.get("id"), "name": d.get("name"),
                    "kind": "unknown", "candidates": []}
            # 找该维度的 additions
            # ★ 实证：cp_id/name 在 additions 里，不在 item 顶层
            for si in sd_items:
                a_ = si.get("additions") or {}
                si_cp = si.get("cp_id") if si.get("cp_id") is not None else a_.get("cp_id")
                si_id = si.get("id")
                match = (str(si_cp) == str(d.get("cp_id"))) or (str(si_id) == str(d.get("id")))
                if match:
                    a = a_
                    pv = a.get("property_values") or []
                    mt = a.get("measure_templates") or []
                    if pv:
                        item["kind"] = "select"
                        # 展平标准色（两级）
                        flat = []
                        for p in pv:
                            if isinstance(p, dict):
                                if p.get("children"):
                                    for c in p["children"]:
                                        flat.append({"cpv_id": c.get("cpv_id"), "value": c.get("value"),
                                                     "parent": p.get("value"),
                                                     "pic": c.get("pic_value")})
                                else:
                                    flat.append({"cpv_id": p.get("cpv_id"), "value": p.get("value"),
                                                 "parent": None, "pic": p.get("pic_value")})
                        item["candidates"] = flat
                    elif mt:
                        item["kind"] = "measure"
                        item["templates"] = [
                            {"template_id": t.get("template_id"),
                             "modules": [
                                 {"module_id": mo.get("module_id"),
                                  "units": [{"label": u.get("label"), "value": u.get("value")}
                                            for u in (mo.get("unit_options") or [])]}
                                 for mo in (t.get("value_modules") or [])]}
                            for t in mt if isinstance(t, dict)
                        ]
                    break
            dims.append(item)

        # SKU 列
        cols = []
        for c in (m.get("sku_detail") or {}).get("columns") or []:
            if isinstance(c, dict):
                cols.append({"key": c.get("key"), "required": bool(c.get("required"))})
            else:
                cols.append({"key": str(c), "required": False})

        return {
            "cid": str(cid),
            "cachedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source": "getSchema",
            "attrCount": len(attrs),
            "requiredCount": sum(1 for a in attrs if a["required"]),
            "specDimCount": len(dims),
            "attrs": attrs,
            "specDims": dims,
            "skuColumns": cols,
        }

    # ─────────── 主入口 ───────────
    def get(self, cid, force=False):
        """
        取精简 schema：缓存优先 → 未命中抓取 → 写缓存
        返回 (slim, err)
        """
        cid = str(cid)
        if not force:
            c = self.load(cid)
            if c:
                self.stats["hit"] += 1
                self.log("schema 缓存命中 %s（%s，%d 属性）" % (
                    cid, c.get("cachedAt"), c.get("attrCount", 0)))
                return c, None

        self.stats["miss"] += 1
        self.log("schema 未缓存，HTTP 抓取 %s" % cid)
        full, err = self.fetch(cid)
        if full is None:
            self.stats["fail"] += 1
            self.log("  抓取失败: %s" % err)
            return None, err

        slim = self._slim(cid, full)
        # 写两份：精简 + 完整
        try:
            with open(self._path(cid), "w", encoding="utf-8") as f:
                json.dump(slim, f, ensure_ascii=False, indent=2)
            with open(self._path_full(cid), "w", encoding="utf-8") as f:
                json.dump(full, f, ensure_ascii=False)
            self.log("  已缓存 %s（%d 属性 / %d 维度 / %d 列，精简 %d KB）" % (
                cid, slim["attrCount"], slim["specDimCount"], len(slim["skuColumns"]),
                os.path.getsize(self._path(cid)) // 1024))
        except Exception as e:
            self.log("  写缓存失败: %s" % str(e)[:80])
        return slim, None

    def get_full(self, cid, force=False):
        """取完整 model（改包要原样提交时用）"""
        cid = str(cid)
        if not force:
            f = self.load_full(cid)
            if f:
                return f, None
        full, err = self.fetch(cid)
        if full is None:
            return None, err
        try:
            with open(self._path_full(cid), "w", encoding="utf-8") as fh:
                json.dump(full, fh, ensure_ascii=False)
            with open(self._path(cid), "w", encoding="utf-8") as fh:
                json.dump(self._slim(cid, full), fh, ensure_ascii=False, indent=2)
        except Exception:
            pass
        return full, None

    # ─────────── 查询辅助 ───────────
    def required_attrs(self, cid):
        """返回必填属性列表（含候选）"""
        s, err = self.get(cid)
        if not s:
            return [], err
        return [a for a in s["attrs"] if a["required"]], None

    def list_cached(self):
        out = []
        for fn in sorted(os.listdir(self.dir)):
            if fn.endswith(".json") and not fn.endswith(".full.json"):
                p = os.path.join(self.dir, fn)
                try:
                    with open(p, encoding="utf-8") as f:
                        d = json.load(f)
                    out.append({
                        "cid": d.get("cid"), "cachedAt": d.get("cachedAt"),
                        "attrCount": d.get("attrCount"), "requiredCount": d.get("requiredCount"),
                        "specDimCount": d.get("specDimCount"),
                        "sizeKB": os.path.getsize(p) // 1024,
                    })
                except Exception:
                    continue
        return out
