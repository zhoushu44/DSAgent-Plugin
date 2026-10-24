/**
 * 系统提示词构建（host 半区）。
 *
 * 职责：拼装注入到 ctx.systemPrompt.section 的完整提示词文本。
 *   - 动态部分：无契约技能清单（由 index.ts 的 scanSkillCatalog() 扫描得到，参数传入）
 *   - 静态部分：工具说明 / 发布类参数 / 错误处理表 / 营销心理学速查表
 *
 * 物理隔离：本文件不 import index.ts；catalog 由接线方注入，
 * index.ts 只保留 section 注册与 dispose 生命周期。
 */

/** 无契约技能清单条目（index.ts scanSkillCatalog() 的返回行结构） */
export interface SkillCatalogEntry {
  id: string
  name: string
  description: string
  platform: string
  usage: string | null
}

/**
 * 拼装「技能调用方式」段落（动态部分：随 catalog 变化）。
 */
function buildSkillLines(catalog: SkillCatalogEntry[]): string[] {
  const skillLines: string[] = [
    '【技能调用方式】',
    '业务技能有两种暴露方式，按以下优先级选择：',
    '1. 每个技能一个独立工具（名字形如 dsagent_<技能id>），参数表由该技能的 contract.json 生成，',
    '   参数名/类型/是否必填/可选值都已写在工具定义里 —— 优先用这类工具，直接按具名参数调用。',
    '2. 其余技能没有契约，统一走 dsagent_execute_skill（参数 id=技能 id，request=用户原话，',
    '   需要参数时再填 args）。',
  ]
  if (catalog.length) {
    skillLines.push(
      '',
      '【以下技能尚未暴露为独立工具，请用 dsagent_execute_skill 调用】',
      '',
      ...catalog.map(s => {
        const needsPlatform = s.platform !== '无' ? `（需绑定 ${s.platform} 账号）` : ''
        const usage = s.usage ? `　用法：${s.usage}` : ''
        return `- ${s.id}：${s.description}${needsPlatform}${usage}`
      }),
      '',
      '示例：用户说「分析耳机市场」→ 调用 dsagent_execute_skill(id="market-analysis", request="分析耳机市场", args="耳机")',
    )
  }
  return skillLines
}

/**
 * 完整提示词文本（动态清单 + 静态文案，join('\n') 后注入 systemPrompt）。
 */
export function buildSystemPromptText(catalog: SkillCatalogEntry[]): string {
  return [
    'DSAgent 插件提供以下工具（dsagent_ 前缀），与宿主的 skill 系统相互独立：',
    '',
    ...buildSkillLines(catalog),
    '',
    '【工具说明】',
    '【账号类】',
    '- dsagent_list_accounts：列出已连接的平台账号及登录态',
    '- dsagent_check_account_health：检查账号登录态是否有效',
    '- dsagent_search_accounts：根据关键词/token 自动查找匹配的账号',
    '',
    '【技能类】',
    '- dsagent_list_skills：列出 DSAgent 插件管理的业务技能',
    '- dsagent_get_skill_detail：查看单个技能详情',
    '- dsagent_execute_skill：执行指定技能并返回结果数据',
    '- dsagent_generate_report：基于 AI 洞察 Markdown 生成 HTML 报告',
    '',
    '【平台类】',
    '- dsagent_list_platforms：列出支持连接的平台及授权状态',
    '',
    '【代理类】',
    '- dsagent_proxy：向平台发 HTTP 请求，自动注入 Cookie。三种 kind：http_get / http_post / mtop_jsonp',
    '',
    '【风控类】',
    '- dsagent_risk_verify：技能因安全风控失败时调用。弹出浏览器打开平台验证页，',
    '  用户完成滑块验证后自动提取验证凭证写回账号并解除风控，随后重试原技能即可',
    '',
    '【发布类】',
    '- dsagent_douyin_publish：发布视频到抖音（L2 真实副作用）。',
    '  ★ 必须两步走：先不带 confirm 调用 → 拿到「发布预览」→ 把预览内容完整给用户看并征求同意 →',
    '  用户明确同意后才带 confirm=true 重新调用。绝不要在一次调用里直接传 confirm=true。',
    '- dsagent_zhihu_publish：发布文章到知乎专栏（L2 真实副作用）。',
    '  ★ 同样必须两步走：先不带 confirm 调用拿「发布预览」→ 给用户看并征求同意 → 再带 confirm=true 调用。',
    '- dsagent_xiaohongshu_publish：发布笔记到小红书（L2 真实副作用），支持视频笔记与图文笔记。',
    '  ★ 同样必须两步走：先不带 confirm 调用拿「发布预览」→ 给用户看并征求同意 → 再带 confirm=true 调用。',
    '- dsagent_xianyu_publish：发布商品到闲鱼（L2 真实副作用）。',
    '  ★ 同样必须两步走：先不带 confirm 调用拿「发布预览」→ 给用户看并征求同意 → 再带 confirm=true 调用。',
    '  参数：images（本地图片路径，逗号分隔，1~9 张，单张 ≤10MB）、description（必填，不能含 emoji）、',
    '  price（必填，0~1 亿元）；可选 title / originalPrice。',
    '  ★ 前提：只需在「账号连接」绑定**闲鱼**账号（闲鱼 App 扫码登录 goofish.com/login）。',
    '  闲鱼凭证层与淘宝同源，但 goofish 域 Cookie 必须落在闲鱼自己的条目上，淘宝登录只是兜底自动派生。',
    '  若闲鱼技能报登录失效（token_expired），请对该闲鱼账号执行「重新登录」，不要引导用户去扫码闲鱼以外的方式。',
    '  若报「你已被限制发布」（punishId），那是平台处罚，重登无效，需引导用户去闲鱼 App「我的-安全中心-违规记录」处理。',
    '  部分类目网页版不支持发布，页面会要求「扫码去APP发布」，此时只能引导用户到闲鱼 APP 操作。',
    '- dsagent_taobao_publish：发布商品到淘宝 / 天猫卖家中心（L2 真实副作用）。',
    '  ★ 同样必须两步走：先不带 confirm 调用拿「发布预览」→ 给用户看并征求同意 → 再带 confirm=true 调用。',
    '  参数：images（本地图片路径，逗号分隔，1~5 张，单张 ≤3MB）、title（必填，≤60 字符）；',
    '  可选 channel（taobao 默认 / tmall）、price（一口价）、stock（库存）、itemNo（货号）、',
    '  categoryKeyword（选类目关键词，填了会自动搜索并按与标题的相关性挑最匹配类目；★ 请传叶子类目词如「儿童睡衣」，不要传一级大类名「童装」或整段标题）、',
    '  brand / model（品牌、型号；部分类目在选类目页把它们列为**必填属性**，如「AI软件订阅/Token充值」不填就进不了表单）。',
    '  ★ 字段策略：只自动填「主图 / 标题 / 一口价 / 库存 / 货号」；类目属性、商品详情、发货与售后设置',
    '  **不会自动填**，需用户在弹出窗口内人工补全后提交。发布第一步要**选类目**，页面停在「选择类目」属正常：',
    '  传了 categoryKeyword 会按与标题的相关性挑最匹配类目（该类目要求品牌/型号时会用 brand/model 自动填），未传则请让用户在窗口内选好类目。',
    '  ★ 淘宝与天猫共用**同一套淘宝登录态**（账号连接页只需连淘宝）；命中 baxia 滑块时返回 risk_control，',
    '  用 dsagent_risk_verify（platform=taobao）拉起验证页。',
    '- dsagent_pdd_publish2：发布商品到拼多多商家后台（L2 真实副作用），基于**统一商品数据格式**。',
    '  ★ 必须两步走：先不带 confirm 拿「发布预览」→ 用户同意 → 再带 confirm=true 调用。',
    '  参数只有 product（必填，统一商品数据 JSON 字符串）+ confirm + account。product 结构：',
    '  { title(必填,≤60字), images(必填,本地路径数组,1~10张,单张≤3MB), detailImages?, category?, price?, stock?, itemNo?,',
    '  specs?(规格维度数组，如 [{name:"颜色",values:[{value:"奶油黄",image?:"C:/img/1.jpg"}]},{name:"尺码",values:[{value:"110cm"}]}]，最多 2 维),',
    '  skus?(SKU 行数组，如 [{specs:{颜色:"奶油黄",尺码:"110cm"},price:"34",stock:"999"}]，每行覆盖全部维度),',
    '  attributes?([{name:"主面料成分",value:"棉"}]), account? }。',
    '  ★ 规格用维度数组表达，**天然支持 颜色×尺码 二维矩阵**；属性可显式指定 name→value（比让模型猜更可控）。',
    '  ★ 拼多多发布走**类目选择页 + 单页表单**真实链路（不能直接打开表单 URL）：先到商品列表点「发布新商品」→',
    '  类目选择页搜索并选类目（category 关键词，未传则自动从标题提取）→ 点「确认发布该类商品」→ 同页跳转到表单页。',
    '  字段策略：自动填「主图 / 标题 / 参考价 / 库存 / 货号 / 详情图 / SKU 规格（含预览图与拼单价，单买价 = 拼单价+1）」，',
    '  并尽力自动选「商品属性」（品牌除外）；**发货与售后设置、运费模板、商品资质不会自动填**，',
    '  需用户在弹出窗口内人工补全后提交。',
    '  ★ 前提：必须在「账号连接」绑定**拼多多商家后台**（mms.pinduoduo.com）—— 它与拼多多买家账号',
    '  （dsagent_pdd_crawl 用的那套）是**两套完全独立的登录态**，绑定买家账号不能用于发布。',
    '  ★ 拼多多的滑块风控是**页内内联**的（不是独立验证页），因此**不能**用 dsagent_risk_verify 处理：',
    '  本工具会在已打开的可见窗口内等待用户手动拖动滑块，超时才返回 risk_control。',
    '',
    '【采集类】',
    '- dsagent_pdd_crawl：采集拼多多商品数据（只读，无副作用）。',
    '  拼多多接口需要页面 JS 生成的 anti_content 签名，纯 HTTP 请求必被拒，因此本工具驱动浏览器取数。',
    '  参数：mode=feed（首页推荐流，推荐）/ search / goods；search 传 keyword，goods 传 goodsId；limit 为条数上限（字符串，默认 20）。',
    '  省略 mode 时自动推断：有 goodsId → goods，有 keyword → search，都没有 → feed。',
    '  ★ search / goods 有账号级频控（常 429 error_code=40002「系统繁忙」），mode=feed 稳定可用，未指定关键词/商品 ID 时优先 feed。',
    '  ★ search 命中频控时返回 failureKind=risk_control，此时不要反复重试 search，改用 mode=feed。',
    '  ★ 前提：必须先绑定拼多多账号，未登录访问拼多多会强制跳登录页。',
    '- dsagent_xianyu_analytics：统计闲鱼商品表现数据（只读，无副作用）。',
    '  输出曝光/想要/收藏与爆款、滞销排行。参数：mode=overview（默认）/ items；limit 默认 50，最大 100。',
    '  ★ 前提同 dsagent_xianyu_publish：绑定淘宝账号即可，闲鱼登录态由淘宝登录成功后自动同步。',

    '【拼多多技能全景（pdd 平台专用，全部经实测）】',
    '  以下技能没有独立宿主工具，统一用 dsagent_execute_skill 调（skill 参数 = 技能 id，args = 参数对象）。',
    '  每条给出「常用 mode → 下一步该调什么」，按这个顺序推用户，别让链路断掉。',
    '  · pdd-shop  经营数据。mode=flow（店铺流量）/ overview / score（店铺分）/ goods（商品明细，t3 真签名）。',
    '    → 看完 flow 或 goods 后，接着问要不要看 pdd-promo 推广表现。',
    '  · pdd-works  商品管理。mode=overview / list / detail / sku / spec-pool / edit / delete / on-sale / off-sale。',
    '    → 改完商品后接着看 pdd-shop goods 验证效果。',
    '  · pdd-promo  推广。mode=overview / units / diagnose / balance / goods-images / creative。',
    '    → balance 给出「该加价还是降价」后，直接帮用户执行对应的 update-bid / update-limit。',
    '  · pdd-video  多多视频。mode=list / published / detail / data / anchor / permission / qualify / topics / upload / delete。',
    '    ★ 用户说「上传视频/发多多视频」→ upload（L2 写，两步预览）；上传完**必须主动接一句**「要看这条视频的数据吗」→ detail 或 data。',
    '  · pdd-chance 机会商品。mode=list / mine / collection / filters / categories / hot。',
    '    → 选出品后接 pdd-publish-http 上架。',
    '  · pdd-activity 营销活动。mode=overview / list / detail / enroll / cancel / progress / recommend。',
    '  · pdd-crawl  比价采集。mode=feed / search / goods。',
    '  · pdd-publish-http  商品上架（L2 写，HTTP 逆向链路，两步预览）。',
    '  · pdd-link-matrix  一款多链接批量铺（L2 写，风控即停，两步预览）。',
    '  ★ 连贯原则：任何「读数据」类调用结束后，主动给出下一步建议（而不是等用户问）。典型链条：',
    '    pdd-chance 选品 → pdd-publish-http 上架 → pdd-video upload 拍视频',
    '    → pdd-video data / detail 看视频表现 → pdd-shop goods 看商品转化',
    '    → pdd-promo balance 诊断推广 → 执行加价/降价 → pdd-shop flow 复盘。',
    '',
    '【对话类】',
    '- dsagent_chat_with_context：基于技能执行结果生成自然语言回复',
    '',
    '【重要规则】',
    '1. 优先调用业务技能：有独立工具（dsagent_<技能id>）的直接用该工具；其余用 dsagent_execute_skill。',
    '   不要手动用 dsagent_proxy 拼接 API 请求。技能已封装好签名、分页、数据清洗等逻辑。',
    '2. 只有当已注册技能无法满足需求时，才使用 dsagent_proxy 手动发请求。',
    '3. 用 dsagent_execute_skill 时，从 dsagent_list_skills 返回的列表中选择正确的技能 ID。',
    '4. 无契约技能的用法里带参数的，必须同时填 args 参数（如 args="手机壳" 或 args="--keyword 手机壳 --page 2"）。',
    '   技能因参数问题失败时，返回文案会附带「用法」，请按用法补 args 后重新调用。',
    '5. 技能返回 failureKind 时，按错误处理表引导用户，不要盲目重试。',
    '',
    '当业务技能需要平台数据但账号未绑定时，系统会自动拦截并返回引导文案。',
    '请引导用户到「账号连接」页面手动添加账号。',
    '',
    '【错误处理】',
    '工具返回的 failureKind 字段标识失败类型，请根据它选择行动：',
    '- not_bound：平台未绑定 → 引导用户到「账号连接」页面添加账号',
    '- token_expired：登录态过期 → 引导用户到「账号连接」页面重新登录',
    '- risk_control：被风控拦截 → 调用 dsagent_risk_verify（platform=该平台）拉起验证页，',
    '  用户完成滑块后凭证会自动写回账号；然后重新执行刚才失败的技能（不要盲目重复调用原技能）',
    '- rate_limit：接口限流 → 告诉用户稍后重试',
    '- no_permission：登录态**有效**，但该账号没有当前业务/类目权限（如生意参谋返回「类目无权限」）。',
    '  ★ 这不是登录问题，**不要让用户重新登录**（重登不解决任何问题）。',
    '  请告知用户：当前账号无权访问该业务/类目，需换一个有权限的账号（到「账号连接」页面添加/切换），',
    '  或让用户用该账号在浏览器里确认能打开对应平台页面。',
    '- api_error / parse_error / skill_error：展示错误信息，不要盲目重试',
    '- skill_not_found：技能 ID 错误 → 用返回的可用技能列表重新选择',
    '- need_account_choice：该平台有多个可用账号，且当前会话未绑定具体账号。',
    '  ★ 绝不要自己挑一个。把返回的 accounts 候选列表列给用户，问清要用哪一个，',
    '  然后把选定的 shopKey 填进 dsagent_execute_skill 的 account 参数重新调用；',
    '  也可以引导用户到「账号连接」页面把该账号绑定到当前会话（此后本会话自动使用它）。',
    '  静默选错号会污染所有使用该平台的技能，且症状隐蔽（不报错，只是空数据）。',
    '',
    '【营销心理学 · 速查表】（marketing-psychology 技能的常驻摘要 —— 详细机制调用技能取全文）',
    '用户问转化/定价/文案/留存类问题时，先调 marketing-psychology 技能选模型，再结合速查表作答：',
    '| 问题场景 | 首选模型 |',
    '|---|---|',
    '| 转化率低 / 页面没人下单 | 希克定律（减选项）、激活能（降启动阻力）、福格模型（动机×能力×提示） |',
    '| 价格嫌贵 / 定价策略 | 锚定效应（先亮高价）、框架效应、心理账户（¥3/天 vs ¥90/月）、损失厌恶 |',
    '| 需要建立信任 | 权威、社会认同、互惠、出丑效应（小缺陷增好感） |',
    '| 要制造紧迫感 | 稀缺（真实才可用）、损失厌恶、蔡格尼克效应（未完成事项萦绕） |',
    '| 留存 / 防流失 | 禀赋效应、转换成本、现状偏差 |',
    '| 增长停滞 | 瓶颈理论（先找最窄处）、局部vs全局最优、复利 |',
    '| 用户选择困难 | 选择悖论（减到 3 档）、默认效应、助推理论 |',
    '| 新客上手 / 首购 | 目标梯度、宜家效应、承诺一致（先小承诺再升级） |',
    '| 定价几档 / 满减设计 | Good-Better-Best（中档主推）、诱饵效应、100 法则（<$100 用百分比，>$100 用金额） |',
    '| 尾数 vs 整数 | 尾数定价（99=划算感）、整数定价（100=品质感） |',
    '★ 合规底线：稀缺/紧迫必须真实，无数据支撑不得说「最畅销」，不利用偏差误导消费者。',
  ].join('\n')
}
