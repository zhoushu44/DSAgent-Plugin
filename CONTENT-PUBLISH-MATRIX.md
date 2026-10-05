# 内容发布型平台接入规范

> 参照实现：`bilibili-publish.ts` / `douyin-publish.ts` / `xiaohongshu-publish.ts` / `zhihu-publish.ts`
> 适用范围：**发布视频/笔记/文章**的平台（抖音、B站、小红书、知乎、微博、视频号、公众号 等）
> **不适用**：商品上架（淘宝/拼多多/1688 等——有类目树和属性表，见 `PUBLISH-MATRIX.md`）

---

## 一、与商品上架的本质区别

内容发布**没有类目树、没有属性表、没有下拉枚举**。它的"字段"是：

| 字段 | 类型 | 每平台是否有 |
|---|---|---|
| 标题 | 文本（有字符上限） | 都有 |
| 描述/正文 | 文本或富文本 | 都有（知乎是 Draft.js 富文本，其他多为纯文本/textarea） |
| 标签/话题 | 文本数组（有数量上限） | B站最多 10 个、抖音 5 个、小红书无显式标签但有 #话题 |
| 封面 | 图片 | B站有、抖音自动截取、小红书可选、知乎无 |
| 视频 | 视频文件 | 抖音/B站/小红书有 |
| 图片 | 图片数组 | 小红书/知乎有 |

所以内容发布的规范不是"拉属性表 + AI 选枚举值"，而是**"上传素材 + 填文本字段 + 等平台处理"**。

---

## 二、为什么必须走浏览器

和商品上架同理——但原因不同：
1. **上传素材是 multipart 二进制**，网关不支持
2. **编辑器是 React 受控组件**，直接 setter + input 事件才生效，纯 HTTP POST 无法填
3. **知乎正文是 Draft.js raw contentState**，需带 x-xsrftoken + 站点签名，浏览器路线下页面自身完成全部序列化与签名

---

## 三、标准发布流程（8 步，顺序固定）

每个内容发布平台的主函数都按这 8 步走：

```
1. confirm 门禁     — 不带 confirm=true 只返回预览，不执行
2. 账号 + Profile 锁  — selectAccount + tryAcquireProfile（按目录加锁）
3. 启动浏览器         — headless: false（可见窗口，用户能看过程/人工处理滑块）
4. 注入 Cookie        — 复用已绑定的登录态
5. 打开发布页 + 检测登录态失效 — 被重定向到 login 页 = token_expired
6. 上传素材           — input[type=file] + uploadFile
7. 等编辑页加载       — 上传完自动跳编辑页，等 React 渲染 + 转码回填
8. 填字段 → 关弹窗 → 提交 → 检测风控 → 成功判定
```

---

## 四、每步的关键约束

### 1. confirm 门禁（两步走）
```typescript
if (opts.confirm !== true) {
  return { ok: false, needConfirm: true, text: buildPreview(...) }
}
```
**永远先返回预览，用户明确同意后才带 confirm=true 重调。** 发布是 L2 真实副作用，不可撤销。

### 2. 账号 + Profile 锁
- `selectAccount` — 多账号时让用户选（`need_account_choice`）
- `tryAcquireProfile` — 按浏览器 Profile 目录加锁，拦住「发布与登录窗口同时启动」跨模块撞锁
- 释放：`releaseProfile`（finally 块里）

### 3. 启动浏览器
- **headless: false**——可见窗口，原因有二：① 用户应能看到发布过程 ② 出现滑块时可人工处理
- 复用已绑定的 Chrome/Edge Profile 目录（与登录/风控验证共享）

### 4. 注入 Cookie
从 CredentialStore 取该账号的 Cookie，`page.setCookie` 注入。

### 5. 打开发布页 + 登录态失效检测
```typescript
await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
const landedUrl = page.url()
if (/login|passport|sso/i.test(landedUrl)) {
  return { ok: false, failureKind: 'token_expired', text: '登录态已失效...' }
}
```
**给模型明确的失败类型，不是空等超时。** 登录态失效 → 返回 `token_expired`，引导用户重新登录。

### 6. 上传素材
```typescript
const fileInput = await page.$('input[type=file]')
if (!fileInput) return { ok: false, failureKind: 'api_error', text: '未找到文件上传控件' }
await fileInput.uploadFile(videoPath)  // 或图片数组
```
- 视频平台：单个视频文件
- 图文平台：图片数组，逐张上传或批量
- B站额外有封面图：上传完视频后单独上传封面

### 7. 等编辑页加载
上传完平台会**自动跳编辑页**，需要等：
- URL 跳转完成
- React 组件渲染
- 视频转码状态回填（抖音/B站）

**超时处理**：`UPLOAD_WAIT_MS`（90s）内没跳编辑页 → 报失败（可能视频格式不支持/被风控拦截/页面改版）。

### 8. 填字段 → 关弹窗 → 提交 → 风控 → 成功

**关闭引导弹窗**（"我知道了"等）——每个平台都有，不关会挡住后续操作。

**填字段**——每种字段类型填法不同：

| 字段类型 | 填法 | 关键 |
|---|---|---|
| 标题（React 受控 input） | setter + input 事件 | 不能直接 `el.value = x`，要用 `Object.getOwnPropertyDescriptor(proto, 'value').set` |
| 描述（textarea） | setter + input 事件 | 同上 |
| 标签（B站） | `parseTags` 分割 + 逐个输入 + 回车确认 | 最多 10 个、单个 ≤20 字；去重 |
| 话题（小红书 #） | 在正文里插入 `#话题 ` | 无独立标签框 |
| 正文（知乎 Draft.js） | 聚焦编辑器 → 逐段粘贴 | **不能直接 setDraftState**，要模拟输入 |

**提交** → 检测风控 → 成功判定。

---

## 五、各平台差异对照

| 维度 | B站 | 抖音 | 小红书 | 知乎 |
|---|---|---|---|---|
| 素材 | 视频 + 封面 | 视频 | 视频 或 图片 | 纯文本 |
| 标题上限 | 80 字 | 30 字 | 20 字 | 100 字 |
| 标签 | ✅ 最多 10 个 | ✅ 5 个 | ❌（#话题在正文） | ❌ |
| 描述/正文 | 简介 2000 字 | 描述 1000 字 | 正文 1000 字 | Draft.js 富文本 |
| 封面 | ✅ 单独上传 | 自动截取 | 可选 | ❌ |
| 编辑器类型 | textarea | React 受控 | React 受控 | Draft.js |
| 成功标志 | URL 跳转 + 文字 | URL 跳转 | URL 跳转 | URL 跳转 |
| 风控 | baxia 滑块 | 验证码 | 验证码 | 无滑块 |
| 分区/声明 | ✅（选分区+创作声明） | ❌ | ❌ | ❌ |

**三个关键差异**：
1. **编辑器类型**——textarea 最简单（直接 setter）；React 受控要用原生 setter + input 事件；Draft.js 最复杂（要模拟粘贴/逐段输入）
2. **标签处理**——B站是独立标签框（逐个输入+回车）；小红书无标签框，#话题嵌在正文里
3. **封面**——B站单独上传；抖音自动截取（不用管）；知乎无封面

---

## 六、内容发布不需要的（与商品上架的区别）

| 机制 | 商品上架 | 内容发布 |
|---|---|---|
| 类目匹配 | ✅ 必须选叶子类目 | ❌ 无类目树 |
| 属性表拉取 | ✅ readAttrItems | ❌ 无属性表 |
| 枚举选值 | ✅ pickPropValue | ❌ 无下拉枚举 |
| attrCache | ✅ 省模型调用 | ❌ 不适用（每条内容标题/描述都不同） |
| maxlength 截断 | ✅ 类目规则优先 | ✅ 但来源不同（DOM maxlength 或硬编码上限） |
| 选值证据 | ✅ 候选N项/缓存命中 | ❌ 无候选选择（文本是 AI 生成） |
| 品牌跳过 | ✅ 授权风险 | ❌ 无品牌字段 |

---

## 七、新平台接入检查清单

接一个新的内容发布平台时，照这张清单走：

### 页面锚点实测（必须真机）
- [ ] 发布/投稿入口 URL
- [ ] 文件上传控件选择器（`input[type=file]`）
- [ ] 编辑页 URL 特征（上传完跳到哪）
- [ ] 标题输入框选择器 + 字符上限
- [ ] 描述/正文输入框选择器 + 字符上限
- [ ] 标签框选择器（有则逐个输入+回车；无则在正文插 #话题）
- [ ] 封面上传控件（有则单独处理）
- [ ] 提交按钮选择器
- [ ] 成功标志（URL 跳转？文字匹配？）
- [ ] 引导弹窗（"我知道了"等，需提前关闭）
- [ ] 风控检测（滑块？验证码？）

### 函数实现（3 个标准函数）
- [ ] `selectAccount` — 多账号选择
- [ ] `buildPreview` — 预览文案（confirm 前给用户看）
- [ ] `xxxPublish` — 主函数（8 步流程内联）

### 关键约束
- [ ] **两步走**：不带 confirm 只返回预览
- [ ] **headless: false**：可见窗口
- [ ] **Profile 锁**：tryAcquireProfile + releaseProfile
- [ ] **登录态失效**：goto 后检测 URL 跳 login 页 → token_expired
- [ ] **React 受控组件**：用原生 setter + input 事件
- [ ] **上传超时**：UPLOAD_WAIT_MS 内没跳编辑页 → 报失败
- [ ] **关弹窗**：引导弹窗提前关
- [ ] **L2 风险标注**：不可撤销的真实操作

### 各平台特有项
- [ ] B站：`parseTags`（分割+去重+≤10个+≤20字）、封面上传、选分区、创作声明
- [ ] 抖音：自动截取封面（不用管）、话题在描述里
- [ ] 小红书：图片/视频二选一、#话题嵌正文
- [ ] 知乎：Draft.js 富文本（逐段粘贴，不能直接 setDraftState）

---

## 八、各平台现状对照

| 平台 | 视频 | 图片 | 标签 | 封面 | 富文本 | 两步走 | 风控 | 现状 |
|---|---|---|---|---|---|---|---|---|
| B站 | ✅ | — | ✅ parseTags | ✅ 单独 | — | ✅ | ✅ | **完整** |
| 抖音 | ✅ | — | — | 自动 | — | ✅ | ✅ | **完整** |
| 小红书 | ✅ | ✅ | — | 可选 | — | ✅ | ✅ | **完整** |
| 知乎 | — | — | — | — | ✅ Draft.js | ✅ | ✅ | **完整** |

**待接（按此规范）**：微博、视频号、公众号、TikTok、YouTube、Instagram 等内容发布平台。
