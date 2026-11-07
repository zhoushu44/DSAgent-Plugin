# -*- coding: utf-8 -*-
"""
按候选值确定性选值（照抄拼多多「规格池查表」的做法，但用类目 schema 的候选）

核心：抖店每个属性/规格都有固定候选，必须**从候选里选**，不能凭空写。
      本模块负责：给一个类目的 schema + 意图值 → 返回合法的候选对象。

选值策略（按优先级）：
    ① 意图值精确命中候选（归一化比较）
    ② 意图值包含于候选 / 候选包含于意图值
    ③ 数字全匹配（"250" → "250ML"）
    ④ 无意图值时用「推荐默认」：优先选候选列表第一个（平台通常把常用项排前）
"""
import re


def norm(s):
    if s is None:
        return ""
    t = str(s).strip()
    t = t.replace("（", "(").replace("）", ")").replace("，", ",")
    t = t.replace("～", "~").replace("－", "-").replace("—", "-")
    t = t.replace("℃", "c").replace("°", "")
    t = re.sub(r"\s+", "", t)
    return t.lower()


def pick_from_options(options, want, prefer_names=None):
    """
    options: [{"value_id","value_name"}, ...]
    返回 (选中的 option, 方式) 或 (None, 原因)
    """
    if not options:
        return None, "无候选"

    # 有偏好名单时先按名单挑（如品牌 → 无品牌）
    if prefer_names:
        for pn in prefer_names:
            for o in options:
                if norm(o.get("value_name")) == norm(pn):
                    return o, "prefer:%s" % pn

    if want in (None, ""):
        return options[0], "默认第一个"

    wn = norm(want)

    # ① 精确
    for o in options:
        if norm(o.get("value_name")) == wn:
            return o, "exact"

    # ② 包含
    for o in options:
        if wn and wn in norm(o.get("value_name")):
            return o, "contains"
    for o in options:
        cn = norm(o.get("value_name"))
        if cn and cn in wn:
            return o, "reverse-contains"

    # ③ 数字全匹配
    nums = re.findall(r"\d+", wn)
    if nums:
        for o in options:
            cn = norm(o.get("value_name"))
            if all(n in cn for n in nums):
                return o, "number"

    return None, "无匹配"


def pick_color(candidates, want):
    """
    颜色候选：candidates = [{"cpv_id","value","parent","pic"}]
    want 可以是 "白色" / "白" / "白色系/白色"
    """
    if not candidates:
        return None, "无颜色候选"
    if want in (None, ""):
        return candidates[0], "默认第一个"

    # 支持 "父/子"
    leaf_want = str(want).split("/")[-1].strip()
    wn = norm(leaf_want)

    for c in candidates:
        if norm(c.get("value")) == wn:
            return c, "exact"
    for c in candidates:
        if wn and wn in norm(c.get("value")):
            return c, "contains"
    for c in candidates:
        cn = norm(c.get("value"))
        if cn and cn in wn:
            return c, "reverse-contains"
    # 单字匹配（白 → 白色）
    if len(wn) == 1:
        for c in candidates:
            if norm(c.get("value")).startswith(wn):
                return c, "prefix"
    return None, "无匹配"


def build_spec_values(schema_slim, spec_intent):
    """
    根据 schema 的 specDims 生成合法的 spec_detail 值。

    spec_intent: [{"name": "颜色分类", "values": ["白色","红色"]},
                  {"name": "总容量", "values": ["250","350"]}]
    返回 (specs_for_patch, report)
      specs_for_patch 形态： [{"cp_id":..., "name":..., "spec_values":[{...}]}]
    """
    dims = schema_slim.get("specDims") or []
    out, report = [], {"dims": [], "failed": []}

    for i, intent in enumerate(spec_intent or []):
        # 找对应维度：先按 name，再按位置
        target = None
        nm = norm(intent.get("name"))
        for d in dims:
            if norm(d.get("name")) == nm:
                target = d
                break
        if target is None and i < len(dims):
            target = dims[i]
        if target is None:
            report["failed"].append({"spec": intent.get("name"), "why": "无对应维度"})
            continue

        kind = target.get("kind")
        values = intent.get("values") or []
        spec_values = []

        if kind == "select":
            cands = target.get("candidates") or []
            for v in values:
                c, how = pick_color(cands, v)
                if c is None:
                    report["failed"].append({"spec": target.get("name"), "value": v, "why": how})
                    continue
                # 写值：抖店 spec_values 用 cpv_id + value
                spec_values.append({
                    "cpv_id": c.get("cpv_id"),
                    "value": c.get("value"),
                    "cp_id": target.get("cp_id"),
                    "parent": c.get("parent"),
                })
        elif kind == "measure":
            # 数值 + 单位
            tpls = target.get("templates") or []
            tpl = tpls[0] if tpls else {}
            mods = tpl.get("modules") or []
            mod = mods[0] if mods else {}
            units = mod.get("units") or []
            # 优先 ml
            unit = next((u for u in units if str(u.get("label")).lower() == "ml"), None) \
                or (units[0] if units else None)
            for v in values:
                num = re.findall(r"[\d.]+", str(v))
                spec_values.append({
                    "value": num[0] if num else str(v),
                    "unit": unit.get("value") if unit else None,
                    "unit_label": unit.get("label") if unit else None,
                    "template_id": tpl.get("template_id"),
                    "module_id": mod.get("module_id"),
                })
        else:
            # unknown：原样写
            for v in values:
                spec_values.append({"value": str(v)})

        out.append({
            "cp_id": target.get("cp_id"),
            "name": target.get("name"),
            "spec_values": spec_values,
        })
        report["dims"].append({"name": target.get("name"), "kind": kind, "count": len(spec_values)})

    return out, report


def build_attribute_values(schema_slim, intent):
    """
    根据 schema 的 attrs 生成合法属性值。

    intent: {"适用温度": "-10℃~20℃", "品牌": "无品牌", ...}
    返回 (attrs_for_patch, report)
      attrs_for_patch: {attr_id: {"value_id","value_name","label"}}
    """
    PREFER = {
        "品牌": ["无品牌"],
    }
    out, report = {}, {"filled": [], "missing_required": [], "failed": []}

    for a in schema_slim.get("attrs") or []:
        label = a.get("label")
        if not label:
            continue
        required = a.get("required")
        want = intent.get(label)

        if want in (None, "") and not required:
            continue
        if want in (None, "") and required:
            # 必填但没给 → 用默认第一个（并记录）
            opts = a.get("options") or []
            if opts:
                o = opts[0]
                out[str(a.get("id"))] = {
                    "value_id": o.get("value_id"),
                    "value_name": o.get("value_name"),
                    "label": label,
                }
                report["filled"].append({"label": label, "value": o.get("value_name"),
                                          "how": "必填默认第一个"})
            else:
                report["missing_required"].append(label)
            continue

        opts = a.get("options") or []
        if not opts:
            # 自由输入（如导购短标题）→ 直接给字符串
            out[str(a.get("id"))] = {"value_id": None, "value_name": str(want), "label": label}
            report["filled"].append({"label": label, "value": want, "how": "自由输入"})
            continue

        prefer = PREFER.get(label)
        o, how = pick_from_options(opts, want, prefer_names=prefer)
        if o is None:
            report["failed"].append({"label": label, "want": want, "why": how,
                                      "sample": [x.get("value_name") for x in opts[:5]]})
            continue
        out[str(a.get("id"))] = {
            "value_id": o.get("value_id"),
            "value_name": o.get("value_name"),
            "label": label,
        }
        report["filled"].append({"label": label, "value": o.get("value_name"), "how": how})

    return out, report


if __name__ == "__main__":
    # 离线自检：用真实缓存的 glass cup schema
    import json
    import os
    p = os.path.join(os.path.expanduser("~"), "Desktop", "童装",
                     "artifacts", "douyin-schema", "1000010127.json")
    if not os.path.exists(p):
        print("找不到缓存:", p)
        raise SystemExit(1)
    slim = json.load(open(p, encoding="utf-8"))

    print("=== 属性选值 ===")
    intent = {
        "品牌": "无品牌",
        "适用温度": "-10℃~20℃",
        "材质": "玻璃",
        "容量": "100ML以下",
        "数量": "10个以上",
        "款式": "提绳款",
    }
    attrs, rep = build_attribute_values(slim, intent)
    for f in rep["filled"]:
        print("  ✅ %-10s = %-18s (%s)" % (f["label"], str(f["value"])[:18], f["how"]))
    for f in rep["failed"]:
        print("  ❌ %-10s want=%s %s %s" % (f["label"], f["want"], f["why"], f.get("sample")))
    for m in rep["missing_required"]:
        print("  ⚠️ 必填缺失: %s" % m)

    print("\n=== 规格选值 ===")
    spec_intent = [
        {"name": "颜色分类", "values": ["白色", "红色"]},
        {"name": "总容量", "values": ["250", "350"]},
    ]
    specs, srep = build_spec_values(slim, spec_intent)
    for d in srep["dims"]:
        print("  %-10s kind=%-8s 值数=%d" % (d["name"], d["kind"], d["count"]))
    for d in specs:
        print("    %s: %s" % (d["name"], json.dumps(d["spec_values"], ensure_ascii=False)[:250]))
    for f in srep["failed"]:
        print("  ❌ %s" % f)
