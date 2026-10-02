"""淘宝适配器 —— 复用 market-analysis（MTOP 搜索）与 keyword-assistant（sycm 关联词）的数据链路。

字段映射：
  - 商品：MTOP 搜索接口 itemsArray → ProductItem
  - 关键词趋势：sycm 关联词拓展 → KeywordTrendItem
"""

from __future__ import annotations

import json
import random
import re
import time
from datetime import datetime, timedelta
from urllib.parse import quote

from .base import (
    AdapterError,
    CollectConstraints,
    KeywordTrendItem,
    NicheData,
    ProductItem,
)

# ─── runtime 引入（技能侧统一入口）───
import os
import sys

_dsagent_dir = os.path.join(os.environ.get("DSAGENT_SKILL_ROOT", ""), ".dsagent")
if _dsagent_dir and _dsagent_dir not in sys.path:
    sys.path.insert(0, _dsagent_dir)

from runtime.dsagent_runtime import http_get, mtop_jsonp, CallThrottle, call_json_with_retries  # noqa: E402
from runtime.dsagent_runtime import (  # noqa: E402
    FAILURE_RISK, FAILURE_TOKEN, FAILURE_PARSE, FAILURE_API, FAILURE_NOT_BOUND,
)
from runtime.dsagent_runtime import PlatformRequestError  # noqa: E402

# ─── 淘宝 MTOP 搜索接口常量（与 market-analysis 技能一致）───
PLATFORM = "taobao"
MTOP_APP_KEY = "12574478"
MTOP_API = "mtop.relationrecommend.wirelessrecommend.recommend"
MTOP_API_VERSION = "2.0"
MTOP_BASE_URL = "https://h5api.m.taobao.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# ─── sycm 关联词拓展接口常量（与 keyword-assistant 技能一致）───
SYCM_BASE_URL = "https://sycm.taobao.com"
KEYWORD_EXPAND_ENDPOINT = "/mc/rest/productSearchWord/relatedSearchWord.json"

# 节流：MTOP 4-6s / sycm 1.5-2.5s（对齐原技能的防风控节奏）
MTOP_THROTTLE = CallThrottle(min_interval=4.5, jitter=1.5)
SYCM_THROTTLE = CallThrottle(min_interval=1.8, jitter=0.7)

RISK_HINTS = ("RGV587", "FAIL_SYS_USER_ACCESS", "baxia", "punish", "滑块")
TOKEN_HINTS = ("FAIL_SYS_SESSION_EXPIRED", "FAIL_SYS_TOKEN_EMPTY", "未登录")


class TaobaoAdapter:
    """淘宝/天猫适配器：MTOP 搜索商品 + sycm 关联词拓展。"""

    platform = PLATFORM

    def __init__(self) -> None:
        # MTOP 搜索参数需要 myCNA；从绑定上下文取（缺省空串，平台会自行容错）
        self._cna = ""
        try:
            from runtime.dsagent_runtime import fetch_binding_context
            binding = fetch_binding_context(platform=PLATFORM)
            self._cna = str(binding.get("cna") or "")
        except Exception:  # noqa: BLE001 —— 取不到不阻塞（采集时平台会再校验）
            self._cna = ""

    def collect(self, keyword: str, c: CollectConstraints) -> NicheData:
        data = NicheData(platform=PLATFORM, keyword=keyword)
        data.collected_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        data.raw_meta["date_range"] = self._default_date_range()

        # 1) 关联词拓展（sycm，可选增强层）
        #    ★ sycm 与 taobao 是两套域会话，sycm 未登录很常见；
        #      此时降级为「只基于商品数据」分析，并在 data_gaps 里明确提示用户重新登录，
        #      绝不因可选层失败而让整个技能失败（商品层仍能支撑价格/竞争/标题分析）。
        try:
            data.keyword_trend = self._fetch_related_words(keyword, data.raw_meta["date_range"])
        except PlatformRequestError as e:
            kind = getattr(e, "failure_kind", "") or ""
            if kind == FAILURE_RISK:
                data.data_gaps.append(
                    f"关键词趋势被风控拦截（{e}）——建议先过验证再重试以补齐趋势层"
                )
            elif kind == FAILURE_TOKEN:
                data.data_gaps.append(
                    "生意参谋（sycm）会话未登录，关键词趋势层缺失——"
                    "请到「账号连接」重新登录淘宝账号以补齐该层；"
                    "本次分析仅基于商品数据（价格带/竞争/标题线索）"
                )
            else:
                data.data_gaps.append(
                    f"关键词趋势数据不可用（{e}），本次分析仅基于商品数据"
                )
        except Exception as e:  # noqa: BLE001
            data.data_gaps.append(
                f"关键词趋势采集异常（{e}），本次分析仅基于商品数据"
            )

        # 2) 商品搜索（MTOP）
        products = self._fetch_products(keyword, c)
        data.products = products

        # 3) 价格分布（计算数据）
        data.price_distribution = _price_distribution(products)

        if not products:
            raise AdapterError(FAILURE_API, f"关键词「{keyword}」未采集到商品数据")
        if not data.keyword_trend and not any("关键词趋势" in g for g in data.data_gaps):
            data.data_gaps.append("关键词趋势数据为空（sycm 返回 0 条关联词）")

        # 评价/投放层数据本期未启用（PDF 的痛点层依赖评价采集，较慢）
        data.data_gaps.append("评价数据未采集（痛点层本期未启用，痛点分析基于标题词频推断）")
        return data

    # ─── 内部实现 ───

    def _default_date_range(self) -> str:
        end = datetime.now() - timedelta(days=1)
        start = end - timedelta(days=7)
        return f"{start:%Y-%m-%d}|{end:%Y-%m-%d}"

    def _infer_date_type(self, date_range: str) -> str:
        return "recent30" if "recent30" in date_range else "recent7"

    def _fetch_related_words(self, keyword: str, date_range: str) -> list[KeywordTrendItem]:
        params = {
            "dateRange": date_range,
            "dateType": self._infer_date_type(date_range),
            "pageSize": 50,
            "page": 1,
            "order": "desc",
            "orderBy": "seIpvUvHits",
            "keyWord": keyword,
            "cycleFlag": "cycle",
            "rankType": "related",
            "device": "0",
            "marketVersion": "free",
        }
        SYCM_THROTTLE.wait()
        payload = http_get(
            f"{SYCM_BASE_URL}{KEYWORD_EXPAND_ENDPOINT}",
            platform=PLATFORM,
            params=params,
            headers={"Referer": "https://sycm.taobao.com/", "User-Agent": UA},
            timeout=30,
        )
        items = (payload.get("data") or {}).get("data") or []
        rows: list[KeywordTrendItem] = []
        for it in items:
            def _v(key: str) -> str:
                cell = it.get(key) or {}
                return str(cell.get("value", "") or "")
            rows.append(KeywordTrendItem(
                word=_v("relatedSekeyword"),
                search_popularity=_to_int(_v("seIpvUvHits")),
                popularity_change=_v("seIpvUvHits") and _cyc(it, "seIpvUvHits") or "",
                click_rate=_to_float(_v("clickThroughRate")),
                pay_conv_rate=_to_float(_v("payConvRate")),
                demand_supply_ratio=_to_float(_v("simWeight")),
                source="sycm 关联词拓展",
            ))
        return [r for r in rows if r.word]

    def _fetch_products(self, keyword: str, c: CollectConstraints) -> list[ProductItem]:
        page_size = 48
        max_pages = max(1, min(4, (c.item_limit + page_size - 1) // page_size))
        products: list[ProductItem] = []
        for page in range(1, max_pages + 1):
            if len(products) >= c.item_limit:
                break
            MTOP_THROTTLE.wait()
            payload = self._mtop_search(keyword, page, page_size, c)
            page_items, _total = _parse_search_products(payload, page)
            if not page_items:
                break
            products.extend(page_items)
            time.sleep(random.uniform(0.5, 1.0))
        # 去重（同商品多页出现）
        seen: set[str] = set()
        uniq: list[ProductItem] = []
        for p in products:
            key = _title_key(p.title)
            if key and key not in seen:
                seen.add(key)
                uniq.append(p)
        return uniq[:c.item_limit]

    def _mtop_search(self, keyword: str, page: int, page_size: int, c: CollectConstraints) -> dict:
        # ★ data 结构与 market-analysis 原技能一致：{appId, params:<搜索参数的 JSON 字符串>}
        #   params 内是搜索参数对象（含 q=URL编码关键词 / start_price 等）
        start_price = str(c.price_min) if c.price_min not in (None, 0) else None
        end_price = str(c.price_max) if c.price_max not in (None, 0) else None
        params = {
            "device": "HMA-AL00", "isBeta": "false", "grayHair": "false",
            "from": "nt_history", "brand": "HUAWEI", "info": "wifi", "index": "4",
            "rainbow": "", "schemaType": "auction", "elderHome": "false",
            "isEnterSrpSearch": "true", "newSearch": "false", "network": "wifi",
            "subtype": "", "hasPreposeFilter": "false", "prepositionVersion": "v2",
            "client_os": "Android", "gpsEnabled": "false", "searchDoorFrom": "srp",
            "debug_rerankNewOpenCard": "false", "homePageVersion": "v7",
            "searchElderHomeOpen": "false", "search_action": "initiative",
            "sugg": "_4_1", "sversion": "13.6", "style": "list",
            "ttid": "600000@taobao_pc_10.7.0", "needTabs": "true",
            "areaCode": "CN", "vm": "nw", "m": "pc", "n": page_size,
            "q": quote(keyword, safe=""), "page": page, "sort": "default",
            "loc": "", "qSource": "url", "pageSource": "a21bo.jianhua/a.201856.d13",
            "tab": "all", "pageSize": page_size, "totalPage": 100,
            "totalResults": 4800, "sourceS": "0", "bcoffset": "", "ntoffset": "",
            "filterTag": "", "service": "", "prop": "",
            "start_price": start_price, "end_price": end_price,
            "startPrice": start_price, "endPrice": end_price,
            "itemIds": None, "p4pIds": None, "p4pS": None, "categoryp": "",
            "ha3Kvpairs": None,
            # ★ myCNA / userAgent 是 MTOP params 校验的一部分（缺失会 FAIL_BIZ_PARAM_ERR）。
            #   myCNA 来自绑定上下文的 cna（与 market-analysis 技能一致）。
            "myCNA": self._cna,
            "userAgent": UA,
        }
        payload = {"appId": "34385", "params": json.dumps(params, ensure_ascii=False, separators=(",", ":"))}
        try:
            # ★ rate_limit 重试：MTOP 首次调用会返回 FAIL_SYS_TOKEN_EMPTY（token 引导响应），
            #   网关合并新 _m_h5_tk 后报 rate_limit —— 重试一次即成功。
            #   平台错误（risk/token）不重试，直接抛给上层归类。
            result = call_json_with_retries(
                lambda: mtop_jsonp(
                    f"{MTOP_BASE_URL}/h5/{MTOP_API}/{MTOP_API_VERSION}/",
                    platform=PLATFORM,
                    api=MTOP_API,
                    version=MTOP_API_VERSION,
                    data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                    extra_params={"timeout": "10000", "appKey": MTOP_APP_KEY},
                    timeout=30,
                ),
                max_retries=3,
                base_delay=1.5,
                retry_on=("rate_limit",),
            )
            if result.get("status") == "error":
                kind = result.get("failure_kind", FAILURE_API)
                raise AdapterError(kind, f"淘宝搜索失败：{result.get('error_message', '未知错误')}")
            return result
        except PlatformRequestError as e:
            raise self._classify_mtop_error(e) from e

    def _classify_mtop_error(self, e: PlatformRequestError) -> AdapterError:
        """把网关异常转成 AdapterError。

        ★ 优先采用网关给出的 failure_kind —— 网关已实现完整的归因
        （token 引导 / 风控 / 冷却 / 限流），字符串匹配只作兜底，
        否则会把 risk_control 误判成 api_error（模型因此不知道该过验证）。
        """
        kind = getattr(e, "failure_kind", "") or ""
        msg = str(e)
        if kind in (FAILURE_RISK, FAILURE_TOKEN, "rate_limit", "not_bound", "no_permission"):
            return AdapterError(kind, f"淘宝搜索失败：{msg}")
        # 网关未给出有效类型时的兜底归类
        if any(h in msg for h in RISK_HINTS) or "风控" in msg or "冷却" in msg:
            return AdapterError(FAILURE_RISK, f"淘宝搜索被风控：{msg}")
        if any(h in msg for h in TOKEN_HINTS) or "登录" in msg:
            return AdapterError(FAILURE_TOKEN, f"淘宝登录态失效：{msg}")
        return AdapterError(FAILURE_API, f"淘宝搜索请求失败：{msg}")


# ─── 解析与计算辅助 ───

def _cyc(item: dict, key: str) -> str:
    cell = item.get(key) or {}
    return str(cell.get("cycleCrc", "") or "")


def _to_int(v: str) -> int:
    m = re.match(r"^([\d.]+)(万|亿)?", re.sub(r"[^\d.万亿]", "", v or ""))
    if not m:
        return 0
    n = float(m.group(1))
    if m.group(2) == "万":
        n *= 10000
    elif m.group(2) == "亿":
        n *= 100000000
    return int(n)


def _to_float(v: str) -> float:
    try:
        return float(re.sub(r"[^\d.]", "", v or "") or 0)
    except ValueError:
        return 0.0


def _strip_html(v: str) -> str:
    return re.sub(r"<[^>]*>", "", v or "")


def _title_key(title: str) -> str:
    """标题去重键：去空格/标点后前 40 字符。"""
    t = re.sub(r"[\s\-_|·+！!，,。.．?？]", "", _strip_html(title))
    return t[:40]


def _parse_sales(text: str) -> int:
    return _to_int(text)


def _parse_search_products(payload: dict, page: int) -> tuple[list[ProductItem], int]:
    items = (
        (payload.get("data") or {}).get("itemsArray")
        or ((payload.get("data") or {}).get("data") or {}).get("itemsArray")
        or []
    )
    total = int((payload.get("data") or {}).get("totalResults") or 0)
    rows: list[ProductItem] = []
    for idx, it in enumerate(items, start=1):
        title = _strip_html(it.get("title") or "")
        price = _to_float(str(it.get("price") or it.get("realSales") or ""))
        # price 字段形态多样：price_wap / sold / price 层
        price_raw = (
            it.get("priceShow")
            or (it.get("price") if isinstance(it.get("price"), (int, float)) else None)
            or _to_float(it.get("priceWap") or "")
        )
        try:
            price_val = float(price_raw)
        except (TypeError, ValueError):
            price_val = 0.0
        rows.append(ProductItem(
            title=title,
            price=price_val,
            sales_count=_parse_sales(_strip_html(it.get("realSales") or it.get("sold") or "")),
            is_tmall=bool(it.get("isTmall") or "tmall" in str(it.get("icon") or "")),
            location=it.get("area") or it.get("loc") or "",
            page_rank=idx,
            shop_name=_strip_html(it.get("shopName") or ""),
        ))
    return rows, total


def _price_distribution(products: list[ProductItem]) -> dict:
    prices = sorted(p.price for p in products if p.price > 0)
    if not prices:
        return {"note": "无有效价格数据"}
    def pct(q: float) -> float:
        i = min(len(prices) - 1, max(0, int(len(prices) * q)))
        return prices[i]
    # 价格带众数区间：把价格按 10 的幂取整后统计
    bands: dict[str, int] = {}
    for p in prices:
        base = 10 ** len(str(int(p))) // 10 or 1
        lo = (int(p) // base) * base
        bands[f"{lo}-{lo + base}"] = bands.get(f"{lo}-{lo + base}", 0) + 1
    mode = max(bands.items(), key=lambda kv: kv[1])[0] if bands else ""
    return {
        "p10": pct(0.10), "p25": pct(0.25), "p50": pct(0.50),
        "p75": pct(0.75), "p90": pct(0.90),
        "min": prices[0], "max": prices[-1],
        "mode_band": mode, "sample": len(prices),
    }
