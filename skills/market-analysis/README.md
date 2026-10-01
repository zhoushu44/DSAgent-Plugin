# market-analysis（淘宝商品市场分析）

当前统一名称：

- skill 名称：`market-analysis`
- 命令行模块：`market_analysis`

通过淘宝搜索页获取指定关键词下的商品市场数据，分析价格分布、标题统计以及商品多维度信息。

## 特性

- 默认自动获取一批靠前商品做分析
- 淘宝 MTOP 请求经 Connect `POST /api/v1/proxy` 代理（技能进程不持有 cookie）
- 运行时由 QIWork 注入 `{workspace}/.qiwork/runtime/`
- 店铺绑定经 `GET /api/v1/accounts?include_cookie=false` 获取 `shop_key`（需 `pip install -e .` 安装 `httpx`）
- 执行后会额外生成一份 HTML 报告，结论只基于本次真实抓到的数据
- 结果文件统一保存在当前智能体 workspace 的 `artifacts/` 目录（形如 `~/.QIWork/users/{user_id}/workspaces/{agent_id}/artifacts/`）

## 最简单的用法

```bash
cd "{this_skill_dir}"
python -m market_analysis "帮我查看手机的趋势"
```

查看使用指南：

```bash
cd "{this_skill_dir}"
python -m market_analysis guide
```

## 自然语言示例

- `帮我看看手机的趋势`
- 排序方式支持：
  `按综合排序看看手机壳`
  `按销量排序看看耳机市场`
  `按信用排序看看女装`
  `按价格从低到高看看水杯`
  `按价格从高到低看看电脑桌`
- `帮我看浙江发货的女装`
- `帮我看 100 元以上的手机壳`
- `帮我看 300 元以下的手机壳`
- `帮我看 200 到 500 元的蓝牙耳机`
- `帮我分析前 200 个商品手机壳市场`

## 手动命令行时常用的可选项

- 想看发货地：`--location 浙江`
- 想按销量看：`--sort sale`
- 想改数量：`--item_limit 200`
- 想限制价格：`--price_min 200 --price_max 500`
- JSON 同时输出到 stdout 并写入 `{workspace}/artifacts/`；商品明细另写入 Connect skill-cache

## 登录凭证

在 QIWork 桌面应用中完成淘宝「平台连接」登录，并将该账号绑定到当前智能体。

执行技能时由 Connect 根据智能体绑定代理平台请求，技能进程不持有 cookie，无需在技能内单独登录。

## 产物路径

| 类型 | 路径 |
|------|------|
| Connect skill-cache | 表 `cache_market_analysis_*`（按 shop_key） |
| JSON/CSV/HTML | `{workspace}/artifacts/` |

`workspace` 默认：`~/.QIWork/users/{user_id}/workspaces/{agent_id}/`
