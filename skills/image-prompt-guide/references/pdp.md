# PDP Detail Page Images

## Routing Header

- **Load when**: user requests detail-page images or a complete detail page (PDP) — triggers: "详情页", "商详图", "详情图", "详情页素材", "PDP", "PDP 素材", "detail page", "detail page material pack", "generate the images for my detail page". Two modes, resolved in Step 0:
  - **Material mode**: the user wants detail-page images only, to their own specification (count, size, copy) — e.g. "生成两张适合跨境电商的详情图，1200*1200px".
  - **Full PDP mode**: the user wants a complete detail page — screen plan + per-screen finished images + stitched long image and/or platform-formatted slices, often combined with a main-image set and naming a platform.
- **Do not load when**: user wants a single standalone image without detail-page context (route to the single scene), a standard multi-image listing set for a platform (load `platform-product-guidelines.md`), or a marketing campaign poster (load `marketing-poster.md`).
- **Merge notes**: this reference owns the PDP screen layer end-to-end: input collection → product-image diagnosis & retouch → conversion strategy → screen planning → per-screen generation (copy baked in) → pre-delivery gate → stitching & export. It delegates each screen's scene treatment to the existing scene references (Scene Image, Selling Point, Image Detail, White Background, Model Showcase) but **owns the per-screen shot plan and screen card**. The main-image/listing layer belongs to `platform-product-guidelines.md` — when the request combines main images + PDP, run BOTH from one diagnosis/retouch pass and one Style Lock. Whenever a screen carries copy, load `selling-point.md` → **Step 5: Typography Design**.
- **Hard stops**: (1) No-Hallucination end-to-end — never fabricate facts, certifications, dimensions, claims, reviews, or proof data; use clearly-marked placeholders. (2) The platform is confirmed with the user whenever it still shapes the output, and is never assumed when asked for — but it is **skipped** when the user already fixed count AND size/ratio and wants no platform-formatted artefact, because the spec has already replaced every adapter default (Step 0b). (3) The assembled long image is code-stitched, never one AI call (Step 9).
- **Platform rules**: when the platform is known (Step 0b), load `pdp-platform-specs.md` and read **only the named platform's section** for its detail-page upload specs, content rules, and module ordering — they shape the screen plan, the baked copy's compliance check (Step 7), and the export slices (Step 9).

## Scene Description

Generate the images for a multi-screen product detail page. A PDP is a vertical stack of screens (mobile-first) that tells: what the product is → why it matters → proof → parameters → trust → action. Each screen is one **complete, finished image** — the product visual AND its copy (headline, labels, spec rows) are generated together in one AI call, per a confirmed screen card. Screens are stacked into one long image by code (Step 9); pass-through merchant graphics may fill a screen without an AI call.

> **vs Platform Image Set**: a platform listing set (Priority 1) produces independent listing images per platform specs. PDP screens are designed to stack into ONE continuous page — shared background world, lighting, and palette across screens — and each screen is a finished composited image, not a raw base layer.

## Apply Method: Concatenate

Build each screen prompt per the loaded scene reference (Scene Image / Selling Point / Image Detail / White Background / Model Showcase), including the screen card's exact copy strings styled per `selling-point.md` → **Step 5: Typography Design**, then append the **PDP Screen Contract** fixed constraints (Step 6), then assemble per SKILL.md **Final Prompt Assembly**.

---

## Step 0 — Mode, Platform & Spec Resolution (run before anything else)

### 0a. Mode

| Mode | Signals |
|------|---------|
| **Material mode** | the request fixes the per-image specs itself — count + size/ratio + per-image content ("生成两张适合跨境电商的详情图，1200*1200px，它是可以折叠的干燥架…"); no story/structure request |
| **Full PDP mode** | the user asks for a detail page as a deliverable — "详情页/商详" as a page, a platform named, main images + PDP requested together, or a reference detail page supplied |

Material mode runs Steps 1–2 and 5–9 and skips Steps 3–4 (the user's own spec is the strategy). Full PDP mode runs the whole flow. When genuinely ambiguous, ask once — batched with the platform question (0b).

### 0b. Platform gate (conditional — ask only when the platform still shapes the output)

- **Ask once** when the answer would change what gets produced: full PDP mode (the adapter drives story structure, screen count, slice format, and language baseline), material mode with count or size/ratio still unresolved (those would otherwise come from adapter defaults), or the user wants platform-formatted slices, platform compliance statements, or a listing set alongside the PDP. Ask "发在哪个平台？" batched with the mode question and any other blocking gap. Never infer it — "跨境电商" / "cross-border" is NOT a platform answer.
- **Skip it** when material mode already fixes count AND size/ratio and no platform-formatted artefact was requested: the user's spec has replaced every adapter default the platform would have supplied, so the question cannot change the output. Build to the given spec with generic cross-border defaults and record "no platform bound — built to the specs you gave" under **Assumptions / Defaults Used**. Never stall a fully-specified request on a question whose answer would change nothing.
- If the user explicitly delegates ("你定"), pick from the covered adapters by request evidence (B2B / wholesale / OEM signals → Alibaba.com; B2C retail → Amazon) and state the choice under **Assumptions / Defaults Used**.
- **Delivery cadence (same card, full PDP mode only)**: ask it batched with the platform — 「交付节奏」 → `直接生成（不用给我看规划）` / `先看规划再生成`. This one answer decides whether Steps 4 and 5 stop for confirmation at all. Material mode never asks it — its spec is already the plan, so it has no planning gate to skip.
- **Medium (HARD)**: every Step 0b question goes through the `ask_user` structured form — ONE card, all questions batched (platform + mode when ambiguous + cadence + any other blocking gap). Never pose them as chat prose that makes the user type the answer back. The same holds for every other question this reference authorizes (Step 1 input gaps, Step 3 driver ambiguity, Step 5 plan approval): if the run needs an answer to continue, it is asked with `ask_user`.
- **No re-asking (HARD)**: whatever this card returns is granted permission, not a preview. A cadence of `直接生成`, or a delivery-form answer that includes image generation, authorizes generation for the rest of the run — never stop later to ask for the same permission a second time.
- **Unsourced facts (same card, both modes)**: before planning, check every fact the plan would bake into an image against its source — the user's request, text physically printed on an uploaded image, or a prior answer. When a Must-ask fact (Step 7) has none, add ONE question to this same card: 「产品参数」 → `我提供参数（贴给我）` / `不要写具体参数` / `按图上可见的写`. `不要写具体参数` is a complete answer, not a degraded one — express the selling point qualitatively ("Waterproof Coated Finish", never "330gsm") and never substitute an invented value or bake a `[pending]` placeholder into a picture. `按图上可见的写` is transcription ONLY — never infer, convert units, complete a partial spec table, or carry a number across products. Skip the question when every Must-ask fact already has a source. Do not spend this card's slots on answers the platform baseline already gives (e.g. copy language for Alibaba.com is English per Step 0c) — spend them on the facts that would otherwise be invented.
- Covered PDP adapters: **Alibaba.com, Amazon** (see **Platform Adapters** below). If the user names another platform, run with generic cross-border defaults plus that platform's rules in `pdp-platform-specs.md` (detail-page layer) and `platform-product-guidelines.md` (listing layer) where present, and note the adapter gap in the output.
- The request combines main images + PDP → also enter the Priority 1 planner (`platform-product-guidelines.md`): one diagnosis/retouch pass, one Style Lock, both layers planned together.

### 0c. Spec precedence & language

- **Material mode**: user-specified count / size / ratio / language / copy override everything — deliver exactly what was asked. Fill unspecified gaps from the platform adapter defaults; ask only when a gap blocks generation. The stitched long image is NOT part of that count — it is assembled on top of the requested screens either way (Step 9).
- **Full PDP mode**: adapter defaults shape the plan; explicit user specs still override where stated.
- **Language**: platform baseline (current adapters → English) unless the user specifies. Resolve once for the whole set; write it explicitly into every text-bearing prompt. On-product text physically on the real product (labels, brand marks) stays as-is per the Identity Match Contract.

## Step 1 — Minimum Input Collection (staged, labeled)

Collect inputs in THIS order — never ask for everything at once. Proceed to the next stage only when the current one is provided or explicitly skipped. (Material mode: collect what the user's spec still needs; usually most of it arrives in the first message.)

| Order | Input | What to collect | Notes |
|-------|-------|-----------------|-------|
| 1 | **Product images** | hero / detail / multi-view / packaging / certificates / ingredient or parameter labels | If it is a real product, ask for real-shot photos (front, back, side, close-up) — they prevent structure being drawn wrong. Identify each uploaded image's role. |
| 2 | **Product information** | category, brand/product name, selling points, target audience, usage scenarios, specs, price tier, platform, claims that must appear | Missing facts are marked `pending`, never invented. |
| 3 | **Detail-page reference** (optional) | reference style image or a complete reference long page | Used for visual rhythm, typography density, color mood, and screen/module count (Step 5 → reference-driven mode). |

**Source labels** — every fact used downstream carries one label; only `User-provided` and `Attachment/context` are trusted without verification:

- `User-provided` / `Attachment/context` — from user text, uploads, files, or conversation history.
- `Web-researched` — verified via public sources; briefly list the source in the final output.
- `Inferred` — logical inference from known facts.
- `Assumption` / `Default` — temporary assumption or skill default.

**Disclosure rule**: whenever any `Inferred` / `Assumption` / `Default` is used in a strategy, prompt, or generated result, list it in the final output under **Assumptions / Defaults Used** (short bullet list). Never silently pass off inference as fact.

### 1a. Asset Inventory (one row per uploaded image — build it before Step 2)

Uploaded images have different jobs, and an image whose job is never assigned gets silently dropped. Record every upload in this table and carry it into the Step 5 plan you present to the user:

| Field | What to record |
|-------|----------------|
| **Asset** | short handle for the file (so later steps and prompts can name it unambiguously) |
| **Role** | `real-shot / visual source` (a photograph of the actual product — a generation reference or crop source) · `merchant graphic` (infographic, spec sheet, parameter label, comparison chart — **finished artwork AND a fact source**, see disposition rules) · `packaging` · `certificate / proof` · `reference style page` |
| **What it uniquely shows** | the angle, component, output, diagram, or fact only this image carries |
| **Disposition** | `place as-is → screen N` · `rebuild → screen N` · `visual source → screen N` · `data only (user-agreed: reason)` · `not used (user-agreed: reason)` |
| **Identity source?** | `primary` / `secondary (angle X)` / `no` — see Step 2 |

Rules:

- **Every real-shot gets a planned use.** A photograph the user took is proof of real structure; redrawing what it already shows loses information. Assign it to a screen, or state in the plan why it is not used — an unassigned real-shot is an inventory defect, not a neutral outcome.
- **A merchant-made graphic is finished work, not raw data.** The user spent real effort producing that infographic and will immediately notice its absence. Default disposition is therefore `place as-is` or `rebuild` — **never `data only`**. Reducing a graphic to its numbers is only acceptable when the user agrees to it in the confirmation round, with a stated reason (resolution too low to read at the column width, text in a language that must be translated and the artwork cannot be rebuilt, third-party or competitor branding, compliance risk).
- **Choosing as-is vs rebuild**:

| Disposition | Choose when | What happens |
|-------------|-------------|--------------|
| `place as-is` | artwork reads clearly at the column width, its text is already in the target listing language, and its information order already fits the screen's job | the graphic becomes that screen's visual directly, carrying its own text; no regeneration, the merchant's work is preserved exactly (Step 9 places it as a pass-through screen) |
| `rebuild` | its text must be translated or edited, resolution is too low, or its visual style clashes with the Style Lock | keep its **information architecture** (same facts, same order, same emphasis), mine its embedded visuals as assets, and regenerate the screen as a dense-layout image with the translated/edited copy baked in — editable through regeneration, while still honouring the merchant's structure |

  When both are viable, state the trade-off in one line (exact preservation vs translatability) and let the user choose. Multi-language listings normally push toward `rebuild`; a single-language listing toward `place as-is`.
- **Mine the embedded visuals, not just the numbers.** Merchant graphics usually contain real product photography, diagrams, exploded views, or annotated close-ups. Those embedded visuals are **visual sources in their own right** — record them in "What it uniquely shows" and treat them like real-shots in Step 2. A wire-path diagram inside an infographic is often the ONLY asset showing that part; regenerating it from the primary source invents it.
- The inventory is presented **with** the Step 5 screen plan, in the same confirmation round — no extra approval step. Every row must show a disposition; a blank disposition blocks generation. (Material mode: when the user's request is fully specified, present the inventory alongside the planned screens and proceed unless the user objects — no separate confirmation round.)

## Step 2 — Product Image Diagnosis & Retouch (run before screen generation)

Analyze uploaded product images BEFORE planning screens. Check: blur, noise, exposure, color cast, reflection, deformation, dirty background, bad cropping, harsh shadows, wrinkles/scratches, logo legibility, perspective, material texture, and missing front/back/side proof. Then:

1. Output a **customized retouch prompt** naming the specific defects found (one prompt, `image_edit`, resolved mode).
2. Generate a **white-background refined product image** (load `references/white-background.md`). When the inventory (Step 1a) holds **several distinct real-shot angles**, retouch **each** of them — one refined image per angle, not one refined image for the whole product. Each keeps its own handle (`refined-front`, `refined-side`, …).
3. **Multi-angle consistency check** (when 2+ angles exist): verify color and proportions match across angles; keep all other product traits unchanged (Identity Match Contract). Report the consistency result before moving on.
4. If the user says no retouch, or already provides refined images: skip generation but still run the consistency check when multiple angles exist.

**Retouch usage — one primary source, angle sources kept alive**:

- Designate the best full-product angle as the **primary identity source**. Screens showing the whole product (hero, spec, action) reference it.
- Each additional refined angle stays an **available identity source for the views it uniquely shows**. A screen whose job is a specific angle, component, mechanism, or output **must reference the real photo of that angle** — never the primary source, because asking a model to invent an unseen side of a real machine is exactly where fabricated structure appears.
- **Detail close-ups prefer a crop.** A component close-up takes the matching real-shot and crops into it per `image-detail.md` — cropping preserves true structure; regenerating a close-up from a front-only source invents it.
- Reference images for props/style ("参考图二的道具") are inputs to the scene treatment of the delegated scene reference; product identity still follows the Identity Match Contract.
- Never generate screens from a defect-ridden source and hope the model fixes it.
- Record which source each screen uses in the Step 5 plan, so Step 8 can verify it.

## Step 3 — Conversion Driver Diagnosis (full PDP mode only)

Decide what the PDP must prove before planning screens. The driver determines screen order and emphasis:

| Driver | Product fits when | PDP emphasis |
|--------|-------------------|--------------|
| **Visual-Driven** | appearance, texture, gifting, before/after contrast sell the product | hero + close-up detail + scene beauty shots; minimal copy |
| **Pain-Driven** | recurring annoyance, risk, inefficiency, clear loss | problem screen first (state the pain visually), then solution screen, then proof |
| **Emotion-Value-Driven** | self-expression, identity, care, impulse, social currency | aspiration/identity screen, lifestyle scene, unboxing/gifting moment |

Rules:
- Diagnose from the product category + user input. If the driver is genuinely ambiguous, ask the user once ("who is this PDP for, and what makes them buy?").
- The diagnosis selects WHICH screens matter, not their pixel execution. Do not invent pain points or emotional claims — only restructure what the user provided or what is verifiable from the source.

## Step 4 — Buyer Reason Card (full PDP mode only; lock before any copy is written)

Before writing any screen plan or copy, output a Buyer Reason Card — it is the single source of truth for every screen's message and copy:

1. **Target buyer** — who buys, in which usage scenario.
2. **Purchase trigger** — why they would consider buying NOW.
3. **Core belief shift** — old belief → new belief the page must create.
4. **Primary selling reason** — the single strongest reason (pick ONE).
5. **Proof material** — available evidence assets; if none, write `proof placeholder` (never invent data).
6. **Review / recommendation material** — real reviews/themes only if the user provided them; otherwise write `review placeholder` (never synthesize fake reviews).
7. **Offer lever** — price, bundle, guarantee, shipping, gift, or low-risk promise.
8. **Evidence-bound claims** — claims (data, certifications, sales, reviews, brand authorization) only when evidence exists.

The card is output with the Step 5 plan, never as its own stop point — it does not get a confirmation round of its own. Whether the combined output pauses for approval is decided solely by the Step 0b cadence answer (Step 5, last bullet). The locked card feeds Step 5's screen messages and every screen card's copy; user edits to it are final.

## Step 5 — Screen Plan

### 5a. Screen cards (one row per screen — the planning unit for BOTH modes)

| # | Message | Shot plan (angle · distance · subject position) | Identity source | Copy (exact strings) | Scene reference | Execution |
|---|---------|--------------------------------------------------|-----------------|----------------------|-----------------|-----------|

- **Shot plan is mandatory per screen**: every screen carries an explicit angle · distance · subject position before generation starts. A screen with no planned shot defaults to the source image's framing, which is how a multi-screen pack collapses into one repeated shot with different background tints. Carry each shot plan into that screen's `Canvas and composition:` / `Camera:` blocks as concrete values (adapt a row when the product's shape makes the default implausible — state the adapted value in the plan).
- **Copy column is exact strings, locked before generation**: headline, labels, spec rows, compliance lines — the precise text that will be baked into the image, in the resolved language. The prompt must reproduce these verbatim; the model adds no other text.
- **Identity source column** names which Step 2 source that screen references (primary, a specific angle source, or a crop of a real-shot). Screens whose job is an angle or component the primary source does not show must point at the real photo that does.
- **Execution column**: `standard` for most screens; `dense-layout` for text-heavy screens (parameters, compliance, comparison — Step 5d) and dense flat-lay/comparison layouts.
- A screen filled by a **merchant graphic placed as-is** (Step 1a) has no shot plan, no copy, and no AI call — mark it `pass-through → <asset>` in the plan. Prefer this over regenerating a screen the user has already built well.
- **Material mode**: the user's spec defines the rows (count, per-image content, copy); build the card for each requested image. When the request is fully specified, present the cards + inventory and proceed unless the user objects.
- **Full PDP mode — the Step 0b cadence answer decides whether there is a stop point at all.** The plan itself is always written out (driver + Buyer Reason Card + screen cards + inventory), only its ending differs:
  - `直接生成` → **no stop point**. Write the plan as a statement of what is being built, then generate in the SAME turn. The cadence answer already granted permission — asking again is a violation of Step 0b's No-re-asking rule. Adjustments happen after delivery (localized copy fixes via `references/text-editing.md`, single screens regenerated individually).
  - `先看规划再生成` → present the plan once, then close the turn with an `ask_user` card: `确认，开始生成` / `我要调整（说明改哪屏）` / `换平台重规划`. **Never end the turn with prose that asks the user to type a confirmation** (e.g. 「请回复"确认开始生图"」) — a plan that cannot be approved by one click is a broken gate. Edited plans are final — no second confirmation round.

### 5b. Full PDP mode — story arc

The platform adapter's story arc (see **Platform Adapters**) defines the default screen stack and count. When the adapter has no arc or the user gave no platform signal beyond the gate, fall back to the generic 9-screen stack below; add/remove per driver and category.

| # | Screen | Base visual | Shot plan (angle · distance · subject position) | Scene reference |
|---|--------|-------------|--------------------------------------------------|-----------------|
| 1 | Hero / first screen | full product on brand background | straight-on eye level · full product · centered (hero centering is correct — do not offset it for variety) | White Background or Scene Image |
| 2 | Problem / pain (Pain-Driven only) | situation shown, product absent | contextual angle natural to the situation · medium-wide establishing · product absent | Scene Image |
| 3 | Solution / benefit | product in use, outcome visible | three-quarter at eye level · medium in-use · offset to one third, outcome visible in frame | Scene Image |
| 4 | Key selling points (2–3) | product with clean negative space for the copy | three-quarter or side profile (whichever shows the point) · medium-close · offset away from the copy zone | Selling Point |
| 5 | Detail close-ups | macro texture/structure | perpendicular to the surface being shown · extreme close · detail fills the frame | Image Detail |
| 6 | Parameters / specs | product on clean background, spec rows baked per screen card | straight-on · full product · centered, full-frame | Selling Point (dense-layout, card format) |
| 7 | What's included / packaging | line-up arrangement | elevated top-down (flat-lay is explicit for this screen) · wide · line-up/grid fills the frame | Scene Image (flat-lay) |
| 8 | Trust / brand / compliance | brand-safe visual, compliance statement baked per screen card | slightly below eye level · medium · lower third with headroom above | White Background / Scene Image |
| 9 | Contact / action | product + brand color background | three-quarter · medium · offset against a brand-colour field | Scene Image |

### 5c. Reference-driven mode (when the user provided a reference detail page)

1. Identify the reference's **visible screen/module count** and each screen's message (what it shows + what it claims).
2. Plan the SAME number of screens (or the confirmed adapted count), replicating the reference's **order and message pattern**.
3. Do NOT copy its artwork, layout, fonts, or photography — only the structure. Original visual execution per Step 6.

### 5d. Copy rules (baked-in text)

- **Copy is customer-facing benefit/scenario wording** — never planning vocabulary ("front view", "slot 4", occupancy numbers).
- **Short copy, strong hierarchy**: headline 3–7 words, one idea; ≤4 short support labels on a standard screen; spec/compliance content uses card formats (big numbers, short rows, icons), never dense tables — if the content genuinely cannot fit legibly, split it across two screens rather than shrinking it.
- **Legibility**: all baked copy must stay legible at the platform column width on a phone; apply `selling-point.md` → Step 5 typography (scale, contrast, ≤2 weights, sentence case).
- **Copy placement is part of the shot plan**: the subject is composed away from the copy zone — copy never covers the product's critical areas; put copy in clean negative space.
- **Traceability**: every headline/label traces to the Buyer Reason Card (full mode) or the user's request (material mode); a screen whose copy cannot trace back gets its copy dropped, not invented. Claims with data, certifications, sales, or review themes appear only when evidence exists — otherwise a clearly-marked placeholder (Step 7).

## Step 6 — Screen Continuity Contract (fixed constraints appended to every screen prompt)

Every screen is generated to slot into one vertical long image. Enforce per screen:

1. **Canvas**: generate at 2K (long edge 2048px) per `resolution-routing.md`; aspect per screen role (hero 1:1 or 4:5; scene 3:4; detail 1:1; wide comparison 4:3) unless the user specified exact pixels (then follow the pixel-translation rules). Screens must tolerate a ~64px vertical safe margin at top and bottom — no critical content or copy there — because the column is scaled at stitch time.
2. **Style Lock**: all screens share ONE style system — same background world, lighting language, and palette (repeat the style tokens verbatim across screen prompts, per `platform-product-guidelines.md` → **Platform Image Set Style Systems** rules 1/5). Lock the tokens once (Step 3/4), reuse verbatim. Screens must read as one continuous long image, not disconnected cards.
    - **Style Lock covers treatment, NOT the shot.** The locked tokens are background world, lighting language, palette, and mood. Camera angle, shot distance, subject position, and placement pose are **per-screen decisions** from the screen card and are deliberately NOT locked — repeating them verbatim is a defect, not continuity. A pack whose screens differ only by background tint has applied the Style Lock to the wrong layer.
3. **Role-driven, not artificially varied**: shot differences come from what each screen has to *show*. Two screens may share a framing when both genuinely need it (e.g. hero and spec screen are both straight-on centered). What is NOT acceptable is every screen inheriting the source framing by default.
4. **Grounding**: every screen needs a clean bottom edge (surface/shadow ends within the frame) — a floating product breaks the seam between screens.
5. **Deliverables**: one AI call per **AI-generated** screen — pass-through screens consume no AI call, so generated output count = confirmed screen count minus pass-through screens. Keep a numbered list covering **all** screens (1..N), marking each pass-through entry with its source asset handle, so Step 9 still maps screens 1:1. Log every screen's final prompt for the `prompts/` output.

## Step 7 — Compliance (international listing)

- **Fact sourcing (HARD — both modes)**: every number, material, certification, standard, model code, and origin claim baked into an image must trace to the user's request, text printed on an uploaded image, or a Step 0b answer. Two handling classes:
  - **Must-ask** (blocks generation until sourced — goes into the Step 0b card): composition / material, weight / dimensions / spec values, load rating & capacity (e.g. "up to 10kg" — a safety claim), certifications & standard numbers, MOQ / price / lead time, model codes.
  - **Never-write-unless-given** (never asked, simply absent): factory location or region, headcount, founding year, sales figures, rankings, patent numbers, testing-body names. When unsourced these are removed from the copy AND from the scene — not replaced with a placeholder, and never illustrated.
  - **Unsourced facts must never be rendered as graphics either.** A dimension-callout diagram, spec table, technical drawing, certification badge, or test-report layout presents a claim with the authority of a datasheet — it is more damaging than the same sentence in body copy, not less. No dimension lines without sourced dimensions.
- Generalize regional ecosystem terms before generation (e.g. "小爱同学" → "voice assistant"; "米家" → "smart home app") unless the user confirms the regional term for a regional listing.
- Replace local-only certification marks with international compliance statements (e.g. "Low-VOC" / "PET film" instead of a domestic eco-label logo) — per user confirmation, never invented.
- No fabricated certifications, standards, or test data. Claims must come from the user or be verifiable public facts.
- Reviews / testimonials / before-after proof: only real user-provided material; otherwise use a clearly-marked placeholder. Never synthesize fake reviews or virtual endorsements, even when the user asks for "faster results" — offer a proof placeholder instead.
- Comparison claims (vs competitors, ingredient data, safety, sales): only user-provided or publicly verifiable facts with sources.
- **Reference links and competitor listings are visual references only, never fact sources.** Borrow structure, module order, shot types, and copy style; never carry a model code, filter or material spec, certification, or spec value from someone else's listing onto the user's product.
- Follow the platform's prohibited-element rules (`platform-product-guidelines.md`) — e.g. Alibaba.com bans Chinese text and marketing/discount wording. When the platform is known, also apply its **detail-page content rules** from `pdp-platform-specs.md` (e.g. Amazon bans prices/discounts/"Buy Now" and customer reviews in A+ modules; several platforms ban QR codes and off-site contact) — those rules gate every baked copy string before it enters a screen card.

## Step 8 — Pre-delivery Gate (run before stitching)

Check the generated pack as a set, not image by image. Fix and regenerate the offending screen before delivery:

1. **Shot plan honoured**: each screen's actual angle, distance, and subject position match its confirmed screen card. A screen that came back with the source framing when a different shot was planned is a **failed generation** — restate the framing as concrete values in blocks 4/5 and regenerate that screen. Do not accept it and move on.
2. **Not a background-swap set**: if every screen shows the same subject at the same scale in the same position, differing only in background tint, the pack has failed Step 6.2 — regenerate the screens whose roles called for a different shot.
3. **Style continuity intact**: background world, lighting language, and palette are consistent across all **generated** screens — the varied shots must not have leaked a different venue, time of day, or colour temperature into any screen. Pass-through merchant graphics are exempt: they keep their own look by design, and Step 9 bands them into the column.
4. **Copy read-back (mandatory for every screen with baked copy)**: transcribe every text element in the generated image and compare against the screen card's exact strings. **Source check in the same pass**: every number, certification, standard, model code, and origin string must point to its source (user-supplied / printed on an uploaded image / Step 0b answer) — including values rendered as dimension lines or spec-table graphics. A string that cannot be sourced is a defect even when it matches the screen card exactly: the card itself was wrong, so drop the claim and regenerate. Wrong/garbled/missing/invented text is a defect. A localized error (typo, one wrong label, one wrong number) → fix via `references/text-editing.md` local replacement, not full-screen regeneration. A structural error (text covers the product's critical area, wrong language, copy unreadable at column width) → regenerate the screen.
5. **Copy placement**: no baked text sits over the product's critical areas; labels are legible at the platform column width.
6. **Grounding and seams**: every screen has a clean bottom edge with contact shadow inside the frame; no floating product.
7. **Uploaded-asset consumption**: cross-check the delivered pack against the Step 1a inventory. Every real-shot is either referenced by at least one screen (as an identity source or a crop source) or was explicitly marked not used in the confirmed plan. **Every** uploaded asset — real-shots and merchant graphics alike — must reach the output in the disposition the user confirmed. A merchant graphic silently downgraded to `data only` is a defect even when all its numbers made it into the copy.
8. **Conversion sanity (full PDP mode)**: the first screen states the core value in one glance; each screen carries ONE message; all copy is legible at mobile scale. A screen whose message cannot be named in one phrase is a planning defect — merge or split it.

## Step 9 — Stitching & Export

- **Column width**: platform adapter default (e.g. Alibaba.com structured modules 1200px), the named platform's width in `pdp-platform-specs.md` (e.g. Taobao/Tmall 1440px, JD.com 990px PC / 750px mobile, Pinduoduo 720–750px, Xiaohongshu 1200–1500px, Douyin 620–1290px, AliExpress 960px desktop / 750px mobile), or user-specified width. Scale each screen to the column **by width only** — no crop, no stretch, no upscaling. Respect that file's per-image height caps and file-size caps when slicing (e.g. Taobao/Tmall: per-slice height÷width ≤2, total height ≤100000px; JD.com: ≤500KB per slice recommended).
- **Pass-through screens**: scale by width only; if a merchant graphic is illegible at the column width, send it back to Step 1a for `rebuild` instead of shrinking it. Band it with the nearest palette neutral (from the Style Lock) so the seams above and below match.
- **Stitch**: Python PIL (or an equivalent local image library) vertical concatenation, screens in confirmed order 1..N → the long image. This is code, never `image_generate` / `image_edit` — and never generate the long image as one oversized AI call (a 750×10000px single generation collapses).
- **Deliverables (in this order, always)**:
  1. **Numbered single screens** (`01..N`) — the pre-stitch outputs, ALWAYS delivered.
  2. **Stitched long image** — ALWAYS delivered, in BOTH modes. Stitching is code, not an image call, so it costs nothing and is never withheld as "optional". Only PDP screens enter the column: main-image / listing outputs produced in the same run (the `platform-product-guidelines.md` layer) are NOT stitched in. Two exceptions only — the user explicitly said they do not want a long image, or N=1 (nothing to stitch).
  3. **Slices — only on request**: cut per the platform adapter's module/slice specs, convert format and compress to the platform's size caps (e.g. iterate JPEG quality until ≤3M per slice), named in order.
- **Output organization**: `screens/` (numbered singles), `long/` (stitched), `slices/` (when requested), `prompts/` (per-screen prompt log from Step 6.5). Save to the user-specified directory when given.

## Platform Adapters

Adapters shape the full-PDP plan (story arc, screen count, language) and the export specs (Step 9). Explicit user specs override adapter defaults. Pixel/format numbers are working defaults — **re-verify against current platform docs at delivery time** and say so when you deviate. For platforms without an adapter below, `pdp-platform-specs.md` supplies the detail-page upload specs, content rules, and module ordering — combine them with the generic story arc (Step 5b) and note the adapter gap in the output.

### Alibaba.com (阿里国际站)

| Field | Value |
|---|---|
| Language baseline | English (Chinese text banned in images) |
| Detail-page form | vertical long image; structured detail-page module slices on request ("结构化商详") |
| Slice specs | 1200px (W) × 1200px (H) or larger; JPG/JPEG/PNG; ≤3M per slice |
| Story arc (typical 6–9 screens) | hook screen (core value + strongest fact) → selling-point screens (one point per screen) → scenario/use screens → spec screen → trust screen (OEM / factory / packaging / certifications) → action/contact |
| Tone & avoid | professional B2B, spec-forward, restrained; avoid marketing/discount wording, over-promotion, unverifiable superlatives, fake certifications |
| Main-image linkage | `platform-product-guidelines.md` → Alibaba.com row (real-photo hero, English only) |

### Amazon

| Field | Value |
|---|---|
| Language baseline | English (US) |
| Detail-page form | A+ Content module slices (fixed-size modules; the stitched long image is a preview, not the native form). A+ requires a brand-registered ASIN — otherwise treat as generic cross-border detail images |
| Module specs | standard modules 970×600; hero/banner 1464×600 |
| Story arc (typical 4–7 modules) | hero brand statement → feature modules (one benefit per module, each self-contained) → comparison / at-a-glance chart → proof & FAQ |
| Tone & avoid | benefit-led, evidence-backed, module-scoped; avoid unsupported superlatives, keyword stuffing, fabricated reviews |
| Main-image linkage | `platform-product-guidelines.md` → Amazon row (pure-white L0 hero, no overlay) |

## Tool Invocation

Per screen: `image_generate` (no reference) or `image_edit` (user uploaded product images — refined per Step 2) under the resolved mode from **Execution Mode Resolution**. When the user uploaded product images, ALL generated screens use `image_edit` against **the Step 2 identity source planned for that screen** (primary source for full-product screens, the matching angle source for angle/component screens) — `image_generate` is not an escape hatch for getting a different composition, and the primary source is not a default substitute for an angle the user actually photographed. Screens are standard scenes (product-fidelity) unless the screen is text-heavy (parameters, compliance, comparison) or a dense flat-lay/comparison layout — then dense-layout.

Stitching & export: Python PIL (or an equivalent local image library) — code, never `image_generate` / `image_edit`, never a single oversized AI generation for the long image.

> **`image_edit` anchoring pitfall (the main cause of monotonous packs)**: with a reference image plus identity-preservation blocks, an editing model's default behaviour is to keep the subject exactly as framed in the source and repaint only the surroundings. When the whole pack references one identity source, it inherits that one framing unless each prompt names its own concrete framing. The composition instruction must therefore be **prescriptive** ("three-quarter view at eye level, product in the right third at ~40% of frame height"), never **permissive** ("the camera angle may be changed freely"). This is a prompt-authoring requirement, not a tool-selection problem.
