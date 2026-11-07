# -*- coding: utf-8 -*-
"""从 DSH 凭证库读账号（通过 Node Call 解密，Python 侧 helper）"""
import json
import os
import subprocess

_NODE_HELPER = r"""
import('%s') as m:
"""
# 上面不能写 Python，改写成 JS 内联
_JS = r"""
const { CredentialStore } = await import('file:///%s/lib/services/credential-store.js');
const path = await import('node:path');
const os = await import('node:os');
// ★ ES module 里 argv[1] 是脚本路径，平台参数在 argv[2]
const platform = process.argv[2] || 'douyin_shop';
const store = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'));
const accs = store.listAccounts().filter(a => a.platform === platform && a.status !== 'invalid');
process.stdout.write(JSON.stringify(accs.map(a => ({
  shopKey: a.shop_key, nickname: a.nickname || '', status: a.status || '',
  cookies: a.cookies || {}
}))));
"""


def _plugin_root():
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(here)


def list_accounts(platform):
    js = _JS % _plugin_root().replace("\\", "/")
    js_file = os.path.join(os.environ.get("TEMP", "."), "_dsh_list_acc.mjs")
    with open(js_file, "w", encoding="utf-8") as f:
        f.write(js)
    try:
        r = subprocess.run(["node", js_file, platform], capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            print("[py_cred] node 失败: %s" % (r.stderr or "")[:200], file=__import__("sys").stderr)
            return []
        return json.loads(r.stdout or "[]")
    except Exception as e:
        print("[py_cred] 异常: %s" % e, file=__import__("sys").stderr)
        return []


def get_account(platform, shop_key=None):
    """返回 {shopKey, cookies, profileDir, nickname}"""
    accs = list_accounts(platform)
    if not accs:
        return None
    a = None
    if shop_key:
        a = next((x for x in accs if x.get("shopKey") == shop_key), None)
    if a is None:
        a = accs[0]
    sk = a.get("shopKey") or ""
    prof = os.path.join(os.path.expanduser("~"), ".dsh", "browser-profiles", "accounts", sk)
    return {
        "shopKey": sk,
        "nickname": a.get("nickname") or "",
        "cookies": a.get("cookies") or {},
        "profileDir": prof,
    }
