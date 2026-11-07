# PDD 纯 Node 通道 · 第二轮（参数与限流）

> 2026-11-07
> 本轮解决：参数命名规则、54001 的真实含义、可用接口扩到 8 个

---

## 一、本轮三个关键发现

### ① `54001` 的真正含义（最重要）

```
msg = "操作太过频繁，请稍后再试"
```

**`54001` 不只是「签名无效」，它还包含「限流」。**

这解释了之前所有的困惑：
- `goods.list` 反复失败 → 其实是我密集测试触发了限流
- 浏览器也失败 → 因为**同一个账号**被限流，跟通道无关

**教训：** 看到 54001 要先看 `error_msg`：
```js
if (ec === 54001) {
  const msg = j.error_msg || ''
  if (/频繁|稍后/.test(msg)) → 限流，等 60~90 秒
  else → 真的签名/参数问题
}
```

### ② 参数命名是驼峰，不是下划线

| 接口 | ❌ 错误 | ✅ 正确 |
|---|---|---|
| `goods.skuInfo` | `goods_id` / `goods_sn` / `goods_ids[]` | **`goodsId`** |
| `goods.batchOnSale` | `goodsId` | **`goodsIds: [123]`** |
| `goods.commitUpdate` | — | `goodsId` + `goods_commit_id`（混用！） |

**同一个接口族里命名不统一**，只能靠报错信息试。

### ③ 返回结构是 `result.list`，不是 `result.goodsList`

```json
{
  "total": 180,
  "list": [
    { "goods_id": 1025317086069, "goods_name": "...", "goods_commit_id": 205398721152 }
  ]
}
```

注意：**返回字段是下划线（`goods_id`），请求参数是驼峰（`goodsId`）**。两套规则。

---

## 二、可用接口扩到 8 个

| 接口 | 路径 | 参数 | 状态 |
|---|---|---|---|
| `goods.listGlide` | `/glide/v2/mms/addProperties/goodsList` | `{page_num, page_size, only_query_no_props_goods:false, only_query_un_auth_brand:false}` | ✅ total=180 |
| `goods.skuInfo` | `/vodka/v2/mms/query/sku/info` | `{goodsId}` | ✅ 完整 SKU 数据 |
| `goods.batchOnSale` | `/vodka/v2/mms/batchOnSale` | `{goodsIds:[id]}` | ✅ |
| `goods.count` | `/vodka/v2/mms/query/display/mall_goods/count` | `{}` | ✅ |
| `goods.copyedExist` | `/vodka/v2/mms/query/display/goods_copyed/is_exist` | `{}` | ✅ |
| `goods.newStyleGray` | `/vodka/v2/mms/newStyleGoods/gray/queryNewStyleGoodsGray` | `{}` | ✅ |
| `common.status` | `/vodka/v2/mms/common/query/status` | `{}` | ✅ |
| `goods.list` | `/vodka/v2/mms/query/display/mall/goodsList` | 完整 body（见下） | ⚠️ 限流中 |

### `goods.list` 的完整 body（从抓包还原）

```json
{
  "pre_sale_type": 4,
  "page": 1,
  "out_goods_sn_gray_flag": true,
  "shipment_time_type": 3,
  "is_onsale": 1,
  "sold_out": 0,
  "size": 10
}
```

---

## 三、`only_query_un_auth_brand` 的影响

| 值 | total | 说明 |
|---|---|---|
| `true` | 0 | 只返回「未授权品牌」商品 |
| `false` | **180** | 全部商品 |

**默认必须传 `false`，否则列表是空的。**

---

## 四、性能实测

| 接口 | 耗时 |
|---|---|
| 首次（含沙箱初始化） | 1830ms |
| 后续调用 | **125~162ms** |
| 浏览器通道 | 28000ms |

---

## 五、限流阈值（经验值）

| 操作 | 建议间隔 |
|---|---|
| 只读接口 | ≥ 3 秒 |
| 写操作（上下架/改库存） | ≥ 10 秒 |
| 密集测试后 | 等 60~90 秒 |

**本轮因为连测 20+ 个接口，触发了两次限流。**

---

## 六、错误码速查（本轮新增）

| 码 | 含义 | 处理 |
|---|---|---|
| `1000000` | 成功 | — |
| `54001` + "操作太过频繁" | **限流** | 等 60~90 秒 |
| `54001` + 其它 | 风控/签名 | 换签名重试 |
| `3000000` | 参数校验失败 | 看 `error_msg` 补参数 |
| `600009` | 商品不存在 | 换 ID |
| `600001` | 删除失败 | — |
| `2000000` | 无权限 | — |

---

## 七、踩坑记录

| # | 坑 | 教训 |
|---|---|---|
| 1 | 以为 54001 都是签名问题 | **先看 error_msg，区分限流** |
| 2 | 参数用下划线 | **请求参数驼峰，返回字段下划线** |
| 3 | 取 `result.goodsList` | **实际是 `result.list`** |
| 4 | `only_query_un_auth_brand` 默认 true | **必须显式传 false** |

---

## 相关

- [[PDD-VODKA-INTEGRATION]] — 第一轮集成
- [[SUCCESS-VODKA]] — 突破过程
- [[JVM2-结论]] — JVM2 逆向
