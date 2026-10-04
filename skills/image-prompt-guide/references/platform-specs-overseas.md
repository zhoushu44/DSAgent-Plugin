# Platform Specs — Overseas Marketplaces
> **Updated**: 2026-08-31
> **Parent**: `platform-product-guidelines.md` — the framework layer. Load it FIRST; this file alone is not enough to plan a set.

## Routing Header

- **Load when**: the user names one of the platforms indexed below AND requests main images, hero images, listing images, a product image set, or listing-risk/compliance guidance.
- **Load with**: `platform-product-guidelines.md` is **mandatory alongside this file**. It owns the in-image language resolution, the Composite Slot Model, the layer-permission table, the slot brief/differentiation contracts, and the agent-side checks. This file owns **only** each platform's hard specs and image-set style notes.
- **Do not load when**: the user named a China-domestic platform (Taobao / Tmall / Douyin E-Commerce / JD.com / Pinduoduo / 1688) → load `platform-specs-china.md` instead. The two files are never interchangeable.
- **Hard stop**: if the user requests latest compliance, official verification, or policy-sensitive review, verify against official platform documentation before finalizing.

## Platform index

| § | Platform | Model | Default in-image language |
|---|----------|-------|---------------------------|
| 1 | Amazon | B2C marketplace | English (en-US) |
| 2 | eBay | B2C marketplace | English (en-US) |
| 3 | Walmart Marketplace | B2C marketplace | English (en-US) |
| 4 | Shopify | DTC storefront | English (en-US) |
| 5 | Etsy | B2C handmade marketplace | English (en-US) |
| 6 | AliExpress | Cross-border B2C | English |
| 7 | TikTok Shop | Social commerce | English (en-US) |
| 8 | Shopee | SEA B2C marketplace | English |
| 9 | Lazada | SEA B2C marketplace | English |
| 10 | Alibaba.com (International) | B2B wholesale | English (Chinese strictly prohibited) |

> **Read only the section of the platform the user named.** Every entry below uses the same numbered field structure (`Image count` / `Recommended size` / `Aspect ratio` / `Max file size` / `Product coverage` …), which makes cross-contamination easy and expensive — quoting Walmart's 2200×2200 for an Amazon listing is a rejected listing, not a typo. **Never take a numeric value from a neighbouring platform's section.**

> **§7 TikTok Shop is the cross-border platform.** 抖音电商 (Douyin E-Commerce) is a different, China-domestic platform documented in `platform-specs-china.md` → §14: Simplified-Chinese copy and different rules. Never apply one's rules to the other.

---

## Cross-Border B2C

### 1. Amazon

1. **Hero image count**: 1 hero required; recommended total ≥6 supporting images + 1 video.
2. **White background**: ✅ Mandatory pure white (RGB 255, 255, 255).
3. **Recommended size**: Longest side min 500 px, max 10,000 px; recommended ≥1600 px for best zoom. **AI generation target: 2K (2048 px on the longest edge)**.
4. **Aspect ratio**: No strict enforcement; typically 1:1 or category-appropriate.
5. **File format**: JPEG preferred; also TIFF, PNG, GIF (non-animated).
6. **Max file size**: 10 MB.
7. **Resolution/DPI**: 72 DPI recommended; longest side ≥1000 px enables Zoom.
8. **Product coverage**: ≥85%.
9. **Background**: Hero must be pure white; supporting images allow lifestyle scenes, text, infographics.
10. **Prohibited elements**: Watermarks, borders, text, logos, URLs, prices, promotions (e.g., "Free Shipping"), non-included accessories, mannequins (except apparel), reviews/ratings, Amazon logos.
11. **Supporting images**: Allow product details, scale references, lifestyle scenes, text overlays, infographics, models.
12. **Video/3D**: 1 video recommended, MP4 or common formats.
13. **Category-specific rules**:
    - Footwear: single shoe facing left at 45°
    - Adult apparel: hero must use model, standing
    - Underwear/swimwear/infant clothing: must be flat lay, no model
14. **Official docs**: [Image requirements](https://sellercentral.amazon.com/help/hub/reference/external/G1881) | [Style guide](https://sellercentral.amazon.com/help/hub/reference/external/G9FUUH87RBNXGKB7)

### Amazon Image Set Style Notes

Amazon is the **info-first** platform. The winning structure for a 4-image set is usually:

1. **White-bg hero** — all colorways in a neat grid or a single clear product shot on pure white; communicates SKU value instantly.
2. **Spec chart** — dimension callouts (diameter, thickness, length, stretch) in one clean infographic slot; merge dimensions rather than spreading them across multiple images.
3. **Usage guide** — 2–4 configurations/positions with short headings and sub-lines showing how the product is used.
4. **Benefit callout** — product arrangement + real hand or lifestyle detail + one benefit sentence; keep it inside the white-bg world.

Style tokens: `clean white background, thin dark gray dimension arrows, small neat sans-serif labels, generous white space, soft neutral shadows`.

> **Enrichment mandate for Amazon**: slot 1 is the hero (L0 only, pure white, ≥85%). Slots 2–4 are composite by construction — spec chart = L0 studio + L2 arrows/leader lines + L1 values; usage guide = L0 studio or scene columns + L2 step badges + L1 captions; benefit callout = L0 + L3 hand or lifestyle detail + L1 benefit line. Any additional supporting image (slots 5–7) must also carry ≥2 enrichment layers; a plain back/side/angle shot is an extra, not a required slot.

> **Why this works**: Amazon buyers are in comparison mode; info density and clarity beat atmospheric lifestyle scenes. Lifestyle can still appear in slots 5–7 if the user wants them, but the core 4-image set should answer "what is it, what size, how do I use it, why is it better" first.

---

### 2. eBay

1. **Image count**: 1–24.
2. **White background**: ⭕ Strongly recommended.
3. **Recommended size**: Min 500×500 px; recommended 1600×1600 px for clearer display and zoom viewing. **AI generation target: 2K (2048 px on the longest edge)**.
4. **Aspect ratio**: 1:1 or 16:9.
5. **File format**: JPEG, PNG, GIF, TIFF, BMP, WEBP, HEIC, AVIF.
6. **Max file size**: 12 MB.
7. **Resolution**: High resolution (1600 px recommended) enables zoom.
8. **Product coverage**: Not specified; must show full product without clutter.
9. **Background**: Neutral or white recommended; avoid cluttered environments.
10. **Prohibited elements**: Borders, text, logos, copyright notices, watermarks, promotional badges.
11. **Supporting images**: Multiple angles, details, defects, size reference (e.g., coin), package contents.
12. **Video**: Via Photos & Video panel.
13. **Category-specific**: Used/vintage items must use actual photos (no stock images); PSA Graded Cards have a dedicated auto-fill flow.
14. **Official docs**: [Picture requirements](https://www.ebay.com/help/selling/listings/adding-pictures-listings/picture-requirements?id=4148)

### eBay Image Set Style Notes

eBay is the **trust-first catalog** platform. The safest 4-image set is a consistent light-gray or white multi-view catalog:

1. **3/4 hero** — angled front view on neutral background (L0 only; the set's single-capability image).
2. **Condition / mechanism composite slot** — straight-on or profile base + hand demonstrating the mechanism, opening, or fit (L0 + L3 + a second interaction/context cue).
3. **Scale composite slot** — detail or profile base + a scale reference held or placed beside the product (coin, hand, everyday object) + visible contact grounding.
4. **Contents composite slot** — product with its included accessories/packaging laid out, or macro material shot with a hand presenting it (L0 + L4, or L0 + L3 + L4).

Style tokens: `light gray seamless background, even soft shadow, consistent camera height and lighting across all views, no props that do not come with the product`.

> **Enrichment mandate for eBay**: eBay bans in-image text and badges, so slots 2–4 must still be composite via non-text layers — e.g. hand-held scale reference, product in use, accessory/packaging line-up, or mechanism shown mid-action. A plain second/third camera angle does not count as a required slot (see **Supporting-slot enrichment mandate**).

> **Why this works**: eBay buyers need to verify condition and authenticity; multi-view consistency is the trust signal. This set is a solid fallback when the user does not need a styled campaign, but it is usually lower priority than Amazon/TikTok/Etsy/Shopify sets.

---

### 3. Walmart Marketplace

1. **Image count**: ≥1; recommended ≥4.
2. **White background**: ✅ Mandatory seamless pure white (RGB 255, 255, 255).
3. **Recommended size**: US: 2200×2200 px; CA: 2000×2000 px @ 300 ppi. **AI generation target: 2K (2048 px on the longest edge)**, then scale to market final size.
4. **Aspect ratio**: 1:1 (square).
5. **File format**: JPEG, JPG, PNG, BMP (no animated GIF).
6. **Color format**: RGB; bit depth: 8 bits per pixel.
7. **Max file size**: US: 5 MB; CA: 1 MB.
8. **Resolution**: Min 500×500 px (below = auto-delist); zoom requires 1500×1500 (US) / 2000×2000 (CA).
9. **Image duplication**: Do not duplicate images on the same product detail page.
10. **Product coverage**: Fill frame as closely as possible.
11. **Background**: Hero must be seamless white; supporting images allow environment/detail shots.
12. **Prohibited elements**: Watermarks, personal/company logos, text overlays, promotional language, price tags, borders, non-included accessories, other retailer logos.
13. **Supporting images**: Back, side, detail, multi-angle, lifestyle; apparel allows "Pack Bugs". These are the platform-permitted content types, not a delivery plan — build each as a composite slot (`L0 + L1 labels + one of L2/L3/L4`) per **Supporting-slot enrichment mandate**; a bare back/side/angle shot is an extra image, never a required slot.
14. **Video/3D**: Rich Media supported per Walmart media library standards.
15. **Category-specific**: Large items (e.g., bedding) may include reasonable lifestyle environment.
16. **Official docs**: [US guidelines](https://marketplacelearn.walmart.com/guides/Item%20setup/Item%20content,%20imagery,%20and%20media/Product-detail-page:-Image-guidelines-&-requirements) | [CA guidelines](https://marketplacelearn.walmart.com/ca/guides/Item%20setup/Item%20content,%20imagery,%20and%20media/item-image-guidelines)

---

### 4. Shopify

1. **Image count**: Min 1; max 250 media items per product (images + 3D + video).
2. **White background**: Not required; theme-dependent.
3. **Recommended size**: 2048×2048 px (square) for best display. **AI generation target: 2K (2048 px on the longest edge)**.
4. **Aspect ratio**: 1:1 recommended; any ratio supported (auto-generates thumbnails).
5. **File format**: PNG (preferred), JPEG, WebP, PSD, TIFF, BMP, GIF, SVG, HEIC. Animated GIF and WebP files are supported.
6. **Max file size**: Image 20 MB; 3D model 500 MB; video 1 GB.
7. **Resolution**: Max 5000×5000 px or 25 megapixels.
8. **Product coverage**: Not specified; product should be clear.
9. **Background**: Not specified; driven by merchant brand style.
10. **Prohibited elements**: Embedded videos must not use private/restricted-access videos (must be public/unlisted).
11. **Supporting images**: Encouraged multi-angle; system auto-generates size variants.
12. **Video/3D**: Uploaded video ≤10 min, ≤1 GB, up to 4K (4096×2160 px), in .mp4, .mov, or .webm format; 3D models ≤500 MB, in .GLB or .USDZ format.
13. **Category-specific**: None (customized via apps/theme code).
14. **Official docs**: [Product media types](https://help.shopify.com/en/manual/products/product-media/product-media-types) | [Add media](https://help.shopify.com/en/manual/products/product-media/add-media)

### Shopify Image Set Style Notes

Shopify is the **brand-owned premium** platform. There is no platform-imposed style, so the image world should match the merchant's page theme. A proven 4-image luxury/professional set:

1. **Product portrait** — negative-space hero under deliberate lighting (spotlight or rim light).
2. **Detail macro** — material, weave, texture, or craft close-up.
3. **Styled flat lay** — curated surface arrangement showing the product as object.
4. **Gift box / packaging shot** — only when gifting is the selling angle; otherwise replace with another detail or lifestyle still.

Style tokens: `dark moody premium, deliberate lighting design, controlled shadows, styled surfaces, editorial composition, subtle film grain`.

> **Enrichment mandate for Shopify**: slots 2–4 must still be composite — pair the macro/flat-lay/packaging base with brand-voice copy plus one more layer (annotation, swatch cards, accessory line-up, or the single anonymous hand). A bare macro or bare flat lay does not satisfy a required slot.

Hard boundary vs TikTok: **people are absent, or at most one anonymous styling hand**. The product-as-object is the selling point; it should feel like a brand lookbook, not a creator post.

> **Why this works**: Shopify shoppers buy into a brand world. Coherence between the image set and the page theme (dark set → dark theme, serif wordmark, swatch dots) is the conversion driver. Adapt the palette to the product category (navy/teal for premium, warm earth for artisan, monochrome for minimalist).

---

### 5. Etsy

1. **Image count**: Max 20 photos.
2. **White background**: Not required; stock images and placeholder renders prohibited.
3. **Recommended size**: Width and height ≥2000 px; the first image should have both width and height ≥635 px to avoid appearing lower in search results. **AI generation target: 2048 px on the shortest side** (ensures both dimensions meet Etsy's ≥2000 px recommendation; note this differs from other platforms where 2K refers to the longest edge).
4. **Aspect ratio**: 4:3 or 1:1 recommended (first image horizontal or square for thumbnail cropping).
5. **File format**: .jpg, .gif, .png, .svg, .heic (no animated .gif, no transparent .png).
6. **Max file size**: ≤1 MB recommended for stable upload.
7. **Resolution**: 72 PPI recommended; sRGB color mode.
8. **Product coverage**: Centered with adequate negative space (for cropping tolerance).
9. **Background**: Clean with ample whitespace recommended.
10. **Prohibited elements**: Hero must not contain placeholder mockups (e.g., "Your Text Here"); must use original photos.
11. **Supporting images**: Subsequent images may use renders to show customization options.
12. **Video**: 3–15 s, silent, ≤100 MB, MP4/MOV/FLV/AAC/AVI/3GP/MPEG, 1080p recommended.
13. **Category-specific**: Children's products must meet safety policy; custom products require real sample as hero.
14. **Official docs**: [Image help](https://help.etsy.com/hc/en-us/articles/115015663347) | [Image requirements](https://www.etsy.com/legal/policy/listing-image-requirements/253962679005)

### Etsy Image Set Style Notes

Etsy is the **handmade / warm / gifting** platform. The winning system is a handwritten scrapbook collage set, all in **4:3 landscape** with content kept in the central safe zone (desktop thumbnails crop 4:3, mobile crops 1:1).

A proven 4-image structure:

1. **Cover** — product cluster or wreath on one side, large handwritten script title + subline on the other; title must survive thumbnail crop.
2. **Feature chart** — products or details annotated with handwritten color names and small icons.
3. **Usage polaroids** — 1–2 taped photo frames showing the product in use, with warm annotation.
4. **Gift box** — kraft box with tissue/twine, product peeking out; box itself stays text-free, annotation around it.

Style tokens: `textured light gray paper background, beige washi tape, elegant handwritten script typography, hand-drawn hearts/arrows/sparkles, polaroid frames, soft natural shadows`.

> **Enrichment mandate for Etsy**: the handwriting layer is what makes these slots composite — every non-cover slot needs handwritten L1 copy plus one more layer (L2 annotation/icons/polaroid frames, L3 hand, or L4 gift packaging). A clean unannotated product photo does not satisfy a required slot.

> **Why this works**: The handwritten annotation layer carries the 手作感 and personality that plain photography cannot. Do not abandon it because a user complains the template feels repetitive — instead vary the collage dialect (torn-edge scraps, filmstrips, notebook margins, wax seals, pressed flowers) while keeping the handwriting voice.

---

### 6. AliExpress

1. **Image count**: 1–6 (some categories up to 8).
2. **White background**: Mandatory for first hero image.
3. **Recommended size**: ≥800×800 px. **AI generation target: 2K (2048 px on the longest edge)**, then downscale to final delivery size and ≤5 MB if needed.
4. **Aspect ratio**: 1:1.
5. **File format**: JPG, JPEG, PNG.
6. **Max file size**: ≤2 MB or ≤5 MB (varies by category).
7. **Resolution**: Not specified; must be clear and not blurry.
8. **Product coverage**: 70%–85%.
9. **Background**: First image pure white; subsequent allow solid color, scene, or lifestyle.
10. **Prohibited elements**: Borders, watermarks, multi-image collages, oversized marketing text or color blocks.
11. **Brand logo exception**: A brand logo may be placed in the upper-left corner, up to 220×80 px, with a 20 px margin, under the accessible regional guidelines.
12. **Supporting images**: Recommended order: front, back, side, detail, scene, packaging — read as **content types the platform permits, not slots**. Deliver them as composite slots: hero = L0 only pure white; then a use-context slot (L0 scene + L1 + L3/L2), a structure or steps slot (L0 + L2 callouts/cutaway + L1 labels), and a contents slot (L0 + L4 accessory line-up + L1 caption). Keep marketing type restrained (no oversized text or color blocks) and never ship a bare front/back/side view as a required slot.
13. **Video**: ≤30 s (max 2 min), ≤2 GB, AVI/3GP/MOV/MP4.
14. **Category-specific**: Apparel recommends model photography.
15. **Official docs**: [Seller portal](https://sell.aliexpress.com/) | [Seller learning](https://sellerlearning.aliexpress.com/)

---

### 7. TikTok Shop

1. **Image count**: 1–9 (≥5 recommended for "Good" quality rating).
2. **White background**: Hero (first image) must be pure white.
3. **Recommended size**: ≥600×600 px. **AI generation target: 2K (2048 px on the longest edge)**, then compress to ≤2 MB if needed.
4. **Aspect ratio**: 1:1 (square).
5. **File format**: JPG, JPEG, PNG.
6. **Max file size**: Image not specified (≤2 MB recommended); video ≤5 MB.
7. **Resolution**: >600×600 px.
8. **Product coverage**: Not specified; must clearly show the subject.
9. **Background**: Hero must be pure white; no mosaic or blur effects.
10. **Prohibited elements**: Watermarks, text, borders, graphic overlays, marketing stickers (e.g., "Best Seller"), digital renders, black-and-white images.
11. **Supporting images**: Show different angles, functional details, accessories; no duplicate angles.
12. **Video specs**: Max 1 video per listing, **≤5 MB** (very strict limit).
13. **Media Center video**: Product Media Center accepts MP4 videos ≤10 MB, under 60 seconds, with an aspect ratio from 9:16 to 16:9; however, the Product Listing Policy separately limits listing videos to ≤5 MB.
14. **Category-specific**: Food must show packaging; children's swimwear/underwear must be flat lay on background — no live models or mannequins.
15. **Official docs**: [Image guidelines](https://seller-us.tiktok.com/university/essay?knowledge_id=3196690250417921)

### TikTok Shop Image Set Style Notes

TikTok Shop is the **creator / UGC 种草** platform. The hard differentiator is **human presence**: at least 3 of the 4 shots must include a person or body part (hands, arms, lap, shoulder, POV grip) **interacting with the product**.

Recommended 4-image structure:

1. **Worn-as-accessory close-up** — hands, wrist stack, clasped pose, or how the product is worn/held.
2. **Rear-head / hairstyle detail** — product in use with hard shadow on wall; faces out of frame.
3. **Mid-motion freeze** — the core benefit shown in action (secure hold, stretch, grip, etc.).
4. **Pre-activity ritual** — lacing shoes, gear bench, getting-ready moment; product in life, not on a pedestal.

> **Enrichment mandate for TikTok Shop**: text and graphic layers are banned set-wide, so each supporting slot must stack **L3 + one more non-text layer** — a second body/interaction point, an accessory or packaging item in frame, a companion device, or a clear scale/context reference. Shot 1 is the hero (L0 only, pure white). A bare product-only angle never counts as a supporting slot.

Style tokens (sports / active categories): `direct camera flash aesthetic, hard small shadows, slightly grainy editorial film look, cool tones, plain unbranded garments, faces out of frame`.

Style tokens (cozy / home categories): `warm golden light, cream/beige home scenes, influencer phone-photo authenticity, lived-in mess, soft natural skin tones`.

Hard rules:
- **Ratio: 1:1 square ONLY** — never 3:4/4:5, even if official docs are silent on ratio. Use the platform minimum (≥600×600 px) as the floor; the style system targets 800×800+ for best thumbnail quality.
- **No text overlays** on the editorial set; let the action do the selling.
- **AI-original people only**, faces cropped or out of frame; plain unbranded garments; no crests/numbers/athlete likeness.

Boundary vs Shopify: TikTok should feel like *"a creator I follow just posted this"*; Shopify should feel like *"a brand's lookbook page"*. If a generated TikTok set could pass as Shopify, regenerate with stronger human presence and phone-photo angles.

> **Why this works**: TikTok shoppers convert on authentic "someone like me uses it" energy. The person USING the product is the selling point, not the product alone.

---

### 8. Shopee

1. **Image count**: 1–9 (including cover); Shopee Mall requires ≥3 different angles.
2. **White background**: Cover image requires solid-color background (white preferred).
3. **Recommended size**: Mall min 500×500 px; recommended 1024×1024 px. **AI generation target: 2K (2048 px on the longest edge)**, then downscale to final size.
4. **Aspect ratio**: 1:1 mandatory; optional 3:4 upload for extra traffic.
5. **File format**: JPG, JPEG, PNG.
6. **Max file size**: ≤2 MB.
7. **Resolution**: Must be clear, sharp, true-color.
8. **Product coverage**: Cover ≥60%; non-cover ≥50%.
9. **Background**: Cover must be solid color (white preferred); apparel/food/home non-cover may use environment backgrounds.
10. **Prohibited elements**: Watermarks, collages, borders, promotional text/symbols; Mall seller logo limited to top-left corner at <10% area.
11. **Supporting images**: Must show different angles, details, scale, usage, variations, packaging, and relevant specifications; avoid duplicate views. Each of these must be built as a composite slot (`L0 + L1 + one of L2/L3/L4`) per **Supporting-slot enrichment mandate** — "different angles" alone does not satisfy a slot; the angle must carry usage, scale, spec labels, or accessories.
12. **Video**: Max 1, ≤30 MB, resolution ≤1280×1280, 10–60 s, MP4.
13. **Category-specific**: Fashion/beauty cover allows models; adult products require special coverage guidelines.
14. **Official docs**: [Image guide](https://seller.shopee.sg/edu/article/34)

---

### 9. Lazada

1. **Image count**: 3–8. Product images must not be duplicated within the same image set.
2. **White background**: Hero (first image) must be pure white.
3. **Recommended size**: Min 330×330 px; recommended 1000×1000 or 1600×1600 px. **AI generation target: 2K (2048 px on the longest edge)**, then downscale to final size.
4. **Aspect ratio**: 1:1.
5. **File format**: JPG, JPEG, PNG.
6. **Max file size**: ≤3 MB.
7. **Resolution**: ≥72 DPI.
8. **Product coverage**: ~80% (e.g., 80–100 px margin on 1600 px canvas).
9. **Background**: Hero must be pure white (RGB 255, 255, 255).
10. **Prohibited elements**: Watermarks, promotional text, decorative borders, distracting graphic overlays, unrelated objects, competitor branding, and content that obscures or misrepresents the product.
11. **Supporting images**: Must include side, back, detail views; lifestyle scenes or scale references recommended. Build each as a composite slot — because Lazada bans promotional text, use informational L2 labels/callouts plus L3 interaction or L4 accessories (`L2 + one of L3/L4`) rather than promo copy; a bare side/back/detail view is an extra image, never a required slot.
12. **Video**: ≤100 MB, 10–60 s, MP4.
13. **Category-specific**: Fashion supports AI model try-on generated images.
14. **Official docs**: [Lazada University](https://university.lazada.sg/) | [Image requirements](https://redmart.lazada.sg/seller/support/image-requirements-12698.html)

---

## B2B

### 10. Alibaba.com (International)

Use this spec when generating an Alibaba.com main image set (主图套图) so the output meets the platform's upload rules and risk-control requirements.

**1. Set composition — 4 to 6 composite slots (flexible, ordered):** every Alibaba.com main image set MUST include the following slots in this order. The set may contain 4, 5, or 6 images depending on product category and user intent; do not fall below 4 images for a complete listing set. Only slot 1 is a single-capability image — every other slot is a composite slot (`L0 base + ≥2 enrichment layers`) per **Composite Slot Model** → **Supporting-slot enrichment mandate**.

Required base (4 slots):
- **Slot 1 — Hero (white background), L0 only ×1** (must be the first image): pure-white real-product shot, no copy, no callouts, no arrows.
- **Slot 2 — Use-context composite slot ×1**: L0 furnished scene + English L1 headline/subhead + one of L2 (minimal icon/leader line) or L3 (person/hand in use). Archetype A2 or A7. The scene must satisfy **Scene layer richness** (place identity, three depth planes, closed 3–6 element list, named light, depth of field).
- **Slot 3 — Structure / how-it-works composite slot ×1**: L0 clean studio/gradient surface + L2 (cutaway, flow arrows, or dot-anchored leader lines) + English L1 part labels. Archetype A4, or A5 staged in a real scene when the message is an ordered operation. A bare macro crop does NOT satisfy this slot — detail crops are not a slot type.
- **Slot 4 — Feature / contents composite slot ×1**: L0 studio + English L1 headline + one of L2 (feature cards, step badges) / L4 (accessory & packaging line-up) / L5 (app or controller screen). Archetype A3, A6, or A8.

Optional extensions (add in order to reach 5–6 slots):
- **Slot 5 — Second use-context composite slot ×1** — add when the product benefits from showing multiple use contexts (e.g., indoor + outdoor, work + home). Must carry a different message and different enrichment layers than slot 2.
- **Slot 6 — Model composite slot ×1** — add for apparel, accessories, lifestyle, or beauty products where a model adds value: L0 scene + L3 model + English L1 benefit copy. For categories where a model is inappropriate, unsafe, or prohibited (industrial equipment, food packaging, children's swimwear/underwear, sensitive medical devices), replace this slot with another structure/steps or contents composite slot instead.

Do not skip the hero slot, reorder the required base, or omit a required slot's role. Optional slots may be substituted only with another composite scene, structure, or contents slot — never with a duplicate hero, a bare angle shot, or prohibited content.

> Every non-hero slot MUST carry at least two enrichment layers (English copy + callouts/steps/model/accessories); a bare scene photo, an unlabeled close-up, or an alternate-angle white-background shot does not satisfy its slot. The hero slot stays **L0 only**. All L1 copy in this set must be English — Chinese is strictly prohibited.

**2. Base image parameters:**
- Recommended size: not smaller than 640×640; recommended 1000×1000 square. **AI generation target: 2K (2048×2048 square)**, then downscale to 1000×1000 for final delivery.
- Aspect ratio: square (1:1), edge length within 1000×1000.
- File format: JPG / JPEG / PNG.
- File size: ≤5 MB per image.

**3. Hero (white-background) requirements:**
- Mandatory white-background real-product photo: the hero must be a pure-white-background real product shot (also applies to customized products); 3D renders are strictly prohibited.
- Complete and clear subject: the product subject must not be missing or cropped; do not use detail/close-up/partial shots; the subject must be clear with visible details, not too small or blurry.

**4. Composition:**
- Subject coverage: product occupies 75%–80% of the frame, clear and centered.
- No collage, no borders: image collages are not allowed; borders of any form are not allowed, including "white-border images" created by pasting the original onto a white canvas to force a ratio (judged as a border issue — use a ratio-adjustment tool instead).

**5. Copy & language:**
- Any text in the image must be in English.
- Chinese text is strictly prohibited.

**6. Prohibited elements — none of the following may appear:**
- Contact info (including WeChat ID), URLs, QR codes.
- Watermarks (including video watermarks, text watermarks, and watermarks of any form).
- Marketing / discount / platform-benefit wording, including but not limited to: `Local stock`, `EU Local stock`, `Fast customization`, `Guaranteed`, `certified`, `MARCH`, `FREE shipping`, `US$20 off of shipping`, `50% off`, `30% off of new buyers`, `every ¥15 off 15`, `( )% tariff support`, `180-day lowest price`, `delivery`, `dispatch`, `delivery by`, `lower tariff`, `1-year-warranty`, `easy return / money back guarantee`, `GMV`, `1 popular in jewelry`.

**7. Risk-control compliance:**
- Must not contain pornographic, violent, political, terrorist, gory, prohibited-goods, vulgar, or sensitive content; violations will be rejected by the risk-control model after submission.

**8. Official docs**: [Rules](https://rule.alibaba.com/rule/detail/11000682.htm) | [Knowledge base](https://service.alibaba.com/page/knowledge?pageId=128&category=1000000021)
