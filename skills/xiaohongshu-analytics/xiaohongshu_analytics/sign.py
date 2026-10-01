#!/usr/bin/env python3
"""
小红书请求签名（x-s / x-t / x-s-common）— 纯 Python 实现，零外部依赖。

移植自开源项目 Cloxl/xhshow（MIT），去掉 pycryptodome 依赖：
  - ARC4 用纯 Python 实现（仅用于 x-s-common 的 b1 指纹）
  - 自定义 Base64 字母表 / XOR 变换 / 144 字节 payload 构造逐字对齐

对外接口：
  parse_cookie_str(cookie_str) -> dict
  sign_headers(method, uri, cookie_str, payload=None, params=None) -> (headers, body_str)
  get_x_t(timestamp=None) -> int
  gen_search_id() -> str
"""

from __future__ import annotations

import binascii
import hashlib
import json
import math
import random
import struct
import time
import urllib.parse
from urllib.parse import urlparse

# ─── 常量（与 xhshow config.py 逐字一致）───
STANDARD_BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
CUSTOM_BASE64_ALPHABET = "ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5"
X3_BASE64_ALPHABET = "MfgqrsbcyzPQRStuvC7mn501HIJBo2DEFTKdeNOwxWXYZap89+/A4UVLhijkl63G"

HEX_KEY = (
    "71a302257793271ddd273bcee3e4b98d9d7935e1da33f5765e2ea8afb6dc77a5"
    "1a499d23b67c20660025860cbf13d4540d92497f58686c574e508f46e1956344"
    "f39139bf4faf22a3eef120b79258145b2feb5193b6478669961298e79bedca64"
    "6e1a693a926154a5a7a1bd1cf0dedb742f917a747a1e388b234f2277516db711"
    "6035439730fa61e9822a0eca7bff72d8"
)

VERSION_BYTES = [121, 104, 96, 41]
PAYLOAD_LENGTH = 144
A1_LENGTH = 52
APP_ID_LENGTH = 10
MD5_XOR_LENGTH = 8
A3_PREFIX = [2, 97, 51, 16]
TIMESTAMP_LE_LENGTH = 8

SEQUENCE_VALUE_MIN = 15
SEQUENCE_VALUE_MAX = 50
WINDOW_PROPS_LENGTH_MIN = 1000
WINDOW_PROPS_LENGTH_MAX = 1200
ENV_FINGERPRINT_TIME_OFFSET_MIN = 10
ENV_FINGERPRINT_TIME_OFFSET_MAX = 50

ENV_TABLE = [115, 248, 83, 102, 103, 201, 181, 131, 99, 94, 4, 68, 250, 132, 21]
ENV_CHECKS_DEFAULT = [0, 1, 18, 1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0]

HASH_IV = (1831565813, 461845907, 2246822507, 3266489909)
MAX_32BIT = 0xFFFFFFFF

SIGNATURE_DATA_TEMPLATE = {
    "x0": "4.3.5",
    "x1": "xhs-pc-web",
    "x2": "Windows",
    "x3": "",
    "x4": "object",
}

X3_PREFIX = "mns0301_"
XYS_PREFIX = "XYS_"

B1_SECRET_KEY = "xhswebmplfbt"

SIGNATURE_XSCOMMON_TEMPLATE = {
    "s0": 5,
    "s1": "",
    "x0": "1",
    "x1": "4.3.5",
    "x2": "Windows",
    "x3": "xhs-pc-web",
    "x4": "4.86.0",
    "x5": "",
    "x6": "",
    "x7": "",
    "x8": "",
    "x9": -596800761,
    "x10": 0,
    "x11": "normal",
}

PUBLIC_USERAGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0"
)

_BASE36_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz"

# ─── 指纹常量（fingerprint_data.py）───
GPU_VENDORS = [
    "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A8) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB (0x000010DE) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x0000250F) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Google Inc. (Google)|ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
]

SCREEN_RESOLUTIONS = {
    "resolutions": ["1366;768", "1600;900", "1920;1080", "2560;1440", "3840;2160", "7680;4320"],
    "weights": [0.25, 0.15, 0.35, 0.15, 0.08, 0.02],
}
COLOR_DEPTH_OPTIONS = {"values": [16, 24, 30, 32], "weights": [0.05, 0.6, 0.05, 0.3]}
DEVICE_MEMORY_OPTIONS = {"values": [1, 2, 4, 8, 12, 16], "weights": [0.10, 0.25, 0.4, 0.2, 0.03, 0.01]}
CORE_OPTIONS = {"values": [2, 4, 6, 8, 12, 16, 24, 32], "weights": [0.1, 0.4, 0.2, 0.15, 0.08, 0.04, 0.02, 0.01]}
BROWSER_PLUGINS = "PDF Viewer,Chrome PDF Viewer,Chromium PDF Viewer,Microsoft Edge PDF Viewer,WebKit built-in PDF"
CANVAS_HASH = "742cc32c"
VOICE_HASH_OPTIONS = "10311144241322244122"
FONTS = (
    'system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", '
    '-apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif, '
    'BlinkMacSystemFont, "Helvetica Neue", Arial, "PingFang SC", "PingFang TC", "PingFang HK", '
    '"Microsoft Yahei", "Microsoft JhengHei"'
)


# ══════════════════════════════════════════
# Cookie 解析
# ══════════════════════════════════════════
def parse_cookie_str(cookie_str: str) -> dict:
    """把 "a=1; b=2" 解析为 dict（值里允许含 '='，只按首个 '=' 切分）"""
    out: dict[str, str] = {}
    for part in (cookie_str or "").split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k.strip()] = v.strip()
    return out


# ══════════════════════════════════════════
# 自定义 Base64
# ══════════════════════════════════════════
def _b64_translate(data: bytes, alphabet: str) -> str:
    import base64

    std = base64.b64encode(data).decode("utf-8")
    return std.translate(str.maketrans(STANDARD_BASE64_ALPHABET, alphabet))


def encode_custom(data) -> str:
    """标准 Base64 后按 CUSTOM_BASE64_ALPHABET 换表（x-s 外层 / b1 用）"""
    if isinstance(data, str):
        data = data.encode("utf-8")
    return _b64_translate(bytes(data), CUSTOM_BASE64_ALPHABET)


def encode_x3(data) -> str:
    """标准 Base64 后按 X3_BASE64_ALPHABET 换表（x3 用）"""
    return _b64_translate(bytes(data), X3_BASE64_ALPHABET)


# ══════════════════════════════════════════
# 位运算 / 哈希
# ══════════════════════════════════════════
def _int_to_le_bytes(val: int, length: int = 4) -> list:
    arr = []
    for _ in range(length):
        arr.append(val & 0xFF)
        val >>= 8
    return arr


def _rotate_left(val: int, n: int) -> int:
    return ((val << n) | (val >> (32 - n))) & MAX_32BIT


def _custom_hash_v2(input_bytes: list) -> list:
    """a3 字段用自定义哈希：输入字节数须为 8 的倍数，输出 16 字节"""
    s0, s1, s2, s3 = HASH_IV
    length = len(input_bytes)

    s0 ^= length
    s1 ^= length << 8
    s2 ^= length << 16
    s3 ^= length << 24

    for i in range(length // 8):
        v0, v1 = struct.unpack("<II", bytes(input_bytes[i * 8:(i + 1) * 8]))
        s0 = _rotate_left(((s0 + v0) & MAX_32BIT) ^ s2, 7)
        s1 = _rotate_left(((v0 ^ s1) + s3) & MAX_32BIT, 11)
        s2 = _rotate_left(((s2 + v1) & MAX_32BIT) ^ s0, 13)
        s3 = _rotate_left(((s3 ^ v1) + s1) & MAX_32BIT, 17)

    t0 = s0 ^ length
    t1 = s1 ^ t0
    t2 = (s2 + t1) & MAX_32BIT
    t3 = s3 ^ t2

    s0 = (_rotate_left(t0, 9) + _rotate_left(t2, 17)) & MAX_32BIT
    s1 = _rotate_left(t1, 13) ^ _rotate_left(t3, 19)
    s2 = (_rotate_left(t2, 17) + s0) & MAX_32BIT
    s3 = _rotate_left(t3, 19) ^ s1

    result: list = []
    for s in (s0, s1, s2, s3):
        result.extend(_int_to_le_bytes(s, 4))
    return result


def _xor_transform_array(source_integers: list) -> bytearray:
    """144 字节 payload 与 HEX_KEY 逐字节 XOR"""
    key_bytes = bytes.fromhex(HEX_KEY)
    key_length = len(key_bytes)
    result = bytearray(len(source_integers))
    for index in range(len(source_integers)):
        if index < key_length:
            result[index] = (source_integers[index] ^ key_bytes[index]) & 0xFF
        else:
            result[index] = source_integers[index] & 0xFF
    return result


def _build_payload_array(hex_parameter: str, hex_md5_path: str, a1_value: str,
                         app_identifier: str = "xhs-pc-web",
                         string_param: str = "", timestamp: float | None = None) -> list:
    """构造 144 字节 payload（mns0301 版本）"""
    timestamp = time.time() if timestamp is None else timestamp
    seed = random.randint(0, MAX_32BIT)
    seed_byte = seed & 0xFF

    payload = list(VERSION_BYTES)
    payload.extend(_int_to_le_bytes(seed, 4))

    ts_bytes = _int_to_le_bytes(int(timestamp * 1000), TIMESTAMP_LE_LENGTH)
    payload.extend(ts_bytes)

    time_offset = random.randint(ENV_FINGERPRINT_TIME_OFFSET_MIN, ENV_FINGERPRINT_TIME_OFFSET_MAX)
    payload.extend(_int_to_le_bytes(int((timestamp - time_offset) * 1000), TIMESTAMP_LE_LENGTH))
    payload.extend(_int_to_le_bytes(random.randint(SEQUENCE_VALUE_MIN, SEQUENCE_VALUE_MAX), 4))
    payload.extend(_int_to_le_bytes(random.randint(WINDOW_PROPS_LENGTH_MIN, WINDOW_PROPS_LENGTH_MAX), 4))
    payload.extend(_int_to_le_bytes(len(string_param.encode("utf-8")), 4))

    md5_bytes = bytes.fromhex(hex_parameter)
    payload.extend([md5_bytes[i] ^ seed_byte for i in range(MD5_XOR_LENGTH)])

    a1_bytes = a1_value.encode("utf-8")[:A1_LENGTH].ljust(A1_LENGTH, b"\x00")
    payload.append(len(a1_bytes))
    payload.extend(a1_bytes)

    app_bytes = app_identifier.encode("utf-8")[:APP_ID_LENGTH].ljust(APP_ID_LENGTH, b"\x00")
    payload.append(len(app_bytes))
    payload.extend(app_bytes)

    part11 = [1, seed_byte ^ ENV_TABLE[0]]
    part11 += [ENV_TABLE[i] ^ ENV_CHECKS_DEFAULT[i] for i in range(1, 15)]
    payload.extend(part11)

    md5_path_bytes = [int(hex_md5_path[i:i + 2], 16) for i in range(0, 32, 2)]
    payload.extend(A3_PREFIX + [b ^ seed_byte for b in _custom_hash_v2(ts_bytes + md5_path_bytes)])

    return payload


# ══════════════════════════════════════════
# x-s 签名
# ══════════════════════════════════════════
def extract_uri(url: str) -> str:
    """取 URL 的 path 部分（去掉 host / query / fragment）"""
    path = urlparse(url.strip()).path
    if not path or path == "/":
        raise ValueError(f"无法从 URL 提取 URI: {url}")
    return path


def _build_content_string(method: str, uri: str, payload: dict | None = None) -> str:
    payload = payload or {}
    if method.upper() == "POST":
        return uri + json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    if not payload:
        return uri
    params = []
    for key, value in payload.items():
        if isinstance(value, (list, tuple)):
            value_str = ",".join(str(v) for v in value)
        elif value is not None:
            value_str = str(value)
        else:
            value_str = ""
        params.append(f"{key}={urllib.parse.quote(value_str, safe=',')}")
    return f"{uri}?{'&'.join(params)}"


def sign_xs(method: str, uri: str, a1_value: str, xsec_appid: str = "xhs-pc-web",
            payload: dict | None = None, timestamp: float | None = None) -> str:
    """生成 x-s 头（XYS_ 格式）"""
    uri = extract_uri(uri)
    content_string = _build_content_string(method, uri, payload)
    d_value = hashlib.md5(content_string.encode("utf-8")).hexdigest()
    m_value = d_value if method.upper() == "GET" else hashlib.md5(uri.encode("utf-8")).hexdigest()

    payload_array = _build_payload_array(d_value, m_value, a1_value, xsec_appid,
                                         content_string, timestamp)
    xor_result = _xor_transform_array(payload_array)
    x3_signature = encode_x3(xor_result[:PAYLOAD_LENGTH])

    signature_data = dict(SIGNATURE_DATA_TEMPLATE)
    signature_data["x3"] = X3_PREFIX + x3_signature
    return XYS_PREFIX + encode_custom(
        json.dumps(signature_data, separators=(",", ":"), ensure_ascii=False)
    )


# ══════════════════════════════════════════
# x-s-common（依赖 a1 + 指纹 + ARC4 + CRC32）
# ══════════════════════════════════════════
def _arc4(key: bytes, data: bytes) -> bytes:
    """纯 Python ARC4（替代 pycryptodome Crypto.Cipher.ARC4）"""
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) & 0xFF
        s[i], s[j] = s[j], s[i]
    out = bytearray()
    i = j = 0
    for byte in data:
        i = (i + 1) & 0xFF
        j = (j + s[i]) & 0xFF
        s[i], s[j] = s[j], s[i]
        out.append(byte ^ s[(s[i] + s[j]) & 0xFF])
    return bytes(out)


_CRC32_TABLE: list | None = None


def _crc32_js_int(data) -> int:
    """JS 风格 CRC32：(-1 ^ c ^ 0xEDB88320) >>> 0，返回有符号 32 位"""
    global _CRC32_TABLE
    if _CRC32_TABLE is None:
        tbl = [0] * 256
        for d in range(256):
            r = d
            for _ in range(8):
                r = ((r >> 1) ^ 0xEDB88320) if (r & 1) else (r >> 1)
                r &= MAX_32BIT
            tbl[d] = r
        _CRC32_TABLE = tbl

    c = MAX_32BIT
    for ch in data:
        b = ord(ch) & 0xFF if isinstance(ch, str) else (int(ch) & 0xFF)
        c = (_CRC32_TABLE[((c & 0xFF) ^ b) & 0xFF] ^ (c >> 8)) & MAX_32BIT

    u = ((MAX_32BIT ^ c) ^ 0xEDB88320) & MAX_32BIT
    return u - 0x100000000 if (u & 0x80000000) else u


def _weighted_choice(options: list, weights: list) -> str:
    return f"{random.choices(options, weights=weights, k=1)[0]}"


def _get_screen_config() -> dict:
    width_str, height_str = _weighted_choice(
        SCREEN_RESOLUTIONS["resolutions"], SCREEN_RESOLUTIONS["weights"]
    ).split(";")
    width, height = int(width_str), int(height_str)
    if random.choice([True, False]):
        avail_width = width - int(_weighted_choice([0, 30, 60, 80], [0.1, 0.4, 0.3, 0.2]))
        avail_height = height
    else:
        avail_width = width
        avail_height = height - int(_weighted_choice([30, 60, 80, 100], [0.2, 0.5, 0.2, 0.1]))
    return {"width": width, "height": height,
            "availWidth": avail_width, "availHeight": avail_height}


def _generate_webgl_hash() -> str:
    import secrets
    return hashlib.md5(secrets.token_bytes(32)).hexdigest()


def _generate_fingerprint(cookies: dict, user_agent: str) -> dict:
    cookie_string = "; ".join(f"{k}={v}" for k, v in cookies.items())
    screen_config = _get_screen_config()
    is_incognito = _weighted_choice(["true", "false"], [0.95, 0.05])
    vendor, renderer = random.choice(GPU_VENDORS).split("|")
    x78_y = random.randint(2350, 2450)

    return {
        "x1": user_agent,
        "x2": "false",
        "x3": "zh-CN",
        "x4": _weighted_choice(COLOR_DEPTH_OPTIONS["values"], COLOR_DEPTH_OPTIONS["weights"]),
        "x5": _weighted_choice(DEVICE_MEMORY_OPTIONS["values"], DEVICE_MEMORY_OPTIONS["weights"]),
        "x6": "24",
        "x7": f"{vendor},{renderer}",
        "x8": _weighted_choice(CORE_OPTIONS["values"], CORE_OPTIONS["weights"]),
        "x9": f"{screen_config['width']};{screen_config['height']}",
        "x10": f"{screen_config['availWidth']};{screen_config['availHeight']}",
        "x11": "-480",
        "x12": "Asia/Shanghai",
        "x13": is_incognito,
        "x14": is_incognito,
        "x15": is_incognito,
        "x16": "false",
        "x17": "false",
        "x18": "un",
        "x19": "Win32",
        "x20": "",
        "x21": BROWSER_PLUGINS,
        "x22": _generate_webgl_hash(),
        "x23": "false",
        "x24": "false",
        "x25": "false",
        "x26": "false",
        "x27": "false",
        "x28": "0,false,false",
        "x29": "4,7,8",
        "x30": "swf object not loaded",
        "x33": "0",
        "x34": "0",
        "x35": "0",
        "x36": f"{random.randint(1, 20)}",
        "x37": "0|0|0|0|0|0|0|0|0|1|0|0|0|0|0|0|0|0|1|0|0|0|0|0",
        "x38": "0|0|1|0|1|0|0|0|0|0|1|0|1|0|1|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0|0",
        "x39": 0,
        "x40": "0",
        "x41": "0",
        "x42": "3.4.4",
        "x43": CANVAS_HASH,
        "x44": f"{int(time.time() * 1000)}",
        "x45": "__SEC_CAV__1-1-1-1-1|__SEC_WSA__|",
        "x46": "false",
        "x47": "1|0|0|0|0|0",
        "x48": "",
        "x49": "{list:[],type:}",
        "x50": "",
        "x51": "",
        "x52": "",
        "x55": "380,380,360,400,380,400,420,380,400,400,360,360,440,420",
        "x56": f"{vendor}|{renderer}|{_generate_webgl_hash()}|35",
        "x57": cookie_string,
        "x58": "180",
        "x59": "2",
        "x60": "63",
        "x61": "1291",
        "x62": "2047",
        "x63": "0",
        "x64": "0",
        "x65": "0",
        "x66": {"referer": "", "location": "https://www.xiaohongshu.com/explore", "frame": 0},
        "x67": "1|0",
        "x68": "0",
        "x69": "326|1292|30",
        "x70": ["location"],
        "x71": "true",
        "x72": "complete",
        "x73": "1191",
        "x74": "0|0|0",
        "x75": "Google Inc.",
        "x76": "true",
        "x77": "1|1|1|1|1|1|1|1|1|1",
        "x78": {"x": 0, "y": x78_y, "left": 0, "right": 290.828125, "bottom": x78_y + 18,
                "height": 18, "top": x78_y, "width": 290.828125, "font": FONTS},
        "x82": "_0x17a2|_0x1954",
        "x31": "124.04347527516074",
        "x79": "144|599565058866",
        "x53": hashlib.md5(__import__("secrets").token_bytes(32)).hexdigest(),
        "x54": VOICE_HASH_OPTIONS,
        "x80": "1|[object FileSystemDirectoryHandle]",
    }


_B1_FIELDS = ["x33", "x34", "x35", "x36", "x37", "x38", "x39", "x42", "x43",
              "x44", "x45", "x46", "x48", "x49", "x50", "x51", "x52", "x82"]


def _generate_b1(fp: dict) -> str:
    """b1 指纹：ARC4 加密后 URL 编码，再按自定义 Base64 输出"""
    b1_fp = {k: fp[k] for k in _B1_FIELDS}
    b1_json = json.dumps(b1_fp, separators=(",", ":"), ensure_ascii=False)
    ciphertext = _arc4(B1_SECRET_KEY.encode(), b1_json.encode("utf-8")).decode("latin1")
    encoded_url = urllib.parse.quote(ciphertext, safe="!*'()~_-")

    b: list = []
    for chunk in encoded_url.split("%")[1:]:
        chars = list(chunk)
        b.append(int("".join(chars[:2]), 16))
        for j in chars[2:]:
            b.append(ord(j))
    return encode_custom(bytearray(b))


def sign_xs_common(cookie_dict: dict, user_agent: str = PUBLIC_USERAGENT) -> str:
    """生成 x-s-common 头（需要完整 cookie，含 a1）"""
    a1_value = cookie_dict.get("a1")
    if not a1_value:
        raise ValueError("生成 x-s-common 需要 a1 cookie，请重新登录小红书账号")

    fingerprint = _generate_fingerprint(cookies=cookie_dict, user_agent=user_agent)
    b1 = _generate_b1(fingerprint)

    sign_struct = dict(SIGNATURE_XSCOMMON_TEMPLATE)
    sign_struct["x5"] = a1_value
    sign_struct["x8"] = b1
    sign_struct["x9"] = _crc32_js_int(b1)
    return encode_custom(json.dumps(sign_struct, separators=(",", ":"), ensure_ascii=False))


# ══════════════════════════════════════════
# 辅助 ID
# ══════════════════════════════════════════
def get_x_t(timestamp: float | None = None) -> int:
    """x-t 头：毫秒时间戳"""
    return int((time.time() if timestamp is None else timestamp) * 1000)


def _int_to_base36(value: int) -> str:
    if value == 0:
        return "0"
    result = ""
    while value:
        value, remainder = divmod(value, 36)
        result = _BASE36_CHARS[remainder] + result
    return result


def gen_search_id() -> str:
    """搜索接口的 search_id"""
    return _int_to_base36((int(time.time() * 1000) << 64) + math.ceil(0x7FFFFFFE * random.random()))


def gen_search_request_id() -> str:
    """搜索接口的 request_id"""
    return f"{math.ceil(0x7FFFFFFE * random.random())}-{int(time.time() * 1000)}"


def gen_b3_trace_id() -> str:
    return "".join(random.choice("abcdef0123456789") for _ in range(16))


def gen_xray_trace_id() -> str:
    ts = int(time.time() * 1000)
    seq = random.randint(0, 8388607)
    part1 = format((ts << 23) | seq, "016x")
    part2 = "".join(random.choice("abcdef0123456789") for _ in range(16))
    return part1 + part2


# ══════════════════════════════════════════
# 对外主入口
# ══════════════════════════════════════════
def sign_headers(method: str, uri: str, cookie_str: str,
                 payload: dict | None = None, params: dict | None = None,
                 user_agent: str = PUBLIC_USERAGENT) -> tuple[dict, str | None]:
    """
    生成小红书请求所需的完整签名头。

    返回 (headers, body_str)：
      headers  —— 直接合并进请求头
      body_str —— POST 时必须用这个字符串作为请求体（与签名用的 content_string 字节一致）；
                  GET 时为 None

    注意：POST 的 body 必须原样使用返回值，不能另行 json.dumps，
    否则签名与请求体不一致会被平台拒绝。
    """
    cookies = parse_cookie_str(cookie_str)
    a1_value = cookies.get("a1")
    if not a1_value:
        raise ValueError("缺少 a1 cookie，无法生成签名，请在「账号连接」页面重新登录小红书账号")

    sign_payload = payload if method.upper() == "POST" else (params or {})
    headers = {
        "x-s": sign_xs(method, uri, a1_value, payload=sign_payload),
        "x-t": str(get_x_t()),
        "x-b3-traceid": gen_b3_trace_id(),
        "x-xray-traceid": gen_xray_trace_id(),
    }

    try:
        headers["x-s-common"] = sign_xs_common(cookies, user_agent)
    except Exception:
        # x-s-common 为辅助头，生成失败不阻断主签名
        pass

    body_str = None
    if method.upper() == "POST":
        body_str = json.dumps(payload or {}, separators=(",", ":"), ensure_ascii=False)

    return headers, body_str
