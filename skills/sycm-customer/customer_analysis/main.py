from __future__ import annotations

import argparse
import logging
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence

from .api_client import SycmCustomerClient
from .config import (
    DEFAULT_PROFILE_DAYS,
    EXIT_COOKIE_INVALID,
    EXIT_PARAM_ERROR,
    EXIT_SUCCESS,
    PROFILE_KIND_DETAIL,
    PROFILE_KIND_LABELS,
    PROFILE_KIND_SUMMARY,
    PURCHASE_POWER_ATTRIBUTES,
    DEFAULT_PURCHASE_POWER_JSON_FILES,
    artifacts_dir,
    print_output_files,
)
from .conversion_analyzer import generate_conversion_analysis
from .csv_exporter import export_csv
from .dates import (
    build_day_range,
    build_recent_range,
    default_stat_date,
    format_date,
    format_date_compact,
    parse_date,
)
from .io import emit_json, write_result_json
from .parser import (
    default_page_info_config,
    load_json_file,
    parse_overview,
    parse_page_info,
    parse_profile_batch,
)
from .pathutil import sanitize_path_component
from .report_generator import generate_customer_report
from .types import PageInfoConfig, SkillError, SkillOutput

logger = logging.getLogger(__name__)


def sanitize_filename(value: str) -> str:
    return sanitize_path_component(value, collapse_whitespace=True, fallback="customer")


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="生意参谋店铺客户概览与客户画像分析",
        prog="customer_analysis",
    )
    parser.add_argument("--date", default="", help="统计日期 YYYY-MM-DD（默认昨天）")
    parser.add_argument("--date-type", default="day", help="概览 dateType，默认 day")
    parser.add_argument("--profile-date-type", default="recent30", help="画像 dateType，默认 recent30")
    parser.add_argument("--profile-days", type=int, default=DEFAULT_PROFILE_DAYS, help="画像统计天数，默认 30")
    parser.add_argument(
        "--attributes-summary",
        default="",
        help="汇总画像属性，逗号分隔（默认 prefer_type,interest,gender,age,province,city）",
    )
    parser.add_argument(
        "--attributes-detail",
        default="",
        help="店铺客户深度画像属性，逗号分隔（默认 career_type,education_degree,brand,brand_cate,purchase_power）",
    )
    parser.add_argument(
        "--crowd-type",
        default="",
        help="客户类型，逗号分隔：shop_crowd,new_crowd,unpur_crowd,purch_crowd（默认全部）",
    )
    parser.add_argument("--from-overview-json", default="", help="本地客户概览 JSON（1.json）")
    parser.add_argument(
        "--from-profile-json",
        default="",
        help="本地店铺客户汇总画像 JSON（shop_crowd，7.json），同 --from-profile-json-shop",
    )
    parser.add_argument("--from-profile-json-shop", default="", help="本地店铺客户汇总画像 JSON（7.json）")
    parser.add_argument("--from-profile-json-new", default="", help="本地客户新访画像 JSON（4.json）")
    parser.add_argument("--from-profile-json-unpur", default="", help="本地未购客户回访画像 JSON（5.json）")
    parser.add_argument("--from-profile-json-purch", default="", help="本地已购客户回访画像 JSON（6.json）")
    parser.add_argument(
        "--from-profile-detail-json",
        default="",
        help="本地店铺客户消费层级等深度画像 JSON（2.json，shop_crowd）",
    )
    parser.add_argument("--from-profile-purchase-json-new", default="", help="本地客户新访消费层级 JSON")
    parser.add_argument("--from-profile-purchase-json-unpur", default="", help="本地未购回访消费层级 JSON")
    parser.add_argument("--from-profile-purchase-json-purch", default="", help="本地已购回访消费层级 JSON")
    parser.add_argument("--from-page-info-json", default="", help="本地页面配置 JSON（getPageInfo，3.json）")
    parser.add_argument("--skip-shop-detail", action="store_true", help="跳过各人群消费层级画像拉取")
    parser.add_argument(
        "--fetch-purchase-power-online",
        action="store_true",
        help="本地汇总 JSON 模式下仍在线拉取各人群消费层级",
    )
    return parser.parse_args(list(argv))


def ensure_binding_context(*, local_mode: bool) -> tuple[dict[str, Any] | None, str]:
    """本地 JSON 模式不拉绑定；线上模式必须拿到 sycm shop_key。"""
    if local_mode:
        return None, "local-json"

    from ._runtime import BindingContextError, fetch_binding_context
    from .config import SYCM_PLATFORM

    try:
        ctx = fetch_binding_context(platform=SYCM_PLATFORM)
    except BindingContextError as exc:
        raise SkillError(EXIT_COOKIE_INVALID, exc.message) from exc
    source = f"gateway:{ctx.get('source', 'dsagent')}"
    return ctx, source


def resolve_attributes(raw: str, default: list[str], *, label: str) -> list[str]:
    if not str(raw or "").strip():
        return list(default)
    valid = set(default)
    names = [part.strip() for part in str(raw).split(",") if part.strip()]
    unknown = [name for name in names if name not in valid]
    if unknown:
        raise SkillError(
            EXIT_PARAM_ERROR,
            f"未知{label}属性: {', '.join(unknown)}；可选: {', '.join(sorted(valid))}",
        )
    return names


def resolve_crowd_types(raw: str, page_config: PageInfoConfig) -> list[tuple[str, str]]:
    valid_map = {value: label for value, label in page_config.crowd_types}
    if not str(raw or "").strip():
        return list(page_config.crowd_types)
    selected: list[tuple[str, str]] = []
    for part in str(raw).split(","):
        value = part.strip()
        if not value:
            continue
        if value not in valid_map:
            raise SkillError(
                EXIT_PARAM_ERROR,
                f"未知客户类型: {value}；可选: {', '.join(valid_map)}",
            )
        selected.append((value, valid_map[value]))
    return selected


def load_page_config(
    client: SycmCustomerClient | None,
    *,
    from_page_info_json: str,
) -> PageInfoConfig:
    if from_page_info_json:
        payload = load_json_file(Path(from_page_info_json))
        return parse_page_info(payload)
    if client is not None:
        payload = client.fetch_page_info()
        return parse_page_info(payload)
    return default_page_info_config()


def build_profile_json_map(args: argparse.Namespace) -> dict[str, str]:
    mapping = {
        "shop_crowd": str(args.from_profile_json_shop or args.from_profile_json or "").strip(),
        "new_crowd": str(args.from_profile_json_new or "").strip(),
        "unpur_crowd": str(args.from_profile_json_unpur or "").strip(),
        "purch_crowd": str(args.from_profile_json_purch or "").strip(),
    }
    return mapping


def build_purchase_power_json_map(args: argparse.Namespace) -> dict[str, str]:
    package_dir = Path(__file__).resolve().parent
    manual = {
        "shop_crowd": str(args.from_profile_detail_json or "").strip(),
        "new_crowd": str(args.from_profile_purchase_json_new or "").strip(),
        "unpur_crowd": str(args.from_profile_purchase_json_unpur or "").strip(),
        "purch_crowd": str(args.from_profile_purchase_json_purch or "").strip(),
    }
    summary_map = build_profile_json_map(args)
    resolved: dict[str, str] = {}
    for crowd_type, path in manual.items():
        if path:
            resolved[crowd_type] = path
            continue
        summary_path = summary_map.get(crowd_type, "")
        if summary_path:
            auto_path = Path(summary_path).with_name(f"{Path(summary_path).stem}_purchase.json")
            if auto_path.is_file():
                resolved[crowd_type] = str(auto_path)
                continue
        default_name = DEFAULT_PURCHASE_POWER_JSON_FILES.get(crowd_type, "")
        if default_name:
            default_path = package_dir / default_name
            if default_path.is_file():
                resolved[crowd_type] = str(default_path)
                continue
        resolved[crowd_type] = ""
    return resolved


def append_profiles(
    *,
    all_profiles: list[dict[str, Any]],
    crowd_type: str,
    crowd_label: str,
    attributes: list[str],
    profile_kind: str,
    profile_json: str,
    client: SycmCustomerClient | None,
    profile_range: str,
    profile_date_type: str,
) -> None:
    if not attributes:
        return

    kind_label = PROFILE_KIND_LABELS.get(profile_kind, profile_kind)
    if set(attributes) == set(PURCHASE_POWER_ATTRIBUTES):
        kind_label = "消费层级"
    if profile_json:
        profile_payload = load_json_file(Path(profile_json))
    elif client is not None:
        logger.info(
            "拉取画像: %s / %s (%s)，维度 %s 个",
            crowd_label,
            kind_label,
            crowd_type,
            len(attributes),
        )
        profile_payload = client.fetch_profiles(
            date_range=profile_range,
            date_type=profile_date_type,
            attributes=attributes,
            cust_crowd_type=crowd_type,
        )
    else:
        if set(attributes) == set(PURCHASE_POWER_ATTRIBUTES):
            logger.warning("本地模式跳过 %s 消费层级：未提供消费层级 JSON", crowd_label)
        else:
            logger.warning("本地模式跳过 %s / %s：未提供画像 JSON", crowd_label, kind_label)
        return

    dimensions = parse_profile_batch(
        profile_payload,
        crowd_type=crowd_type,
        crowd_label=crowd_label,
        profile_kind=profile_kind,
        profile_kind_label=kind_label,
    )
    if attributes:
        allowed = set(attributes)
        dimensions = [item for item in dimensions if item.attribute_name in allowed]
    all_profiles.extend(item.to_dict() for item in dimensions)


def collect_customer_data(
    *,
    stat_day,
    date_type: str,
    profile_date_type: str,
    profile_days: int,
    summary_attributes: list[str],
    selected_crowds: list[tuple[str, str]],
    page_config: PageInfoConfig,
    binding_source: str,
    client: SycmCustomerClient | None,
    from_overview_json: str,
    profile_json_map: dict[str, str],
    purchase_power_json_map: dict[str, str],
    skip_purchase_power: bool,
) -> SkillOutput:
    day_range = build_day_range(stat_day)
    profile_range = build_recent_range(end=stat_day, days=profile_days)

    if from_overview_json:
        overview_payload = load_json_file(Path(from_overview_json))
    else:
        if client is None:
            raise SkillError(EXIT_PARAM_ERROR, "缺少客户概览数据")
        overview_payload = client.fetch_overview(date_range=day_range, date_type=date_type)

    metrics, seller_id, stat_date = parse_overview(overview_payload)

    all_profiles: list[dict[str, Any]] = []
    for crowd_type, crowd_label in selected_crowds:
        append_profiles(
            all_profiles=all_profiles,
            crowd_type=crowd_type,
            crowd_label=crowd_label,
            attributes=summary_attributes,
            profile_kind=PROFILE_KIND_SUMMARY,
            profile_json=profile_json_map.get(crowd_type, ""),
            client=client,
            profile_range=profile_range,
            profile_date_type=profile_date_type,
        )

        if not skip_purchase_power:
            append_profiles(
                all_profiles=all_profiles,
                crowd_type=crowd_type,
                crowd_label=crowd_label,
                attributes=list(PURCHASE_POWER_ATTRIBUTES),
                profile_kind=PROFILE_KIND_DETAIL,
                profile_json=purchase_power_json_map.get(crowd_type, ""),
                client=client,
                profile_range=profile_range,
                profile_date_type=profile_date_type,
            )

    result = SkillOutput(
        status="success",
        seller_id=seller_id,
        stat_date=stat_date or format_date(stat_day),
        date_range=day_range,
        profile_date_range=profile_range,
        profile_date_type=profile_date_type,
        binding_source=binding_source,
        overview={key: metric.to_dict() for key, metric in metrics.items()},
        crowd_types=[
            {"crowd_type": value, "crowd_label": label}
            for value, label in page_config.crowd_types
        ],
        profiles=all_profiles,
    )

    output_dir = artifacts_dir()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_date = sanitize_filename(format_date_compact(stat_day))

    csv_name = f"客户分析数据_{safe_date}_{timestamp}.csv"
    result.csv_path = export_csv(result, output_dir / csv_name)

    report_name = f"客户分析报告_{safe_date}_{timestamp}.html"
    ai_markdown = generate_conversion_analysis(result)
    result.ai_analysis_markdown = ai_markdown
    ai_name = f"客户分群转化分析_{safe_date}_{timestamp}.md"
    ai_path = output_dir / ai_name
    ai_path.write_text(ai_markdown, encoding="utf-8")
    result.ai_analysis_path = str(ai_path)
    result.report_path = generate_customer_report(result, output_dir / report_name)

    json_name = f"客户分析数据_{safe_date}_{timestamp}.json"
    result.json_path = write_result_json(result, output_dir / json_name)
    return result


def run(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    date_input = str(args.date or "").strip()
    if date_input and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_input):
        emit_json({
            "status": "error",
            "error_code": EXIT_PARAM_ERROR,
            "error_message": "date 格式应为 YYYY-MM-DD，例如 2026-07-05",
        })
        return EXIT_PARAM_ERROR

    try:
        stat_day = parse_date(date_input) if date_input else default_stat_date()
        profile_days = int(args.profile_days or DEFAULT_PROFILE_DAYS)
        if profile_days < 1:
            raise ValueError("profile-days 必须 >= 1")
    except ValueError as exc:
        emit_json({
            "status": "error",
            "error_code": EXIT_PARAM_ERROR,
            "error_message": str(exc),
        })
        return EXIT_PARAM_ERROR

    local_mode = bool(args.from_overview_json)
    fetch_purchase_online = bool(args.fetch_purchase_power_online)
    # 纯本地 JSON：不拉绑定；若本地汇总但仍要在线拉购买力，则需要绑定
    skip_binding = local_mode and not fetch_purchase_online
    try:
        _binding, binding_source = ensure_binding_context(local_mode=skip_binding)
        client = None if skip_binding else SycmCustomerClient()

        page_config = load_page_config(
            client,
            from_page_info_json=str(args.from_page_info_json or ""),
        )
        summary_attributes = resolve_attributes(
            str(args.attributes_summary or ""),
            page_config.summary_attributes,
            label="汇总画像",
        )
        selected_crowds = resolve_crowd_types(str(args.crowd_type or ""), page_config)
        profile_json_map = build_profile_json_map(args)
        purchase_power_json_map = build_purchase_power_json_map(args)

        result = collect_customer_data(
            stat_day=stat_day,
            date_type=str(args.date_type or "day"),
            profile_date_type=str(args.profile_date_type or "recent30"),
            profile_days=profile_days,
            summary_attributes=summary_attributes,
            selected_crowds=selected_crowds,
            page_config=page_config,
            binding_source=binding_source,
            client=client,
            from_overview_json=str(args.from_overview_json or ""),
            profile_json_map=profile_json_map,
            purchase_power_json_map=purchase_power_json_map,
            skip_purchase_power=bool(args.skip_shop_detail),
        )

        emit_json(result.to_dict())
        profile_count = sum(len(item.get("rows") or []) for item in (result.profiles or []))
        crowd_count = len({item.get("crowd_type") for item in (result.profiles or []) if item.get("crowd_type")})
        print(
            f"--- 客户概览 {result.stat_date}，人群类型 {crowd_count} 个，"
            f"画像维度 {len(result.profiles or [])} 个，细分 {profile_count} 条",
            file=sys.stderr,
        )
        print_output_files(
            JSON=result.json_path,
            CSV=result.csv_path,
            HTML=result.report_path,
            AI分析=result.ai_analysis_path,
        )
        return EXIT_SUCCESS
    except SkillError as exc:
        payload = {
            "status": "error",
            "error_code": exc.exit_code,
            "error_message": str(exc),
        }
        # 脚本自报失败类型：插件侧据此精确引导用户
        # （no_permission → 换账号；token_expired → 重新登录），避免笼统报「接口错误」。
        failure_kind = getattr(exc, "failure_kind", "")
        if failure_kind:
            payload["failure_kind"] = failure_kind
        emit_json(payload)
        return exc.exit_code


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
        stream=sys.stderr,
    )
    args = list(argv if argv is not None else sys.argv[1:])
    if not args:
        print(
            "用法:\n"
            "  python -m customer_analysis\n"
            "  python -m customer_analysis --date 2026-07-05\n"
            "  python -m customer_analysis --date 2026-07-05 "
            "--from-overview-json 1.json "
            "--from-page-info-json customer_analysis/3.json "
            "--from-profile-json-shop customer_analysis/7.json "
            "--from-profile-json-new customer_analysis/4.json "
            "--from-profile-json-unpur customer_analysis/5.json "
            "--from-profile-json-purch customer_analysis/6.json "
            "--from-profile-detail-json 2.json "
            "--from-profile-purchase-json-new customer_analysis/10.json "
            "--from-profile-purchase-json-unpur customer_analysis/9.json "
            "--from-profile-purchase-json-purch customer_analysis/8.json",
            file=sys.stderr,
        )
        return EXIT_SUCCESS
    return run(args)
