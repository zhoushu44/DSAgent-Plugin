# 拼多多上架 — 目录结构

```
skills/pdd-publish/
├── templates/          ★ 模板系统（每个类目一套）
│   └── index.mjs           buildTemplate / loadTemplate / validate
│
├── modules/            ★ 组件（7 个独立组件）
│   ├── 01-image-upload/    图片/视频上传
│   ├── 02-form-input/      输入框（含 SKU 表格）
│   ├── 03-button/          按钮点击
│   ├── 04-select/          下拉选择
│   ├── 05-radio/           单选
│   ├── 06-sku-thumb/       SKU 预览图
│   ├── 07-attributes/      商品属性批量填
│   └── index.mjs           组件总入口
│
├── steps/              ★ 步骤（17 步，每步一文件）
│   ├── index.mjs           主控 run()
│   ├── step1.mjs           打开发布页
│   ├── step2.mjs           商品主图
│   ├── step3.mjs           商品标题
│   ├── step4.mjs           点下一步
│   ├── step4-wait-category.mjs  等类目渲染
│   ├── step5.mjs           白底图
│   ├── step6.mjs           商品属性
│   ├── step7.mjs           商品视频
│   ├── step8.mjs           讲解视频
│   ├── step9.mjs           商详视频
│   ├── step10.mjs          商详图
│   ├── step11.mjs          商品规格
│   ├── step12.mjs          价格库存
│   ├── step13.mjs          商品参考价
│   ├── step14.mjs          满件折扣
│   ├── step15.mjs          承诺发货时间
│   ├── step16.mjs          提交 / 存草稿
│   └── helpers/
│       ├── slider.mjs          滑块
│
└── scripts/            工具
    ├── harvest-native-props.mjs  抓属性结构（备用）
    ├── compress-images.mjs       图片压缩
    ├── img-prep.mjs              图片预处理（体积压缩到平台上限）
    └── pdd-category.mjs          类目树查询
```

> 已删除（2026-11，逻辑已吸收进 `_shared/PDD-KNOWLEDGE.md` 第十八 / 十九章）：
>
> | 文件 | 原因 |
> |---|---|
> | `imgprep.py` | 「宽度统一 750 + 超 1500 均分切分」规则已记入知识库；本目录 `img-prep.mjs` 负责体积压缩。两套并存会混淆 |
> | `analyze_spec_ui.py` | 规格区视觉识别方案（`dim_type` → 交互策略映射）已记入知识库；脚本本身硬编码了工作区外绝对路径与 API key，不适合留库 |

---

## 一、模板系统

### 建模板（每个类目一次）

```bash
node templates/index.mjs build --cat 16675 --name 纸杯
```

**唯一来源**：基座 `request()` → `/draco-ms/mms/template/mall?catId=<id>`

> ⚠️ Node 直连 fetch 或页面内 fetch 都会 40002，必须走基座。

### 模板位置

```
artifacts/pdd-templates/<类目名>-<catId>/
  template.json      完整模板
  attributes.json    属性清单
  specs.json         规格清单
```

### 现有模板

| 类目 | catId | 属性 | 规格模式 | 维度 |
|---|---|---|---|---|
| 纸杯 | 16675 | 8 | `custom` | 1（容量，自写）|
| 门贴隔音棉 | 9683 | 10 | `none` | 0 |
| 餐垫 | 22278 | 8 | `none` | 0 |
| 女短袖 | 8463 | 15 | `mixed` | 2（颜色分类 115 + 尺码 91）|

### 规格模式

| mode | 含义 | 示例 |
|---|---|---|
| `none` | 不开放规格 | 门贴、餐垫 |
| `preset` | 只能选预设值 | （暂无）|
| `mixed` | 点选 + 可自写 | 女短袖 |
| `custom` | 只能自写 | 纸杯 |

### 校验

```js
import { loadTemplate, validateAttrValues, validateSpecs } from './templates/index.mjs'

const tpl = loadTemplate(16675)

validateAttrValues(tpl, { '品牌': '爱绿森' })
// → { ok, errors, warnings, resolved:[{label, templatePid, vid, moduleId}] }

validateSpecs(tpl, [{ name: '容量', values: ['14oz'] }])
// → { ok, errors, warnings, mode, maxDims }
```

**规则**：
- 必填属性没给 → 报错
- 值不在预设但 `allowCustom=true` → 放行 + 提示
- 值不在预设且不允许自写 → 报错
- `mode=none` 却填了规格 → 报错

---

## 二、步骤

### 调用

```js
import { run } from './steps/index.mjs'

await run({
  shopKey: 'pdd_mms_xxx',
  catId: 16675,

  title: '双层中空纸杯',
  mainImages: ['E:/a.png'],
  detailImages: ['E:/d1.png'],

  attrValues: { '品牌': '爱绿森', '产地': '中国大陆' },
  specs: [{ name: '容量', values: ['14oz'] }],
  skuRows: [{ quantity: 1000, multiPrice: 10.8, price: 11.8 }],

  marketPrice: 199.9,
  batchDiscount: 9.5,
  shipmentTime: '48小时',
})
```

**输入什么就做什么，没输入的跳过。**

### 17 个步骤

| # | 步骤 | 必做 | 输入 |
|---|---|---|---|
| 1 | 打开发布页 | ✅ | `shopKey` |
| 2 | 商品主图 | ✅ | `mainImages` 1~10 张 |
| 3 | 商品标题 | ✅ | `title` ≤30 汉字 |
| 4 | 点下一步 | ✅ | 自动 |
| 5 | 白底图 | 选做 | `whiteBg` 1 张 |
| 6 | 商品属性 | 看模板 | `attrValues` |
| 7 | 商品视频 | 选做 | `carouselVideo` |
| 8 | 讲解视频 | 选做 | `explanationVideo` |
| 9 | 商详视频 | 选做 | `detailVideo` |
| 10 | 商详图 | ✅ | `detailImages` ≤50 张 |
| 11 | 商品规格 | 看模板 | `specs` |
| 12 | 价格库存 | ✅ | `skuRows` |
| 13 | 商品参考价 | ✅ | `marketPrice` > 最大单买价 |
| 14 | 满件折扣 | ✅ | `batchDiscount` 5.0~9.9 |
| 15 | 承诺发货时间 | ✅ | `shipmentTime` |
| 16 | 提交上架 | ✅ | 自动 |
| 17 | 存草稿 | 选做 | `saveOnly: true` |

---

## 三、组件（另一个 agent 维护）

| 组件 | 导出 |
|---|---|
| `01-image-upload` | `uploadImages` `probeImageRegion` `uploadAll` `UPLOAD_TARGETS` |
| `02-form-input` | `fillInput` `readInput` `countLimit` `fillFields` `listInputs` `fillSkuTable` `fillCustomSpecValues` |
| `03-button` | `clickButton` `findButton` `waitButtonReady` `listButtons` `buildXPath` |
| `04-select` | `selectOptions` `readSelected` `probeSelect` `openSelect` `listOptions` `closeAllSelects` |
| `05-radio` | `selectRadio` `readRadio` `listRadios` |
| `06-sku-thumb` | `setSkuThumbs` `probeSkuThumbs` `openThumbPicker` `waitThumbPopup` `pickThumbInPopup` |
| `07-attributes` | `fillAttributesByName` `fillAttributes` `listAttributes` `checkRequiredAttributes` |

**steps 只做编排，DOM 操作全在 components 里。**

---

## 四、关键约束

### 必须走基座

```js
const { request } = await import('.../skills/_shared/pdd-request.mjs')
await request('/draco-ms/mms/template/mall?catId=16675', {}, {
  method: 'GET', account, shopKey, page,
})
```

| 方式 | 结果 |
|---|---|
| Node 直连 fetch | ❌ 40002 |
| 页面内 fetch | ❌ 40002 |
| 基座 request() | ✅ |

### 规格判定

```js
is_spec: false          → 不开放规格
input_max_spec_num: 0   → 自定义输入维度上限（服饰的点选规格不算）
maxDims = dimensions.length    ← 用实际维度数，不是 input_max_spec_num
```

### 类目搜索

```js
GET /vodka/v2/mms/search/categories/v2?keyword=女短袖
→ cat_info_v2_lists[].cat_id_3 = 8463
```

---

## 五、实测状态

| 模块 | 状态 |
|---|---|
| 模板系统 | ✅ 4 个类目完成 |
| 步骤 1-4 | ✅ 实测通过 |
| 步骤 5-16 | 已写好，待验收 |
| 组件 | ✅ 7 个就绪 |
