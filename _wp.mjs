import fs from "node:fs";
const p = "C:/Users/Administrator/.dsh/profiles/desktop/wiki/平台/entities/拼多多风控机制与应对.md";
let t = fs.readFileSync(p,"utf8");

// 1) 模块表加 pdd-guard
if (!t.includes("pdd-guard.mjs")) {
  t = t.replace(
"| `pdd-sign-scope.mjs` |",
"| `pdd-guard.mjs` | **★ 2026-11-04 新增**：**统一风控闸门**，所有 pdd 技能的单一出口。`openTask()` 准入（冷却/健康分/账号锁）+ `beforeCall()` 签名计划与节流 + `afterCall()` 错误归因记账 + `close()` 放锁。详见《拼多多技能统一风控闸门（pdd-guard）》 |\n| `pdd-sign-scope.mjs` |");
}
// 2) 修复记录补第 5 项
if (!t.includes("5. **发布链路与批量场景接入统一闸门**")) {
  t = t.replace(
"3. **9 个 pdd-* 技能的风控速查表统一升级**",
"3. **发布链路与批量场景接入统一闸门**（`pdd-publish-http` 的 `publish-v2`/`batch-publish`、`pdd-link-matrix` 的 `matrix`）：冷却中不开浏览器、批量每项强制 45s 间隔、`batch-publish` 的 shopKey 硬编码兜底改必填、`pdd-chance` 的进程内节流改落盘\n4. **9 个 pdd-* 技能的风控速查表统一升级**");
}
fs.writeFileSync(p,t,"utf8");
console.log("risk page updated: guard=", t.includes("pdd-guard.mjs"), "| fix5=", t.includes("发布链路与批量场景接入统一闸门"));
