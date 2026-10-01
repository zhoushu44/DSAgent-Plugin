"""生意参谋客户分析 — 路径与常量。"""

from __future__ import annotations

import sys
from pathlib import Path

SYCM_BASE_URL = "https://sycm.taobao.com/domain/oneQuery.json"
SYCM_MULTI_URL = "https://sycm.taobao.com/domain/multiQuery.json"
SYCM_PAGE_INFO_URL = "https://sycm.taobao.com/oneauth/constructed/getPageInfo.json"
DEFAULT_PAGE_CODE = "bxJCiiv7"
SYCM_PLATFORM = "sycm"
DEFAULT_DEVICE = 0
DEFAULT_PROFILE_DAYS = 30
DEFAULT_PROFILE_GRANULARITY = "1m"
DEFAULT_CUST_CROWD_TYPE = "shop_crowd"

OVERVIEW_DOMAIN = "tao.shop.customer.overview"
PROFILE_DOMAIN = "tao.shop.customer.newprofile"

OVERVIEW_INDEX_CODES = (
    "sellerId,statDate,shopCustomer,shopCustomerAvgGood,"
    "newVisitorCnt,newVisitorCntAvgGood,newVisitorBuyCnt,newVisitorInShopCnt,"
    "newVisitorPayRate,newVisitorPct,newVisitorVipRate,newVisitorFansRate,"
    "newVisitorPayAmtRatio,newVisitorReCall,"
    "noPurchaseCnt,noPurchaseCntAvgGood,noPurchaseBuyCnt,noBuyInShopCnt,"
    "noPurchasePayRate,noPurchasePct,noPurchaseFansRate,noPurchaseVipRate,"
    "noPurchasePayAmtRatio,noPurchaseReCall,noPurchaseBuyCntRate,"
    "hasPurchaseCnt,hasPurchaseCntAvgGood,hasPurchaseUbyCnt,hasBuyInShopCnt,"
    "hasPurchasePayRate,hasPurchasePayAmtRatio,hasPurchasePct,"
    "hasPurchaseFansRate,hasPurchaseVipRate,hasPurchaseReCall,hasPurchaseUbyCntRate"
)

DEFAULT_CROWD_TYPES: tuple[tuple[str, str], ...] = (
    ("shop_crowd", "店铺客户"),
    ("new_crowd", "客户新访"),
    ("unpur_crowd", "未购客户回访"),
    ("purch_crowd", "已购客户回访"),
)

SUMMARY_PROFILE_ATTRIBUTES: tuple[str, ...] = (
    "prefer_type",
    "interest",
    "gender",
    "age",
    "province",
    "city",
)

SHOP_DETAIL_ATTRIBUTES: tuple[str, ...] = (
    "career_type",
    "education_degree",
    "brand",
    "brand_cate",
    "purchase_power",
)

PIE_CHART_ATTRIBUTES: frozenset[str] = frozenset({
    "gender",
    "age",
})

HIDDEN_PROFILE_ATTRIBUTES: frozenset[str] = frozenset({
    "prefer_type",
    "career_type",
    "education_degree",
})

# 各人群汇总画像中额外展示的 detail 属性（不单独展示深度画像区块）
CROWD_EXTRA_DISPLAY_ATTRIBUTES: frozenset[str] = frozenset({
    "purchase_power",
})

PURCHASE_POWER_ATTRIBUTES: tuple[str, ...] = ("purchase_power",)

DEFAULT_PURCHASE_POWER_JSON_FILES: dict[str, str] = {
    "new_crowd": "10.json",
    "unpur_crowd": "9.json",
    "purch_crowd": "8.json",
}

PROFILE_KIND_SUMMARY = "summary"
PROFILE_KIND_DETAIL = "detail"
PROFILE_KIND_LABELS = {
    PROFILE_KIND_SUMMARY: "汇总画像",
    PROFILE_KIND_DETAIL: "深度画像",
}

CROWD_PROFILE_JSON_ARGS: tuple[tuple[str, str], ...] = (
    ("shop_crowd", "from_profile_json_shop"),
    ("new_crowd", "from_profile_json_new"),
    ("unpur_crowd", "from_profile_json_unpur"),
    ("purch_crowd", "from_profile_json_purch"),
)

ATTRIBUTE_LABELS: dict[str, str] = {
    "career_type": "职业",
    "education_degree": "学历",
    "brand": "品牌偏好",
    "brand_cate": "品类偏好",
    "purchase_power": "消费层级",
    "prefer_type": "偏好类型",
    "interest": "兴趣爱好",
    "gender": "性别",
    "age": "年龄",
    "province": "省份",
    "city": "城市",
}

PROFILE_ATTRIBUTES: tuple[tuple[str, str], ...] = tuple(ATTRIBUTE_LABELS.items())

OVERVIEW_GROUPS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "shop",
        "店铺整体",
        ("shopCustomer", "shopCustomerAvgGood"),
    ),
    (
        "newVisitor",
        "客户新访",
        (
            "newVisitorCnt",
            "newVisitorCntAvgGood",
            "newVisitorBuyCnt",
            "newVisitorInShopCnt",
            "newVisitorPayRate",
            "newVisitorPct",
            "newVisitorVipRate",
            "newVisitorFansRate",
            "newVisitorPayAmtRatio",
            "newVisitorReCall",
        ),
    ),
    (
        "noPurchase",
        "未购客户回访",
        (
            "noPurchaseCnt",
            "noPurchaseCntAvgGood",
            "noPurchaseBuyCnt",
            "noBuyInShopCnt",
            "noPurchasePayRate",
            "noPurchasePct",
            "noPurchaseFansRate",
            "noPurchaseVipRate",
            "noPurchasePayAmtRatio",
            "noPurchaseReCall",
            "noPurchaseBuyCntRate",
        ),
    ),
    (
        "hasPurchase",
        "已购客户回访",
        (
            "hasPurchaseCnt",
            "hasPurchaseCntAvgGood",
            "hasPurchaseUbyCnt",
            "hasBuyInShopCnt",
            "hasPurchasePayRate",
            "hasPurchasePayAmtRatio",
            "hasPurchasePct",
            "hasPurchaseFansRate",
            "hasPurchaseVipRate",
            "hasPurchaseReCall",
            "hasPurchaseUbyCntRate",
        ),
    ),
)

EXIT_SUCCESS = 0
EXIT_PARAM_ERROR = 1
EXIT_COOKIE_INVALID = 2
EXIT_API_ERROR = 4
# 登录态有效但账号无该类目/业务权限（生意参谋 code=10013「类目无权限」等）。
# 与 market-trend / keyword-assistant 保持一致，取值 7。
EXIT_NO_PERMISSION = 7

from ._runtime import workspace_root


def artifacts_dir() -> Path:
    path = workspace_root() / "artifacts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def print_output_files(**files: str) -> None:
    paths = {k: str(v) for k, v in files.items() if v}
    if not paths:
        return
    print("\n---[OUTPUT_FILES]", file=sys.stderr)
    for label, path in paths.items():
        print(f"{label}: {path}", file=sys.stderr)
