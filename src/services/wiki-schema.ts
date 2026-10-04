/**
 * 八域本体 Schema 注册表 —— 移植 Accio 的「商家私域知识 Wiki」本体。
 *
 * 来源：Accio 明文的 `wiki-skills/merchant-wiki-compiler/references/schema/`
 * （八域：商品 / 店铺 / 客户 / 经营 / 平台 / 资产 / 接待 / 概念）。
 * 本文件把那份 Markdown 字段清单**固化成可执行的数据**，用于：
 *   1. 生成「锁定模板」（见 wiki-frontmatter.ts）
 *   2. 校验写入的页面（字段名、枚举、必抓项）
 *   3. 给模型列出「本域该填哪些字段」的清单
 *
 * ★ 三条 Accio 的核心设计原则，在本文件中显式落为数据：
 *
 *   ① **实时数据不入 wiki**。平台能直接导出的挂牌价、库存、销量、访客数属于 raw；
 *      进 wiki 的应是「表现摘要 + 对比基准 + 判断」，而不是裸指标数值。
 *      → 体现为各域 `boundary`（边界说明）。
 *
 *   ② **披露分级**。字段级 `disclosure` 声明「可对外 / 仅内部 / 机密」，
 *      机密字段（价格底线、成本、客户名单、财务数据）不得进入对外回答。
 *      → 体现为字段级 disclosure，`filterByDisclosure()` 据此过滤。
 *
 *   ③ **概念域独立成域**，是各域字段口径的唯一出处。
 *      → 概念域 6 个字段里 `定义`/`计算方式`/`统计范围` 为硬性。
 *
 * 字段名一律保持 Accio 的中文原文，不自创、不改写 —— 这样两边可以逐字对照。
 */

/** 披露等级（Accio 三档） */
export type Disclosure = '可对外' | '仅内部' | '机密'

/** 页面形态：实体 or 概念 */
export type PageKind = '实体' | '概念'

/** 字段义务（Accio 三层） */
export type FieldDuty =
  /** 必出现：整块有则必须提取；块内字段可缺 */
  | 'required-block'
  /** 必有值：拿不到就放弃建页，而不是编造 */
  | 'required-value'
  /** 必抓：raw 里有就必须提取，没有可省略（但需在 log 记「达标待办」） */
  | 'must-grab'
  /** 可选：raw 碰巧有才填，不为它推测 */
  | 'optional'

/** 一个字段的定义 */
export interface FieldDef {
  /** 中文字段名（逐字照抄 Accio） */
  name: string
  /** 字段说明 */
  desc: string
  duty: FieldDuty
  /** 字段级披露等级；未声明则继承页级 */
  disclosure?: Disclosure
}

/** 字段分组（对应 Accio schema 的 `领域字段集` 内部层级） */
export interface FieldGroup {
  /** 分组名，如「商品基础判断」 */
  name: string
  fields: FieldDef[]
}

/** 一个域的定义 */
export interface DomainDef {
  /** 域中文名 */
  name: string
  /** 边界一句话 —— 「什么不进本域」比「什么能进」更重要 */
  boundary: string
  /** 什么时候读它（raw 命中什么） */
  whenToRead: string
  /** 实体子类型枚举；空数组表示该域为单一形态，frontmatter 不得出现 `实体子类型` */
  subtypes: string[]
  /** 实体识别字段（建页锚点，第一项为必有值） */
  identity: FieldDef[]
  /** 领域字段集 */
  groups: FieldGroup[]
  /** 意图字段集（检索路由） */
  intent: FieldDef[]
  /** 正文章节清单 */
  sections: string[]
}

/* ────────────────────────── 通用顶层字段（八域共有） ────────────────────────── */

/**
 * 顶层检索标签 + 页面归属四项。
 *
 * Accio 的设计意图：**模型只看这十行就能判断「这页是什么、要不要打开」**，
 * 无需读正文。因此这十项是强制的，且 `title` 必须与正文 H1、文件名三者一致
 * （render 阶段会校验）。
 */
export const TOP_LEVEL_FIELDS: FieldDef[] = [
  { name: 'type', desc: '页面形态，取「实体」或「概念」两值之一', duty: 'required-value' },
  { name: 'title', desc: '页面标题，与正文 H1、文件名保持一致', duty: 'required-value' },
  { name: 'description', desc: '一句话说清这页是什么 —— 身份定位加关键规格或适用边界，供检索预览，不堆砌字段', duty: 'required-value' },
  { name: 'resource', desc: '本页内容来自的 raw 文件，写 raw/ 起始的相对路径；多来源写行内数组', duty: 'required-value' },
  { name: 'tags', desc: '检索关键词数组，建议 3-5 个，取买家和运营会自然搜的词', duty: 'required-value' },
  { name: 'timestamp', desc: '本页生成或最后修订时间，格式 YYYY-MM-DD:HH:mm:ss，禁止编造', duty: 'required-value' },
  { name: '所属领域', desc: '本页归属的域，取八域之一', duty: 'required-value' },
  { name: '实体子类型', desc: '同一域内的页面形态区分；仅在有子类型的域填写，取值须逐字落在枚举内', duty: 'optional' },
  { name: '披露等级', desc: '可对外 / 仅内部 / 机密三档，决定本页能否进入对买家的回答', duty: 'required-value' },
  { name: '置信度说明', desc: '本页内容的可信程度，以及支撑它的证据充分度', duty: 'required-value' },
]

/* ────────────────────────── 八域 ────────────────────────── */

const 商品: DomainDef = {
  name: '商品',
  boundary: '平台已提供的挂牌价、库存、销量、起订量、规格参数等实时或基础属性不入本域；本域存放商家私域的商品经营判断、商品力证据、定价策略、卖点策略与改版决策。',
  whenToRead: 'raw 命中商品 / SKU / 报价 / 卖点 / 竞品',
  subtypes: [],
  identity: [
    { name: '商品编号', desc: '内部商品编号，用于唯一识别商品；raw 中没有时可省略', duty: 'required-value' },
    { name: '商品名称', desc: '商品对内识别名称；文件名应能唯一映射该名称', duty: 'must-grab' },
    { name: '关联平台货品编号', desc: '1688、抖音、淘宝、天猫等平台上的货品或 offer 编号', duty: 'must-grab' },
    { name: '归属店铺', desc: '该商品在哪些店铺在售，用于跨域关联店铺页', duty: 'must-grab' },
    { name: '商品品类', desc: '内部品类路径，如服装/男装/T恤', duty: 'must-grab' },
    { name: '上架时间', desc: '商品首次上架或进入经营视野的时间', duty: 'must-grab' },
    { name: '商品标签', desc: '自营款、代销款、竞品、主推品、清仓款、定制款等经营标签', duty: 'must-grab' },
  ],
  groups: [
    {
      name: '商品基础判断',
      fields: [
        { name: '目标买家', desc: '面向批发、分销、跨境、定制、零售补货等哪类采购方', duty: 'must-grab' },
        { name: '商品生命阶段', desc: '新品、爬升、爆款、成熟、衰退等阶段；口径见 concepts/商品生命阶段.md', duty: 'must-grab' },
        { name: '主推状态', desc: '当前经营上是主推、备胎、常规、暂停还是清仓', duty: 'must-grab' },
        { name: '货盘角色', desc: '该品在货盘中承担的职能，如引流、利润、凑单、形象、清仓', duty: 'optional' },
      ],
    },
    {
      name: '价格策略',
      fields: [
        { name: '价格底线', desc: '最低可成交价或议价红线', duty: 'must-grab', disclosure: '机密' },
        { name: '价格梯度', desc: '不同采购量、客户等级、定制需求下的价格层次；口径见 concepts/价格梯度.md', duty: 'optional', disclosure: '机密' },
        { name: '定价依据', desc: '成本、倍率、毛利、市场价、竞品价等定价逻辑', duty: 'optional', disclosure: '机密' },
        { name: '历史调价', desc: '调价时间、前后价格、原因和影响；只追加不覆盖', duty: 'optional' },
      ],
    },
    {
      name: '供给与履约',
      fields: [
        { name: '常规交期', desc: '标品或现货的常规发货周期', duty: 'must-grab' },
        { name: '定制交期', desc: '打样、定制、印标、改规格等非标需求的交付周期', duty: 'optional' },
        { name: '定制能力边界', desc: '可改与不可改的项目，如改色、改标、改规格、改包装的门槛', duty: 'optional' },
        { name: '断货替代方案', desc: '缺货时可替代商品、补货周期、换款或退款方案', duty: 'optional' },
      ],
    },
    {
      name: '卖点与披露',
      fields: [
        { name: '公开卖点', desc: '可进入详情页、主图角标、接待话术的卖点', duty: 'must-grab' },
        { name: '披露红线', desc: '不允许对外披露或容易引发误导的内容，如价格底线、成本、未确认承诺', duty: 'must-grab' },
        { name: '隐藏卖点', desc: '不公开但可在特定客户或人工接待时披露的卖点', duty: 'optional', disclosure: '仅内部' },
      ],
    },
    {
      name: '品质与资质',
      fields: [
        { name: '品质判断', desc: '品质等级及其证据摘要，如质检报告、售后工单归因、买家评价趋势', duty: 'optional', disclosure: '仅内部' },
        { name: '资质证书', desc: '可对外使用的证书摘要和原件来源，如质检、环保、授权、验厂', duty: 'optional' },
      ],
    },
    {
      name: '规格与起订',
      fields: [
        { name: 'SKU 结构', desc: '构成 SKU 的属性维度与组合逻辑，如颜色与尺码与克重', duty: 'optional' },
        { name: '起订与阶梯量', desc: '商家实际执行的起订量与阶梯量口径，以及可破例的条件', duty: 'optional' },
      ],
    },
    {
      name: '内容与转化',
      fields: [
        { name: '点击率表现', desc: '主图、视频或推广素材的点击表现，建议附行业基准或历史对比', duty: 'optional' },
        { name: '关键词认知', desc: '该品实际带量的搜索词、标题里应保留与应替换的词及理由', duty: 'optional' },
      ],
    },
    {
      name: '竞争与对标',
      fields: [
        { name: '主要竞品', desc: '同价位同款式的竞争商品，以商品域 entity 引用或名称记录', duty: 'optional' },
        { name: '相对优势', desc: '相比竞品可持续的强项，需有证据支撑', duty: 'optional' },
      ],
    },
  ],
  intent: [
    { name: '商品咨询意图', desc: '质量咨询、价格咨询、起订量咨询、交期咨询、定制咨询、样品咨询、售后咨询、对比竞品、复购补货', duty: 'optional' },
    { name: '意图描述', desc: '对买家围绕本商品的主要关注点进行平铺总结，不做层级嵌套', duty: 'optional' },
    { name: '触发信号', desc: '对话或行为中的线索，如问克重、问缩水、问几天发、问能否打样、问证书', duty: 'optional' },
  ],
  sections: ['商品定位', '价格与议价', '供给与履约', '卖点与披露边界', '品质与资质证据', '竞争对标'],
}

const 店铺: DomainDef = {
  name: '店铺',
  boundary: '平台已提供的评分、等级、粉丝数等不入本域；本域存放运营定位、供给与履约能力、资源分配判断。',
  whenToRead: 'raw 命中工厂 / 主体 / 产能 / 店铺定位 / 对标店',
  subtypes: [],
  identity: [
    { name: '店铺编号', desc: '内部店铺编号', duty: 'required-value' },
    { name: '店铺名称', desc: '店铺对内识别名称；文件名应能唯一映射', duty: 'must-grab' },
    { name: '关联平台店铺', desc: '各平台上的店铺 id 或名称', duty: 'must-grab' },
    { name: '经营主体', desc: '公司或工厂主体名称、注册资本、成立时间等', duty: 'must-grab' },
    { name: '店铺定位', desc: '本店在市场中的定位，如源头工厂、贸易商、品牌方', duty: 'must-grab' },
    { name: '店铺标签', desc: '主店、副店、测试店、清仓店等经营标签', duty: 'must-grab' },
  ],
  groups: [
    {
      name: '供给能力',
      fields: [
        { name: '货源类型', desc: '自产、代工、市场拿货、品牌授权等', duty: 'must-grab' },
        { name: '产能规模', desc: '日产、月产或接单上限', duty: 'optional' },
        { name: '生产周期', desc: '从接单到出货的周期', duty: 'must-grab' },
        { name: '定制能力', desc: '可提供的定制服务与门槛', duty: 'optional' },
      ],
    },
    {
      name: '履约能力',
      fields: [
        { name: '发货时效', desc: '常规与旺季的发货时效', duty: 'must-grab' },
        { name: '物流合作', desc: '常用物流方式与合作条件', duty: 'optional' },
        { name: '售后处理能力', desc: '退换货、补发、赔付的执行口径', duty: 'optional' },
      ],
    },
    {
      name: '运营定位',
      fields: [
        { name: '目标客群', desc: '本店主要服务的买家类型', duty: 'must-grab' },
        { name: '核心品类', desc: '本店赖以生存的品类', duty: 'must-grab' },
        { name: '差异化优势', desc: '相对同行的可持续优势，需有证据', duty: 'optional' },
      ],
    },
    {
      name: '资源分配',
      fields: [
        { name: '重点店铺', desc: '资源倾斜的店铺及其理由', duty: 'optional', disclosure: '仅内部' },
        { name: '资源投入方向', desc: '当前投入推广、备货、人力的方向', duty: 'optional', disclosure: '仅内部' },
      ],
    },
    {
      name: '风险与合规',
      fields: [
        { name: '资质证照', desc: '营业执照、行业许可、品牌授权等', duty: 'optional' },
        { name: '经营风险', desc: '已知的平台处罚、供应链风险、资金风险', duty: 'optional', disclosure: '仅内部' },
      ],
    },
  ],
  intent: [
    { name: '店铺相关意图', desc: '问产能、问交期、问能否定制、问是否源头厂、问对标店', duty: 'optional' },
    { name: '意图描述', desc: '围绕本店供给与履约能力的关注点平铺总结', duty: 'optional' },
    { name: '触发信号', desc: '如问起订量、问打样费、问多久出货、问能否开票', duty: 'optional' },
  ],
  sections: ['店铺定位', '供给与产能', '履约能力', '资源分配判断', '风险与合规'],
}

const 客户: DomainDef = {
  name: '客户',
  boundary: '平台订单、聊天消息等原始记录不入本域；本域存放客户深度认知、关系判断与跟进策略。**整体保密**。',
  whenToRead: 'raw 命中客户档案 / 对话 / 跟单 / CRM / 售后争议',
  subtypes: [],
  identity: [
    { name: '客户编号', desc: '内部客户编号', duty: 'required-value' },
    { name: '客户名称', desc: '客户识别名称（可用代号，避免真实姓名外泄）', duty: 'must-grab' },
    { name: '关联平台账号', desc: '平台上的买家账号标识；**该字段强制机密**', duty: 'must-grab', disclosure: '机密' },
    { name: '客户类型', desc: '批发、分销、零售、跨境等', duty: 'must-grab' },
    { name: '客户标签', desc: '大客户、潜力客户、风险客户、流失预警等', duty: 'must-grab' },
  ],
  groups: [
    {
      name: '基础认知',
      fields: [
        { name: '所在地区', desc: '省市或国家地区', duty: 'optional' },
        { name: '经营规模', desc: '采购量级、店铺数、团队规模', duty: 'optional', disclosure: '仅内部' },
        { name: '主营品类', desc: '客户自己经营的品类', duty: 'optional' },
      ],
    },
    {
      name: '关系判断',
      fields: [
        { name: '合作阶段', desc: '询盘、样品、试单、稳定、流失预警', duty: 'must-grab' },
        { name: '信任程度', desc: '对价格、账期、交期的信任与让步意愿', duty: 'optional', disclosure: '仅内部' },
        { name: '历史摩擦', desc: '曾经的质量、交期、账期争议与解决结果', duty: 'optional', disclosure: '仅内部' },
      ],
    },
    {
      name: '需求与偏好',
      fields: [
        { name: '采购偏好', desc: '偏好的规格、包装、价格带', duty: 'optional' },
        { name: '价格敏感度', desc: '对价格的敏感程度与议价风格', duty: 'optional', disclosure: '仅内部' },
        { name: '关注点', desc: '最在意质量、交期、价格还是服务', duty: 'optional' },
      ],
    },
    {
      name: '跟进策略',
      fields: [
        { name: '跟进节奏', desc: '多久跟进一次、用什么渠道', duty: 'optional', disclosure: '仅内部' },
        { name: '报价策略', desc: '对该客户的价格区间与让步边界', duty: 'optional', disclosure: '机密' },
        { name: '风险提示', desc: '账期风险、流失风险、投诉倾向', duty: 'optional', disclosure: '仅内部' },
      ],
    },
  ],
  intent: [
    { name: '客户相关意图', desc: '问报价、问账期、问样品、问交期、问售后、问复购', duty: 'optional' },
    { name: '意图描述', desc: '围绕本客户的主要关注点平铺总结', duty: 'optional' },
    { name: '触发信号', desc: '如问最低价、问能否赊账、问能不能加急、抱怨质量', duty: 'optional' },
  ],
  sections: ['客户画像', '关系与信任', '需求偏好', '跟进与报价策略', '保密边界说明'],
}

const 经营: DomainDef = {
  name: '经营',
  boundary: '平台已经给出的数字（访客数、支付金额、转化率）不入本域；本域存放目标、判断、复盘、资源配置与增长决策。',
  whenToRead: 'raw 命中企划 / 复盘 / 预算 / 备货 / 风险预案',
  subtypes: ['目标', '复盘', '企划', '预算', '风险预案'],
  identity: [
    { name: '经营事项编号', desc: '内部编号', duty: 'required-value' },
    { name: '经营事项名称', desc: '如「2026Q3 冲量计划」；文件名应能唯一映射', duty: 'must-grab' },
    { name: '周期', desc: '该事项覆盖的时间范围', duty: 'must-grab' },
  ],
  groups: [
    {
      name: '目标与依据',
      fields: [
        { name: '经营目标', desc: '量化目标及其口径', duty: 'must-grab' },
        { name: '目标依据', desc: '定这个目标的依据，如历史同期、行业增速', duty: 'optional' },
      ],
    },
    {
      name: '执行与资源',
      fields: [
        { name: '关键动作', desc: '为达成目标计划做的关键动作', duty: 'must-grab' },
        { name: '资源投入', desc: '预算、人力、货品资源的投入安排', duty: 'optional', disclosure: '仅内部' },
      ],
    },
    {
      name: '复盘与判断',
      fields: [
        { name: '结果对比', desc: '实际结果与目标的差距', duty: 'must-grab' },
        { name: '归因判断', desc: '对差距或超预期的归因分析', duty: 'must-grab' },
        { name: '经验沉淀', desc: '可复用的做法与需避免的坑', duty: 'optional' },
      ],
    },
    {
      name: '风险与预案',
      fields: [
        { name: '主要风险', desc: '已知风险及其触发条件', duty: 'optional' },
        { name: '应对预案', desc: '风险触发后的应对动作', duty: 'optional' },
      ],
    },
  ],
  intent: [
    { name: '经营相关意图', desc: '问目标完成度、问怎么归因、问怎么调整、问预算怎么分', duty: 'optional' },
    { name: '意图描述', desc: '围绕本经营事项的关注点平铺总结', duty: 'optional' },
    { name: '触发信号', desc: '如问为什么跌了、问还差多少、问要不要加预算', duty: 'optional' },
  ],
  sections: ['目标与依据', '执行安排', '结果与归因', '经验沉淀', '风险与预案'],
}

const 平台: DomainDef = {
  name: '平台',
  boundary: '平台规则的原文属于 raw；本域存放对规则、流量机制、工具与风险边界的理解与应对策略。',
  whenToRead: 'raw 命中平台规则 / 流量 / 工具投产 / 违规处罚',
  subtypes: ['规则', '流量机制', '工具', '风险边界'],
  identity: [
    { name: '平台事项编号', desc: '内部编号', duty: 'required-value' },
    { name: '平台事项名称', desc: '如「淘宝搜索权重构成」；文件名应能唯一映射', duty: 'must-grab' },
    { name: '适用平台', desc: '淘宝、抖音、拼多多、小红书等', duty: 'must-grab' },
    { name: '生效时间', desc: '该规则或机制的生效时间', duty: 'optional' },
  ],
  groups: [
    {
      name: '规则理解',
      fields: [
        { name: '规则要点', desc: '用自己的话复述规则，不是抄原文', duty: 'must-grab' },
        { name: '适用范围', desc: '哪些类目、店铺类型、场景适用', duty: 'optional' },
      ],
    },
    {
      name: '机制理解',
      fields: [
        { name: '机制说明', desc: '流量分配、权重构成、推荐逻辑的理解', duty: 'optional' },
        { name: '影响判断', desc: '该机制对本店经营的实质影响', duty: 'must-grab' },
      ],
    },
    {
      name: '应对策略',
      fields: [
        { name: '合规动作', desc: '为符合规则应做的动作', duty: 'must-grab' },
        { name: '违规风险', desc: '容易触碰的红线与后果', duty: 'must-grab' },
        { name: '工具使用', desc: '平台工具的使用方式与投产表现', duty: 'optional' },
      ],
    },
  ],
  intent: [
    { name: '平台相关意图', desc: '问规则怎么算、问会不会违规、问流量怎么来的、问工具怎么用', duty: 'optional' },
    { name: '意图描述', desc: '围绕本平台机制与规则的关注点平铺总结', duty: 'optional' },
    { name: '触发信号', desc: '如问权重、问处罚、问限流、问能不能这么写标题', duty: 'optional' },
  ],
  sections: ['规则要点', '机制理解', '对经营的影响', '应对策略', '违规风险'],
}

const 资产: DomainDef = {
  name: '资产',
  boundary: '已提交到平台的商品图、详情页等成品不入本域；本域存放完整素材库、版权边界与复用记录。',
  whenToRead: 'raw 命中素材 / 拍摄 / 版权 / 授权 / 合规发送',
  subtypes: ['图片素材', '视频素材', '文案素材', '资质文件'],
  identity: [
    { name: '资产编号', desc: '内部资产编号', duty: 'required-value' },
    { name: '资产名称', desc: '素材对内识别名称', duty: 'must-grab' },
    { name: '资产类型', desc: '图片、视频、文案、证书等', duty: 'must-grab' },
    { name: '关联对象', desc: '该素材服务于哪些商品或店铺', duty: 'must-grab' },
  ],
  groups: [
    {
      name: '素材信息',
      fields: [
        { name: '规格参数', desc: '尺寸、时长、格式等技术规格', duty: 'optional' },
        { name: '拍摄信息', desc: '拍摄时间、场地、模特、摄影师', duty: 'optional' },
      ],
    },
    {
      name: '版权边界',
      fields: [
        { name: '版权归属', desc: '自有拍摄、委托拍摄、购买授权、平台素材', duty: 'must-grab' },
        { name: '授权范围', desc: '可用于哪些平台、哪些商品、有效期', duty: 'must-grab' },
        { name: '使用限制', desc: '不可使用的场景与地域', duty: 'optional' },
      ],
    },
    {
      name: '复用与记录',
      fields: [
        { name: '已用位置', desc: '该素材已经用在哪些链接或渠道', duty: 'optional' },
        { name: '复用建议', desc: '还能复用到哪些场景', duty: 'optional' },
      ],
    },
  ],
  intent: [
    { name: '资产相关意图', desc: '问素材在哪、问能不能用、问版权归谁、问有没有更高清版本', duty: 'optional' },
    { name: '意图描述', desc: '围绕本素材的关注点平铺总结', duty: 'optional' },
    { name: '触发信号', desc: '如问有没有原图、问能否商用、问授权到什么时候', duty: 'optional' },
  ],
  sections: ['素材说明', '版权与授权', '复用记录', '使用限制'],
}

const 接待: DomainDef = {
  name: '接待',
  boundary: '只存「怎么说、何时说、说到什么边界」；「说什么事实」属于对应知识域，不重复存。',
  whenToRead: 'raw 命中客服人设 / 话术 / SOP / FAQ，或对话挖掘 T+1 产物',
  subtypes: ['策略', '问答', '话术', '人设', 'SOP'],
  identity: [
    { name: '接待编号', desc: '内部编号', duty: 'required-value' },
    { name: '接待名称', desc: '如「价格异议应对」；文件名应能唯一映射', duty: 'must-grab' },
    { name: '接待场景', desc: '售前咨询、售中跟进、售后处理、投诉安抚', duty: 'must-grab' },
  ],
  groups: [
    {
      name: '策略定义',
      fields: [
        { name: '策略状态', desc: '候选、启用、废弃。证据不足或置信度低的策略只能停在「候选」，不得标为「启用」', duty: 'must-grab' },
        { name: '接待意图', desc: '必填且只填 1 个，取自受控词表 8 个中文值', duty: 'must-grab' },
        { name: '接待意图码', desc: '与「接待意图」一一对应的英文码', duty: 'must-grab' },
      ],
    },
    {
      name: '话术内容',
      fields: [
        { name: '话术要点', desc: '该怎么说的核心要点，机密内容只能存变量占位（如 {规格}）', duty: 'must-grab' },
        { name: '禁止说法', desc: '不能说的话与原因', duty: 'must-grab' },
        { name: '变量占位', desc: '话术中需要运行时填充的变量', duty: 'optional' },
      ],
    },
    {
      name: '边界与升级',
      fields: [
        { name: '披露边界', desc: '该场景下最多能披露到什么程度', duty: 'must-grab' },
        { name: '转人工条件', desc: '什么情况下必须转人工', duty: 'optional' },
      ],
    },
  ],
  intent: [
    { name: '关联意图', desc: '若填，取值同样限受控词表的 8 个值', duty: 'optional' },
    { name: '意图描述', desc: '围绕本接待场景的关注点平铺总结', duty: 'optional' },
    { name: '触发信号', desc: '买家问什么话时进入本场景', duty: 'optional' },
  ],
  sections: ['适用场景', '话术要点', '禁止说法', '披露边界', '转人工条件'],
}

/**
 * 接待域受控词表 —— Accio 硬规则：**封闭 8 键**，不得出现第 9 个意图或改写字面。
 * 保持原文，便于逐字校验。
 */
export const RECEPTION_INTENTS: Array<{ code: string; label: string }> = [
  { code: 'price_objection', label: '价格异议' },
  { code: 'quality_concern', label: '质量顾虑' },
  { code: 'delivery_urge', label: '交期催单' },
  { code: 'customization', label: '定制需求' },
  { code: 'sample_request', label: '样品索取' },
  { code: 'after_sales', label: '售后处理' },
  { code: 'repurchase', label: '复购补货' },
  { code: 'competitor_compare', label: '竞品对比' },
]

const 概念: DomainDef = {
  name: '概念',
  boundary: '不存经营数据本身，只定义怎么算、怎么判、怎么分。是各域字段口径的唯一出处。',
  whenToRead: '需要沉淀指标口径 / 判定规则 / 分层模型 / 方法论时',
  subtypes: ['指标', '术语', '判定规则', '方法论', '分层模型'],
  identity: [
    { name: '概念编号', desc: '内部概念编号', duty: 'required-value' },
    { name: '概念名称', desc: '概念的标准称谓；文件名应能唯一映射', duty: 'must-grab' },
    { name: '别名', desc: '店内、平台或行业里对同一概念的其他叫法，用于检索归一', duty: 'must-grab' },
    { name: '适用范围', desc: '该概念适用于哪些域、哪些场景', duty: 'must-grab' },
    { name: '易混淆概念', desc: '名字相近但含义不同的概念，以及区别在哪', duty: 'optional' },
  ],
  groups: [
    {
      name: '口径与算法',
      fields: [
        { name: '定义', desc: '用一句话说清这个概念到底指什么', duty: 'must-grab' },
        { name: '计算方式', desc: '若为指标，说明怎么算出来的，分子分母各是什么', duty: 'must-grab' },
        { name: '统计范围', desc: '统计哪些对象、哪些渠道、哪些订单状态，明确算与不算', duty: 'must-grab' },
        { name: '时间窗口', desc: '按自然月、滚动30天、活动期还是其他窗口统计', duty: 'optional' },
        { name: '去重规则', desc: '按人、按账号、按公司还是按订单去重', duty: 'optional' },
      ],
    },
    {
      name: '判读与应用',
      fields: [
        { name: '判读方式', desc: '拿到这个数或这个判断后怎么解读，多少算好多少算差', duty: 'optional' },
        { name: '参考基准', desc: '行业均值、历史同期、同层级同行等可比基准及其来源', duty: 'optional' },
        { name: '常见误读', desc: '容易被误解的地方，如比率类指标在小样本下失真', duty: 'optional' },
      ],
    },
    {
      name: '分层与规则',
      fields: [
        { name: '分层维度', desc: '若为分层模型，说明按什么维度分层', duty: 'optional' },
        { name: '各层定义', desc: '每一层的名称、含义与进入条件', duty: 'optional' },
      ],
    },
    {
      name: '关系与演化',
      fields: [
        { name: '数据来源与口径差异', desc: '同一概念在平台后台、ERP、店内台账中的口径差异；有差异必须列全', duty: 'must-grab' },
        { name: '引用本概念的字段', desc: '哪些域的哪些字段依赖本概念的口径，改口径时需同步', duty: 'optional' },
        { name: '口径变更历史', desc: '口径调整的时间、前后差异、原因和对历史数据可比性的影响；只追加不覆盖', duty: 'optional' },
      ],
    },
  ],
  intent: [
    { name: '概念查询意图', desc: '问这个指标怎么算、问这个词什么意思、问算好还是算差、问怎么分层、问两个口径哪个对', duty: 'optional' },
    { name: '意图描述', desc: '对围绕本概念的疑问进行平铺总结，不做层级嵌套', duty: 'optional' },
    { name: '触发信号', desc: '对话或任务信号，如问口径、问分母、问算不算、发现两处数字不一致', duty: 'optional' },
  ],
  sections: ['定义与口径', '计算方式', '统计范围与边界', '判读与基准', '口径差异', '变更历史'],
}

/** 八域注册表 */
export const DOMAINS: Record<string, DomainDef> = {
  商品, 店铺, 客户, 经营, 平台, 资产, 接待, 概念,
}

/** 八域名称列表（顺序与 Accio 一致） */
export const DOMAIN_NAMES = Object.keys(DOMAINS)

/** 取域定义；不存在返回 null */
export function getDomain(name: string): DomainDef | null {
  return DOMAINS[name] ?? null
}

/**
 * 判断某域是否为「单一形态域」—— Accio 规定商品 / 店铺 / 客户三域
 * **不得**出现 `实体子类型` 字段（自创取值一律不合格）。
 */
export function isSingleFormDomain(name: string): boolean {
  const d = DOMAINS[name]
  return !!d && d.subtypes.length === 0
}

/**
 * 按披露等级过滤字段 —— 对应 Accio 的机密字段过滤硬规则。
 *
 * 用途：生成「可对外」的页面版本时，剔除机密字段。
 * 字段级 disclosure 优先于页级。
 *
 * @param domain 域定义
 * @param maxLevel 允许的最高披露等级（'可对外' 最严）
 * @returns 被过滤掉的字段名列表
 */
export function filterByDisclosure(domain: DomainDef, maxLevel: Disclosure): { kept: FieldDef[]; dropped: FieldDef[] } {
  const rank: Record<Disclosure, number> = { 可对外: 0, 仅内部: 1, 机密: 2 }
  const allowed = rank[maxLevel]
  const all = [...domain.identity, ...domain.groups.flatMap(g => g.fields), ...domain.intent]
  const kept: FieldDef[] = []
  const dropped: FieldDef[] = []
  for (const f of all) {
    const lv = f.disclosure ?? (maxLevel === '可对外' ? '可对外' : '仅内部')
    if (rank[lv] <= allowed) kept.push(f)
    else dropped.push(f)
  }
  return { kept, dropped }
}

/**
 * 该域所有字段名（含顶层），供校验器判断「是否是 Schema 外字段」。
 */
export function allFieldNames(domain: DomainDef): Set<string> {
  const s = new Set<string>()
  for (const f of TOP_LEVEL_FIELDS) s.add(f.name)
  for (const f of domain.identity) s.add(f.name)
  for (const g of domain.groups) for (const f of g.fields) s.add(f.name)
  for (const f of domain.intent) s.add(f.name)
  // 分组名也登记（frontmatter 里以嵌套块形式出现）
  for (const g of domain.groups) s.add(g.name)
  return s
}

/** 该域的必抓字段名（`must-grab` 与 `required-value`） */
export function mustGrabFields(domain: DomainDef): string[] {
  const out: string[] = []
  for (const f of domain.identity) if (f.duty === 'must-grab' || f.duty === 'required-value') out.push(f.name)
  for (const g of domain.groups) for (const f of g.fields) if (f.duty === 'must-grab') out.push(f.name)
  for (const f of domain.intent) if (f.duty === 'must-grab') out.push(f.name)
  return out
}

/**
 * 生成「域说明书」—— 给模型看的紧凑清单，用于生成 Wiki 页面。
 *
 * 对应 Accio 的渐进式读取协议：先给路由层（域选择表），
 * 命中域才给该域的字段定义，**不要一次性读全**。
 */
export function describeDomain(name: string): string {
  const d = DOMAINS[name]
  if (!d) return `未知领域：${name}`
  const lines: string[] = [
    `# ${d.name}本体 Schema`,
    '',
    `> 边界：${d.boundary}`,
    `> 何时读它：${d.whenToRead}`,
    '',
  ]
  if (d.subtypes.length) {
    lines.push(`实体子类型（必填，只能取其中之一）：${d.subtypes.join('、')}`)
  } else {
    lines.push('本域为单一形态：frontmatter 的 `实体子类型` 一律省略，不要自创取值。')
  }
  lines.push('', '## 实体识别字段')
  for (const f of d.identity) lines.push(`- ${f.name}${dutyTag(f.duty)}：${f.desc}`)
  lines.push('', '## 领域字段集')
  for (const g of d.groups) {
    lines.push(`### ${g.name}`)
    for (const f of g.fields) lines.push(`- ${f.name}${dutyTag(f.duty)}${f.disclosure ? `〖${f.disclosure}〗` : ''}：${f.desc}`)
  }
  lines.push('', '## 意图字段集')
  for (const f of d.intent) lines.push(`- ${f.name}${dutyTag(f.duty)}：${f.desc}`)
  lines.push('', '## 正文章节', d.sections.map(s => `## ${s}`).join('\n'))
  return lines.join('\n')
}

function dutyTag(d: FieldDuty): string {
  if (d === 'required-value') return '〖必有值〗'
  if (d === 'must-grab') return '〖必抓〗'
  if (d === 'required-block') return '〖必出现〗'
  return ''
}

/** 八域路由表 —— 对应 Accio 的 `_index.md`「八域选择表」 */
export function domainRoutingTable(): string {
  const lines = ['| 域 | 边界一句话 | 什么时候读它 |', '|---|---|---|']
  for (const n of DOMAIN_NAMES) {
    const d = DOMAINS[n]
    lines.push(`| ${d.name} | ${d.boundary} | ${d.whenToRead} |`)
  }
  return lines.join('\n')
}
