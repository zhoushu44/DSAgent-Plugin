# -*- coding: utf-8 -*-
"""
规格区/属性区 视觉分析器（供 Node 调用）

用法：
  python analyze_spec_ui.py <截图路径> <目标维度名> <值1,值2,...>

输出（stdout JSON）：
  {
    "ok": true,
    "dim_type": "text-input|color-input|checkbox|dropdown|unknown",
    "strategy": "type-and-blur|click-checkbox|click-dropdown|type-and-enter",
    "blur_target": "描述失焦位置",
    "element_hints": ["选择或输入主色", "..."]
  }

模型：cn:glm-5v-turbo（实测可用，能正确读图）
"""
import sys, json, base64, urllib.request, ssl, re
from pathlib import Path

sys.path.insert(0, r'E:\360MoveData\Users\Administrator\Desktop\童装\artifacts\pajama')
from imgkit import BASE, KEY

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def ask_vision(img_path: str, prompt: str, model: str = 'cn:glm-5v-turbo') -> str:
    b64 = base64.b64encode(Path(img_path).read_bytes()).decode()
    ext = Path(img_path).suffix.lower().lstrip('.')
    mime = 'png' if ext == 'png' else 'jpeg'
    payload = {
        'model': model,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': prompt},
                {'type': 'image_url', 'image_url': {'url': f'data:image/{mime};base64,{b64}'}},
            ],
        }],
        'temperature': 0.1,
    }
    req = urllib.request.Request(
        f'{BASE}/chat/completions',
        data=json.dumps(payload).encode(),
        method='POST',
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
        j = json.loads(r.read().decode())
        return j['choices'][0]['message']['content'].strip()


def analyze(img_path: str, dim_name: str, values: list) -> dict:
    prompt = f"""这是一个拼多多商品发布页的「商品规格」区域截图。

我要填写规格维度「{dim_name}」，值是：{', '.join(values)}

请仔细观察截图，回答以下问题（只输出 JSON，不要任何解释）：

{{
  "dim_type": "这个规格维度的填写控件类型，从以下选一个：text-input(纯文本输入框) / color-input(带色块的输入) / checkbox(可勾选的预设值) / dropdown(下拉选择) / unknown",
  "strategy": "推荐的填写动作，从以下选一个：type-and-blur(输入文字后点空白处失焦) / type-and-enter(输入文字后按回车) / click-checkbox(点击复选框) / click-dropdown(点下拉选) / unknown",
  "blur_target": "如果需要失焦，应该点哪里（用截图里能看到的中文文字描述，比如'规格区标题左侧空白'）",
  "element_hints": ["截图里与这个维度相关的输入框的 placeholder 文字或标签，最多3个"],
  "confidence": "high / medium / low"
}}

注意：
- 如果看到输入框里有「选择或输入主色」，说明是 color-input
- 如果看到一排可勾选的小方框，说明是 checkbox
- 如果只有普通文本输入框，说明是 text-input
- 维度名可能是「容量」「型号」「尺寸」「颜色分类」等任意名称，不要假设一定是颜色"""

    raw = ask_vision(img_path, prompt)

    # 从回复里抠 JSON（模型可能带 markdown 代码块）
    m = re.search(r'\{[\s\S]*\}', raw)
    if not m:
        return {'ok': False, 'error': 'no json in reply', 'raw': raw[:300]}
    try:
        obj = json.loads(m.group(0))
        obj['ok'] = True
        obj['raw'] = raw[:300]
        return obj
    except Exception as e:
        return {'ok': False, 'error': f'json parse: {e}', 'raw': raw[:300]}


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(json.dumps({'ok': False, 'error': 'usage: analyze_spec_ui.py <img> <dim> <v1,v2,...>'}, ensure_ascii=False))
        sys.exit(2)

    img = sys.argv[1]
    dim = sys.argv[2]

    # ★ 属性区模式：第二个参数是 __ATTR_MODE__，第三个参数直接是 prompt
    if dim == '__ATTR_MODE__':
        prompt = sys.argv[3]
        try:
            raw = ask_vision(img, prompt)
            m = re.search(r'\{[\s\S]*\}', raw)
            if not m:
                res = {'ok': False, 'error': 'no json in reply', 'raw': raw[:300]}
            else:
                obj = json.loads(m.group(0))
                obj['ok'] = True
                obj['raw'] = raw[:300]
                res = obj
        except Exception as e:
            res = {'ok': False, 'error': f'{type(e).__name__}: {e}'}
        print(json.dumps(res, ensure_ascii=False))
        sys.exit(0)

    vals = [v for v in sys.argv[3].split(',') if v]
    try:
        res = analyze(img, dim, vals)
    except Exception as e:
        res = {'ok': False, 'error': f'{type(e).__name__}: {e}'}
    print(json.dumps(res, ensure_ascii=False))
