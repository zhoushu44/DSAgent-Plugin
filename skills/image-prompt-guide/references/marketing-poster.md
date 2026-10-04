# Marketing Poster

## Routing Header

- **Load when**: the user requests a marketing visual whose primary message is a **campaign / offer / brand event** rather than a product fact — promo/sale posters (大促、采购节), product marketing posters, shop banners (旺铺/店招), exhibition posters, holiday posters, company/brand promos, social covers. Triggers: "海报", "poster", "banner", "大促", "促销", "sale poster", "campaign", "旺铺", "店招", "展会海报", "节日海报", "封面".
- **Also load when (Edit Mode)**: the user uploads an existing poster/banner and asks for a whole-canvas change — re-layout to a new size or skeleton, swap the product inside, or "de-AI-ify" the look (去 AI 化). See **Poster Edit Mode**.
- **Do not load when**: product-fact feature images (→ `selling-point.md`); platform listing image sets (→ `platform-product-guidelines.md`); PDP materials or long image (→ PDP references); single-region text replace/fix on an existing poster (→ `text-editing.md`); translating poster text (→ `image-translation.md`); pure dimension change with content unchanged (→ `image-resize.md`); watermark/element removal (→ `remove-watermark.md`).
- **Boundary test**: is the image's primary message a **product fact** (what it is, its features) or a **campaign message** (what event, what offer, when, who, where to buy)? Campaign message → this scene, even when the product is the visual hero. Product fact → Selling Point.
- **Merge notes**: this scene owns the marketing layout and is the merge carrier when a poster combines product scene, model, and copy — absorb Scene Image / Model Showcase as sub-layers, never merge in a second dense-layout scene's layout system. Whenever the poster carries copy, load `selling-point.md` → **Step 5: Typography Design** and apply it; do not duplicate its rules here.
- **Hard stop**: marketing facts and brand assets are NEVER invented or improvised — campaign name, discount/price, dates/countdown, booth number, address, certifications, contact info, reviews, **and the brand's own logo file**. Missing items → ask once via the `ask_user` tool (batch the questions, assets included) or emit clearly-marked placeholders (e.g. `[date placeholder]`); a logo that was not supplied is omitted, never reconstructed. No recognizable third-party brand elements (SKILL.md Core Rule 6).

## Scene Description

Generate or edit a single marketing image in which designed copy (headline, offer, date, CTA) is part of the composition. The deliverable is one finished raster image; text is baked into pixels. The scene has two modes:

- **Generation mode**: create a poster from a brief (optionally with product/logo reference images).
- **Edit mode**: re-render an existing poster as a whole canvas (re-layout, product swap, de-AI-ify).

## Apply Method: Concatenate

The Agent builds the `Primary request:` from the selected template (Step 2) plus the confirmed facts (Step 1), then concatenates the fixed constraint text below (distributed into `Product invariants:` / `Avoid:` / `Typography:` per SKILL.md Final Prompt Assembly). Assemble at the **dense** tier.

### Fixed Constraint Text

```
Every text element must reproduce the confirmed copy exactly, with correct spelling; no other text.
No invented discounts, dates, certifications, statistics, or claims beyond the confirmed facts.
Commercial print quality: no pseudo-text, no garbled small print, no meaningless decorative blobs, no greasy gradients, no stacked type effects (never outline + shadow + gradient on one headline).
```

---

## Generation Mode

### Step 1: Copy & Fact Intake (mandatory before prompting)

Collect the facts the poster must state. Ask ONCE through the **`ask_user` tool**, batching every missing item into that single call with discrete choices; a prose question in the reply does not count as asking. Ask only for facts and assets that cannot be derived (the rows below) — never for layout, palette, typography, or style, which are the Agent's decisions. If the user declines, use clearly-marked placeholders and proceed.

| Field | Rule |
|---|---|
| Campaign / headline | Required. One idea; ≤7 words preferred for promo. |
| Offer line | Discount/price/benefit — only if user-provided; never invent numbers. |
| Date / countdown | Only if user-provided. |
| CTA | Button text or action line; omit if none. |
| Scene-specific mandatory | Exhibition → booth number + venue + date; company promo → provided certifications/facts only. |
| Brand assets | Logo file if the poster must carry one. When the user says "our logo" / "我们自己的 logo" but attaches no file, request the file in this Step 1 batch. If they decline or none exists, omit logos entirely and say so in the delivery note. **NEVER** lift a logo out of a product photo, packaging, manual, or the reference poster (crop, trace, or redraw), and never reuse a logo found in an unrelated file or an earlier task's output — a lifted mark has uncontrolled edges, resolution, and color, and is not a brand asset. Printing a supplied logo onto the product itself is `logo-customization.md`, not this scene. |
| In-image language | Resolve explicitly (user request → target market default) and state it in `Typography:`. |

### Step 2: Template Selection

Select ONE template per poster. **All templates are dense-layout.**

| # | Template | When to Use | Visual Anchors (required in prompt) | Prompt Keywords |
|---|----------|-------------|-------------------------------------|-----------------|
| ① | **Promo / Sale Blast** | 大促、采购节、黑五、flash sale、countdown | Dominant headline + offer number as the visual anchor; date strip; CTA zone; product/category imagery secondary | `"bold promotional poster, oversized offer number as the visual centerpiece, headline above, date strip and CTA below, high-energy commercial layout"` |
| ② | **Product Hero Poster** | Single-product brand poster; product is the hero but the message is brand/campaign | Product at 40–60% of canvas in an ambient scene world; slogan headline; generous negative space | `"product hero poster, product centered in an atmospheric scene, slogan headline with generous negative space, premium commercial photography"` |
| ③ | **Store Banner (wide)** | 旺铺首页 banner、店招、轮播 | Three-zone horizontal composition (copy left / product center-right / CTA); brand strip; wide safe margins | `"wide store banner, three-zone horizontal layout, headline block on the left, product on the right, clean brand strip"` |
| ④ | **Company / Brand Profile** | 企业宣传、工厂实力、证书展示 | Evidence blocks (certificate wall, production line, data strip) in a grid or column structure; restrained corporate palette | `"corporate profile poster, evidence blocks in a clean grid, certificates and facility imagery, restrained corporate palette"` |
| ⑤ | **Exhibition / Event** | 展会、会议、博览会 | Event name + date + venue/booth block with wayfinding-grade hierarchy; product or venue imagery | `"exhibition poster, event name as the dominant headline, date and booth number in a fixed info block, clear information hierarchy"` |
| ⑥ | **Holiday / Festival** | 节日海报 | Festival motif + brand placement; restrained product integration; greeting headline | `"festival poster, seasonal motif integrated with the brand, greeting headline, product placed naturally without dominating"` |
| ⑦ | **Social / Cover** | FB/IG 帖图、朋友圈、短视频封面 | Single thumb-stopping focal point; ≤2 copy lines; platform safe zones | `"social media cover image, single strong focal point, at most two lines of copy, high scroll-stopping contrast"` |

> **Long tail (no dedicated template)**: invitations, celebration/announcement posters (喜报/战报), recruitment, quotation sheets, live-stream posters — compose directly from Step 1 facts with vocabulary from `style-guide.md`; still dense-layout. Do not force them into a template.

### Step 3: Canvas & Size

Priority: explicit user size → template preset below → default `3:4` at `1536x2048`.

| Use | Platform truth | Generate at (16-multiple) | Final delivery |
|---|---|---|---|
| 旺铺/店招 banner | 1920×650 | `1920x656` | native crop to 1920×650 |
| IG / 朋友圈方图 | 1080×1080 | `1088x1088` | native crop/scale to 1080×1080 |
| Story / 竖版社媒 | 1080×1920 | `1088x1920` | native crop to 1080×1920 |
| 视频封面 (16:9) | 1920×1080 | `1920x1088` | native crop to 1920×1080 |
| 通用竖版海报 | — | `1536x2048` (3:4) | as-is |

- Pixel translation, 16-multiple rounding, and area bounds follow `references/resolution-routing.md` and SKILL.md's parameter-shape table — do not re-derive them here.
- Ultra-wide banner ratios exceed the supported `aspect_ratio` list (>21:9): in `auto` mode pass the concrete `size`; in simple/complex fallback generate at the closest supported ratio and finish with native crop/extend.
- Keep all critical copy inside the central 80% of the canvas (safe margin).

### Step 4: Typography

Load and apply `selling-point.md` → **Step 5: Typography Design** in full (type voice, skeleton, scale, contrast direction). Poster-specific additions:

- Exact confirmed copy in quotes + `no other text` (Final Prompt Assembly block 9).
- Numbers in the copy must match the confirmed facts digit-for-digit.
- One headline voice per poster. Expressive type treatments (描边、投影、发光、浮雕压印、渐变填充、金属铬、膨胀弧形、硬边色块承载文字) follow `selling-point.md` → Step 5 part 7 — a poster is the register most likely to earn one, but still **at most one treatment, on H1 only**, matched to the campaign register, and never used to rescue legibility. A series shares the same treatment across all posters.

### Step 5: Campaign Style Lock (multi-poster series)

When the user requests a series (e.g. a 采购节 campaign set), lock once and reuse **verbatim** across all prompts: palette, font voice, layout skeleton family, background world, graphic language. Vary only each poster's single message. Reuse SKILL.md's set-lock mechanics; the locked tokens are the series' identity.

---

## Poster Edit Mode

Whole-canvas edits of an existing poster. Always `image_edit`, always dense-layout.

### Edit Intent Gate

| User asks for | Classification | Route |
|---|---|---|
| Change one copy region / price / date on a poster | single-region text edit | → `text-editing.md` |
| Translate poster text | translation | → `image-translation.md` |
| New size/ratio, content unchanged | resize | → `image-resize.md` |
| Re-layout to a new size/skeleton | whole-canvas | Recipe A |
| Same design, replace the product | whole-canvas | Recipe B |
| "AI 味太重", make it look professionally designed | whole-canvas | Recipe C |

### Pre-Edit Question Gate (HARD)

A whole-canvas edit re-renders every pixel, so whatever the source image cannot tell you would otherwise be invented. Before the first `image_edit` call, check the three items below. If any is open, ask through the **`ask_user` tool** — ONE call, all open items batched, each offered as discrete choices. A question written as prose in the reply does not count as asking: never end the turn with an unanswered question and no `ask_user` call.

| Ask only about | Trigger | Choices to offer |
|---|---|---|
| Illegible copy | Text that must be kept cannot be read with confidence from the source (Copy Transcription Rule) | your best readings as options + "I'll type it in" — never a silent guess |
| Missing brand asset | The request invokes "our logo" / 我们自己的 logo but no logo file is attached | "upload the logo file" / "keep the mark already in the poster" / "no logo at all" |
| Missing hard-stop fact | The edit needs a price, date/countdown, booth number, or claim that was not supplied (Routing Header **Hard stop**) | "provide it now" / "use a clearly-marked placeholder" |

**Ask about nothing else.** Target canvas (SKILL.md Step 0.5 source-following), recipe classification (Edit Intent Gate), layout skeleton, palette, typography, and style are the Agent's own decisions — asking about them is noise, not diligence. When all three items above are already closed, make no `ask_user` call at all: state the intent and what is kept in one line and proceed.

### Copy Transcription Rule (HARD)

A whole-canvas edit re-renders every pixel — "keep the text unchanged" is NOT enforceable by a preservation clause. Before prompting, the Agent MUST transcribe **all** copy to be kept from the source poster and restate it verbatim in `Typography:` (quoted, with role per line). Never delegate copy survival to "keep/unchanged" wording. If any text is illegible, ask via `ask_user` (Pre-Edit Question Gate) instead of guessing.

### Recipe A — Re-layout (整版重排)

1. Transcribe all copy to keep (Copy Transcription Rule).
2. Pick the target skeleton from Step 2 (user-named, or the best fit for the target canvas).
3. Canvas: explicit user size/ratio wins; otherwise follow SKILL.md Step 0.5 source-following.
4. Assemble dense prompt: `Primary request:` = re-layout instruction naming the target skeleton; `Typography:` = the full transcribed copy; `Product invariants:` ≤3 lines; `Allowed changes:` = composition, layout skeleton, element positions, and scale only.
5. Acceptance (agent-side): every transcribed line present and verbatim; product identity intact; result reads as the target skeleton.

### Recipe B — Product Swap (换产品)

Two input images with explicit roles (`Input images:` block 2 is mandatory):

- **Image 1 (poster)** = design source of truth: layout, copy, color system, background.
- **Image 2 (product)** = product identity source of truth: only the product comes from it.

`Primary request:` template:

```
Replace the product in the poster (image 1) with the product from image 2, at the same position and approximate scale as the original product, adapting its lighting, contact shadow, and perspective to the scene. Keep the poster's layout, background, color system, and all text exactly as in image 1.
```

- Copy Transcription Rule still applies (the canvas is re-rendered).
- `Avoid:` must include `no leftover parts of the old product`.
- Acceptance (agent-side): new product identity matches image 2 (geometry, color, prints, logo, on-product text); zero old-product residue; copy verbatim; layout unchanged.

### Recipe C — De-AI-ify (去 AI 化)

1. **Diagnose** the source against the AI-tell checklist and state which items it hits:

| AI tell | Re-declare direction |
|---|---|
| Garbled / pseudo small text | transcribe and re-render all copy (Copy Transcription Rule) |
| Greasy gradients, plastic texture | flat print finish, matte surfaces, named grade |
| Stacked type effects (outline + shadow + gradient at once) | keep one treatment on H1 only per `selling-point.md` Step 5 part 7 |
| Meaningless decorations (light blobs, ribbons, shards) | positive closed element list in `Scene/backdrop:` + `Avoid:` |
| Oversaturated / neon palette | palette re-declared, sampled from the brand |
| Conflicting shadows / lighting | one coherent key light for the whole canvas |

2. **Freeze**: copy content, information hierarchy, brand assets, product identity. **Open**: rendering style, material finish, decorative system.
3. If the source copy is too garbled to transcribe, ask via `ask_user` (Pre-Edit Question Gate) for the correct text first.

### Edit Fallback

After 2 failed attempts at the same whole-canvas edit, stop and offer the alternative: regenerate from scratch in Generation Mode using the old poster as a style reference.

---

## Tool Invocation

- **Generation mode**: `image_generate` (no reference image) / `image_edit` (product, logo, or style reference provided). **Dense-layout** — resolve `task_type` via SKILL.md Execution Mode Resolution (prefer `auto` / `auto_generation`; fallback `complex` / `complex_generation`).
- **Edit mode**: always `image_edit`, dense-layout (`auto_generation` preferred; `complex_generation` fallback).
- **Dimensions**: generation → explicit user size, else Step 3 preset; edit → SKILL.md Step 0.5 source-following unless the user specified a new canvas (explicit override wins).
- With a product reference image, the product is governed by SKILL.md's Identity Match Contract (`Product invariants:` ≤3 lines); the poster's background, layout, and copy are free design space.
- Final delivery crop/compress to exact platform pixels (Step 3) is a native operation, never an AI call.

## Notes

- **Anti-AI-feel is a design rule, not a style preference**: every decorative element must serve the message; if you cannot name its job, cut it — control elements via the positive closed list in `Scene/backdrop:`, never via named negations in `Avoid:`.
- **Text is baked into pixels**: if the user needs editable/translatable text layers, say so once and suggest a code-rendered layout workflow instead (out of this scene's scope).
- **No fabrications end-to-end**: placeholders beat invented facts; synthetic reviews or fake certificates are never generated, even on request.
- **Batch series**: Step 5 Style Lock + one AI call per poster; never one call per design element.
- **Acceptance summary (agent-side)**: copy verbatim and complete; facts match the confirmed inputs; template skeleton recognizable; product identity intact when a reference was provided; no pseudo-text or decorative noise.
