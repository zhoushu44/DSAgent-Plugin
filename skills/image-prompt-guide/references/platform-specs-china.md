# Platform Specs — China Domestic Marketplaces
> **Updated**: 2026-08-31
> **Parent**: `platform-product-guidelines.md` — the framework layer. Load it FIRST; this file alone is not enough to plan a set.

## Routing Header

- **Load when**: the user names one of the platforms indexed below AND requests main images (主图), a main-image set (主图套图), listing images, detail-page images, or listing-risk/compliance guidance.
- **Load with**: `platform-product-guidelines.md` is **mandatory alongside this file**. It owns the in-image language resolution, the Composite Slot Model, the layer-permission table, the slot brief/differentiation contracts, and the agent-side checks. This file owns **only** each platform's hard specs, compliance red lines, and category rules.
- **Do not load when**: the user named an overseas platform (Amazon / eBay / Walmart / Shopify / Etsy / AliExpress / TikTok Shop / Shopee / Lazada / Alibaba.com) → load `platform-specs-overseas.md` instead. The two files are never interchangeable.
- **Hard stop**: if the user requests latest compliance, official verification, or policy-sensitive review, verify against official platform documentation before finalizing.

## Platform index

| § | Platform | Model | Numeric upload specs |
|---|----------|-------|----------------------|
| 11 | 1688 | B2B wholesale | ✅ covered in this file |
| 12 | Taobao (淘宝) | B2C marketplace | ❌ not covered — verify officially |
| 13 | Tmall (天猫) | B2C marketplace | ❌ not covered — verify officially |
| 14 | Douyin E-Commerce (抖音电商) | Social / live commerce | ❌ not covered — verify officially |
| 15 | JD.com (京东) | B2C marketplace | ❌ not covered — verify officially |
| 16 | Pinduoduo (拼多多) | B2C marketplace | ❌ not covered — verify officially |

**In-image language for every platform in this file is Simplified Chinese (zh-CN)** unless the user specifies otherwise — see `platform-product-guidelines.md` → **Default In-Image Language**.

> **Numeric specs — read this before quoting any number.** Only **§11 (1688)** carries numeric upload specs (pixel size, ratio, format, file-size cap). For **§12–§16** the sourced material defines **what may be depicted, not the numbers** — they are marked `not covered` and MUST be verified against official documentation before delivery. **Never fill a missing numeric spec from memory**: an invented pixel size or ratio is a No-Hallucination violation and a rejected listing. While specs are unconfirmed, default AI generation to **2K on the long edge** per `platform-product-guidelines.md` → **Platform Image Set Style Systems** rule 7, and tell the user the final delivery size still needs platform confirmation.

> **§14 抖音电商 (Douyin E-Commerce) ≠ TikTok Shop.** TikTok Shop is the cross-border platform in `platform-specs-overseas.md` → §7: English copy and its own human-presence grammar. Douyin is China-domestic: Simplified-Chinese copy and the rules below. Route by the platform the user actually named — never inherit one's rules for the other.

> **Read only the section of the platform the user named**, then apply the **Shared red lines** below on top of it. Never take a numeric value from a neighbouring platform's section.

---

### Shared red lines (apply to every platform in this file)

Every platform below enforces the same core principle: **the image must depict the item actually being sold.** These are hard listing-compliance constraints layered on SKILL.md Core Rule 1 (No Hallucination) — not style preferences. Violating them gets the listing penalized, not just criticized.

1. **Consistency contract** — the depicted quantity, color, specification, and selling unit must match the title, attributes, SKU, detail page, and the physical product.
2. **Never generate what the buyer will not receive** — no fabricated accessories, gifts, props, functions, packaging, certifications, awards, sales figures, or usage results.
3. **SKU images map to the real variant** — never use a higher-configuration image for a lower-configuration SKU, and never show a separately-sold accessory as if it were included.
4. **Second-hand / defective goods are photographed, not generated** — show the real item's condition, wear, repairs, and missing parts. Erasing scratches, stains, or defects is prohibited, and an AI reconstruction may not stand in for the actual item.
5. **Regulated-category labels are never redrawn** — for cosmetics, food, health, and maternal/infant products, the packaging, Chinese-language labels, ingredients, net content, filing/registration info, applicable users, and warnings must come from the real product. Never let the model guess or re-render them, and never fabricate a certification mark (小金盾, organic, patent, lab-test).
6. **No medical or absolute efficacy claims** — no disease-treatment, medical, medical-aesthetic, or health-function claims; no fabricated before/after comparisons; no 「第一」「最有效」-class superlatives.
7. **No third-party rights infringement** — no unauthorized brands, packaging trade dress, IP characters, or celebrity likeness, and no confusable wording such as 「某品牌同款」. Do not use unauthorized consumer, doctor, or influencer imagery as proof of effect.
8. **The seller remains liable** — even when an image comes from the platform's own AI tooling, the merchant must review it and bears responsibility. Surface every inferred fact to the user for sanity-check before delivery.

> **The Composite Slot Model still applies**: only the hero slot may be single-capability; every supporting slot needs `L0 + ≥2 enrichment layers` per `platform-product-guidelines.md` → **Supporting-slot enrichment mandate**. In-image copy for all platforms in this file is **Simplified Chinese** unless the user specifies otherwise.

---

### 11. 1688

1. **Image count**: **≥5** (1 hero + ≥4 supporting) — key indicator for product quality score. Only the hero is a single-capability image; every supporting slot is a composite slot (`L0 base + ≥2 enrichment layers`) per **Composite Slot Model** → **Supporting-slot enrichment mandate**. Recommended slot plan:
   - **Slot 1 — Hero, L0 only**: pure-white real-product shot, no copy, no callouts.
   - **Slot 2 — Use-context composite slot**: L0 furnished scene + zh-CN headline/subhead + person/hand or a minimal icon. Archetype A2 / A7; the scene must satisfy **Scene layer richness**.
   - **Slot 3 — Structure / how-it-works composite slot**: L0 clean studio/gradient + cutaway or flow arrows + dot-anchored zh-CN part labels. Archetype A4.
   - **Slot 4 — Operation or maintenance composite slot**: L0 furnished scene columns + numbered step badges + zh-CN step captions. Archetype A5 (or A3 when an app/controller drives operation).
   - **Slot 5 — Contents / configuration composite slot**: L0 studio + accessory & packaging line-up or two identical units + zh-CN headline and contents caption. Archetype A6 / A8.
   - Beyond slot 5, add further composite slots only when each carries a new verified message. A bare alternate angle or unlabeled close-up may be delivered as an extra, never as one of the ≥5 required slots. All in-image copy is Simplified Chinese.
2. **White background**: Hero must be white-background real product photo (no 3D renders for customizable items).
3. **Recommended size**: ≥800×800 px. **AI generation target: 2K (2048 px on the longest edge)**, then downscale to final size.
4. **Aspect ratio**: Strict 1:1.
5. **File format**: JPG / JPEG / PNG.
6. **Max file size**: ≤5 MB per image.
7. **Resolution**: Industrial/technical drawings ≥150 dpi; critical dimensions labeled in mm.
8. **Product coverage**: 75%–80%, centered and clear.
9. **Background**: Pure white (RGB 255, 255, 255), no shadow or very faint shadow.
10. **Prohibited elements**: Watermarks (especially those from other platforms), messaging QR codes, external links, excessive text overlays, misleading promotional wording.
11. **Detail page images**: Width ≤752 px (max 790 px); include material, craft, size chart, factory capability modules.
12. **Video**: MP4, ≤30 s, ≥720P, must showcase core selling points or production process.
13. **Category-specific**:
    - **General goods**: hero must be a white-background real-product photo. Supporting images may show material, craft, dimensions, factory capability, and the production process.
    - **Customized goods**: the hero must NOT use a 3D render in place of a real customized sample. Supporting images may present customization options, colorways, craft, and application scenes.
    - **Apparel**: hero must cover front/side/detail, and must never alter the real fabric, cut, or color. Supporting images may be generated as a coordinated front / side / detail set.
    - **Hardware & electronics**: supply technical parameters or drawings — label critical dimensions in mm and keep technical drawings legible enough for business use. **Dimension values must never be guessed by the model** — use only user-supplied or source-visible numbers. Supporting images may include structure diagrams, parameter charts, and engineering-style views.
14. **Official docs**: [Rules](https://rule.1688.com/) | [Wiki](https://wiki.1688.com/zh/WKfkh560fqu60w)

---

### 12. Taobao (淘宝)

1. **In-image language**: Simplified Chinese (zh-CN).
2. **AI generation — explicitly permitted**: AI background replacement, image extension (扩图), retouching, and generated model or scene images are allowed, **provided** the product information stays truthful, accurate, lawful, and consistent with the item actually sold. This is the most AI-permissive platform in this section — the constraint is factual accuracy, not the use of AI.
3. **Prohibited elements**: fabricated accessories, gifts, functions, packaging, certifications, sales figures, or usage effects; pornographic or vulgar content; fraudulent or misleading imagery; infringement of trademark, copyright, portrait rights, or privacy.
4. **Seller responsibility**: images produced by Taobao's own intelligent-optimization tooling still must be reviewed by the merchant, who remains liable for them.
5. **Category-specific rules**:
   - **Second-hand / sample / defective goods**: base every image on the actual item on sale and show its true condition, wear, repairs, and flaws. An AI-reconstructed image must NOT replace the real item, and scratches, stains, or missing parts that affect the buying decision must NOT be erased.
   - **Custom / pre-sale goods**: effect renders and customization mock-ups are allowed, but must NOT present an unmade result as a finished physical item. Label them `效果图 / 定制示意` and keep material, size, color, and delivery scope consistent with the agreed order.
6. **Numeric upload specs**: not covered by the sourced material — **verify officially before delivery**.
7. **Official docs**: [Main-image dimension validation announcement](https://developer.alibaba.com/support/announcementDetail.htm?id=25721&source=search) | [Product-image upload API](https://developer.alibaba.com/docs/api.htm?apiId=23&scopeId=12166)

---

### 13. Tmall (天猫)

1. **In-image language**: Simplified Chinese (zh-CN).
2. **AI generation — permitted with a completeness bar**: platform intelligent-generation, intelligent-optimization, and AI-assisted production capabilities may be used, but the merchant must guarantee the final displayed information is **truthful, accurate, complete, and non-misleading**. Note the extra bar versus Taobao: *complete* — an image that omits a material fact can fail even when nothing in it is false.
3. **Prohibited elements**: a pure concept render passed off as an already-manufactured product; fabricated brands, certifications, awards, sales figures, functions, packaging, or gifts.
4. **Category-specific rules**:
   - **Apparel / footwear / bags**: an AI model shot must NOT alter the real product's fabric, texture, color, cut, length, shoe shape, hardware, or brand markings. Size representation and on-body effect must not create visibly wrong proportions or fabricate a shaping/slimming effect.
   - **Beauty / food / health / maternal-infant**: packaging, Chinese labels, ingredients, net content, filing/registration info, applicable users, and warning text must come from the real product — never guessed or repainted by the model. Do not fabricate medical-efficacy or absolute-efficacy claims, fake before/after comparisons, or 小金盾 / organic / patent / lab-test marks.
   - **Brand / co-branded goods**: no unauthorized use of another party's brand, packaging trade dress, IP character, or celebrity likeness, and no confusable wording such as 「某品牌同款」.
5. **Numeric upload specs**: not covered by the sourced material — **verify officially before delivery**.
6. **Official docs**: [天猫 publishing standards center](https://www.tmall.com/wow/seller/act/pinkongrule#%E5%A4%A9%E7%8C%ABmalllist%E4%B8%BB%E5%9B%BE-%E5%A4%A9%E7%8C%ABmalllist%E4%B8%BB%E5%9B%BE-%E5%8F%91%E5%B8%83%E8%A7%84%E8%8C%83) | [Main-image dimension validation announcement](https://developer.alibaba.com/support/announcementDetail.htm?id=25721&source=search)

---

### 14. Douyin E-Commerce (抖音电商)

> **Not TikTok Shop.** See the disambiguation note at the top of this section before routing.

1. **In-image language**: Simplified Chinese (zh-CN).
2. **General quality bar**: main images and detail-page images must be clear and truthful; product quantity, color, specification, and selling unit must be consistent across them.
3. **Hero image — 全球购 (cross-border) channel**: the first main image must be a **front-facing real photo of the product body**; apart from the brand logo it must contain **no text and no watermark**. Supporting images show side, back, flat-lay, and detail views — multi-angle coverage is the minimum. Packaging, specification, quantity, color, and origin must match the detail page and the physical item.
4. **Prohibited elements**: heavy watermarks; 大字报 / 牛皮癣 oversized promo type; collaged or stitched images; compression distortion; over-retouching; click-bait imagery; brand infringement; borderline-sexual, gory, or otherwise disturbing content. Never add products, accessories, or props the buyer will not receive.
5. **AI content labeling**: Douyin's user agreement carries **AI-labeling requirements** — confirm the current labeling obligation for AI-generated imagery before publishing. Do not assume an unlabeled AI image is acceptable.
6. **Category-specific rules**:
   - **Underwear / lingerie**: in 商城「猜你喜欢」, an underwear cover image must NOT show a real person wearing it. Neither cover nor detail page may contain suggestive posing, sexual innuendo, exposed sensitive areas, or improper poses. C-string styles must not use a real human figure. Do not work around this with skin smoothing, flesh-toned covers, or transparent occlusion.
   - **Adult / intimate products**: no minors, no real private body parts, no intercourse or usage demonstration, no sexual solicitation, no vulgar wording. Do not fabricate potency, treatment, enlargement, or delay claims. Cover and supporting images should show the real packaging, product, and producer information per current rules.
   - **Beauty / personal care**: no fabricated or exaggerated efficacy; never present cosmetics as having medical, medical-aesthetic, health, or disease-treatment effects. Do not use unauthorized consumer, doctor, celebrity, or other-platform influencer imagery as proof. Efficacy, ingredients, origin, and specification must match the registered filing and the actual packaging.
   - **Children / maternal-infant**: no adultized, sexualized, or unsafe-usage scenes. A children's-cosmetics main image must display the real 「儿童化妆品」小金盾 mark from the actual packaging — the model must NEVER invent it.
7. **Numeric upload specs**: not covered by the sourced material — **verify officially before delivery**.
8. **Official docs**: [Douyin Mall Management Standard](https://school.jinritemai.com/doudian/web/articlev0/aHRK3WaAk7AN?from=compass&from_school=1&should_full_screen=1&should_hide_bottom_nav=1) | [Global Purchase Product Management Standard](https://school.jinritemai.com/doudian/web/articlev0/108057?from_school=1&should_full_screen=1&should_hide_bottom_nav=1)

---

### 15. JD.com (京东)

1. **In-image language**: Simplified Chinese (zh-CN).
2. **Hero / main image**: the product subject must be **complete and clear**, and the image content must be consistent with the title, attributes, SKU, detail page, and the actual product.
3. **Prohibited elements**: self-added unauthorized platform or institutional marks such as 「京东物流」「京东超市」「官方认证」; other platforms' names, logos, contact information, URLs, and QR codes; any off-site traffic-diversion element.
4. **Category-specific rules**:
   - **Promotions / gifts / multi-packs**: when an image shows a promotional price, the activity conditions and validity period must be stated. When it shows a gift, state the gift's type, specification, quantity, time limit, and how to obtain it. The quantity and specification in the main image must match what the buyer actually receives.
   - **Multi-variant products**: each SKU image must correspond to the real color, model, size, and style. Never use a high-configuration image for a low-configuration SKU, and never present a separately-purchased accessory as standard.
   - **Second-hand / refurbished / defective goods**: use photos of the actual item and clearly show condition, repairs, missing parts, and flaws. Do not use AI to erase wear, and do not substitute a standard new-product image for the specific item on sale.
5. **Numeric upload specs**: not covered by the sourced material — **verify officially before delivery**.
6. **Official docs**: [京东 Rules Center](https://learn-jdm.jd.com/knowledge/rule) | [Main-image rules and Asset Center introduction](https://mtt.m.jd.com/video/655807577)

---

### 16. Pinduoduo (拼多多)

1. **In-image language**: Simplified Chinese (zh-CN).
2. **General requirement**: the merchant's product description, introduction, and images must be truthful and valid, and must appropriately reflect the product's characteristics — never false, forged, misleading, or infringing on third-party rights.
3. **Image quality**: images must be clear and free of distortion; the product's appearance must NOT be deformed. This constrains any resize, extension, or reframing step — stretch/squash to force a ratio is a compliance failure here, not just a quality one.
4. **Prohibited elements**: deformed or distorted product appearance; misleading comparison images with a clear directional target (i.e. aimed at an identifiable competitor).
5. **Category-specific rules**:
   - **Multi-variant / multi-pack**: SKU images must correspond to the real color, model, and style, and the quantity, capacity, packaging, and accessories shown must match that SKU. Never pair a high-value product image with a low-value accessory SKU, and never use imagery to manufacture a low-price traffic lure.
   - **Beauty / food / health goods**: never let AI fabricate packaging, Chinese labels, ingredients, net content, origin, filing/registration, lab certification, or efficacy. No exaggerated before/after comparisons, disease-treatment or absolute-efficacy claims, or unsupported 「第一」「最有效」 advertising language.
6. **Numeric upload specs**: not covered by the sourced material — **verify officially before delivery**.
7. **Official docs**: [拼多多 Open Platform](https://open.yangkeduo.com/) | [Public product-publishing field mirror](https://docs.rs/pdd/latest/pdd/requests/struct.PddGoodsAdd.html)
