# DS上架工具 —— 安装与豆包配置

## 这是什么

淘宝商品上架 + 商品数据采集的本地引擎，通过 MCP 供豆包（或任何 MCP 客户端）调用。
逆向（签名/Cookie/页面驱动）全部在本引擎内部，模型只见到 4 个标准工具。

## 每台新电脑安装（约 10 分钟）

1. 把整个 `DS上架工具` 文件夹拷到桌面（或任意位置）；
2. 装 Node.js（≥18）：https://nodejs.org 下载 LTS 安装包，一路下一步；
   - 检查：开 PowerShell 输入 `node -v` 有版本号即 OK；
3. 装 Google Chrome（引擎用无界面 Chrome 驱动，一般电脑已装）；
4. 首次登录：双击 `login-taobao.ps1`，弹出窗口里用手机淘宝扫码，登录态存本机 profile；
5. 更新到最新引擎：双击 `update.ps1`。

## 豆包侧配置（一次）

豆包 PC 版 → 设置 → MCP / 扩展 → 添加 MCP Server：

- 命令：`node`
- 参数：`C:\Users\<你的用户名>\Desktop\DS上架工具\mcp-server.cjs`

配置后豆包里会出现 3 个工具：

| 工具 | 作用 | 是否动真格 |
|---|---|---|
| publish_preview | 上架预览：完成全部填写，返回预览+taskId | 否 |
| publish_confirm | 确认提交（需 taskId，10 分钟内有效） | **是** |
| check_listing | 买家页验证：标题/价格/是否已下架 + 截图 | 否 |

## 商品 JSON 格式

```json
{
  "catId": 50006119,
  "title": "陶瓷马克杯办公水杯定制",
  "price": "19.9", "stock": "200", "itemNo": "SKU001",
  "images": ["D:\\图\\杯子主图.jpg"],
  "specs": [{ "name": "颜色分类", "values": [{ "value": "白色" }, { "value": "黑色" }] }],
  "skus": [
    { "specs": { "颜色分类": "白色" }, "price": "19.9", "stock": "100", "outerId": "SKU001-W" },
    { "specs": { "颜色分类": "黑色" }, "price": "19.9", "stock": "100", "outerId": "SKU001-B" }
  ],
  "attributes": { "适用场景": "办公" },
  "fillAllAttrs": true
}
```

- `catId`：叶子类目 ID（找卖家要，或用采集工具从在售商品里拿）；
- `title`：≤30 个汉字（60 字符）；
- `fillAllAttrs: true`：自动把该类目所有可填属性配值（品牌除外，品牌必须人工）；
- 服装类目可加 `sizeTable: { "M": ["160","50","90"], "L": ["165","55","94"] }`。

## 类目 ID 怎么拿

引擎的 `resolve-category` 还没包进 MCP；临时办法：给豆包的商品 JSON 里直接写 catId（从卖家后台或同类商品页面拿）。

## 常见问题

- **登录态失效**：工具会返回 `Cookie 缺登录态` / 页面跳登录——重新跑一次 `login-taobao.ps1`；
- **预览 10 分钟没确认**：taskId 过期，重新 preview；
- **提交后没结果**：看 `out\` 目录里的截图，提交成功页会显示商品编号。
