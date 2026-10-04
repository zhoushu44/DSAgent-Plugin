# PDP Platform Specs — Detail Page Rules
> **Updated**: 2026-09-04
> **Parent**: `pdp.md` — the PDP workflow layer. Load it FIRST; this file alone is not enough to plan a detail page.

## Routing Header

- **Load when**: the PDP flow (`pdp.md`) is active AND the user named one of the platforms indexed below — for that platform's detail-page (详情页/PDP) upload specs, content rules, and module ordering.
- **Load with**: `pdp.md` is **mandatory alongside this file**. It owns the detail-page workflow end-to-end (mode resolution, screen cards, Style Lock, per-screen generation, stitching & export). This file owns **only** each platform's detail-page upload specs, content rules, and production notes.
- **Do not load when**: the request is main images / a listing image set only → load `platform-specs-overseas.md` / `platform-specs-china.md` instead. Those two files cover the **listing-image layer**; this file covers the **detail-page layer**. A combined main-image + PDP request loads both layers.
- **Hard stop**: platform rules change frequently. If the user requests latest compliance, official verification, or a policy-sensitive review, verify against official platform documentation before finalizing. When this file and the platform backend disagree, the backend validation at upload time wins.

## Platform index

| § | Platform | Model | Default in-image language |
|---|----------|-------|---------------------------|
| 1 | Amazon (A+ Content) | B2C marketplace | English (en-US) |
| 2 | eBay | B2C marketplace | English (en-US) |
| 3 | Walmart Marketplace | B2C marketplace | English (en-US), English only on US site |
| 4 | Shopify | DTC storefront | Store language |
| 5 | Etsy | Handmade marketplace | English (en-US) |
| 6 | AliExpress | Cross-border B2C | English |
| 7 | TikTok Shop | Social commerce | English (en-US) |
| 8 | Shopee | SEA B2C marketplace | Target-site language |
| 9 | Lazada | SEA B2C marketplace | Target-site language |
| 10 | Alibaba.com (International) | B2B wholesale | English (Chinese strictly prohibited) |
| 11 | 1688 | B2B wholesale | Simplified Chinese (zh-CN) |
| 12 | Taobao (淘宝) | B2C marketplace | Simplified Chinese (zh-CN) |
| 13 | Tmall (天猫) | B2C marketplace | Simplified Chinese (zh-CN) |
| 14 | JD.com (京东) | B2C marketplace | Simplified Chinese (zh-CN) |
| 15 | Pinduoduo (拼多多) | B2C marketplace | Simplified Chinese (zh-CN) |
| 16 | Xiaohongshu (小红书) | Social commerce | Simplified Chinese (zh-CN) |
| 17 | Douyin E-Commerce (抖音电商) | Social / live commerce | Simplified Chinese (zh-CN) |

> **Read only the section of the platform the user named.** Every entry below uses the same field structure (Upload / Content rules / Production notes), which makes cross-contamination easy — quoting Taobao's 1440px width for a Pinduoduo page is a rejected upload, not a typo. **Never take a numeric value from a neighbouring platform's section.**

> **§17 抖音电商 (Douyin E-Commerce) ≠ §7 TikTok Shop.** Different platforms with different in-image languages (zh-CN vs English) and different rules. Route to the one the user named.

> **This file's index is independent of the listing-spec files.** §14 here is JD.com; in `platform-specs-china.md` §14 is Douyin. Always resolve platform → section **within the file you are reading**.

---

## Cross-Border B2C

### 1. Amazon

Amazon detail pages are **A+ Content modules** — fixed-size modules assembled in Seller Central, not one free-form long image. The stitched long image the PDP flow delivers is a preview/backup; the native form is per-module slices at the backend-specified sizes. A+ requires a brand-registered ASIN — without one, treat the output as generic cross-border detail images.

1. **Upload**: ≤2 MB per image. Clear, high-quality images only — no blur, no pixelation, no animated images. Do NOT bake large bodies of text into images: baked text blurs when zoomed on mobile. Build each module to the exact pixel size the backend specifies for that module, and preview both desktop and mobile before submitting.
2. **Content rules**: no prices, discounts, offers, shipping information, or purchase prompts such as "Buy Now". No QR codes, hyperlinks, URLs, phone numbers, email addresses, or off-site customer-service contact. No customer reviews, unverifiable rankings, or absolute claims ("best seller", "#1"). No comparisons with competing brands or products. Awards, certifications, test conclusions, and efficacy claims must be provable. No infringement of third-party trademark, copyright, or portrait rights.
3. **Production notes**: default module order — core product advantage → usage scenario → functional details → technical parameters → size information → brand information. Images carry the product and the scenes; specs, parameters, and explanatory text go in the modules' native text fields. Fill accurate alt text for every image; check both mobile and desktop rendering before submission.

---

### 2. eBay

1. **Upload**: 1–24 images per listing; ≤12 MB each; JPEG, PNG, GIF, TIFF, BMP, WebP, HEIC, AVIF; minimum 500×500 px, recommended ~1600×1600 px; 1:1 or 16:9 recommended.
2. **Content rules**: images must accurately show the actual item, its quantity, accessories, and condition. Used, damaged, or flawed items must be shown in real photographs that display the flaws — never catalog or stock images alone. No marketing badges, borders, logos, watermarks, copyright notices, or promotional text in images. No misleading images, placeholders, or imagery inconsistent with the actual item. The detail description must not contain URLs, contact information, or transaction links that lead buyers off eBay.
3. **Production notes**: use the image slots for overall view, front/back, multiple angles, material details, size reference, accessory list, and flaw disclosure. Dimensions, materials, condition, and defects go in the Item Description and Item Specifics native fields — do not produce one full-length text image.

---

### 3. Walmart Marketplace

1. **Upload**: JPEG, JPG, PNG, BMP (no GIF); RGB color, 8-bit depth; ≤5 MB per image; standard 2200×2200 px; zoom functionality requires ≥1500×1500 px; ≥4 images per item recommended.
2. **Content rules**: images must match the product name, type, and key attributes; no duplicate images on the same detail page. Never substitute stock images for the actual product. The hero must not carry watermarks, the seller's name, or the seller's logo. Do not show accessories that are not included in the sale. No efficacy claims, promotional language, or Walmart/other-platform names and logos in images. US-site images must not contain non-English text. AI-generated images must be truthful, accurate, and non-misleading.
3. **Production notes**: use the image slots for overall view, multiple angles, structure, material, packaging, and usage scenes. Parameters, selling points, and notices go into structured attributes or Rich Media modules — not one super-long infographic.

---

### 4. Shopify

Shopify is a storefront, not a marketplace — there is no platform detail-page format. The constraint is the merchant's theme: build with its responsive modules (image, text, spec table, FAQ), not with one fixed-width super-long image.

1. **Upload**: product and collection images up to 5000×5000 px or 25 MP; <20 MB per file; PNG, JPEG, PSD, TIFF, BMP, GIF, SVG, HEIC, WebP; up to 250 media items per product including all variants.
2. **Content rules**: the merchant bears compliance responsibility for images, copy, promotions, and efficacy claims — they must meet the sales region's laws, consumer-protection rules, and IP rules. No unauthorized brands, photography, fonts, portraits, or third-party assets. Product images, description, specs, price, and the actually delivered content must be consistent.
3. **Production notes**: do NOT build the entire detail page as one fixed-width super-long image — use the theme's responsive modules instead. Any in-image text must remain legible on mobile; important information goes in native text. Prefer WebP or compressed JPEG, and check cropping and load speed on phone, tablet, and desktop separately.

---

### 5. Etsy

1. **Upload**: JPG, GIF, PNG, SVG, HEIC; animated GIF is NOT supported and transparent PNG is NOT supported (transparent areas may render black). Width and height both ≥2000 px recommended. Images >1 MB may fail or time out on slow networks. sRGB color mode recommended.
2. **Content rules**: images must in principle be the seller's own or commissioned photographs of the actual finished product. No stock images, renders, or staged scenes that cannot represent the actually delivered item. For personalized products the hero must show a similar actually-finished item — never a blank product or a "Your Text Here" placeholder. Images must accurately reflect condition, quality, quantity, and what the buyer actually receives. Every image must have legal usage rights.
3. **Production notes**: organize the 20-image allowance as overall view, details, size/scale, material, making process, packaging, and personalization options. Put explanatory text in the product description — avoid turning the entire introduction into one vertical long image.

---

### 6. AliExpress

1. **Upload**: no unified platform limit on detail-image count, per-image height, total height, or per-image file size (single image ≤5 MB recommended practice). Pure-image description: desktop width 960 px, mobile width 750 px. Upload via platform-recognized image addresses or the built-in editor — never login-protected or non-public URLs.
2. **Content rules**: content must match the actual product; supplementary images must not meaninglessly repeat the hero. No third-party website links, phone numbers, email addresses, social accounts, barcodes, or QR codes. No infringing content, fake effect images, exaggerated efficacy imagery, or discomforting before/after comparisons. Product, specs, material, color, quantity, and accessory information must be consistent everywhere.
3. **Production notes**: when publishing across multiple country sites, prepare both the 960 px desktop and the 750 px mobile versions. Order: core selling points → usage scenes → detail materials → size parameters → usage method → packaging list → after-sales. Record important specs in the platform's native attributes as well — never let them exist only inside images.

---

### 7. TikTok Shop

1. **Upload**: up to 30 related banners or images, plus a separately-added size-chart image. Images must be color, clear, and unblurred, each showing a different angle. Hero on a plain background (white recommended); the product occupies ≥60% of the frame and must not be cropped or occluded. There is no public unified width or total-height spec for the 30 detail images — defer to the country-site backend validation at upload time.
2. **Content rules**: images, title, description, attributes, model number, and the actually delivered product must be consistent. No external order links, phone numbers, email addresses, social accounts, or QR codes. No unauthorized brand logos, celebrity likenesses, or third-party IP. No false efficacy claims, absolute claims, misleading before/after comparisons, or price comparisons with other products or platforms.
3. **Production notes**: organize the detail images as core benefit → usage scenes → functional details → specs/sizes → usage method → packaging list → safety notes. Record important parameters and safety information in native text fields as well — never only as baked image text.

---

### 8. Shopee

1. **Upload**: images must be clear, sharp, and truthful — no blur or pixelation. Provide at least 3 professional product images. Cover image on a plain background (white preferred) with the subject clear and complete; other images show different angles, details, real scale, and usage.
2. **Content rules**: images, product name, specs, variants, and the actual product must be consistent. The cover must not carry watermarks, collages, borders, promotional text, or irrelevant graphics. Do not show products or accessories not included in the sale. No false, misleading, infringing, or product-unrelated images and descriptions.
3. **Production notes**: use the product album for overall, angle, detail, size, variant, accessory, and scene coverage. Do not compress all information into one long image; record important specs in attributes and text description. Before publishing, check the current file-size, dimension, and count hints in the target country site's Seller Centre.

---

### 9. Lazada

1. **Upload**: JPG, PNG; ≤3 MB per image; minimum 330×330 px, maximum 5000×5000 px.
2. **Content rules**: images and text must match the product name, attributes, SKU, and the actually delivered content. No external website image links or off-site redirect links in the long description. No false, misleading, infringing, vulgar, or product-unrelated assets. Text must use the target country site's required language and fully disclose specs, dimensions, accessories, and usage limitations.
3. **Production notes**: use image-text modules for selling points, scenes, details, parameters, sizing, packaging contents, and after-sales. Do not produce one super-long image that cannot adapt to mobile; record important parameters in the product attributes as well.

---

## B2B

### 10. Alibaba.com (International)

1. **Upload**: up to 30 images; ≤3 MB each; JPG/JPEG/PNG only — no animation; RGB color mode; table width 750 px — content beyond it is not displayed.
2. **Content rules**: no IP infringement, duplicate listings, or misleading prices/MOQ. Images, attributes, specs, price, MOQ, lead time, packaging, and the actual supply capability must be consistent. Certifications, capacity, patents, and factory-strength statements must have a real basis. No undeliverable effect renders, fabricated factory imagery, or misleading scene assets.
3. **Production notes**: a B2B detail page leads with specs and parameters, materials, MOQ, tiered pricing, OEM/ODM capability, sample service, lead time, capacity, certifications, packaging, and logistics. Build buyer trust with multi-angle product images plus production-line, quality-inspection, and factory-environment shots. Do not merge the whole deck into one super-long image — modular slices make parameter updates and cross-device adaptation easier.

---

## China Domestic

> **In-image language for every platform in this section is Simplified Chinese (zh-CN)** unless the user specifies otherwise.

### 11. 1688

1. **Upload**: width 750–790 px recommended (fits the mainstream display); height unlimited, but keep the total within ~10 screens for readability; JPG, PNG.
2. **Content rules**: product images, function descriptions, specs, product notices, and other detail assets must be truthful and accurate — no false or exaggerated promotion. Detail assets must not infringe third-party trademark, copyright, patent, or portrait rights. Passing platform review does NOT exempt the merchant from truthfulness and IP liability.
3. **Production notes**: present in wholesale-purchasing logic — material specs, MOQ (起订量), tiered pricing, customization capability, sampling cycle, production cycle, capacity, packaging, and logistics. Slice images by module, and record key data in the platform's attribute and transaction fields as well. Before publishing, create a draft in the actual category and use the backend validation to fix the final width and file sizes.

---

### 12. Taobao (淘宝)

1. **Upload**: ≤20 detail images; total height ≤100000 px; JPG, JPEG, PNG; ≤5 MB per image; per-image height÷width ≤2; width ≥1440 px recommended (e.g. at 1440 px width, height ≤2880 px).
2. **Content rules**: images, text, attributes, SKU, material, specs, and the actual product must be consistent. No false promotion, exaggerated efficacy, or concealed defects. No banned words, vulgar assets, infringing images, or unauthorized brands/portraits. Promotions, prices, gifts, and service promises must be real, valid, and consistent with the product and campaign settings.
3. **Production notes**: build with 1440 px-wide segmented slices, each ≤2880 px tall. Order: core selling points → usage scenes → detail materials → parameters/sizes → usage method → packaging list → after-sales. Record important specs in the product attributes as well — not only inside images.

---

### 13. Tmall (天猫)

1. **Upload**: JPG/JPEG/PNG; ≤5 MB per image; per-image height÷width ≤2; ≤20 images; total height ≤100000 px.
2. **Content rules**: product information must be truthful and accurate per the applicable industry publishing standard. Material, composition, specs, executive standards, production licenses, certifications, applicable users, and warning information must be disclosed as the category requires. No fake materials, fake efficacy, baseless certifications, infringing assets, or misleading promotional information. Special categories — food, cosmetics, medical devices, maternal/infant, electronics — follow their industry standards.
3. **Production notes**: general detail images at 1440 px wide, per-image height÷width ≤2. Before designing, check the category's Tmall publishing standard for mandatory statutory labels, test reports, ingredient lists, warning statements, or license information. Record parameters and compliance information in the platform's native attributes as well.

---

### 14. JD.com (京东)

1. **Upload**: width 990 px (PC) / 750 px (mobile); ≤500 KB per detail image recommended — JD weights load speed heavily, and oversized images hurt search ranking.
2. **Content rules**: images, name, model, specs, material, quantity, color, functions, accessories, and the actual product must be consistent. Promises made in the detail page become the basis for transaction and dispute decisions — on a description mismatch the consumer can request JD intervention and the seller may bear return/refund and freight liability. No false, exaggerated, infringing, vulgar, or unauthorized images and text.
3. **Production notes**: use segmented images for selling points, scenes, details, parameters, dimensions, installation/usage, packaging, and after-sales. Sync important parameters, credentials, and promises into the 京麦 attribute fields.

---

### 15. Pinduoduo (拼多多)

1. **Upload**: width 720–750 px; long-image form recommended. No strict length limit, but keep within ~15 screens (~20000–25000 px) — longer pages depress browse completion. ≤2 MB per image, JPG and PNG; JPG compressed to ≤1 MB recommended for load speed.
2. **Content rules**: product name, price, quantity, model, specs, dimensions, shipping promises, quality assurance, defects, and usage limitations must be accurate, complete, and reliable — never misleading. Images, SKU, and the actually delivered product must be consistent. No false or exaggerated promotion, infringing assets, banned content, or undeliverable service promises. Campaign prices, discounts, and gift descriptions must match the backend campaign settings.
3. **Production notes**: use segmented slices highlighting core benefits, specs, scenes, details, usage instructions, packaging, and after-sales. Create a draft in the target category first and use the upload component's feedback to fix the final per-image size, dimensions, and count.

---

### 16. Xiaohongshu (小红书)

1. **Upload**: 1–100 images; per image ≤5000×15000 px; total height ≤50000 px; JPG, JPEG, PNG; ≤5 MB per image; at least 3 detail images that differ from the hero recommended.
2. **Product-information rules**: appearance, color, specs, material, quantity, and packaging contents must match the product actually sold. Efficacy, performance, sales figures, rankings, certifications, and awards must be truthful — never fabricated or exaggerated. Prices, discounts, gifts, offers, and campaign periods must match the actual campaign. Patents, certifications, test reports, awards, co-branding, and endorsements require genuine, valid, verifiable proof. No fake before/after images, experiment images, user reviews, or data presentations of product effects.
3. **Asset-compliance rules**: no QR codes, off-site URLs, contact information, or other platforms' accounts or store information. No unauthorized third-party trademarks, brand names, portraits, photography, fonts, or other copyrighted assets. No misuse of the Xiaohongshu name, logo, or platform image without permission. No watermarks, symbols, stickers, or logos deliberately covering the product subject. No illegal, vulgar, public-order-violating, or discomfort-inducing content.
4. **Production notes**: manual backend publishing — use a unified canvas width of 1200–1500 px. When compatibility with open-platform APIs is needed — 1200 px width, per-image height ≤1500 px, ≤2 MB. Slice images by complete content modules; never cut through titles, text, faces, the product subject, or parameter tables. JPG for real shots and scenes; PNG for transparent backgrounds, line art, and text charts. Keep important text, logos, and the product subject at a safe distance from image edges. Text must satisfy mobile legibility — no tiny fonts, dense packing, or insufficient background contrast.

---

### 17. Douyin E-Commerce (抖音电商)

> **Not TikTok Shop (§7).** See the disambiguation note at the top of this file before routing.

1. **Upload**: JPG, JPEG, PNG; width 620–1290 px; <5 MB per image; the merchant backend currently displays up to 50 detail images.
2. **Content rules**: images, title, attributes, specs, material, functions, usage method, and the actual product must be consistent. No false description of quality, ingredients, performance, usage, producer, shelf life, origin, price, logistics, or service. No infringing, vulgar, discomforting, misleading before/after, or unauthorized brand/portrait assets. No QR codes, external links, contact information, or off-platform traffic-diversion without platform permission. Qualifications, patents, tests, certifications, endorsements, and efficacy claims must be truthful with supporting proof.
3. **Production notes**: use a unified 1200 px or 1280 px canvas (inside the 620–1290 px allowance). The first screen leads with the core benefit, main functions, applicable scenarios, and key purchase notices; subsequent screens cover overall view → details → craft → materials → parameters → sizes → usage method → supply-chain strength → qualifications → after-sales. Do not fill all 50 slots by default — prioritize information completeness, load speed, and mobile text legibility.
