# 抖音/抖店风控绕过 · 实现方案（preload 注入）

> 来源：抖上货 v1.9.9 逆向实证（`electron/preloadJs/preload_doudian_base.js`）
> 核心思路：**不过滑块，直接让风控检测请求不发出去。**

---

## 一、抖店风控的三个入口（逆向所得）

抖上货 hook XHR 拦掉的请求：

```js
// ① session 检查（触发就登出/弹验证）
url.includes('/session_check')

// ② 问卷验证
url.includes('/byteshop/questionnaire/checkPutIn')

// ③ 风控服务 IP
url.includes('49.79.224.248')
```

**只要这三个不发，抖店就不会弹滑块/验证码。**

---

## 二、完整 preload 脚本

保存为 `douyin_risk_bypass.js`，放在你的 Electron 项目里：

```javascript
(function () {
    'use strict';

    // ═══════════ 配置区：按抓包结果增删 ═══════════
    const BLOCK_RULES = [
        '/session_check',                          // session 检查
        '/byteshop/questionnaire/checkPutIn',      // 问卷验证
        '49.79.224.248',                           // 风控 IP
        // 抓到新的就往这里加，格式：url.includes(字符串)
    ];

    const BLOCK_PROTOCOLS = ['bytedance://', 'snssdk1128://', 'douyinopensdk://'];

    // ═══════════ 1. XHR hook —— 核心 ═══════════
    const _XHR = XMLHttpRequest.prototype;
    const _open = _XHR.open;
    const _send = _XHR.send;
    let __token = '';

    _XHR.open = function (method, url, ...rest) {
        this._method = method;
        this._url = url;

        if (url && typeof url === 'string') {
            // ① 拦风控请求（返回假成功，让调用方以为发了）
            for (const rule of BLOCK_RULES) {
                if (url.includes(rule)) {
                    console.log('[风控绕过] 拦截:', url.slice(0, 120));
                    this.__blocked = true;
                    Object.defineProperty(this, 'readyState', { get: () => 4, configurable: true });
                    Object.defineProperty(this, 'status', { get: () => 200, configurable: true });
                    Object.defineProperty(this, 'responseText', { get: () => '{"success":true,"data":{}}', configurable: true });
                    Object.defineProperty(this, 'response', { get: () => '{"success":true,"data":{}}', configurable: true });
                    return;
                }
            }
            // ② 偷 token
            try {
                const m = url.match(/[?&]__token=([^&]+)/);
                if (m) __token = decodeURIComponent(m[1]);
            } catch (e) {}
        }
        return _open.call(this, method, url, ...rest);
    };

    _XHR.send = function (postData) {
        if (this.__blocked) {
            // 触发假的 load，让业务代码正常往下走
            setTimeout(() => {
                if (typeof this.onload === 'function') this.onload({ target: this });
                this.dispatchEvent(new Event('load'));
                this.dispatchEvent(new Event('readystatechange'));
            }, 0);
            return;
        }
        return _send.call(this, postData);
    };

    // ═══════════ 2. 拦截跳 App 验证 ═══════════
    const _open2 = window.open;
    window.open = function (url, name, features, replace) {
        if (typeof url === 'string' && BLOCK_PROTOCOLS.some(p => url.startsWith(p))) {
            console.log('[风控绕过] 拦截跳转:', url);
            return null;
        }
        return _open2.call(this, url, name, features, replace);
    };

    // location.href 也要拦
    try {
        const loc = Object.getOwnPropertyDescriptor(window.Location.prototype, 'href');
        Object.defineProperty(window.Location.prototype, 'href', {
            get() { return loc.get.call(this); },
            set(v) {
                if (typeof v === 'string' && BLOCK_PROTOCOLS.some(p => v.startsWith(p))) return;
                loc.set.call(this, v);
            },
            configurable: true,
        });
    } catch (e) {}

    // ═══════════ 3. WebSocket 风控通道（抓到就走 WS 时打开）═══════════
    // const _WS = window.WebSocket;
    // window.WebSocket = function (url, protocols) {
    //     if (BLOCK_RULES.some(r => String(url).includes(r))) {
    //         return { close(){}, send(){}, addEventListener(){}, readyState: 3 };
    //     }
    //     return new _WS(url, protocols);
    // };

    // ═══════════ 4. 暴露接口 ═══════════
    window.__risk = {
        getToken: () => __token,
        addRule: (r) => BLOCK_RULES.push(r),
        getRules: () => BLOCK_RULES,
    };

    console.log('[风控绕过] 已注入，规则数:', BLOCK_RULES.length);
})();
```

---

## 三、接入方式

### 方式 A：Electron（推荐，最稳）

```javascript
// main.js
const { BrowserWindow } = require('electron');
const path = require('path');

const win = new BrowserWindow({
    width: 1500, height: 950,
    webPreferences: {
        preload: path.join(__dirname, 'douyin_risk_bypass.js'),
        contextIsolation: false,   // 必须（要 require）
        nodeIntegration: true,     // 必须
        webSecurity: false,        // 绕过同源限制
    },
});

win.loadURL('https://fxg.jinritemai.com/ffa/g/list');
```

### 方式 B：CDP 注入（Playwright / Puppeteer）

```python
# 页面加载后注入
page.evaluate(open('douyin_risk_bypass.js', encoding='utf-8').read())
```

或 Playwright 的 `add_init_script`（每次导航自动注入，推荐）：

```python
context = browser.new_context()
context.add_init_script(open('douyin_risk_bypass.js', encoding='utf-8').read())
page = context.new_page()
page.goto('https://fxg.jinritemai.com/ffa/g/list')
```

---

## 四、如何找到你要拦的 URL（关键）

**抖店的三个入口是逆向来的，你的项目要自己抓。**

### 步骤

1. **用 Electron/Chrome 打开抖店后台**（正常登录）
2. **抓包**：DevTools → Network → Fetch/XHR
3. **触发一次风控**：高频操作 / 清 cookie 重登 / 换 IP
4. **看风控触发前 1 秒发了什么请求** —— 那就是检测请求
5. **把 URL 特征加进 `BLOCK_RULES`**

### 常见特征（抖店/抖音系）

```js
const BLOCK_RULES = [
    '/session_check',                       // 会话检查
    '/byteshop/questionnaire/checkPutIn',   // 问卷
    '49.79.224.248',                        // 风控 IP
    // 自己抓包补充：
    // '/risk/', '/verify/', '/captcha/',
    // 'verify.SM', 'rc-verify',
    // 'web-ga', '/log/sentry/v2/',          // 埋点（可选）
];
```

---

## 五、进阶：配合反调试 + 禁代理

抖上货还做了这些（抄它）：

```javascript
// 1. 反调试（Electron main 进程）
const runWithDebug = process.argv.find(e =>
    e.includes('--inspect') || e.includes('--remote-debugging-port'));
if (runWithDebug) {
    console.error('Remote debugging is not allowed');
    app.quit();
}

// 2. 不走代理（躲抓包）
app.commandLine.appendSwitch('no-proxy-server');

// 3. 忽略证书错误
app.commandLine.appendSwitch('ignore-certificate-errors');

// 4. 禁 HTTP/2（有些风控靠 H2 指纹）
app.commandLine.appendSwitch('disable-http2', 'true');

// 5. 改 UA（去 Electron 特征）
win.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...'
);
```

---

## 六、验证是否生效

注入后打开抖店，Console 应该看到：

```
[风控绕过] 已注入，规则数: 3
[风控绕过] 拦截: https://fxg.jinritemai.com/byteshop/questionnaire/checkPutIn?...
[风控绕过] 拦截: https://49.79.224.248/...
```

**然后高频操作 10 分钟，不弹滑块 = 成功。**

---

## 七、注意事项

1. **拦太多会坏功能** —— 只拦风控相关的，别拦业务接口（`/product/tproduct/*` 不能拦）
2. **`responseText` 返回假数据要匹配业务结构** —— 如果调用方要读 `data.xxx`，假 JSON 里要有对应字段，否则报错
3. **抖店改版后规则会变** —— 定期重抓包更新 `BLOCK_RULES`
4. **这只是抖店方案** —— 淘宝 baxia 是服务端同步验签，hook XHR 拦不掉（已实证）
5. **别拦 WebSocket 除非确认风控走 WS** —— 拦错会断连

---

## 八、文件

- `douyin_risk_bypass.js` —— 完整脚本（可直接用）

---

## 九、一句话

> **抖店的风控是「页面内异步发检测请求」，hook XHR 让它不发就行。**
> **淘宝的风控是「提交时服务端同步验签」，hook 拦不掉 —— 这是平台级差异。**
