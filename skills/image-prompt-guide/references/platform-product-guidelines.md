# E-Commerce Platform Product Image Guidelines
> **Updated**: 2026-08-31

## Routing Header

- **Load when**: user names a covered e-commerce platform and asks for main images, hero images, listing images, product image sets, or listing-risk/compliance-oriented image guidance.
- **Always pair with ONE platform spec file**: this file is the **framework layer only** — it contains no platform's hard specs. After matching, load exactly one of `platform-specs-overseas.md` / `platform-specs-china.md` per the **Platform Spec Files** index at the end of this file. Neither file is usable without this one, and this one cannot resolve a platform's specs without it.
- **Do not load when**: user asks for generic cleanup, background change, logo application, or resize with no platform/listing intent.
- **Merge notes**: use this file to select platform constraints, then load only the output scene references needed for each requested image. Each planned set image is a **composite slot** (one base visual layer + the overlay layers it needs) — resolve its layer stack via **Composite Slot Model** below and load every layer's reference, but still emit ONE AI call per slot. Do not split one platform hero into separate AI calls for background, centering, shadow, and coverage when one product-fidelity prompt can satisfy them.
- **Hard stop**: if the user requests latest compliance, official verification, or policy-sensitive review, verify against official platform documentation before finalizing.

## Usage

1. **Primary reference**: Use this document as the default built-in **framework** for platform product hero/set image requirements: in-image language, cross-platform style systems, the Composite Slot Model, and the planning/QA contracts. Per-platform hard specs live in the two spec files indexed at the end.
2. **Official verification**: If the user asks for latest compliance, official verification, listing-risk review, policy-sensitive checks, or requirements not covered here, consult official platform documentation before finalizing.
3. **Platforms covered**: 16 platforms across two spec files — see **Platform Spec Files** at the end of this document for the full index and which file to load.
4. **Coverage depth differs by platform**: overseas platforms and 1688 carry full numeric upload specs (pixel size, ratio, format, file-size cap). Taobao, Tmall, Douyin, JD.com, and Pinduoduo currently carry **authenticity / AI-generation compliance rules only** — their numeric specs MUST be verified against official docs before delivery. Never fill a missing numeric spec from memory.

---

## Default In-Image Language

Any text/copy rendered inside a platform image (headlines, callouts, selling-point labels, spec labels, annotations) must have a definite language.

**Resolution order (highest first):**

1. **Explicit user request** — if the user specifies a language (or a target market/locale that implies one), use it.
2. **Platform default (below)** — if the user did NOT specify a language, use the platform's default language from the table.
3. **Fallback** — if the platform is not listed or is ambiguous, default to **English**.

> This only sets the language of text the user already approved to appear in the image. It does NOT authorize adding new text, claims, or copy — the No-Hallucination and platform prohibited-element rules still apply (e.g., Alibaba.com/1688 hero images forbid marketing text entirely). Never translate a brand name, trademark, or user-provided exact string unless the user asks.

| Platform | Default in-image language | Rationale |
|----------|---------------------------|-----------|
| Amazon | English (en-US) | Primary marketplace is US; other locales only when the user names them |
| eBay | English (en-US) | US/global default |
| Walmart | English (en-US) | US marketplace (CA: English default, French only if requested for Québec) |
| Shopify | English (en-US) | Brand-owned; no platform locale — English unless the merchant's market says otherwise |
| Etsy | English (en-US) | Global handmade marketplace, English-first |
| AliExpress | English | Cross-border B2C to a global audience |
| TikTok Shop | English (en-US) | US-first; per-region language only when the user targets a specific market |
| Shopee | English | SEA multi-country; English is the safe cross-market default (use Thai/Vietnamese/Bahasa only when the target country is given) |
| Lazada | English | SEA multi-country; same rule as Shopee |
| Alibaba.com | English | B2B international; Chinese is strictly prohibited in-image (see platform spec) |
| 1688 | Simplified Chinese (zh-CN) | Domestic China wholesale platform; buyers are Chinese |
| Taobao (淘宝) | Simplified Chinese (zh-CN) | China-domestic marketplace |
| Tmall (天猫) | Simplified Chinese (zh-CN) | China-domestic marketplace |
| Douyin E-Commerce (抖音电商) | Simplified Chinese (zh-CN) | China-domestic platform — do NOT inherit TikTok Shop's English default |
| JD.com (京东) | Simplified Chinese (zh-CN) | China-domestic marketplace |
| Pinduoduo (拼多多) | Simplified Chinese (zh-CN) | China-domestic marketplace |

> **Market-implied language**: if the user names a specific country/site without naming a language (e.g., "Amazon Japan", "Shopee Thailand", "Lazada Vietnam"), infer that market's primary language (Japanese, Thai, Vietnamese) — this counts as an explicit user signal under rule 1, overriding the English default.

### Source-Text Language Conflict Check (image set + no user-specified language)

Run this check **only when BOTH conditions hold**: (a) the user is requesting an image set / listing images, AND (b) the user did NOT specify an in-image language (so the platform default from the table would apply).

1. **Detect source text**: inspect the uploaded source image(s) for **non-brand text that carries meaning** — selling points, product descriptions, spec/parameter values, feature callouts, usage instructions. Exclude brand names, logos, trademarks, and model numbers (those are never translated and never trigger this check).
2. **No such text** → no conflict; proceed with the platform default language.
3. **Such text exists → compare its language to the platform default:**
   - **Same language** → no conflict; proceed.
   - **Different language (conflict)** → do NOT silently pick one, and do NOT raise it as a standalone round. Carry it into the **single** plan confirmation (`SKILL.md` → Step 3 → **One ask, not a chain**) as a prefilled recommendation, presenting exactly two options:
     - **(A) Keep the original language** — reproduce the source text in its original language in the generated set.
     - **(B) Use the platform default language** — translate the source text into the platform default (per the table above), then proceed with generation using the translated copy. *(recommended default — prefill this)*
4. **After the user chooses**, proceed with the rest of the image-set generation using the confirmed language. If the user picks (B), route the translation through the Image Translation scene (`references/image-translation.md`) — do not free-hand translate spec values or claims.

> **Boundaries**: This check governs the language of text the source already contains; it never adds new claims and never alters brand/trademark strings. If a platform prohibits in-image marketing text entirely (e.g., Alibaba.com / 1688 hero image), the prohibition wins — remove the text per that platform's rule instead of translating it, and do not raise the conflict prompt for that specific image.

### Applying the Target Language to the Prompt

For any planned image in the set that will contain text, the resolved target language (explicit user request → platform default → confirmed choice from the conflict check above) MUST be written explicitly into that image's final `image_edit` / `image_generate` prompt. Do not leave the in-image language implicit.

- **Add an explicit language constraint** to the prompt, e.g.: `All in-image text must be written in <target language> (e.g., English / Simplified Chinese).`
- **Keep exact strings verbatim**: quote any user-provided or must-preserve copy exactly, and state that brand names, trademarks, and model numbers are not translated.
- **Only images that will contain no text at all** skip the language constraint — do not inject text into an image that should have none. Do NOT exclude an image by type: a white-background image still gets the language constraint if it will carry any text (e.g., labels, spec callouts).
- **Consistency across the set**: use the same target-language constraint wording for every text-bearing image in the same set, so the whole set stays in one language unless the user asked otherwise.

> Example (planned selling-point image, platform default English): append to the prompt — `All in-image text must be in English; keep the brand name "<Brand>" unchanged; do not add any text beyond the specified labels.`

---

## Platform Image Set Style Systems

> These are **proven principles**, not layouts to photocopy. Match the product's emotional register (sporty / cozy / premium / handmade) first, then regenerate the execution within each platform's grammar.

When a user requests a multi-image listing set for a platform, keep the following cross-platform rules in mind:

1. **One platform = one style system — and the prompt says which one.** All images in the same set share the same background world, lighting language, and palette. Mixed-style sets read as disconnected and usually get rejected. Once the platform is fixed, write the **platform style phrase** into every slot's prompt (block 8, and block 9 for text slots) rather than leaving the platform implicit in the agent's head — e.g. `Amazon info-first listing style`, `Etsy handmade editorial style`, `淘宝高端编辑风`, `1688 B2B 批发参数风`. Derive the phrase from that platform's **Image Set Style Notes** and its style tokens in `platform-specs-overseas.md` / `platform-specs-china.md`, and keep the identical phrase verbatim across the set. An unnamed platform collapses into a generic e-commerce look.
   - **The style system covers typography, not only photography.** A set whose background world, lighting, and palette match but whose slots are set in three different font classes still does not read as one set. Resolve the font system ONCE per set as a **type-lock phrase** and repeat it verbatim in every text-bearing slot's `Typography:` block, exactly as the platform style phrase is repeated in block 8 — see **Set lock** → **Type system lock**.
2. **Same style system ≠ same composition.** A shared style system fixes the *treatment* (background world, lighting, palette, mood), NOT the *shot*. Composition is a per-image planning decision: choose each shot's camera angle, distance/景别, and subject position based on **what that slot needs to show** and the **product's physical characteristics and scene norms** — not by a rule that every shot must differ. A shot may reuse the original image's framing when that framing is the right one for the slot (e.g. a straight-on hero) and it conforms to the scene/platform requirements.
   - Let the set's role structure drive framing (e.g. hero = full product; detail = close-up/macro; scene = in-use/lifestyle; scale = top-down or with reference object). Different roles naturally produce different compositions; do not force artificial variety beyond what the roles call for. These roles name only each slot's **base visual layer** — every non-hero slot still stacks its enrichment layers per **Composite Slot Model**.
   - Plan the angle a real product photographer would use for each slot given the product's shape, orientation, and physical constraints; keep it physically plausible.
   - Keep the style tokens (background world, lighting, palette) constant across the set; let composition follow each slot's purpose.
3. **Identity match, not a frozen shot.** The product's intrinsic identity never changes — same geometry, proportions, weave/texture, color family, prints, logo, and on-product text across every image (identity match per SKILL.md **Identity Match Contract**). Camera angle, pose, distance, and composition may differ per image (or match the original) as each slot requires, and are NOT identity changes. If the product line has messy colors, choose ONE tonal family, state that choice in the plan, and generate — a tonal family is an execution choice, not a fact to confirm.
4. **Platform grammar is fixed; execution is category-flexible.** For example, TikTok always requires strong human presence, but the exact mood can shift between "flash-lit editorial sports" and "warm golden cozy" depending on the category.
5. **Style tokens should be repeated verbatim** across shots in the same set to hold background/lighting/palette constant — and the **type-lock phrase is one of those tokens**: the font system is copied verbatim into each slot, never re-chosen per slot. Composition/framing tokens are chosen per slot (see rule 2) — they may repeat when a slot genuinely needs the same framing, and need not be artificially varied. Number shots ("shot N of 4") to help the model keep style continuity.
6. **Before delivering, run a consistency gate:** check that no single shot leaks a different season, venue, or temperature into the set — or a different font class into its copy; verify in-image text spelling; flag any inferred multi-view angles or spec numbers that need user sanity-check. Also confirm each shot's composition suits its slot role and the scene; a shot repeating the original framing is fine when that is the right framing for the slot.
7. **AI generation resolution (excluding Batch Generation):** for AI-generated platform product images and sets, generate at **2K resolution (long edge 2048 px)** whenever possible. This applies to hero/main images, listing sets, and platform-specific lifestyle/detail shots; it does not override user-specified sizes or platform-mandated minimums, but should be the default production target.

The sections below pair each platform's **hard specs** with an **optional image-set style notes** subsection. Use the specs for compliance; use the style notes as a starting point that should be adapted to the product's emotional register.

---

## Composite Slot Model (every set image is a capability stack)

> **Core rule**: a planned set image is a **slot**, not a single scene. One slot = one **base visual layer** + the overlay layers that slot's message requires. A slot is NOT satisfied by "one detail shot" / "one scene shot" / "one selling-point card" when its job also needs copy, callouts, steps, a person, accessories, or a companion device. The Scene Router still owns routing and this section owns **how many scenes stack into one slot**; SKILL.md **Final Prompt Assembly** still owns the prompt's labels, block order, and tier.

### Layer stack

| Layer | Role | Reference to load | Required |
|---|---|---|---|
| **L0 Base visual** | where the shot happens and how rich the environment is | exactly ONE of `scene-image.md` (**default for supporting slots** — a real, furnished environment) or `white-background.md` (clean studio/gradient — hero, cutaway, and contents slots only). **`image-detail.md` is NOT a set slot** — never plan a bare macro crop as a set image; shoot the close range inside a real scene instead | Always |
| **L1 Copy** | headline + subhead + short labels carrying the slot's single message — **at least two text levels** (H1+H2, or H1 + an H3 feature strip); a lone short headline is not an L1 layer and does not count toward a slot's enrichment minimum | copy sourcing/tiering per `selling-point.md` Steps 1–3; typographic mass per Step 5 part 3 → **Text-block mass**; language per **Default In-Image Language** | **Enrichment layer** — the normal carrier of a slot's message; copy must be customer-facing benefit/scenario wording, never a part name or a planning term |
| **L2 Graphics** | three distinct kinds: **L2-anno** (leader lines, dot anchors, arrows pointing at parts, cutaway), **L2-geo** (equal columns, two-panel split, step badges, grids, flat-lay arrangement), **L2-ui** (cards/rows inside a device screen) | layout template per `selling-point.md` Step 4 | **Optional, and L2-anno is capped at ONE slot per set** — see **Expression-mode diversity**. L2-geo and L2-ui are not annotation and are not capped |
| **L3 Human / interaction** | model, hands, in-use gesture | `model-showcase.md` (+ `scene-image.md` for the setting) | **Planned per product** — see **Human interaction planning**: usually 1–2 slots per set, with the level chosen from the product's form and operation mode. Never stamped onto every slot |
| **L4 Accessory / packaging** | what's-in-the-box line-up, accessory arrangement | no dedicated reference — plan as L0 composition; only items the user confirmed are included | **Enrichment layer** — counts toward the minimum |
| **L5 Second subject** | phone/app screen, controller, companion device | no dedicated reference — allowed only when the user supplied the exact UI text and feature list | **Enrichment layer** — counts toward the minimum |

Stacking rules:

1. **Load every layer's reference** for that slot per the Reference Loading Contract, then emit **one merged AI call per slot** — layer count never multiplies AI calls.
2. **Mode class**: L0 (+L3) only → **standard**. Any slot carrying L1, L2, L4, or L5 → **dense-layout**.
3. **Facts gate**: L1 / L4 / L5 content must come from the user or be visible in the source. Never invent copy, accessory counts, battery/runtime data, UI features, or certifications just to fill a layer. Do not reveal or reconstruct internals that are not user-confirmed.
4. **Quantify overlays**: L1 needs verbatim copy + "appears once" + "no other text"; L2 needs exact element counts, positions, and anchor targets; L4 needs the exact item list; L5 needs the exact on-screen strings.
5. **Identity across layers**: when a slot repeats the product (multi-column steps, dual units), every instance must show the identical visible structure (identity match per SKILL.md **Identity Match Contract**).

### Supporting-slot enrichment mandate (HARD)

> **In every platform image set, only the first/hero slot may be a single-capability image. Every other slot MUST be a composite slot.**

1. **Hero slot (image 1)**: base layer only whenever the platform mandates a white/solid background or bans in-image text and overlays (Amazon, eBay, Walmart, AliExpress, TikTok Shop, Shopee, Lazada, Alibaba.com, 1688). On platforms with no such ban (Shopify, Etsy), the hero may be composite (archetype A1).
2. **Every supporting slot (images 2..N)**: MUST be `L0 + at least TWO enrichment layers` drawn from the platform-permitted set. **L1 copy is mandatory on every supporting slot whose platform permits it**, and it must be a valid ≥2-level text block — never a blank frame and never a lone headline. The second enrichment layer comes from L2/L3/L4/L5. Annotation graphics (L2-anno) are NOT the default way to carry a message and are capped at one slot per set (see **Expression-mode diversity**). A supporting slot is planned as an archetype (A2–A10), never as a bare scene/detail/angle shot.
3. **Explicitly forbidden as a supporting slot**:
   - an alternate-angle white-background shot with nothing added;
   - a macro/detail crop with no labels, no callouts, and no interaction;
   - a plain lifestyle photo with no copy, no graphics, no person, and no accessories;
   - a slot whose only difference from another slot is the camera angle.
   These may be delivered as **extra** images beyond the required composite set, never as one of the required slots.
4. **Platform-ban exception only**: when a platform explicitly bans text (TikTok Shop set-wide; eBay; Lazada promotional copy; and any hero or slot where L1 is prohibited), that ban is the **only** reason a platform-set image may contain no overlay copy. Meet the two-enrichment minimum with non-text layers — L3 human/hand interaction, L4 accessory/packaging line-up, L5 companion device, in-use action, or scale reference. Never satisfy the mandate by smuggling in text the platform forbids, and never treat preference, sparse facts, or a photography-led mood as permission to omit copy.
5. **Mode class**: a supporting slot carrying L1, L2, L4, or L5 is **dense-layout**. A supporting slot enriched only with L3 (e.g. a TikTok in-use shot) stays **standard**.
6. **Message coverage**: because every supporting slot is information-bearing, each one must own a distinct message (use context, working principle, operation, maintenance, contents, benefit, dual state). If the user cannot supply enough verified messages for the requested count, **reduce the count to what the verified messages support** and say so in the plan — do not pad the set with bare angle shots. Ask only when the user pinned the count as a hard requirement.

> **Reading the platform specs below**: where a platform section lists supporting-image *types* ("back, side, detail, scene, packaging", "multiple angles", "scale reference"), it is describing the content each platform **permits**, not a delivery plan. Every such image must still be produced as a composite slot under this mandate — e.g. "detail" becomes a labeled structure/cutaway or a close-range in-use shot inside a real scene, "packaging" becomes an accessory line-up with a contents caption. Never read those lists as permission to ship a bare view.

### Scene layer richness (default base = a furnished scene)

Flat, empty results come from a studio base plus a thin environment. Fix it at the base layer, not with more text.

1. **Base default**: every supporting slot uses a real environment (`scene-image.md`). The clean studio base is allowed ONLY for three slot types: the hero, a structure/cutaway slot (A4), and a contents / dual-state slot (A6 / A8). In a set of 5+ images, **at least half of the supporting slots must use the scene base**.
2. **Every scene slot's prompt must name all seven of**:
   - **Place identity** — which room and which part of it ("kitchen counter beside the stone sink", "living room floor between the cabinet and the sofa"), not just "modern home".
   - **Named element inventory (positive, closed)** — **6–9 named elements** for a lifestyle slot, each with **material + position**: the support surface, the background architecture (wall / window / curtain / doorway / cabinetry / floor line), 1 furniture anchor per side (e.g. "light oak cabinet on the left", "cream textured sofa on the right"), 2–4 secondary props (ceramic vase with one branch, two neutral books, woven rug, side table, ceramic cup, closed notebook), and 1 organic element (plant / greenery outside the window). Close the list with "no other objects". A studio slot instead names the surface, the gradient/backdrop, and nothing else.
   - **Three depth planes** — assign named content to foreground, midground, and background, and state which plane holds the product.
   - **Light source** — a named window/lamp with side, time of day, quality, and the resulting shadow behaviour on the product and surface ("soft morning daylight entering from a window on the left, restrained contact shadows").
   - **Depth of field** — what is sharp and what falls off ("product sharp, cabinet and greenery softly defocused"), so the frame reads as one photograph.
   - **Material & palette** — floor/wall/counter materials plus the set palette (warm ivory, pale oak, cream, low-saturation neutrals).
   - **Art direction statement** — one named editorial register plus an anti-ad clause: e.g. "refined Scandinavian interiors editorial, quiet and spacious; it must read like a premium interiors photograph, not an advertisement filled with graphics".
3. **Quantified staging (mandatory for every slot, studio or scene)**:
   - product **occupancy %** of the frame and its **position zone** ("lower-left to slightly left of center, about 47% of the frame");
   - every secondary subject's own occupancy % and position (pet ~25–30%, phone ~29%, person full-body or kneeling on one side);
   - the subject's **specific action** ("cat lowers its head and eats from the stainless-steel bowl", "woman kneels and rests her right hand on the lid, looking at the window"), plus clothing description when a person appears;
   - camera angle and height ("slightly elevated front three-quarter", "from behind and slightly over the shoulder").
4. **Living-subject and physics guards** — whenever a pet, person, hands, liquid, or falling material appears, state them explicitly:
   - correct anatomy (limbs, tail, ears, paws; five correct fingers; no extra limbs);
   - the subject must not block the product's key structural features;
   - granular/liquid material obeys gravity (kibble falls into the bowl, never floats or sprays; water never passes through a palm);
   - every object rests on a surface with correct contact shadow and ambient occlusion;
   - electrical parts stay dry when water is present, and say so.
5. **Banned wording on scene slots**: "clean minimal background", "simple studio", "plain backdrop" — those describe the studio base and are only valid in the three exceptions above.
6. Props stay secondary: never imply they are included with the product, never let them touch or overlap the product silhouette.

### Human interaction planning (the level follows the product, not a fixed count)

A person is one way to **prove usability or scale** — not a decoration to stamp on every slot. Plan it deliberately, then leave it out where it adds nothing.

1. **Judgement, not quota**: decide per set whether a person helps, and in which slots. For a typical 4–8 image set that is **1–2 slots** (3 at most for lifestyle-led categories). Never add a person to the hero (when the platform requires a bare product shot), to a structure/cutaway slot (A4), to a contents slot (A6), or to a dual-state slot (A8).
2. **The level follows the product** — choose from this table instead of defaulting to a full-body model:

| Product trait | Suitable level | Typical action |
|---|---|---|
| **Sat in / lain on / body-supported (massage chair, pedicure spa chair, mattress, sofa, office chair, bathtub, stroller)** | **occupant in use** — a person seated, reclined, or lying on the product, shown from full or three-quarter body | client reclined in the chair with feet in the basin, relaxed hands on the armrests, eyes closed; optionally a second person (technician/attendant) working beside them |
| Worn / carried / handheld (apparel, bags, wearables, tools, grooming) | full or partial body **wearing/holding** | worn, carried, gripped in genuine use |
| Tabletop appliance with hands-on parts (feeder, kettle, blender, printer) | **hands only** for operation slots; partial body for an observe/check slot | removing a bowl, refilling, pressing a control, rinsing a part |
| App- or remote-operated device | **partial body** with the phone in frame | seated or over-the-shoulder, phone held, product in the same room |
| Floor-standing / large / installed (furniture, purifier, appliance) | **full body in room** for scale, or partial body for interaction | walking past, kneeling beside it, adjusting it |
| Hands-free automatic operation (the point is "it runs without you") | **full body leaving/arriving**, or no person at all | stepping out of the entryway while the device runs |
| Pet / baby / plant products | the **cared-for subject** is the primary living element; the person is secondary or absent | pet eating from the bowl, adult nearby supervising |
| Sensitive / regulated / hygiene-critical | hands only, or none | clean hands, face out of frame |

> **For sit-in / lie-on products, "a hand touching the armrest" is the wrong answer.** The buyer needs to see the product **occupied and in use** — posture, recline angle, where the limbs rest, whether it fits a real body. State the occupant's clothing (salon-appropriate: robe, casual wear, or the service uniform), posture and recline state, limb placement, gaze or eyes-closed, and that the occupant must not hide the product's silhouette or key structure. For a service product, one occupant plus one attendant is stronger than either alone.

3. **No disembodied limbs.** A hand or forearm entering from the frame edge with no plausible body attached is a failure pattern: either show enough of the person to read as a person (torso + arm, kneeling, seated), or frame the hands close in on the part being operated so the crop is natural. **The "arm reaching in from off-frame" gesture may appear at most once in a set** — and never in two slots that share a similar setting.
4. **Every person or hand needs a stated purpose** — operation, scale, care, or benefit. An idle bystander standing beside the product with no action is a failed slot: give them a real action or remove them.
5. **A living subject does not have to be human**: for pet/baby/plant categories, the animal or plant can carry the life in the frame while people stay out of it.
6. **When a person or hand does appear, state all of**:
   1. **Persona**: age band and gender presentation (e.g. "young adult woman"); ethnicity only when the user named a target market; no minors as the primary subject unless the product is for children and the user approved it.
   2. **Wardrobe**: top, bottom, and footwear with colour + material ("white knit top, pale beige trousers, soft house slippers"); plain and unbranded, fully and modestly clothed.
   3. **Posture and exact action**: what the body does and **which hand touches which part of the product**.
   4. **Gaze**: where the person looks (at the product, at the pet, out the window, away from camera).
   5. **Placement**: which side of the frame, and their own occupancy % relative to the product's.
   6. **Face policy**: visible and calm, or deliberately cropped/turned out of frame — state which; AI-original person, never a recognizable likeness.
   7. **Anatomy and hierarchy guards**: five correct fingers per hand, natural joints and proportions, no extra limbs, undistorted face; the person must **not cover the product's key structural features**, and the product stays the visual focus.
7. **Persona lock**: when more than one slot shows a person, lock ONE persona (same age band, hair, wardrobe palette) so the set reads as one household story, and vary the interaction level, pose, and framing between those slots — never repeat the same pose or hand gesture.
8. **Platform overrides** (these outrank the judgement above):
   - **TikTok Shop**: platform grammar *requires* human presence in ≥3 of 4 slots.
   - **Amazon**: mannequins are forbidden (real people are fine in supporting images).
   - **TikTok children's swimwear/underwear**: flat lay only, no model.
   - **Regulated / sensitive categories**: downgrade to hands-only or omit people, and say so in the delivery summary.

### Expression-mode diversity (stop the leader-line clone set)

The most common failure is a set where every image is "product + two or three leader lines + short labels". A set must **vary how it speaks**, not just what it says.

**Five expression modes:**

| Mode | How the message is carried | Copy role | Typical archetypes |
|---|---|---|---|
| **M1 Editorial photograph** | one strong photograph; the message lives in the composition and a headline in reserved space | benefit or scenario headline + subhead; **no labels on the product** | A1, A7, close-range in-scene frame |
| **M2 Narrative scene** | a person, pet, or action tells the story (leaving home, feeding, checking, tidying) | scenario headline + one supporting line | A2, A7, A9 |
| **M3 Geometry-driven** | meaning comes from layout: equal columns, two panels, numbered steps, flat lay, symmetric pair | short caption per column/panel, or one feature strip | A5, A6, A8, A9, A10 |
| **M4 Annotated technical** | leader lines, dot anchors, arrows, cutaway pointing at parts | part or function labels — **this is the only mode allowed to label parts** | A4 |
| **M5 Second-subject demo** | a phone/app/controller in frame shows how it is operated | exact UI strings + headline | A3 |

> **M3 requires a per-panel delta.** A columned or panelled M3 slot is only valid when **every panel shows a nameable, visibly different state** (configuration, action stage, or framing) and is described separately in the prompt with its own caption. Panels that repeat the same arrangement from the same camera — differing only by a hand entering or a few degrees of angle — are one image printed N times: collapse them into a single frame. **Never let the panel count echo a quantity in the copy** ("Three-Piece Set" ≠ three panels — a set is shown together in one frame), and never render `what is included` as a step sequence; use a single flat-lay or grouped-set frame instead. See `selling-point.md` → **Panelled layouts need a real difference per panel**.

**Mode quota per set:**

| Requested images | Distinct modes required | Caps |
|---|---|---|
| 4 | ≥3 | M4 ≤ 1 slot; no other mode more than twice |
| 5–6 | ≥4 | M4 ≤ 1 slot; no other mode more than twice |
| 7+ | ≥5 | M4 ≤ 1 slot; no other mode more than three times |

**Hard rules:**

1. **One annotated slot maximum.** After the set's single M4 slot, no other image may carry leader lines, dot-anchored labels, or arrows pointing at parts. Move that information into a caption, a step column, or the environment instead.
2. **Do not label visible parts as if they were selling points.** "Backrest", "Armrest", "Seat", "Foot Basin", "Front Base" are part names, not messages — they belong only in the single M4 slot, and even there each label must earn its place (function, benefit, or material).
3. **Never render planning vocabulary as on-image text.** Words used to brief the shot — "Front View", "Visible Components", "Floor Contact", "Retail Interior Context", "Salon Placement", "Front Assembly Detail", occupancy percentages, angle names, slot or archetype names — are instructions to the model, not copy. On-image text may only be the customer-facing strings the user approved.
4. **Copy must speak to the buyer, not describe the photo.** Captions like "Client Service Context", "Salon & Spa Setting", "Product shown within a salon service setting", "Pedicure chair shown in a professional service environment" only narrate what is already visible. Apply the **copy voice test**: does the line state a benefit, a scenario, a verified spec, or an instruction the buyer needs? If it merely names or describes the picture, rewrite it.
5. **Vary the copy shape too**: if one slot uses a centred headline + subhead, another should use a flush-left headline, another a feature strip, another per-column captions. Not every slot gets "headline + 3 short labels".
6. **A platform-set supporting slot is never deliberately copy-free when its platform permits copy.** Emotional, scale, and context messages still use a ≥2-level text block at its footprint (`selling-point.md` → Step 5 part 3 → **Text-block mass**) plus the scene/person/pet/accessory enrichment. The only no-copy exception is an explicit platform text ban (Supporting-slot rule 4).

### Slot brief template (fill before writing any prompt)

A thin prompt comes from a thin brief. For every slot, fill all ten fields — then the Enhancer turns them into the labeled prompt:

| Field | Content |
|---|---|
| 1. Message | the single thing this slot proves |
| 2. Base | scene (which place) or studio (why it qualifies for the exception) |
| 3. Element inventory | 6–9 named elements with material + position, closed list (studio: surface + backdrop only) |
| 4. Staging | product occupancy % + position zone; each secondary subject's occupancy %, position, and action; whether this slot carries a person/hand at all, and if so the level (hands / partial body / full body) with persona, wardrobe, gaze |
| 5. Camera | angle, height, shot scale, and what is sharp vs defocused |
| 6. Light | named source, side, time of day, quality, shadow behaviour |
| 7. Art direction | the **platform style phrase** this set conforms to (rule 1 of **Platform Image Set Style Systems**) + named editorial register + palette + anti-ad clause |
| 8. Copy | exact strings per text level (H1 / H2 / tertiary strip or note) — **at least two levels whenever the slot carries copy at all** (H1+H2, or H1 + an H3 feature strip; a lone short headline is not a text block, see `selling-point.md` → Step 5 part 3 → **Text-block mass**), language, plus the set's **type-lock phrase copied verbatim** (headline class + companion class + 简繁 variant + the CJK glyph-integrity clause where applicable — resolved once per set in **Set lock** → **Type system lock**, matched to field 7's register, never re-chosen for this slot), its **skeleton** and zone with the block's **target footprint** (8–18% of the canvas for a corner block / lower third / side column, 18–28% for a top band / split header / numeral-led block — reserved as negative space in fields 4–5 before the copy is placed), its **contrast direction** (dark-on-light / light-on-dark / tone-on-tone) with the sampled colour, the **2–3 devices** it uses — each must differ from the other slots' — and either the **one expressive treatment** this slot carries with its parameters (Step 5 part 7) or an explicit "plain type, no effects" |
| 9. Graphics | which L2 kind, if any: L2-anno (only in the set's single M4 slot), L2-geo (columns/panels/badges/flat lay), L2-ui (screen cards) — with exact count, geometry, anchors — or an explicit "no icons, arrows, cards, or badges" when the slot is photography-led |
| 10. Guards | anatomy, gravity, grounding, dryness, and identity clauses relevant to this slot |

> Field 9 matters in both directions: a lifestyle or macro slot should often **state that no graphics are added**, so the model does not decorate it. Richness comes from environment, staging, and light — not from more overlays.

### Slot differentiation contract (no two slots may look alike)

**Message uniqueness comes first.** Assign each slot a distinct message from this taxonomy, and never assign the same one twice:

`what it is` · `where it is used / placement in a room` · `who uses it and how it feels` · `how it works inside` · `how it is operated` · `how it is cleaned / maintained` · `what is included` · `configuration or state options` · `scale vs a human or room` · `material and finish quality`

> "Placement in a salon" and "shown in a professional salon setting" are the **same message** — two slots like that are a duplicate, not a variation. If two planned slots reduce to the same sentence, change one of their messages before touching the visuals.

Then fill this matrix for the whole set **before** writing any prompt. Two slots may not share the same value in more than two columns:

| Slot | Place / area of the world | Shot scale + camera height | Product position & occupancy % | Expression mode (M1–M5) | Enrichment layers | Person present? |
|---|---|---|---|---|---|---|

- **Expression mode**: satisfy the **Expression-mode diversity** quota — ≥3 distinct modes in a 4-image set, and only one M4 annotated slot.
- **Shot scale**: a 4+ slot set needs at least one wide/environmental, one medium, and one tight composition.
- **Camera height**: eye level, product level (low), and slightly high (~30°) should each appear at least once in a 5+ slot set.
- **Product placement**: left-third / right-third / centered must not all be identical, and occupancy should differ by ≥10 percentage points between neighbouring slots.
- **Place**: a different room area or vantage per slot — never reuse the identical backdrop with only new copy.
- **Mirroring is not variation**: flipping the composition left↔right, nudging the camera a few degrees, or swapping which side the person's arm enters from produces a **duplicate**. A real variation changes at least the message plus one of {place, shot scale, expression mode, interaction level}.
- If two planned slots still read alike, change the **message first**, then the base scene, then the shot scale. Never fix similarity by adding more text or more callouts.

### Typography is design, not an overlay

L1 is a **designed type system**, not text pasted onto a photo. Build every text-bearing slot per `selling-point.md` → **Step 5: Typography Design**, and enforce **variety** within one voice:

- **Every platform-set supporting slot carries a real text block whenever its platform permits copy**: ≥2 levels (H1+H2, or H1 + an H3 feature strip) with 2–3 devices, occupying **8–18%** of the canvas for a corner / lower-third / side-column skeleton or **18–28%** for a top band / split header / numeral-led one, with that zone reserved as negative space in the composition *before* the copy is placed. A blank supporting frame and a single four-character headline are both failures. When a slot has only one verified message, add the second level from the **same verified facts** (a 3–4 item feature strip, a footnote); **never lengthen the headline** to fill space. If verified copy is insufficient, obtain it in the one consolidated plan confirmation or reduce the set to the supported count — do not omit text;
- **one locked font system for the whole set**, resolved once as the **type-lock phrase** (**Set lock** → **Type system lock**) and written verbatim into every text-bearing slot — same headline class, same companion class, same 简繁 variant in slot 1 and slot 6; the family class is never re-chosen per slot;
- for a **Chinese-language set** (every zh-CN platform), the locked class is named from `selling-point.md` → Step 5 part 1 → **CJK type voices** — 宋体/明朝体、仿宋、楷体、魏碑、书法行书、隶书、黑体、圆体、方头黑/等线体、长体黑、美术字 — plus its Latin/numeral companion; a flat 黑体 headline in every slot is the failure this rule exists to stop, and every CJK text slot carries the glyph-integrity clause;
- a **different skeleton per slot** (top band / left column / lower third / eyebrow stack / corner block / numeral-led / baseline strip / split header) — no two slots use the same skeleton unless the set exceeds 8 skeletons; **relocating the same block to another corner is not a different skeleton** — the block's *structure* must change (line count, compact vs edge-spanning, kicker- or numeral-led, band vs column), see `selling-point.md` → Step 5 part 2;
- text colour derived from the scene (darkest neutral in the frame), not a fixed `#1A1A1A`/`#6B6B6B` in every image;
- for CJK copy, per-slot variation comes from 字重档位、字号、skeleton、竖排 vs 横排、对比方向、全角分隔符 (there is no ALL-CAPS lever) — each zh slot must move at least two of them;
- each slot picks 2–3 typographic devices from the device library, and at least 4 distinct devices appear across a 4-image set;
- an **expressive treatment** (描边 / 投影 / 发光 / 浮雕压印 / 渐变填充 / 金属铬 / 膨胀弧形 / 硬边色块承载文字) is available per `selling-point.md` → Step 5 part 7 — **at most 1–2 slots per set**, one treatment per slot, register- and platform-gated, never on the hero / cutaway / spec slot, and never as a legibility fix;
- copy always sits in **reserved negative space** planned in the composition — never over the product, never crossing a face or the product silhouette.

### Slot archetypes (reusable stacks)

Use these as the planning vocabulary. Pick 4–8 per set; each slot carries exactly one primary message.

| # | Archetype | Stack | Mode | Must be stated explicitly in the prompt |
|---|---|---|---|---|
| A1 | **Hero + headline** | L0 studio/gradient + L1 | dense | product occupancy %, headline + subhead verbatim, closed prop list |
| A2 | **Scene narrative** | L0 scene + L1 (+ minimal L2 icon/link) (+ L3) | dense | soft left/right narrative without hard split, icon count, person's action |
| A3 | **App / control demo** | L0 scene + L5 device + L1 + L2 cards | dense | card count, per-card label verbatim, no invented UI, no brand marks on screen |
| A4 | **Structure / how-it-works cutaway** | L0 studio + L2 cutaway + flow arrows + leader labels | dense | which half is cut, the allowed internal parts, arrow path, each label's anchor |
| A5 | **Usage / maintenance steps** | L0 scene × N columns + L2 step badges + L1 captions | dense | column count, unique badges 1..N, identical product per column, hand realism |
| A6 | **Accessories / what's in the box** | L0 studio + L4 line-up + L1 list caption | dense | exact item list, all items grounded with contact shadow, nothing extra |
| A7 | **Lifestyle benefit with person** | L0 scene + L3 + L1 (no L2) | dense | person pose/action, product occupancy %, explicitly no icons/cards/arrows |
| A8 | **Dual state / dual configuration** | L0 two identical units + L1 | dense | both units identical in every visible feature; no ✓/✗ marks, no competitor framing |
| A9 | **Two-panel narrative** | full-width L1 header + two equal panels, each its own L0 scene (+ L3 / L5 inside a panel) | dense | header spans both panels, hairline divider (no thick border), each panel's own place/staging, shared palette and photographic quality |
| A10 | **Top-down flat lay** | L0 fabric/wood surface shot from above + L4 line-up + L1 + optional tertiary contents line | dense | top-down camera, deliberate asymmetry with calm spacing, each item's position named, unbranded packaging, directional sunlight |

> Layout mapping: A1 → `selling-point.md` ①; A2/A7 → ④; A3/A6 → ②; A4 → ⑥; A5/A9 → ⑦; A8 → ⑧; A10 → ② geometry, top-down.

> **Base rule**: A1, A4, A6, A8, A10 use the clean studio/gradient/fabric base; **A2, A3, A5, A7, A9 use a furnished scene base** and must satisfy **Scene layer richness**. There is no detail-crop archetype — when a close range is needed, shoot it as a **close-range editorial frame inside a real interior** (softly defocused room behind, headline in reserved space, no callouts), which stays a scene slot.

> **Secondary-subject variant**: A1, A2, A5, A7, A9 may add a live pet or a person as a secondary subject when the category supports it — state its occupancy %, position, action, and anatomy guards, and keep it from covering the product's key structural features. On platforms whose hero must be a bare white-background product shot, this variant is not available to the hero.

### Composite planning of a set

1. Lock the platform hard specs first (hero rule, slot count, ratio, prohibited elements) from the platform section below, then resolve the set-wide locks in **Set lock** — including the **type-lock phrase** — before writing any slot prompt.
2. Assign an archetype per slot so the set answers, in order: **what it is → where it is used → how it works → how it is operated → how it is maintained → what is included**. Add a lifestyle/benefit or dual-state slot when the count allows. Every slot after the hero must satisfy the **Supporting-slot enrichment mandate**.
3. **Hero exception**: when the platform forbids in-image text or overlays on the hero, that slot is **L0 only** — strip L1/L2 entirely instead of shrinking the copy. This exception applies to the hero slot ONLY; it never justifies a bare supporting slot.
4. Do not reuse one archetype twice in a set unless the platform requires multiple scene/detail slots — and even then, the two slots must carry different messages and different enrichment layers. Vary the archetype, never the style tokens.
5. One AI call per slot; slot count must match the requested/platform count (≥4 for a complete set).
6. If an archetype needs a fact the user has not supplied (UI strings, accessory list, internal structure), **swap in another enriched archetype that the available facts support** and note the swap in the plan — add the missing fact to the single consolidated ask only when no alternative archetype fits. Never substitute a generic single-scene or single-angle image silently.

### Layer permission by platform

| Platform | Hero slot | Supporting slots | Minimum enrichment per supporting slot | Hard layer bans |
|---|---|---|---|---|
| Amazon | L0 only, pure white, ≥85% coverage | L1 / L2 / L3 / L4 / L5 all allowed | L1 + one of L2/L3/L4/L5 | no text, logo, or graphic overlay on the hero |
| eBay | L0 only, neutral/white | L3 / L4 / L5 (text and badges banned) | two of L3/L4/L5 (in-use, accessories, scale reference) | text, badges, and borders banned on every image |
| Walmart | L0 only, seamless white | L1 / L2 / L3 / L4 | L1 + one of L2/L3/L4 | no text overlay or promo language on the hero |
| Shopify | L0 (L1 allowed) | all layers | L1 + one of L2/L4/L5 (L3 limited) | L3 limited to at most one anonymous hand |
| Etsy | L0 + handwritten L1/L2 | all layers | handwritten L1 + one of L2/L3/L4 | no placeholder/mockup copy on the hero |
| AliExpress | L0 only, pure white | L1 / L2 / L3 / L4 | L1 + one of L2/L3/L4 | no oversized marketing type or color blocks; no collage |
| TikTok Shop | L0 only, pure white | L3 required in ≥3 slots; **L1 and L2 banned set-wide** | L3 + one of L4/L5 (or a second distinct interaction) | no text overlay, no graphic overlay, no stickers |
| Shopee | L0 only, solid-color cover | L1 / L2 / L3 / L4 | L1 + one of L2/L3/L4 | no promo text/symbols, no collage |
| Lazada | L0 only, pure white | L2 / L3 / L4 (informational labels only, no promo copy) | L2 + one of L3/L4 | no promotional text or decorative overlays on any slot |
| Alibaba.com | L0 only, real photo, 75–80% | L1 (English only) / L2 / L3 / L4 / L5 | L1 + one of L2/L3/L4/L5 | Chinese text banned; marketing/discount wording banned |
| 1688 | L0 only, pure white | L1 (zh-CN) / L2 / L3 / L4 / L5 | L1 + one of L2/L3/L4/L5 | no excessive text overlay, no misleading promotional wording, no other-platform watermark |
| Taobao (淘宝) | L0; hero background rule not defined in the sourced material — **verify officially** | L1 (zh-CN) / L2 / L3 / L4 / L5 (AI scene and model images explicitly permitted) | L1 + one of L2/L3/L4/L5 | fabricated accessories/gifts/functions/packaging/certifications/sales data; defect erasure on second-hand items; unlabeled pre-sale renders |
| Tmall (天猫) | L0; same as Taobao — **verify officially** | L1 (zh-CN) / L2 / L3 / L4 / L5 | L1 + one of L2/L3/L4/L5 | concept render passed off as a finished product; fake brand/certification/award/sales data; unauthorized brand/IP/celebrity likeness; altered fabric, cut, or shoe shape on AI model shots |
| Douyin E-Commerce (抖音电商) | L0 only for the 全球购 channel: front-facing real product, brand logo permitted, **no other text and no watermark** | L1 (zh-CN) / L2 / L3 / L4 / L5 | L1 + one of L2/L3/L4/L5 | heavy watermarks, 大字报/牛皮癣 oversized promo type, collage, compression distortion, over-retouching, click-bait; anything the buyer will not receive |
| JD.com (京东) | L0, complete and clear product subject | L1 (zh-CN) / L2 / L3 / L4 / L5 | L1 + one of L2/L3/L4/L5 | unauthorized 京东物流/京东超市/官方认证 marks; other platforms' names, logos, contact info, URLs, QR codes; off-site traffic diversion |
| Pinduoduo (拼多多) | L0, undistorted product appearance | L1 (zh-CN) / L2 / L3 / L4 / L5 | L1 + one of L2/L3/L4/L5 | deformed/distorted product; misleading directional comparison images; high-value image on a low-value SKU; AI-fabricated packaging, label, certification, or efficacy |

> The platform ban always wins over the archetype. If an archetype's message cannot survive the ban (e.g. A4 leader labels in a TikTok set), move that message to a slot the platform allows or drop the archetype — never smuggle the text in at a smaller size.

> **Exception — a user-confirmed logo/watermark outranks the platform ban.** When the user has confirmed "keep my logo/watermark" per SKILL.md → Step 0 **Logo / watermark confirmation**, that mark is a user hard constraint and is exempt from every ban in the table above and from the platform's **Prohibited elements** list in its spec file (`platform-specs-overseas.md` / `platform-specs-china.md`). Keep it in **every** slot including an `L0 only` hero, at the source's relative position and relative scale, unshrunk and unfaded. Precedence: **explicit user decision > platform requirement > reference default**. It is an overlay layer, not part of L0/L1/L2 — it does not consume a slot's enrichment quota and does not count as the banned text/graphic overlay. Warn the user once about the listing-compliance risk, then generate as confirmed.

### Set lock — extended for composite slots

Beyond the style tokens (background world, lighting, palette), lock the following across the whole set and reuse the wording verbatim in every slot's prompt:

- **Product structure lock** — every slot shows the same visible structure (same window, buttons, outlet, bowl, ports, seams). Multi-column and dual-unit slots must be internally identical as well.
- **Persona lock** — when more than one slot shows a person, use one persona (age band, hair, wardrobe palette) across them; pose, interaction level, and framing change per slot.
- **Scene world lock with room variety** — one coherent world (same home/workspace, same palette, same light temperature), but a different room area, vantage, or depth arrangement in every slot.
- **Type system lock (one set = one font system)** — resolve the set's type system **once at plan time**, write it down as a fixed **type-lock phrase**, and copy that phrase **verbatim** into every text-bearing slot's `Typography:` block, exactly as the platform style phrase is repeated in block 8. The phrase names, in this order:
  1. **Headline font class** — a concrete class from `selling-point.md` → Step 5 part 1 (serif / Didone / humanist sans / geometric sans / condensed grotesk / small caps / script / mono — **never "modern clean font", never a heavy sans by default**); for Chinese/Japanese/Korean copy, a concrete class from the **CJK type voices** table — **never a bare 黑体 default**.
  2. **Companion class** — the family carrying the second level, and every Latin word/numeral inside CJK copy (two families per image maximum, per Step 5 part 1).
  3. **Script variant** — one 简繁 choice for the whole set when the copy is Chinese.
  4. **Glyph-integrity clause** — mandatory in every CJK text slot (笔画完整、无错字缺笔变形).

  > Example (淘宝高端编辑风 set): `type lock: 中粗宋体标题 + 等线黑副文与数字 / 拉丁，全套简体，汉字笔画完整无变形`. Example (Etsy handmade set): `type lock: elegant handwritten script headline + old-style serif for all supporting levels`.

  **Never re-resolve the voice per slot.** Choosing a different headline class, a different companion, or a different 简繁 variant in slot 3 than in slot 2 is a set-consistency failure — that slot is regenerated, not accepted, even if its own typography is individually well designed. **When the product itself carries type** (wordmark, packaging print, panel labels, screen UI), sample that letterform as the set's voice first — style only, never its wording, and never re-typeset the product's own text. What varies per slot is the skeleton, case (字重档位 for CJK), devices, **contrast direction (dark-on-light / light-on-dark white or ivory / tone-on-tone)**, and colour tone — always sampled from the scene, never a frozen hex value, and always **inside the locked families**. Role-swapping within the lock (a serif headline in the lifestyle slots, a sans-only treatment in the spec or contents slot) is variation, not a broken lock.
- **Graphic language lock** — one leader-line weight/color, one arrow style, one badge shape/color for the entire set.
- **Treatment budget** — at most 1–2 slots in the set carry an expressive type treatment (Step 5 part 7); when two do, they use the **same** treatment family so the set reads as one design, and every other slot is explicitly plain.
- **Message uniqueness** — each slot owns one message; never restate another slot's headline.

### Composite slot check (agent-side)

- Every slot's layer list matches its archetype, and each layer's reference was loaded.
- **Every non-hero slot carries ≥2 enrichment layers** permitted by the platform; no supporting slot is a bare angle, bare crop, or bare scene shot.
- **No slot is a bare macro/detail crop** — `image-detail.md` was not used as a slot base.
- **Every slot has a filled slot brief** (all ten fields), including quantified staging: product occupancy % + position, and each secondary subject's occupancy %, position, and action.
- **Every scene slot names** 6–9 elements with material and position, three depth planes, the light source, the depth-of-field intent, and an art-direction register with an anti-ad clause; at least half of the supporting slots use the scene base.
- **Physics/anatomy guards are present** wherever a pet, person, hands, water, or falling material appears (correct anatomy, gravity, contact shadow, electrical parts dry).
- **Human interaction is planned, not stamped**: the chosen level matches the product's form and operation mode, every person/hand has a stated action (no idle bystander), no person appears in hero/structure/contents/dual-state slots, and the persona is locked when more than one slot shows a person.
- **Every slot has a unique message** from the taxonomy; no two slots reduce to the same sentence, and no slot is a mirrored/re-angled copy of another.
- **Sit-in / lie-on products show an occupant actually using the product** in at least one slot, not just a hand on the armrest; no disembodied arm enters the frame in more than one slot.
- **Copy passes the voice test** — it states a benefit, scenario, spec, or instruction, and never merely describes the photograph ("… Setting", "… Context", "Product shown in …").
- **Every panelled slot has a per-panel delta**: each panel/column shows a nameable different state and is described separately with its own caption; no slot repeats the same arrangement across panels; no panel count echoes a quantity in the copy; `what is included` is a single flat-lay frame, not a step sequence.
- **Expression-mode quota is met**: ≥3 distinct modes (4 images), ≥4 (5–6), ≥5 (7+); **exactly one annotated (M4) slot at most**; no other mode overused.
- **No part-name labels outside the single M4 slot**, and **no planning vocabulary rendered as on-image text** (no "Front View", "Visible Components", "Floor Contact", occupancy numbers, slot names).
- **Copy shape varies across the set** — not every slot is "headline + a few short labels".
- **Photography-led slots explicitly say no graphics are added**, so they are not decorated with stray icons or badges.
- **The differentiation matrix is filled** and no two slots share more than two identical columns; shot scale, camera height, and product placement vary across the set.
- **The type-lock phrase is present and identical** in every text-bearing slot's `Typography:` block — same headline font class, same companion class, same 简繁 variant across the whole set; a slot that names a different font class (or leaves the class generic) breaks the set and is regenerated, not accepted. Only skeleton, weight/case, size, devices, contrast direction, and colour tone vary between slots, all inside the locked families.
- **Typography varies** across the set: no two slots share the same skeleton (**and no skeleton is "varied" merely by moving the same block to a different corner** — the block's structure must change); **every supporting slot on a copy-permitted platform has a `Typography:` block with ≥2 text levels and 2–3 devices at the target footprint** (8–18% corner/lower-third/side-column, 18–28% top band/split header/numeral-led) — a missing block, blank image, or lone short headline is a hard failure, and no headline is stretched past its word cap to compensate; at least 4 different typographic devices appear in a 4-image set; a **concrete font class is named** (not "modern clean font", not a heavy sans by default); the **contrast direction changes between slots** — at least one slot uses white/ivory type on a dark, shadowed, or softly scrimmed area when the scenes allow it; text colour is sampled from the scene (not a frozen hex in every image); copy sits in reserved negative space and never overlaps the product or a face.
- **Chinese-language sets additionally pass**: the named class comes from the **CJK type voices** table and matches the product's register (a default 黑体 across every slot is a failure); a Latin/numeral companion is named; one 简繁 variant holds set-wide; every CJK text slot carries the glyph-integrity clause (笔画完整、无错字缺笔变形); each zh slot moves ≥2 CJK variation levers from its neighbours; no 伪粗/伪斜, no mechanically stretched glyphs, no letter-spaced Chinese headline.
- **Expressive treatments stay inside their budget**: ≤1–2 treated slots per set, one treatment per treated slot (never stacked), the register and the platform both permit it, no treatment on the hero / cutaway / spec slot, no treatment used to fix contrast, and 汉字 are never warped, inflated, arched, or relief-deformed.
- **The platform style phrase is present and identical** in every slot's block 8 (and referenced by block 9 on text slots) — the set states which platform's look it conforms to instead of leaving it implicit.
- The hero slot is the only single-capability image in the set, and it complies with the platform's layer ban.
- Slot count matches the requested/platform count, with one AI call per slot.
- Each L1 string is verbatim, appears exactly once, and is in the resolved target language.
- Each L2 element has a stated count, position, and anchor; each L4 item is in the confirmed list.
- Each supporting slot carries a distinct message; no two slots differ only by camera angle.
- **Text-presence gate**: every supporting slot whose platform permits L1 has a non-empty `Typography:` block and visible ≥2-level copy in the output. A blank supporting image is rejected and regenerated; only an explicit platform text ban can waive this gate.
- No layer introduces a fact absent from the user request or the source image.

---

## Special Scenario — Batch Generation

> Use this scenario when the user uploads **multiple images** and asks for the **same operation** to be applied to all of them (e.g., "batch process these 20 product photos to white background", "make all these images into Amazon main images", "apply the same scene style to every SKU photo").

> **Scope boundary**: the **Supporting-slot enrichment mandate** does NOT apply here. Batch Generation repeats one requested operation per input image, so a batch of plain white-background or plain scene outputs is correct. The mandate applies only when the user asks for a platform image **set** for one product — including each set inside a "batch of platform image sets".

### Core Rules

1. **User-specified parameters are the hard batch contract.**
   - Any parameter the user explicitly specifies (operation, background color, ratio, lighting mood, output format, platform target, resolution) must be honored for every image.
   - Do not reinterpret the operation differently per image.
   - If the user's request contains ambiguity (e.g., "make them look better"), propose a single safe default and apply it uniformly across the whole batch — do not let the interpretation drift from image to image.

2. **Style consistency is pursued, not enforced rigidly.**
   - The agent should plan prompts so that the batch reads as visually aligned where semantically reasonable, but it is **not required** to force every image into an identical background world, lighting language, or color palette.
   - Use a **batch style token** as a default anchor, then adapt it per image when strict reuse would create semantic or environmental conflicts.
   - Examples of conflicts where strict reuse should be relaxed:
     - A kitchen product and an outdoor product both asked for "warm home scene" — the outdoor product should get an appropriate warm outdoor context, not a kitchen counter.
     - A dark tech gadget and a pastel baby product both asked for "soft shadows" — the lighting quality can stay similar while the surrounding world differs.
   - When in doubt, prefer **coherence in quality and treatment** over **sameness of scene**.

### Workflow

1. **Intake all images first.**
   - List the batch: file names, dimensions, formats, visible content, and any obvious outliers (damaged, wrong category, extreme aspect ratio).
   - Note domain/style diversity: are these all similar products, or mixed categories? This determines how rigid the style lock should be.
   - Flag images that cannot be processed as requested (e.g., a logo-design request on a corrupted file) and report them before starting the batch.

2. **Lock the hard contract; plan a flexible style anchor.**
   - Summarize back to the user: operation, target ratio, output count, and any assumptions.
   - Propose a **flexible style anchor** — a short phrase that captures the shared treatment (e.g., "clean studio lighting, soft shadow, neutral background") without prescribing a single literal scene.
   - Example: *"Batch plan: convert all 12 images to clean white-bg product hero, 1:1, 1600×1600, with consistent studio lighting and soft shadow. If a product clearly belongs in a different environment, we'll adapt the background while keeping the lighting quality uniform."*
   - Confirm the plan **once**, together with every other open item (`SKILL.md` → Step 3 → **One ask, not a chain**), and only when an operation is genuinely unstated or outliers exist. Do not confirm the ratio, size, or style anchor separately, and do not re-confirm per image.

3. **Generate one image at a time with a shared template and per-image adaptation.**
   - Use a reusable prompt skeleton: `[Operation] + [Flexible style anchor] + [Per-image adaptation] + [Per-image preservation clause]`.
   - The **style anchor** should stay as consistent as possible across the batch; the **per-image adaptation** resolves semantic conflicts (e.g., different appropriate environments for different product types).
   - Number outputs ("image N of M") to help the model maintain continuity.

4. **Coherence gate before delivery.**
   - Spot-check at least 3 outputs across the batch: first, middle, and last.
   - Verify that the shared treatment feels consistent at a glance: lighting quality, shadow softness, color temperature, output ratio, and overall finish.
   - Do not flag a result as inconsistent just because the literal background scene differs — flag it only if the **treatment quality** visibly diverges (e.g., one image is harsh flash while others are soft window light).
   - If one output diverges in treatment, identify which style anchor was lost and regenerate only that image with the corrected prompt.

### Difference from Platform Image Sets

| Dimension | Platform Image Set | Batch Generation |
|-----------|-------------------|------------------|
| Input | Usually one reference product | Multiple distinct images |
| Goal | Per-platform campaign coherence | Same operation applied with shared treatment |
| Style unit | One style system per platform | One flexible style anchor per batch, with per-image adaptation |
| Output relationship | 4–6 images tell one product story | Each image is independent but visually aligned where reasonable |
| Ratio | Platform-mandated | User/platform-mandated; may follow source if user asks |
| Background world | Must be shared | Should be coherent in quality, may differ by product domain |

### Batch of Platform Image Sets

When the user uploads **multiple product images** and asks for a **platform image set for each** (e.g., "make each of these 10 products into an Alibaba 6-image set"), the two modifiers overlap. Apply these rules:

1. **One platform set per input image** — treat each uploaded product image as the single reference for its own set. Do not mix products across sets.
2. **Per-set style contract is primary; batch-wide anchor is secondary** — within one set, use the platform's style system (shared background world, lighting, palette). Across different sets, the style contract restarts for each new product. Do not force unrelated products into a single shared literal background just because they are processed in the same batch; keep treatment quality consistent, not the literal scene.
3. **Output mapping** — aggregate results by input image so the user can clearly map each generated image back to its source product (e.g., "Product A — hero", "Product A — scene", "Product B — hero", ...).
4. **Reference count** — load this file plus the one matching spec file once for the whole batch (all products in a batch share the same platform), then apply their rules independently to each product's set.
5. **Do not average products** — each set preserves only its own product's identity; never generate a "generic" set that blends features from multiple inputs.

### Common Pitfalls

- **Over-locking the scene**: forcing a kitchen counter background onto every image when the batch contains outdoor gear will produce nonsensical results. Lock the treatment, not the literal environment.
- **Drifting treatment adjectives**: replacing "soft natural shadow" with "gentle shadow" or "subtle drop shadow" across calls will break batch coherence. Pick one phrase for the shared anchor and stick to it.
- **Source-ratio following by default**: when the user says "batch process these", they usually expect visual consistency more than pixel-perfect source preservation. Pick one target ratio, state it in the plan, and use it for the whole batch instead of silently mixing ratios.
- **Outlier contamination**: one corrupted, miscategorized, or heavily watermarked image can make the whole batch look uneven if its output is included without flagging.
- **Silent enhancement variance**: applying HD upscale to only the low-res images while leaving others untouched creates a visibly uneven batch.

---

## Platform Spec Files

> **This file holds no platform's hard specs.** Ratios, pixel sizes, file formats, size caps, coverage percentages, prohibited-element lists, and per-platform slot plans live in the two spec files below. Load **exactly one** — the one containing the platform the user named — in addition to this file.

| Platform named by the user | Load this spec file |
|----------------------------|---------------------|
| Amazon, eBay, Walmart, Shopify, Etsy, AliExpress, TikTok Shop, Shopee, Lazada, Alibaba.com | `references/platform-specs-overseas.md` (§1–10) |
| 1688, Taobao (淘宝), Tmall (天猫), Douyin E-Commerce (抖音电商), JD.com (京东), Pinduoduo (拼多多) | `references/platform-specs-china.md` (§11–16) |

Rules:

1. **Load one spec file, read one platform's section.** Do not read a neighbouring platform's section, and never take a numeric value from it — the entries share an identical field structure, so cross-contamination is easy and produces rejected listings.
2. **Both files are children of this one.** Section numbering (§1–§16) is continuous across them, so an existing `§N` cross-reference stays valid regardless of which file it lives in.
3. **Multi-platform requests**: if the user genuinely asks for sets on platforms from both groups, load both spec files, but plan and generate each platform's set separately against its own section — never merge two platforms' specs into one set.
4. **抖音电商 (Douyin, §14) ≠ TikTok Shop (§7).** Different platforms, different files, different in-image languages (zh-CN vs English), different rules. Route by the platform the user actually named.
5. **Split boundary**: this file owns the platform-agnostic framework (in-image language, style systems, Composite Slot Model, slot briefs, differentiation contract, layer-permission table, batch generation). A spec file owns only its platforms' hard specs, style notes, and category rules. A spec file never redefines the slot model; this file never inlines a platform's numbers.
