#!/usr/bin/env python3
"""
1688 供应商搜索网关客户端 —— 通过 DSAgent 本地网关代理调用 1688 MTOP API。

复用 alibaba-product-find 的网关模块，避免重复代码。
"""

from __future__ import annotations

import importlib.util
import os
import sys

# 显式加载 alibaba-product-find/scripts/_1688_gateway.py，避免同名文件循环 import
_PRODUCT_FIND_SCRIPTS = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "alibaba-product-find", "scripts")
)
_GATEWAY_PATH = os.path.join(_PRODUCT_FIND_SCRIPTS, "_1688_gateway.py")

_spec = importlib.util.spec_from_file_location("_1688_gateway_pf", _GATEWAY_PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

search_suppliers = _mod.search_suppliers
