"""SKU 明细采集 — 走淘宝基座（Node 纯自签），不走 Host 网关。

为什么不用网关：
    详情接口响应约 300KB，Host 网关（platform_client.proxy）转发必超时；
    而基座 `skills/_shared/taobao-request.mjs` 用凭证库 Cookie 直接 md5 自签，
    实测 792ms/商品稳定 SUCCESS（见 verify-taobao-base.mjs）。

所以 Python 侧只做「编排 + 落盘」：把 itemId 列表交给 Node 脚本，
拿回 JSON 后写 CSV，并把原始 payload 抽样留档。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .csv_exporter import export_sku_csv

if TYPE_CHECKING:
    from .types import SearchProduct

_SKILL_DIR = Path(__file__).resolve().parent.parent
_RUNNER = _SKILL_DIR / "scripts" / "run-sku.mjs"


def _find_node() -> str:
    for name in ("node", "node.exe"):
        path = shutil.which(name)
        if path:
            return path
    return ""


def _plugin_root() -> Path:
    """skills/market-analysis → 插件根（含 lib/ 和 skills/_shared/）"""
    return _SKILL_DIR.parent.parent


def collect_sku_details(
    products: list["SearchProduct"],
    *,
    limit: int,
    output_dir: Path,
    keyword: str,
    timestamp: str,
    account: str = "",
    interval_ms: int = 1200,
    timeout_sec: int = 900,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], str]:
    """采购 SKU 明细。返回 (rows, errors, summary, csv_path)。"""
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    summary: dict[str, Any] = {}
    csv_path = ""

    node = _find_node()
    if not node:
        return rows, [{"item_id": "", "error": "找不到 node，可执行文件不可用"}], summary, csv_path

    targets = list(products)[: max(1, limit)]
    item_ids = [p.item_id for p in targets if p.item_id]
    if not item_ids:
        return rows, [{"item_id": "", "error": "没有可采集的 item_id"}], summary, csv_path

    raw_json_path = output_dir / f".sku_raw_{timestamp}.json"
    cmd = [
        node,
        str(_RUNNER),
        "--item-ids", ",".join(item_ids),
        "--out", str(raw_json_path),
        "--limit", str(len(item_ids)),
        "--interval", str(interval_ms),
    ]
    if account:
        cmd += ["--account", account]

    print(f"[SKU] 调用基座：{len(item_ids)} 个商品", file=sys.stderr, flush=True)

    env = dict(os.environ)
    env.setdefault("PLUGIN_ROOT", str(_plugin_root()))

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(_plugin_root()),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_sec,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return rows, [{"item_id": "", "error": f"基座调用超时（>{timeout_sec}s）"}], summary, csv_path

    payload: dict[str, Any] = {}
    if raw_json_path.exists():
        try:
            payload = json.loads(raw_json_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
    if not payload and proc.stdout.strip():
        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError:
            payload = {}

    if not payload:
        err = (proc.stderr or "").strip()[-500:] or "基座无输出"
        return rows, [{"item_id": "", "error": err}], summary, csv_path

    summary = payload.get("summary") or {}
    errors = [
        {"item_id": e.get("itemId", ""), "error": f"{e.get('failureKind', '')}: {e.get('hint', '')}"[:300]}
        for e in (payload.get("errors") or [])
    ]

    # 商品元数据索引（补标题/店铺/排名/链接）
    meta = {str(p.item_id): p for p in targets}

    for item in payload.get("items") or []:
        item_id = str(item.get("itemId") or "")
        product = meta.get(item_id)
        for sku in item.get("skuRows") or []:
            rows.append({
                "item_id": item_id,
                "item_title": (product.title if product else item.get("title", "")),
                "shop_name": (product.shop_name if product else item.get("shopName", "")),
                "global_rank": product.global_rank if product else "",
                "item_price": product.current_price if product else "",
                "product_link": product.product_link if product else f"https://item.taobao.com/item.htm?id={item_id}",
                "sku_id": sku.get("skuId", ""),
                "specs": sku.get("specs", ""),
                "color": sku.get("color", ""),
                "size": sku.get("size", ""),
                "price_before": sku.get("priceBefore", ""),
                "price_after": sku.get("priceAfter", ""),
                "stock": sku.get("stock") if sku.get("stock") is not None else "",
                "in_stock": sku.get("inStock", ""),
            })

    if rows:
        safe = "".join(ch if ch not in '\\/:*?"<>|' else "_" for ch in f"淘宝SKU明细_{keyword}_{timestamp}.csv")
        csv_path = export_sku_csv(rows, output_dir / safe)

    # 清理大原始文件（保留一份抽样便于排障）
    if raw_json_path.exists():
        try:
            raw_json_path.unlink()
        except OSError:
            pass

    return rows, errors, summary, csv_path
