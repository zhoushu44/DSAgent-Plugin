"""市场排行趋势分析 — 类目查询

通过生意参谋 API 获取当前账号在市场排行页面可用的类目列表，支持按名称搜索。

API 来源：
  - 市场排行类目: /mc/common/free/getCateInfo.json?marketVersion=free
  - 响应格式: { code: 0, data: [[parentId, cateId, cateName, level, "free", isLeaf, rootCateId, rootCateName], ...] }
  - 返回当前账号有权限的全部市场排行类目（含完整子类目树）
"""

import logging

from ._api_client import SycmClient

from .config import SYCM_BASE_URL

logger = logging.getLogger(__name__)


# ---------- 数据结构 ----------

def _parse_market_cate_item(raw: list) -> dict:
    """将市场排行类目 API 的单条数据解析为 dict。

    API 格式: [parentId, cateId, cateName, level, "free", isLeaf, rootCateId, rootCateName]
    """
    return {
        "parent_id": raw[0],
        "cate_id": raw[1],
        "cate_name": raw[2],
        "level": raw[3],
        "is_leaf": raw[5] == "Y",
        "root_cate_id": raw[6],
        "root_cate_name": raw[7],
    }


# ---------- API 请求 ----------

def fetch_all_categories(client: SycmClient, cate_type: str = "all") -> list[dict]:
    """获取市场排行可用的全部类目列表。

    使用市场排行页面的专用类目 API，返回完整的类目树（包含所有子类目）。
    与 getStdCate/getDefCate 不同，此 API 返回的是市场排行功能实际可用的类目。

    Args:
        cate_type: 保留参数，暂不区分类型（市场排行 API 不区分标准/导购）
    """
    url = f"{SYCM_BASE_URL}/mc/common/free/getCateInfo.json"
    params = {"marketVersion": "free"}

    logger.info("获取市场排行类目列表...")
    data = client.get(url, params=params)

    raw_data = data.get("data", [])
    if isinstance(raw_data, dict):
        raw_data = raw_data.get("data", [])

    categories = [_parse_market_cate_item(item) for item in raw_data]
    logger.info(f"市场排行类目: {len(categories)} 条")
    return categories


# ---------- 类目树构建 ----------

def build_category_tree(flat_items: list[dict]) -> list[dict]:
    """将扁平类目列表构建为嵌套树结构。

    移植自 common/utils/categoryTransform.ts 的 transformToNestedCategories。
    """
    node_map: dict[int, dict] = {}

    for item in flat_items:
        node = {
            **item,
            "children": [],
        }
        node_map[item["cate_id"]] = node

    roots: list[dict] = []
    for item in flat_items:
        node = node_map[item["cate_id"]]
        parent_id = item["parent_id"]
        if parent_id == 0 or parent_id not in node_map:
            roots.append(node)
        else:
            node_map[parent_id]["children"].append(node)

    return roots


def _get_path_recursive(
    tree: list[dict], target_id: int, current_path: list[str],
) -> list[str] | None:
    """递归查找类目路径"""
    for node in tree:
        new_path = [*current_path, node["cate_name"]]
        if node["cate_id"] == target_id:
            return new_path
        if node.get("children"):
            found = _get_path_recursive(node["children"], target_id, new_path)
            if found:
                return found
    return None


def get_category_path(tree: list[dict], cate_id: int) -> str:
    """获取类目完整路径字符串，如 "宠物/猫狗日用 > 猫粮" """
    path = _get_path_recursive(tree, cate_id, [])
    if not path:
        return ""
    return " > ".join(path)


def _count_children(node: dict) -> int:
    """统计直接子类目数量"""
    children = node.get("children", [])
    return len(children) if children else 0


# ---------- 类目搜索 ----------

def search_categories(
    flat_items: list[dict],
    keyword: str,
    tree: list[dict] | None = None,
) -> list[dict]:
    """按关键词模糊搜索类目。

    匹配逻辑：
    1. 类目名称包含关键词 → 直接匹配
    2. 父类目匹配时 → 自动包含其所有子类目（方便用户选择具体子类目）
    3. 类目路径包含关键词 → 也算匹配

    Args:
        flat_items: 扁平类目列表
        keyword: 搜索关键词（支持空格分隔的多关键词 AND 匹配）
        tree: 类目树（用于获取路径），如果为 None 则自动构建

    Returns:
        匹配的类目列表，包含完整路径信息
    """
    if tree is None:
        tree = build_category_tree(flat_items)

    node_map: dict[int, dict] = {}
    _build_node_map(tree, node_map)

    keywords = keyword.lower().split()

    # 第一轮：找到名称直接匹配的类目
    matched_ids: set[int] = set()
    for item in flat_items:
        name = item["cate_name"].lower()
        if all(kw in name for kw in keywords):
            matched_ids.add(item["cate_id"])

    # 第二轮：匹配的父类目 → 自动加入其所有子类目
    expanded_ids: set[int] = set(matched_ids)
    for cate_id in matched_ids:
        node = node_map.get(cate_id)
        if node and node.get("children"):
            _collect_descendant_ids(node, expanded_ids)

    # 第三轮：路径匹配（如搜"猫粮"能匹配"宠物 > 猫粮"）
    for item in flat_items:
        if item["cate_id"] in expanded_ids:
            continue
        path = get_category_path(tree, item["cate_id"]).lower()
        if all(kw in path for kw in keywords):
            expanded_ids.add(item["cate_id"])

    # 构建结果
    results: list[dict] = []
    for item in flat_items:
        if item["cate_id"] not in expanded_ids:
            continue

        path = get_category_path(tree, item["cate_id"])
        node = node_map.get(item["cate_id"])
        children_count = _count_children(node) if node else 0
        is_direct_match = item["cate_id"] in matched_ids

        results.append({
            "cate_id": item["cate_id"],
            "cate_name": item["cate_name"],
            "path": path or item["cate_name"],
            "level": item["level"],
            "is_leaf": item["is_leaf"],
            "root_cate_id": item.get("root_cate_id", item["cate_id"]),
            "root_cate_name": item.get("root_cate_name", item["cate_name"]),
            "children_count": children_count,
            "match_type": "direct" if is_direct_match else "child",
        })

    # 排序：直接匹配优先，然后按路径深度（path 中 ">" 的数量），再按名称
    results.sort(key=lambda x: (
        0 if x["match_type"] == "direct" else 1,
        x["path"].count(">"),
        x["cate_name"],
    ))
    return results


def _collect_descendant_ids(node: dict, id_set: set[int]) -> None:
    """递归收集节点的所有子孙 ID"""
    for child in node.get("children", []):
        id_set.add(child["cate_id"])
        _collect_descendant_ids(child, id_set)


def _build_node_map(tree: list[dict], node_map: dict[int, dict]) -> None:
    """递归构建 cate_id → node 映射"""
    for node in tree:
        node_map[node["cate_id"]] = node
        if node.get("children"):
            _build_node_map(node["children"], node_map)


def list_all_categories_flat(
    flat_items: list[dict],
    tree: list[dict] | None = None,
) -> list[dict]:
    """将所有类目转为输出格式（含路径）"""
    if tree is None:
        tree = build_category_tree(flat_items)

    node_map: dict[int, dict] = {}
    _build_node_map(tree, node_map)

    results: list[dict] = []
    for item in flat_items:
        path = get_category_path(tree, item["cate_id"])
        node = node_map.get(item["cate_id"])
        children_count = _count_children(node) if node else 0

        results.append({
            "cate_id": item["cate_id"],
            "cate_name": item["cate_name"],
            "path": path or item["cate_name"],
            "level": item["level"],
            "is_leaf": item["is_leaf"],
            "root_cate_id": item.get("root_cate_id", item["cate_id"]),
            "root_cate_name": item.get("root_cate_name", item["cate_name"]),
            "children_count": children_count,
        })

    results.sort(key=lambda x: (x["level"], x["cate_name"]))
    return results
