import fs from "node:fs";
const p = "C:/Users/Administrator/.dsh/profiles/desktop/wiki/平台/entities/拼多多风控机制与应对.md";
let t=fs.readFileSync(p,"utf8");
// 把模块表里 pdd-sign-scope 的说明同步成 signPlan 语义
t=t.replace(
"| `pdd-sign-scope.mjs` | **★ 2026-11-04 新增**：Anti-Content 注入范围唯一权威。`needAntiContent(url)` / `ANTI_CONTENT_WHITELIST`（162 条）/ `matchWhitelistRule` / 推广域排除表 / 老 XHR 域名白名单 |",
"| `pdd-sign-scope.mjs` | **★ 2026-11-04 新增**：签名范围唯一权威。**`signPlan(url)` 推荐入口** → `{headerAnti, bodyCrawlerInfo, whitelistRule}`；另含 `needAntiContent`（域名判据）/ `needCrawlerInfo`（162 条路径判据）/ `ANTI_CONTENT_WHITELIST` / `matchWhitelistRule` / 推广域排除表 / 静态域加固排除 |");
// 修正「历史修复」段的措辞
t=t.replace(
"1. **签名范围从「全量」改为「按 162 条白名单选择性注入」**（`pdd-http` + `pdd-client` 各改一处，新增 `pdd-sign-scope.mjs`）",
"1. **签名范围拆成两个独立条件**（`pdd-http` + `pdd-client` 各改两处，新增 `pdd-sign-scope.mjs` 的 `signPlan()`）——**注意：本轮我先误把两者合并成「按 162 白名单决定一切」，被真机 54001 证伪后回滚重做**，详见《拼多多风控代码实现缺陷与修复清单》34-1");
fs.writeFileSync(p,t,"utf8");
console.log("risk page modules table synced");
