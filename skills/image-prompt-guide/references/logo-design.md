# Logo Design

## Routing Header

- **Load when**: user asks to create an original logo, wordmark, brand mark, monogram, emblem, mascot, or logo variant from scratch.
- **Do not load when**: user already has a logo and wants it placed on a product; load Logo Customization instead.
- **Merge notes**: primary logo generation should not be merged with derivative mockups until a primary direction is selected, unless the user explicitly asks for a single preview mockup.
- **Hard stop**: never copy, clone, imitate, or closely mimic an existing trademarked logo.

## Scene Description

Design original logos and brand identity systems, including wordmarks, graphic logos, emblems, mascots, monograms, and icon marks, plus derivative brand application mockups.

Core principle: **Commercial safety first** — all output must be original design. Never imitate existing brand trademarks.

> **vs Logo Customization**: Logo Design creates logos from scratch. Logo Customization composites an existing logo onto a product. If the user already has a logo and wants it printed/applied onto a product → use Logo Customization (`references/logo-customization.md`).

## Scope

**Use for**: Logo, wordmark, graphic logo, emblem, mascot, monogram, icon mark design; brand visual exploration; logo variants (dark/light, monochrome, icon-only, horizontal/vertical lockup); brand application mockups after primary logo selection.

**Do NOT use for**: Posters, banners, product mockups, illustrations → use general image generation; product line concept design → use `ai-product-designer`.

## Workflow (5 Steps)

### Step 1: Understand the Brand

Collect essential context:
- Brand name and exact text to include
- Industry, product/service, target audience, price positioning
- Desired personality: premium / playful / technical / organic / heritage / bold
- Color preferences, colors to avoid, use cases, background requirements

> If the user has provided sufficient context, proceed directly. Only ask a focused follow-up when logo text or business background is missing and cannot be inferred.

**Search assistance**: Use available web/research tools only when:
- User names a specific company/product and expects context-aware design
- Industry visual language materially impacts design direction
- User explicitly requests competitor-aware or trend-aware design

**User provides existing logo**: Inspect the image first, then redesign from its high-level visual language without copying protected elements.

### Step 2: Determine Design Directions

| Situation | Action |
|-----------|--------|
| No quantity specified | Create **3 differentiated directions** by default |
| Quantity specified | Create as requested, each with a distinctly different style |
| "Just one" | Create 1 strong direction with brief explanation |

Recommended direction mix:
1. **Industry-aligned** — high category familiarity
2. **Differentiated** — higher distinctiveness and memorability
3. **Premium / Experimental** — higher risk but unique

### Step 3: Generate Primary Logo

Call `image_generate` using the prompt template below.

### Step 4: Derivative Assets (only after primary logo is selected)

If the user requests mockups, specs, variants, packaging, stationery, or social assets:
1. Confirm the primary logo has been selected
2. Use `image_edit` (pass selected logo URL as `reference_images`) or generate based on the selected direction
3. Keep all derivatives visually consistent with the selected primary logo

> Never batch-generate derivative assets before the primary logo is selected — this causes brand system inconsistency.

**Logo Customization handoff**: If the user wants to apply the selected logo onto a product with a specific craft technique (hot stamping, screen printing, embroidery, etc.) → transfer to Logo Customization flow (`references/logo-customization.md`).
- **Signal for Logo Customization**: user mentions craft method ("stamp the logo", "embroider on the hoodie", "laser engrave on metal")
- **Stay in Step 4**: user only wants brand preview mockups without specific craft

### Step 5: Present Results

Each proposal includes:
- Proposal title
- Generated logo image
- Brief explanation (concept, visual choices, best-fit use case)

Suggest 2–3 next steps: refine selected proposal, generate color/background variants, create mockups, build a lite brand kit.

## Prompt Template

```
Create an original [logo type] for "[brand name]", a [industry/product] brand for [target audience].
Concept: [symbolic idea and brand message].
Visual style: [style direction], [shape language], [typography direction].
Color and background: [palette], high contrast on [background].
Composition: clean centered logo, strong silhouette, readable at small sizes, balanced clear space.
Commercial safety: original logo design, commercially safe, must not resemble any existing brand logo or trademark.
```

| Field | Description |
|-------|-------------|
| `[logo type]` | graphic logo / wordmark / monogram / emblem / mascot / icon mark |
| `[brand name]` | Exact brand text, wrapped in quotes |
| `[style direction]` | See style library below |
| `[shape language]` | geometric / organic / modular / linear... |
| `[typography direction]` | serif / sans-serif / monospace / handwritten... |

## Style Library

| Style | Industries | Key Visual Principles |
|-------|-----------|----------------------|
| **Modern Minimal** | Tech, corporate, architecture, professional services | Simple geometry, strong alignment, generous whitespace, flat vector, mono + one accent color |
| **Abstract Geometric** | Design studios, editorial, AI/data | Deconstructed shapes, negative space, modular, duotone, original abstract symbols |
| **Heritage Vintage** | Coffee, spirits, artisan, traditional | Badge/crest layout, restrained hand-drawn, low-saturation ink tones, minimal ornament |
| **Fashion / Beauty Light Luxury** | Cosmetics, jewelry, fashion, luxury lifestyle | Refined serif or elegant sans-serif, weight contrast, editorial whitespace, cream/black/champagne |
| **Modern Tech / Futuristic** | AI, software, hardware, data, cybersecurity | Parametric curves, modular geometry, precision cuts, cool neutral + cool accent |
| **Cute Cartoon But Premium** | Food, gaming, children, pets, creator brands | Rounded geometry, friendly but mature proportions, soft muted colors + one bright accent |
| **Bold Geometric** | Sports, energy, bold consumer goods | Heavy stable shapes, strong silhouette, high contrast, pure flat vector |
| **3D Luxury** | High-end fashion, jewelry, watches, luxury lifestyle | Polished/brushed metal, beveled depth, cinematic lighting, dark high-contrast background |

## Tool Invocation

| Phase | Tool | Mode class |
|-------|------|-----------|
| Generate primary logo (Step 3) | `image_generate` | dense-layout |
| Edit/adjust existing logo | `image_edit` | standard (dense-layout for complex multi-element edits) |
| Derivative assets (Step 4) | `image_edit` | standard (dense-layout for complex multi-element edits) |

> **Mode class** maps to a `task_type` via SKILL.md **Execution Mode Resolution**. Use `auto`/`simple`/`complex` for `image_generate`, and `auto_generation`/`simple_generation`/`complex_generation` for `image_edit`.
> **Dimensions**: for editing an existing logo (`image_edit`) follow SKILL.md Step 0.5 (auto → source `size` + closest `aspect_ratio`; non-auto → closest `aspect_ratio`); for from-scratch generation (`image_generate`, no source image) use the user's requested ratio/size or default `1:1`.

## Anti-Infringement Rules (Mandatory)

Before generating any logo, check if the user requests copying, cloning, imitating, or closely mimicking an existing brand logo.

**If infringement risk exists**:
1. Clearly state that direct copying or close imitation is not possible
2. Offer safe alternatives based on abstract design principles (color mood, typography characteristics, geometric rhythm, brand personality)
3. Generate visually distinct original designs

**Every prompt must include**: `Original logo design, commercially safe, must not resemble any existing brand logo or trademark.`

**Prohibited**: copying known brand shapes, icons, layouts, letterforms, or mascot details. Reference images serve only as mood/style input unless the user owns the asset and explicitly requests editing.

## Output Rules

- Multiple proposals must be separate images (not composited), so users can use each independently
- Only generate a comparison board when the user explicitly requests "side-by-side comparison"
- Brand text must be accurate
- Output must be original and legally distinct from existing brands
- Each proposal must have a different design logic (not just color swaps)
- Background contrast must keep the logo legible
- Small-size readability must be considered
- Derivative mockups only after the primary logo is selected
- AI-generated logo images are visual direction drafts unless the user explicitly requests production-ready assets
- For commercial use, recommend vectorization, small-size readability review, color/background variants, and trademark similarity checks
