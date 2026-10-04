# Selling Point Image

## Routing Header

- **Load when**: user wants selling points, feature highlights, comparison images, callouts, marketing copy, infographic layout, lifestyle callouts, a how-it-works/structure explanation, usage or maintenance steps, or a dual-state/dual-configuration image.
- **Do not load when**: user only wants a close-up/detail crop without text or layout; load Image Detail instead. For a manufacturing "how it's made" flow, load Process Flowchart instead.
- **Merge notes**: for a single requested selling-point image, merge detail zooms, lifestyle scene, model usage, and callouts into one layout prompt instead of generating intermediate images. Only create separate images when the user asks for multiple outputs. When called as a platform set slot, this reference supplies the L1 copy and L2 graphics layers of a composite slot — see `platform-product-guidelines.md` → **Composite Slot Model**.
- **Hard stop**: never fabricate claims, numbers, certifications, performance data, hidden details, or competitor brand references.

## Scene Description

Generate marketing images that highlight product selling points through **product subject + detail close-ups (optional) + selling-point copy (concise) + layout**. The goal is to help consumers quickly understand product advantages.

> **vs Image Detail**: Detail images are purely "local zoom-in" without copy or layout. Selling Point Image is marketing-oriented — it combines copy + visual layout to convey product selling points.

## Apply Method: Concatenate

Append the fixed constraint text after the selling-point prompt built through Steps 1–4.

---

## Step 1: Selling Point Source

| Situation | Condition | Agent Behavior |
|-----------|-----------|----------------|
| **User provided specific selling points** | User explicitly mentions selling points (e.g., "highlight waterproof and lightweight") | Use user's selling points directly. Agent only adapts wording (translate to English phrases, control word count). **No confirmation needed — execute directly.** |
| **User did not provide selling points** | User only says "make a selling point image" without specifying points | Agent proposes selling points using the Five Dimensions below. **Must confirm with the user before generating.** |
| **Mixed** | User provided partial selling points | Use user's points as L1. Agent supplements L2/L3. **Supplemented parts must be confirmed with the user.** |

### Selling Point Confirmation

When the Agent infers/supplements selling points, present the proposal to the user **before** image generation. Use the host's prompt/selection UI when available; otherwise ask a concise question in chat.

**Step 1 — Confirmation popup** (selling points in the title, only 2 options):

```
Title (markdown, blank line between each tier):

Based on the product features, here is a proposed selling-point plan:

**Core Selling Point**: {L1 copy}

**Feature Highlights**: {L2-1}, {L2-2}

**Trust Signal**: {L3 copy}

Layout template: "{template name}"

Options:
- Confirm & Generate
- Edit Selling Points
```

**Step 2 — If user clicks "Edit"**, show a second popup with the full plan pre-filled in the input field for the user to modify. After submission, treat the edited content as user-provided selling points and execute directly without further confirmation.

**Rules**:
- Only ask for confirmation when the Agent infers/supplements selling points
- One round of confirmation only — no second-guessing after user confirms or edits
- **Merge, never chain**: this is the SAME single interaction described in `SKILL.md` → Step 3 (**One ask, not a chain**). Fold every other open item of the request (overlay-mark handling, in-image language conflict, output count) into this one popup instead of adding a round
- Never put layout, composition, palette, camera, or typography choices in the popup — those are inferred
- Edited content = user-provided selling points; Agent only adapts wording, never overrides intent

## Step 2: Selling Point Criteria (Five Dimensions)

Candidate selling points must fall into one of these five dimensions:

| Dimension | Description | Examples |
|-----------|-------------|----------|
| **Benefit / Experience** | Direct benefit or user experience | "all-day comfort", "silent commute", "effortless cleaning" |
| **Quantifiable Advantage** | Hard metrics with numbers | "40dB ANC", "24h cold", "30H Battery", "IPX8" |
| **Use Case / Target Audience** | Specific scenario or user segment | "office-friendly", "travel-ready", "baby-safe" |
| **Certification / Credential** | Authority endorsement or compliance | "FDA-grade silicone", "BPA-free", "CE Certified", "OEKO-TEX" — only use certification claims that the user explicitly verifies or that are visibly present on the product/packaging |
| **Pain Point Resolution** | Directly addresses consumer complaints | "no slipping", "leak-proof", "anti-scratch" |

**NOT selling points**: subjective adjectives ("high quality", "beautiful"), category common sense ("holds water"), marketing clichés ("crafted with care"), **names of visible parts** ("backrest", "foot basin", "lid"), and **briefing/planning terms** ("front view", "visible components", "floor contact"). Never output these as selling points or as on-image copy.

## Step 3: Selling Point Tiering (L1 → L2 → L3)

Organize candidates into three tiers. User-facing labels: Core Selling Point / Feature Highlights / Trust Signal.

| Tier | User Label | Selection Rule | Copy Requirement |
|------|-----------|----------------|------------------|
| **L1** | **Core Selling Point** | Most differentiated / highest purchase-decision weight — pick 1 | Ultra-concise (≤4 words). Typically "Benefit/Experience" or "Quantifiable Advantage" |
| **L2** | **Feature Highlights** | Expands or supplements L1 — 1–2 items | Short (≤6 words). Typically "Use Case" or "Quantifiable Advantage" |
| **L3** | **Trust Signal** | Contains verifiable elements: numbers, certifications, test conditions | Phrase form, e.g., "FDA-grade silicone", "Loved by 10k+ moms" |

**Tier output rules**:

| Candidate Pool | Output Tiers | Mode class |
|----------------|-------------|-----------|
| Only 1 differentiating point, or user requests "minimal" | L1 + an H3 feature strip — **never L1 alone** | standard |
| 1 core + 1–2 supplements (typical) | L1 + L2 | standard |
| Differentiating point + functional supplements + verifiable evidence | L1 + L2 + L3 | dense-layout |

> **A single tier is not a deliverable.** One short headline on its own has no typographic mass — it reads as a stray watermark rather than a designed frame (see Step 5 part 3 → **Text-block mass**). When only one message is verified, keep L1 at its word cap and build the **second level out of the same already-verified facts**: an H3 tracked feature strip (3–4 confirmed points with full-width separators) or a one-line footnote. **Never lengthen L1 to compensate** — mass comes from a second level, never from a longer headline. For a standalone image, insufficient verified facts may justify a copy-free photographic frame. **For a platform image-set supporting slot, copy is mandatory whenever the platform permits it**: obtain enough verified copy in the consolidated plan confirmation, reuse only verified source facts, or reduce the set to the supported slot count — never silently generate a copy-free supporting image.

**Copy rules** (all tiers):
- Max 6 English words per line
- Prefer data-driven expressions ("40dB ANC" over "powerful noise canceling")
- Preserve the core meaning of user's original wording
- L1 must be the most differentiated; L2 must not repeat L1; L3 must contain verifiable elements

## Step 4: Layout Template Selection

Select ONE of the 8 layout templates based on tier output and product characteristics:

| # | Template | When to Use | Visual Anchors (required in prompt) | Prompt Keywords |
|---|----------|-------------|-------------------------------------|-----------------|
| ① | **Single Highlight** | 1 core selling point; social media hero; ad header | Dynamic motion lines (wind/light arc/curved trail) + optional circular zoom-in | `"single bold headline beside the product, large typography, generous whitespace, dynamic motion lines emphasizing the selling point, optional circular zoom-in, one-focal-point composition"` |
| ② | **Multi-Point Grid** | 2–4 parallel selling points; detail page; A+ module | Circular close-up per point + short text label (≤6 words) | `"product centered, surrounded by circular close-up callouts, each paired with a short text label (≤6 words), arranged in 2x2 grid or 3-column layout with even spacing"` |
| ③ | **Spec Infographic** | Quantifiable specs; tech/electronics/outdoor gear | Double-headed arrows + leader lines + numeric values (not overlapping product) | `"product with technical callouts, double-headed arrows with leader lines indicating dimensions/specs, numeric values alongside leader lines (not overlapping product), small icons, infographic style"` |
| ④ | **Lifestyle + Callouts** | Usage scenario + target audience; apparel/home/outdoor | Thin leader lines → short text labels (≤6 words), never crossing faces or product silhouette | `"product in real-life usage scene, thin leader lines connecting short text labels to specific usage details, lifestyle context, leader lines never crossing faces or main product silhouette"` |
| ⑤ | **Competitor Comparison** | Differentiation; highly commoditized categories | Split-screen "Others" vs "Ours" with row-aligned ✓/✗ marks | `"split-screen comparison layout, left 'Others' with generic gray silhouette (NO brand names/logos/trademarks), pain points with red ✗, right 'Ours' with green ✓, bold 'VS' divider, equal items both sides"` |
| ⑥ | **Structure Cutaway** | How-it-works / internal path for appliances, dispensers, mechanical goods | Half-body semi-transparent cutaway aligned to the real silhouette + directional flow arrows + thin leader lines with dot anchors | `"one half of the product keeps its normal exterior, the other half is a semi-transparent cutaway precisely aligned to the same silhouette, showing only the few internal parts named in the prompt, thick directional arrows tracing the material path, thin leader lines with dot anchors linking each short label to its part, clean studio gradient background"` |
| ⑦ | **Step Sequence** | Usage, installation, cleaning, or assembly steps (NOT manufacturing). **Only when the product visibly changes state between steps** | 2–4 equal-width columns + circular numbered badges 1..N + one caption per column + identical product in every column + **a different, nameable product state or hand action in every column** | `"2 to 4 equal-width vertical panels separated by a hairline or natural boundary and no thick borders, each panel topped by a circular numbered badge, one realistic photo per panel showing that step, one short caption under each panel, the same product with identical structure in every panel, each panel showing a clearly different stage described individually"` |
| ⑧ | **Dual-State Parallel** | One product shown in two configurations/modes/states (power source, size, mode) | Two identical units placed symmetrically + per-side differentiator expressed only through accessory/light/state, no marks | `"two identical units of the same product placed symmetrically side by side, same angle, same accessories, same visible features, each side differentiated only by the state-specific element named in the prompt, symmetric balanced composition, no check marks, no cross marks, no versus divider, no comparison wording"` |

**Selection rules**:

| Trigger | Recommended Layout |
|---------|--------------------|
| One core message only (L1 + its H3 strip per Step 3), or user wants "highlight one point" | ① Single Highlight |
| L1 + L2 (2–4 parallel points, no strong data) | ② Multi-Point Grid |
| Strong quantifiable metrics AND **user already provided specific numeric values** | ③ Spec Infographic |
| Clear usage scenario or target audience | ④ Lifestyle + Callouts |
| User explicitly requests "comparison" / "vs competitors" | ⑤ Competitor Comparison |
| User wants to explain the internal working principle, flow path, or "why it does not jam" | ⑥ Structure Cutaway |
| User wants ordered usage / cleaning / installation steps | ⑦ Step Sequence |
| User wants two power modes, two sizes, or two operating states of the SAME product | ⑧ Dual-State Parallel |

> **Spec Infographic prerequisite**: Layout ③ may ONLY be used when the **user has provided specific numeric values** (dimensions, capacity, battery life, IP rating, etc.). If the user has not provided numbers, do NOT fabricate values — fall back to ②, ④, or ⑥ (a labeled cutaway conveys structure without inventing numbers).

> **Structure Cutaway boundary (⑥)**: the cutaway may show ONLY internal parts the user named or that are plainly implied by the visible product type, and the cut half must stay precisely aligned with the real silhouette. Never generate gears, wiring, circuit boards, screens, or mechanisms that were not stated, and never turn the product into a different product.

> **Step Sequence boundary (⑦)**: use ⑦ for user-side steps only — a manufacturing/production flow goes to `references/process-flow.md`. Step count 2–4; badges unique and sequential; the product's structure identical in every panel; hands anatomically correct and never pierced by water or parts.

> **Panelled layouts need a real difference per panel (⑦ and any multi-column geometry)**: before choosing a panelled layout, write out **what visibly changes in each panel** — the product's configuration (folded → open, empty → filled, attached → detached), the hand's action (grip → lift → insert), the framing (wide → tight), or the surface it sits on. Each panel must also be **described separately in the prompt** and carry its own caption. If you cannot name a different state for every panel, the layout is wrong: **collapse it into one single frame**. Three panels showing the same arrangement from the same camera — differing only by hands appearing, or by a few degrees of angle — is one image printed three times and adds no information (it also wastes two thirds of the canvas). Extra guards:
>
> - **Panel count must never echo a quantity in the copy.** A headline like "Three-Piece Set", "3 Sizes", or "Pack of 4" must NOT be rendered as that many panels — the pieces belong **together in one frame** so the buyer sees them as a set. Panel count is decided by the number of *stages*, never by the number of *items*.
> - **`what is included` is never a step sequence.** Use a single flat-lay or grouped-set frame (one photograph, all pieces visible, optional per-item captions or a bottom contents strip).
> - **Hands are not a stage.** "Product alone" → "same product with a hand resting on it" is not a step; a step needs the product itself to change.
> - Every panel needs its own badge **and** caption; unlabeled identical panels read as a rendering glitch, not a layout.

> **Dual-State Parallel boundary (⑧)**: ⑧ is a self-comparison, NOT ⑤. Never add ✓/✗, "VS", "Others", or better/worse wording, and never add per-side headlines unless the user supplied that copy. Never imply unconfirmed specs (battery count, runtime, capacity) through the state difference.

> **Annotation cap inside a platform image set**: the leader-line / callout styles (③, ④'s leader lines, ⑥) may be used in **at most ONE image of the whole set** — see `platform-product-guidelines.md` → **Expression-mode diversity**. Other slots must carry their message through photography + headline, per-column captions, panel geometry, a feature strip, or an in-frame device screen. Vary the layout template between slots; never reuse the same skeleton twice in one set.

> **Copy must be a message, not a part name**: "Backrest", "Armrest", "Foot Basin", "Front Base" name what is already visible and are only acceptable as labels inside the single annotated image. Everywhere else the copy states a benefit, scenario, or verified spec. **Never render planning vocabulary** — "Front View", "Visible Components", "Floor Contact", "Retail Interior Context", occupancy percentages, angle or slot names — as on-image text; those are briefing terms, not copy.

**Layout → Mode class**: ①② → standard; ③④⑤⑥⑦⑧ → dense-layout. (Mode resolved once in the Tool Invocation section below.)

## Step 5: Typography Design (required whenever the image carries text)

Copy is not "added on top" of the photo — it is designed into the frame. Three failure modes to avoid: type pasted over a photo, **every image in a set wearing the same bold-black-headline + grey-subhead uniform**, and — for Chinese copy — **every slot set in the same flat 黑体**. Work through the eight parts below.

### 1. Choose a type voice that matches the image's art direction

The voice is chosen from the product register and scene mood, then held for the set. **A heavy grotesk sans is one option among many and must never be the default.** Serif, Didone, slab, engraved/small caps, script, condensed, and mono voices are all fully allowed — pick the one the picture is already asking for. For Chinese/Japanese/Korean copy, resolve the register through the **CJK type voices** table below instead of stopping at this one.

| Art-direction register | Type voice | Concrete attributes |
|---|---|---|
| Warm Scandinavian / cozy home | **Humanist sans** | soft-edged humanist sans, semibold headline, generous line spacing, sentence case, warm charcoal drawn from the scene's darkest wood tone |
| Premium interiors / editorial lifestyle | **Editorial serif** | high-contrast serif headline (optionally one italic accent word), sans subhead, tight leading, sentence case |
| Luxury salon / spa / hospitality equipment / furniture | **Didone or transitional serif** | regular-weight high-contrast serif headline with generous cap height, paired with a light wide-tracked sans or small-caps subhead; **ivory or white type over a dark, shadowed, or softly tinted area**; optional single soft-gold / champagne accent |
| Jewelry / fragrance / gifting premium | **Engraved caps** | light serif or copperplate-style ALL CAPS, very wide tracking, hairline rule between levels, warm off-white or muted metallic tone |
| Beauty / spa / wellness | **Light tracked caps** | light-weight sans or serif in ALL CAPS with wide tracking for the eyebrow line, larger light-weight headline, airy spacing, tone-on-tone colour |
| Tech / smart device | **Neutral geometric sans** | medium-weight geometric sans, tight tracking, small line-height, one cool accent colour from the UI |
| Industrial / B2B / OEM | **Technical label voice** | condensed or mono-ish sans, small caps labels, uppercase micro-labels, thin rules, restrained slate grey |
| Handmade / artisan / gifting | **Script + sans pair** | one elegant handwritten line paired with a simple sans supporting line, ink-like colour |
| Sport / bold value | **Condensed heavy sans** | condensed heavy uppercase headline, tight tracking, strong contrast |

Rules: at most **two families per image** (a serif headline + sans subhead pairing counts as two and is encouraged), and the voice's family class stays constant across a set — what varies is the skeleton, case, size, colour direction, and devices below.

> **In a multi-image set, resolve the families once and reuse the wording.** Fix the headline class + companion class (+ the 简繁 variant for Chinese copy) before writing any slot's prompt, then restate that same phrase verbatim in every text-bearing slot — a set whose slots name different font classes does not read as one set even when the photography matches. For platform listing sets this is formalised as the **type-lock phrase** in `platform-product-guidelines.md` → **Set lock** → **Type system lock**.

**Name the font class explicitly in the prompt** — never "clean modern font" or "nice typography". Latin vocabulary: `high-contrast Didone serif` · `transitional serif` · `old-style serif` · `humanist sans` · `geometric sans` · `neo-grotesque sans` · `condensed grotesk` · `slab serif` · `engraved / copperplate small caps` · `elegant handwritten script` · `technical monospace`. For Chinese / Japanese / Korean copy, pick from the **CJK type voices** table below — `黑体` alone is not an acceptable default.

#### CJK type voices (required whenever the in-image language is Chinese, Japanese, or Korean)

Chinese copy collapses into one flat 黑体 headline far more often than Latin copy collapses into a grotesk: 黑体 is the screen-UI voice, not the register voice. Every zh-CN platform (1688 / 淘宝 / 天猫 / 抖音电商 / 京东 / 拼多多) resolves to Chinese in-image text, so this table sets the whole set's tone. Choose the CJK class from the same art-direction register as the table above:

| Art-direction register | CJK font class | Concrete attributes |
|---|---|---|
| 中式文化 / 茶酒 / 高端编辑感 | **宋体 / 明朝体 (Song / Ming serif)** | 横细竖粗高对比、三角形衬线、字距正常；标题可用中粗宋，配深墨色或象牙白 |
| 说明 / 规格 / 克制文书感 | **仿宋 (Fangsong)** | 笔画均匀偏细、字形瘦长、行距宽松；用于参数条与小字说明，不做大标题 |
| 传统手作 / 礼赠 / 老铺食品 | **楷体 (Kaiti)** | 手写楷书骨架、起收笔柔和、常规字重；一行标题为上限 |
| 国潮 / 白酒 / 力量感国风 | **魏碑 / 北魏楷书 (Weibei)** | 刀刻方峻、笔锋外扩、结构紧实；仅用于标题，副文改用黑体 |
| 节庆 / 文创 / 茶酒礼盒 | **书法行书毛笔体 (brush calligraphy)** | 连笔墨韵、粗细随笔势变化；每图最多一行，且必须配黑体或宋体副文 |
| 传统食品 / 中药 / 匾额感 | **隶书 (Lishu)** | 横向扁平、蚕头燕尾、字距略宽 |
| 科技 / 家电 / 商务 / 参数 | **黑体 (Hei / Gothic sans)** | 等粗方正、字距紧凑、行距较小；一个冷调强调色 |
| 母婴 / 宠物 / 儿童 / 甜品 | **圆体 (rounded Gothic)** | 圆角收笔、亲和低压迫、中等字重、行距宽松 |
| 极简美妆 / 护肤 / 香氛 / 轻奢 | **方头黑 / 等线体 (monoline geometric Hei)** | 极细至常规等线字重、几何骨架、眉题宽字距、大面积留白、同色调文字 |
| 工业 / 五金 / B2B / OEM | **长体黑 / 压缩黑体 (condensed Hei)** | 窄体、技术标签、细规则线、克制石板灰；数字用等宽字形 |
| 复古国货 / 老招牌 | **美术字 / 复古招牌体 (retro sign lettering)** | 几何化手绘字形、笔画统一、轻微装饰；仅标题，且不加立体或描边 |
| 大促 / 量贩性价比 | **综艺体 / 粗方头标题体 (heavy display Hei)** | 高字面率、紧排、大字号、高对比 |

> The last row is **platform-gated**: 抖音电商 bans 大字报/牛皮癣 oversized promo type, AliExpress bans oversized marketing type, 1688 bans excessive text overlay. Use a heavy display Hei only when the platform permits it *and* the register genuinely is promotional — never as a shortcut for "make the title stand out".

**CJK execution rules:**

1. **Pair, don't mix.** One CJK family + one Latin/numeral companion fills the two-family budget. 宋体 takes a serif companion for Latin words and figures; 黑体 / 圆体 / 等线体 take a humanist or geometric sans; 书法 / 魏碑 / 隶书 / 美术字 must hand every non-headline line to 黑体 or 宋体. Never set Latin words in a CJK face, and never set the Chinese headline in a Latin face.
2. **Build hierarchy from size and colour, not weight.** Usable CJK weights are few — separate H1/H2/H3 by size ratio, colour step, and tracking. Never fake bold or fake italic (伪粗 / 伪斜) on CJK glyphs.
3. **Vary within the locked family, per slot.** The family class stays constant set-wide and Latin's ALL-CAPS lever does not exist in Chinese, so the available levers are 字重档位、字号、skeleton、竖排 vs 横排、对比方向、全角分隔符 — each zh slot must move **at least two** of them relative to its neighbours.
4. **Glyph integrity clause (mandatory on every CJK text image)** — write into the prompt: `每个汉字必须笔画完整、结构正确，无错字、缺笔、多笔、变形或生造字；不得渲染成近似字形。` Keep each line short (≤12 characters) and prefer common characters — long or rare strings are where models break glyphs.
5. **简繁 lock.** One script variant across the whole set (Simplified OR Traditional); never mix within a string, never switch between slots.
6. **Punctuation and breaks.** Use full-width separators (`｜` `·` `、`) in strips; headlines carry no terminal 句号; never start a line with `，。、）」` or end one with `（「`; break at a phrase boundary and write both lines verbatim into the prompt.
7. **Tracking.** 眉题 and 功能条 may be widely tracked; 标题 stays normal to slightly tight — a Chinese headline is never letter-spaced character by character.

Within one set the pairing's **roles may swap per slot** — a serif headline in the lifestyle slots and a sans-only treatment in the spec or contents slot is variation, not inconsistency.

**If the product itself carries type, sample it first.** When the source image shows a brand wordmark, packaging print, control-panel labels, an embossed logo, or screen UI text, describe that letterform and make it the set's type voice (e.g. "headline in the same geometric sans as the wordmark on the base", "serif matching the packaging print"). It is the most reliable source of a voice that belongs to the product, and it keeps overlay copy and product print from clashing. Guards:

- Sample the **letterform style only** (family class, weight, case, tracking) — never re-use the brand's wordmark, slogan, or packaging sentence as headline copy unless the user supplied that exact string.
- The product's own existing text stays **pixel-identical** — never re-typeset, re-space, translate, or restyle it (see the Identity Match Contract / `Product invariants:`).
- Overlay copy must be clearly **distinguishable in scale and position** from the product's print, so a viewer never reads it as printed on the product.
- If the on-product type is a decorative or illegible mark, or its script differs from the target language (a Latin wordmark for CJK copy), do not force it — fall back to the register table above and instead borrow only its **accent colour**.

### 2. Vary the skeleton per slot (do not reuse one skeleton set-wide)

| Skeleton | Use when |
|---|---|
| **Top band** | the headline is the message; product sits lower; copy in the top 18–26% |
| **Left / right column** | tall product or open wall space; copy in one vertical third, all lines sharing one edge |
| **Lower third** | scene- or person-led frames; copy in the bottom 20–28% |
| **Eyebrow stack** | small tracked-caps kicker above a larger headline, both flush to one edge |
| **Corner block** | compact 2–3 line block in one corner, optically aligned to a scene edge |
| **Numeral-led** | an oversized step or spec numeral anchors the block, copy set beside it |
| **Baseline strip** | one wide tracked line along the bottom edge (feature strip / contents line), no headline above the product |
| **Split header** | full-width header spanning two panels, captions inside each panel |

Pick the skeleton that fits **that slot's composition**, reserve its zone as negative space in the scene wording first, and make sure **no two slots in a set use the same skeleton** unless the set has more slots than skeletons.

> **Moving the block to a different corner is not a new skeleton.** `Corner block` in the top-left, then the top-right, then the bottom-right is **one skeleton used three times** — the set still reads as the same layout repeated with the copy shuffled around the frame. Two slots differ in skeleton only when the **structure** differs: how many lines stack, whether the block hugs a compact corner or spans an edge, whether a kicker or an oversized numeral leads it, whether it runs as a full-width band or a vertical column. When a set genuinely needs two corner-anchored slots, change the structure inside the block (a compact 3-line stack vs an eyebrow above an oversized headline) and state that difference explicitly in each prompt.

### 3. Type scale (relative, not px)

- **H1 headline**: cap height ≈ 6–9% of canvas height; ≤2 lines; ≤12 CJK characters or ≤6 English words per line.
- **H2 subhead**: 45–60% of H1 size; 1–2 lines; may use a thin separator (`｜` or a hairline) between short phrases.
- **H3 tertiary strip** (optional, one per image): 30–40% of H1 size — a feature strip, an "In the Box" line, or a safety note. Use **wide letter-tracking with centred middot separators** (`App Control · Portion Scheduling · Dual Power`) or the CJK full-width bar (`定时喂养｜份量设置｜余粮可视`). Placed at the bottom centre, or directly under H2 when it is a feature strip.
- **Labels / captions**: 25–35% of H1 size; ≤6 words each.
- Size ratio between adjacent levels must be visible at a glance — avoid H1/H2 within 20% of each other.
- **Line balancing**: when copy needs two lines, break it at a phrase boundary into two visually similar lengths and write both lines out verbatim in the prompt — never let the model choose the break.
- **Tracking**: H1 normal to slightly tight; eyebrow lines and H3 strips widely tracked; never letter-space CJK headlines.
- **CJK copy** additionally follows part 1 → **CJK type voices**: the glyph-integrity clause, the 简繁 lock, full-width separators, and the 避头尾 line-break rules.

#### Text-block mass (the copy must read as one designed element, not a stray mark)

Type scale alone does not make copy look designed. The **whole text block** — every level plus its devices, rules and strips, measured as one bounding area — needs enough visual weight to hold its side of the composition against the product. A single four-character headline at the low end of the H1 range occupies under 3% of the canvas: fully compliant on font size, and still reads as a watermark someone forgot to remove.

- **Minimum two levels** on every text-bearing image — H1 + H2, or H1 + an H3 strip. A lone H1 is not a valid text block (Step 3 → *A single tier is not a deliverable*).
- **Block footprint**: the text block occupies roughly **8–18%** of the canvas for a corner block, lower third, or side column, and **18–28%** for a top band, split header, or numeral-led block. Below that range, add the second level or another device — never just enlarge one line.
- **A lone line of <8 CJK characters (or <4 English words) with no second level and no device does not constitute a text block.** Build it into a valid two-level block. Only a standalone photographic image may drop the copy entirely; a platform image-set supporting slot may not use that fallback when its platform permits copy.
- **Reserve the block's zone as negative space first**, sized to the range above, in the composition and scene wording — so the copy lands in planned emptiness instead of being parked on whatever corner happened to stay quiet.
- Mass comes from **level count, device count, and the block's footprint**. Stretching L1 past its word cap to fill the space it leaves is a failure, not a fix.

### 4. Colour: choose a contrast direction per slot, and vary it across the set

First decide the **direction**, then the hue. Do not let every image in a set be dark-on-light.

| Direction | When | Text colour |
|---|---|---|
| **Dark on light** | bright cream/white interiors, studio, flat lay | the scene's darkest neutral, or a **tinted** deep neutral from the palette — espresso, bronze, deep walnut, forest, navy, plum, slate-blue — not generic black |
| **Light on dark** | dark wood, shadowed wall, night/backlit frames, a dark tinted band, or a deep defocused region | **pure white, soft white, warm ivory, or cream** — this is a first-class option, not a fallback |
| **Tone on tone** | quiet minimal frames where the copy should whisper | one or two steps off the background in the same hue |

- Secondary text sits **one step lighter/darker in the same hue family**, not a generic mid-grey.
- At most **one accent colour** per image, pulled from the product or scene palette (a soft gold / champagne / brushed-brass tone is allowed for luxury, salon, jewelry, and hospitality registers), used on at most one word, one rule, or one badge.
- **Legibility support is allowed**: white or ivory type may sit on a **low-opacity tinted scrim** — a soft-edged band along the top or bottom edge, or a gradient wash, colour sampled from the scene (warm brown over wood, cool grey over marble), roughly 15–40% opacity, spanning the full canvas width. It must read as light falling on the frame, never as a hard-edged opaque ribbon, sticker, or badge.
- Never gain contrast through outlines, drop shadows, or glows — use placement, a naturally dark region, or the translucent scrim above. (Part 7 may allow such a treatment as a deliberate **register** choice, but never as the answer to a legibility problem.)

### 5. Device library — pick 2–3 per slot, and vary them across the set

`eyebrow / kicker` · `headline` · `subhead` · `hairline rule` · `tracked feature strip` · `numbered badge` · `per-column caption` · `small-caps spec block` · `pull-quote line` · `footnote / safety note` · `in-frame leader label` (annotated slot only) · `oversized numeral` · `translucent scrim band carrying light type` · `italic accent word`

**CJK-only devices** (they replace the small-caps and italic devices, which do not exist in Chinese): `竖排标题条` — a vertical top-to-bottom headline column along one edge, at most one slot per set, punctuation rotated · `全角分隔功能条` (`定时喂养｜份量设置｜余粮可视`) · `括注副标题` using `【】` or `（）` · `方框细线标题` — a hairline box around the headline · `印章式小色块` — a small seal-like accent mark for 中式 / 国潮 registers only, at most one per image, never carrying the copy itself.

- Each text-bearing slot uses **2–3 devices**, not the same trio every time.
- Across a 4-image set at least **4 different devices** must appear; across 6+, at least **6**.
- For a **standalone image**, the photograph may carry the message with no copy. A **platform image-set supporting slot must carry a real text block** (≥2 levels + 2–3 devices) whenever its platform permits copy; it may not choose a copy-free frame. The only platform-set exceptions are slots covered by an explicit platform text ban, where the ban wins and the plan must use non-text enrichment instead. A short headline parked in a corner is never an acceptable middle state.

### 6. Alignment and margins

- One alignment per image (all centered, or all flush-left) — never mix. Flush-left suits lifestyle/scene slots; centred suits studio and symmetric slots; vary which you use between slots.
- Text block keeps a ≥5% canvas-edge margin; on mobile-first platforms keep ≥8%.
- Optical alignment with a scene edge (counter line, wall edge, product axis) instead of floating mid-air.
- At most three text levels per image — never four.

### 7. Expressive type treatments (register-gated, budgeted — never a legibility fix)

These treatments used to be banned outright, which pushed every image toward the same flat headline. They are **available as deliberate register choices**, under the budget below. They are decoration, so they must be earned: premium interiors, luxury salon/spa, jewelry, and minimal-beauty frames still get plain type — those registers draw their character from voice, tracking, and contrast direction, not from effects.

| Treatment | Allowed registers | Execution constraint |
|---|---|---|
| **描边 Outline / stroke** | 运动、潮流、游戏、潮玩、儿童玩具、大促性价比 | one uniform stroke in one palette colour, on **H1 only**; either solid fill + stroke **or** hollow outline, never both in one image |
| **投影 Drop shadow** | 大促、卡通、儿童、复古印刷 | one soft offset, one direction reused set-wide, offset ≤ 1/8 cap height; never on premium / editorial / minimal registers |
| **发光 Glow / neon** | 夜景、游戏、电子、赛博、酒吧、灯具类目 | only when a **real light source in the frame** justifies it, and the glow hue matches that source; H1 or one accent word only |
| **浮雕 / 压印 Emboss / deboss / letterpress / foil** | 复古招牌、皮具、工艺、礼盒、金属铭牌、节庆 | render as **physical relief on a named material inside the scene** (embossed into the leather lid, engraved on the brass plate, hot-foil on the kraft box), lit by the scene's own light — never as a floating fake-3D layer over the photo |
| **渐变填充 Gradient fill** | 美妆、护肤、科技、渐变包装 | two adjacent hues sampled from the product or scene, one direction; never rainbow, never per-character, never on body copy |
| **金属 / 铬合金 Chrome / metallic** | Y2K 美妆、潮玩、汽配、金属制品、节庆礼盒 | one metal family (chrome / gold / brushed brass), reflections consistent with the scene's lighting; **H1 only, ≤6 words or ≤6 汉字**; never combined with glow or outline |
| **膨胀 / 扇形 / 弧形 Inflated / bubble / arched / warped** | 儿童、糖果、潮玩、复古招牌弧形、圆形徽章 | the arc or swell must follow a **real geometry in the frame** (badge circle, bottle curve, sign board); distortion uniform across the line; **never applied to 汉字** |
| **硬边色块 / 横幅 / 贴纸 / 徽章承载文字** | 大促、清仓、量贩、节庆、活动价 | at most **ONE** per image, ≤12% of canvas area, one palette colour, geometry consistent set-wide; never over the product, never on a slot whose platform bans promo overlays |

**Budget and gates — all of them apply:**

1. **One treatment per image, one level per treatment.** Never stack: an outlined + shadowed + gradient headline is exactly the 牛皮癣 look this budget exists to prevent. The treated level is normally H1; H2 / H3 / labels / captions stay plain.
2. **Register gate.** The treatment must belong to the same art-direction register as the type voice (part 1). If the register column above does not list this image's register, the treatment is not available — no borrowing it "for variety".
3. **Platform gate.** Any slot whose platform bans in-image text, promotional wording, or decorative/graphic overlays bans these treatments too — a treatment is an overlay, not a font. Check `platform-product-guidelines.md` → **Layer permission by platform** (e.g. eBay every slot, Lazada set-wide, the L0-only heroes, AliExpress oversized marketing type, 抖音 大字报/牛皮癣, 1688 excessive text overlay).
4. **Never a legibility fix.** A stroke, shadow, or glow may not rescue text sitting on a busy photo (part 4 stands). If contrast is the problem, change placement, flip the contrast direction, or use the translucent scrim.
5. **Set-level cap.** In a 4–8 image set at most **1–2 slots** carry an expressive treatment, and never the hero, the structure/cutaway slot, or a spec/parameter slot. The plain majority is what makes the treated slot read as intentional rather than cheap.
6. **State it concretely in the prompt.** Name the treatment, its parameters, and its scope — e.g. "headline as hollow outline only, uniform thin stroke in the scene's deep walnut, no fill, subhead plain" — never "cool text effect".
7. **CJK guard.** 描边、投影、渐变、金属 are usable on 汉字 only at large size, as a single simple treatment, and always together with the glyph-integrity clause. **膨胀、扭曲、弧形、浮雕变形 must never deform 汉字 structure** — for Chinese, get the same energy from 字重、字距、竖排、色块 instead. 综艺体 + 描边 + 投影 is the classic 牛皮癣 signature: use it only when the user explicitly asked for a 大促 look **and** the platform permits it.

### 8. Typography prohibitions

- No type effect outside part 7's register + platform + budget gates, and never more than one treatment per image. (Serif, italic accents, small caps, and wide tracking are **voice, not decoration** — they are always available and never count against the treatment budget.)
- No text over the product, over a face, or crossing the product silhouette.
- No text inside a **hard-edged opaque** colour block, ribbon, banner, sticker, or badge beyond part 7's one-per-image allowance — or unless the user asked for one. A soft-edged low-opacity scrim or gradient wash carrying light type (part 4) is always allowed.
- No pseudo-text, garbled glyphs, or unreadable small print — a treatment that degrades letterform legibility is a failed treatment, not a style.
- No more than one headline per image; no repeated copy; no filler line added to "balance" the layout.
- **No single-level text block**: a lone headline with no second level and no device is not a design (part 3 → **Text-block mass**), and no headline may be stretched beyond its word cap to fill the space that a missing second level left behind.
- No skeleton reused across slots by merely relocating the same block to another corner (part 2).
- No mixed languages in one text block unless the user supplied it that way.
- No more than two type families in one image, and no third accent colour.
- **CJK-specific**: no 伪粗 / 伪斜 (faked bold or slanted CJK glyphs); no mechanically stretched or squeezed characters (机械压扁、拉长); no warped, inflated, arched, or relief-deformed 汉字; no character-by-character letter-spaced Chinese headline; no mixed 简繁 in one set; no wrong, missing-stroke, extra-stroke, or invented characters.

> Write these decisions into the prompt as concrete design instructions (voice + family class, skeleton zone, relative size, weight, case, tracking, colour source, alignment, margin, chosen devices, and the expressive treatment with its parameters if part 7 granted one), not as adjectives like "beautiful typography".

## Prompt Construction

**Formula**:

```
[Product subject], [detail close-up (optional)], [L1 copy + a second level — L2 copy or an H3 feature strip — required whenever the image carries copy at all; L3 optional], [Layout template prompt keywords], [Typography Design decisions from Step 5: skeleton zone + block footprint + relative sizes + weight/colour + alignment + 2–3 devices]. [Style/background/color (optional)].
```

**Example — L1 + L2, Layout ② Multi-Point Grid**:

```
Wireless noise-canceling headphones centered as the main subject. Surround the product with four circular close-up callouts in a 2x2 grid: ear cushion close-up paired with "Memory Foam", driver close-up paired with "40dB ANC", battery icon close-up paired with "30H Battery", Bluetooth chip close-up paired with "BT 5.3". Each circular thumbnail with even spacing and short text label below. Headline "All-Day Comfort" on top. Minimalist light gray background, modern tech style.
```

## Fixed Constraint Text

Append to every selling-point prompt:

```
Create a selling-point product image that clearly highlights the product's key advantages. The product subject must be prominently displayed as the visual focus and must remain fully consistent with the original image in shape, color, texture, material details, and structural features — do NOT alter, simplify, or reimagine any aspect of the product's appearance. For any parts that are occluded, blocked, or hidden in the original image, do NOT infer, reconstruct, or fabricate the hidden content — only highlight selling points based on the visible portions actually shown in the original image. Selling-point text labels must be short (max 6 words each), legible, and well-positioned without overlapping the product. Maintain a clean, professional e-commerce layout with balanced whitespace. Do NOT add any text or elements not specified in the prompt.
```

## Tool Invocation

- Tool: `image_edit` (when user uploaded a product image) / `image_generate` (text-only, no reference image)
- Mode: **standard** for single-point layouts; **dense-layout** for multi-region grids, comparison, or spec layouts — resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto`/`auto_generation`).
- Dimensions (mandatory): for `image_edit` (uploaded product) follow SKILL.md Step 0.5 (auto → source `size` + closest `aspect_ratio`; non-auto → ONLY closest `aspect_ratio`); for text-only `image_generate` (no source image) use the user's requested ratio/size or default `1:1`.

## Notes

- **Product must be the visual focus** — copy must not overpower the product
- **Selling points must fall within the Five Dimensions** — no subjective adjectives, common sense, or marketing clichés
- **Tier hierarchy must be visually clear** — L1 largest font, L3 typically a small badge in the corner
- **Typography is designed, not pasted** — every text-bearing image must carry the Step 5 decisions (skeleton zone, relative type scale, weight/colour pair, alignment, margins); reserve the copy zone as negative space in the composition before placing type
- **Text needs mass, not just size** — every text-bearing image carries **≥2 levels** (H1+H2, or H1 + an H3 feature strip) with **2–3 devices**, and the block occupies **8–18%** of the canvas (corner / lower third / side column) or **18–28%** (top band / split header / numeral-led). A lone four-character headline in a corner is a failure even when its font size sits inside the H1 range; when only one message is verified, add the second level from verified facts instead of lengthening the headline
- **Single layout only** — pick the best match from the 8 templates; do not mix layout skeletons
- **Visual anchors are mandatory** — each layout's required visual elements must appear in the prompt (① motion lines; ② circular callouts; ③ arrows + leader lines; ④ thin leader lines; ⑤ row-aligned ✓/✗; ⑥ aligned cutaway + flow arrows + dot-anchored leaders; ⑦ numbered badges + equal columns; ⑧ two identical symmetric units)
- **Repeated-product consistency** (⑦⑧): when the product appears more than once in one image, every instance must be structurally identical — same window, buttons, outlet, bowl, and angle. Divergent copies are a hard failure.
- **No invented internals** (⑥): only render the internal parts named in the prompt; keep them simple, plausible, and manufacturable.
- **Competitor comparison compliance**: Layout ⑤ must NEVER show competitor brand names, logos, trademarks, or recognizable packaging. Use generic gray silhouettes only.
- **No fabrication of occluded areas**: only base selling points on what is actually visible in the original image
- **Keep copy concise**: L1 ≤4 words, L2/L3 ≤6 words
- **User selling points take priority**: when user provides specific selling points, execute directly without confirmation
- **Platform image set rule**: when called within a platform image set workflow and user uploaded product images, must use `image_edit`
