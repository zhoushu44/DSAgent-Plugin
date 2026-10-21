# 知乎·文章发布(HTTP)（zhihu-publish-http）

RE HTTP 三步链路发布知乎专栏文章，不走 DOM 逐格填写。

| 文件 | 说明 |
|---|---|
| [contract.json](contract.json) | 参数契约（file / content / title / account / dry / confirm）|
| [SKILL.md](SKILL.md) | 技能全文：触发词、边界、接口清单、错误处理 |
| [scripts/run.py](scripts/run.py) | Python 入口包装（宿主只认 .py）|
| [scripts/publish.mjs](scripts/publish.mjs) | Node 主逻辑 |

## 用法

```bash
# 1) 预览（零写操作）
python3 scripts/run.py --file "D:/notes/article.md"

# 2) 试跑（建草稿 + 写正文，不发布）
python3 scripts/run.py --file "D:/notes/article.md" --dry

# 3) 正式发布（L2，不可撤销）
python3 scripts/run.py --file "D:/notes/article.md" --confirm true
```

## 三步链路

```
POST  /api/articles/drafts          建草稿
PATCH /api/articles/{id}/draft      写标题 + 正文（HTML）
PUT   /api/articles/{id}/publish    发布
```

`zhuanlan` 域，只需 `x-xsrftoken`，无 `x-zse-96` 签名。

## 文章格式

Markdown 文件：首行 `# 标题`，第一个 `## ` 起是正文。支持标题层级、表格、列表、引用、加粗、行内代码、分割线。**图片语法不支持**。

## 依赖

- Node.js（`DSAGENT_NODE_BIN` 可覆盖）
- Chrome / Edge
- 「账号连接」已绑定 zhihu 账号且登录态有效
