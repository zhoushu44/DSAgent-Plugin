## 快速开始（30 秒）

**只有一条路：`steps/index.mjs`。** 没有第二套脚本。

| 你想干什么 | 用哪条命令 | 说明 |
|---|---|---|
| 只校验数据、看会怎么填 | `--product-file <json> --account <shop>` | 预览：不开浏览器、零写操作 |
| 填完停在提交前自己看 | 上面再加 `--confirm true --stop-before-submit` | 真开浏览器填 1→15 步 + 跑提交前必填校验，**不提交** |
| 真的发出去 | 上面再加 `--confirm true` | L2 写操作，必须用户明确同意 |
| 我自己上架（推荐） | `node run-to-submit.mjs <json> [shopKey]` | 薄壳，固定店铺，填完停在提交前 |
| 新类目第一次发 | 先拉模板 `scripts/pdd-category.mjs template --cat-id <id> --account <shop> --save` | 不拉模板会填不进属性/规格 |
| 批量发 | 让工作流逐轮调用本技能 | 本技能内部不循环 |

## 目录

| 文档 | 内容 |
|---|---|
| [`../SKILL.md`](../SKILL.md) | 主文档：入口、步骤、数据格式、错误处理 |
| [00-上架固定流程](00-上架固定流程.md) | **流程固定版**（两个入口、数据格式、三条硬规矩、实测矩阵） |
| [05-template-brand](05-template-brand.md) | 类目模板与品牌字段 |
| [06-ratelimit](06-ratelimit.md) | 限流与冷却 |
| [08-troubleshoot](08-troubleshoot.md) | 排障 |
| [09-实战知识库](09-实战知识库.md) | 实战知识库（属性/规格/图片/风控长文） |
| [10-规格维度适配](10-规格维度适配.md) | 规格维度适配 |
| [11-规格填充总流程](11-规格填充总流程.md) | 规格填充完整流程 |
| [11-CDP操控浏览器](11-CDP操控浏览器.md) | CDP 连接与操控细节 |

## 已经废弃的路径（不要再用）

| 旧方案 | 状态 |
|---|---|
| 纯 HTTP 上传/替换主图（`file/create`） | 19 次尝试、7 种方案、4 个账号全失败，已放弃 |
| 纯 HTTP 复制改包（复制本店商品再改） | 随旧引擎一起删除 |
| 拦截 `goodsCommit/action/edit` 改包提交 | 随旧引擎一起删除（`src/pdd-publish.ts` / `pdd-mode2`） |

> 这些方案的**结论**仍在 `docs/knowledge/平台逆向与发布机制.md` 与
> `docs/09-实战知识库.md` 里，作为逆向资产保留；脚本已经没有了。
