# Scene Image

## Routing Header

- **Load when**: user wants to change, replace, or generate the surrounding scene/background/environment while preserving the product.
- **Do not load when**: user wants only pure white background, only product recolor, only text editing, or only native resize/crop/format conversion.
- **Merge notes**: this is the preferred merge carrier for compatible edits such as background, lighting, mood, composition, cleanup, model-in-scene, and listing-style hero refinements when the product must stay unchanged. When the output will carry **any overlay copy**, also load `selling-point.md` → **Step 5: Typography Design** and see **Overlay Copy Typography** below. A standalone scene may be copy-free; a platform image-set supporting scene must carry a ≥2-level text block whenever its platform permits copy, never a lone line.
- **Hard stop**: do not alter, redraw, recolor, simplify, or invent product details or hidden/occluded areas.

## Scene Description

Preserve the product subject while generating or replacing the surrounding scene/background to create a lifestyle or contextual visual.

> **Hard constraint (identity + physics only)**: The product's intrinsic identity (shape, silhouette, texture, color, material, logo, prints, structural details) must be preserved — this is the **identity match** requirement defined in SKILL.md **Identity Match Contract**. Composition is otherwise free: camera angle, viewing perspective, shot distance/景别, subject position in frame, and placement pose SHOULD be chosen actively to serve the new scene and the product's role in it, as long as the result stays physically plausible. Only two things are hard-locked: (a) product identity, and (b) physical realism.
> - If occluded parts exist (covered by hands, packaging, objects, or the product itself), do NOT infer, reconstruct, or fabricate hidden content — only render what is actually visible in the original.

> **Physical realism is a co-equal requirement.** Preserving the product is necessary but not sufficient. A scene image fails if the product floats, casts no shadow, is wrongly scaled, or is lit from a different direction than the environment. The product must sit in the scene as a real photograph, not a cut-out pasted onto a background.

## Prompt Rewriting

Do not write the scene instruction by hand. Feed the source image and the user's scene request through the rewriter below; the returned `prompt` value is the **content of the `Primary request:` block**, which is then assembled into the final labeled prompt by SKILL.md **Final Prompt Assembly** (`standard` tier). This reference owns the rewriter's content rules; SKILL.md owns the final prompt format.

### Rewriter Input

- **Original Image**: the source product image provided by the user.
- **User Input**: the user's description of the desired new background scene (may be empty/vague).

### Rewriter Meta-Prompt

```
You are an assistant that generates a single, high-quality image-editing prompt for an image editing model to restage a product into a new scene. You control the background/environment AND the shot composition (camera angle, distance, framing, pose); you must preserve the product's identity.
Your Task
Base on the Input:
The Original Image (showing a product): <image>
The User Input (a description of the desired new background scene): <user_input> You must output one concise, fluent, and visually descriptive English prompt that an image-editing model can use to change the product background.
1. Identify the Main Product
Observe the product image and Identify one main product/object.
Describe it with a Simple, General Category Name, such as: "glasses", "laptop", "sports car", "wireless earbuds", "air conditioner"
Do NOT include:
Brand names
Model numbers
Technical or overly detailed terms
This short phrase is the [product name].
2. Understand the Desired New Scene and Generate the Product Background Description for E-commerce
Read the User Input and generate a clear, visual product background scene description from it.
You may include:
Location & environment (e.g., "modern office desk", "beach at sunset", "cozy living room")
Atmosphere & lighting (e.g., "soft warm light", "bright daylight")
Key background elements (e.g., "wooden table surface", "blurred skyline")
Product composition & presentation (e.g., "centered", "fully visible", "sharp focus")
Ensure that the background does not include any descriptions of people, unless one of the following applies:
The user input explicitly asks to include people
Including people is necessary to make the scene look natural
The product category requires a human carrier to appear physically plausible (e.g., apparel, jewelry, eyewear, watches, bags, hats, shoes — see Section 4).

**Model / Human appearance compliance (MANDATORY when a model is used):**
- The model MUST be fully and appropriately clothed at all times. NO nudity, NO partial nudity, NO exposed private areas, NO see-through or revealing clothing that exposes underwear or intimate body parts.
- When the main product itself is apparel (dress, shirt, pants, etc.), the model MUST be wearing the main product properly and completely.
- When the main product is NOT apparel (e.g., jewelry, eyewear, watches, bags, hats), the model MUST still wear neutral, modest, complete clothing (e.g., plain T-shirt, casual outfit, business attire) appropriate to the scene context. The model's clothing MUST NOT distract from the main product, and MUST NOT introduce competing brand logos or busy patterns.
- Swimwear, lingerie, or underwear may only appear on the model when the main product itself is swimwear / lingerie / underwear AND the scene is contextually appropriate (beach, pool, bedroom, studio).

If the User Input is empty/vague, use a neutral, product-friendly scene.

3. Focus on identity match, not composition lock
The main product's intrinsic identity must not be changed (shape, silhouette, texture, color, material, logo, prints, structural details must all be preserved).
Changes MAY apply to:
The product background.
The surrounding environment of the product.
Supporting surfaces, carriers, or holders for the product if needed (e.g., desk, table, floor, hanger, mannequin, model, hand, stand, shelf, wall hook).
The product's placement pose, orientation, viewing angle, camera distance, and position within the frame — choose these **actively** to compose the strongest shot for the product's role in the new scene. You are not restricted to the original framing; pick the angle/景别/composition a photographer would use for this scene, as long as the product stays physically plausible and its identity is preserved.

4. Physical Plausibility & Pose Adaptation Rule (MANDATORY)
The product MUST obey real-world physics within the new scene. Beyond that, the model is free to adjust the product's **viewing angle, orientation, camera distance, and placement pose** to compose the best shot for the scene. Physical plausibility is the hard floor, not a cap on composition change: pick the framing that best tells the product's story here. If the original pose already fits the new scene well, you may keep it, but you are not required to.

Mandatory rules:
The product MUST NOT float, hover, or hang in mid-air without visible support.
The product MUST rest on, lean against, hang from, be worn by, or be held by a physically reasonable carrier in the scene.
The product MUST cast a correct contact shadow and ambient occlusion at the contact point with its carrier.
DO NOT lay the product flat directly on any surface unless the user input contains an explicit flat-lay instruction (e.g., "flat lay", "lay flat", "lying flat", "top-down flat lay", "knolling"). When no explicit flat-lay instruction is present in the user input, the product MUST be placed using a carrier-based pose from the Category → Pose Map (worn by model, on mannequin, on hanger, standing upright, hanging on hook, held by hand, etc.).
Prefer carrier-based placement (hanger, mannequin, model, stand, hook, hand) over flat-lay whenever the category supports it.

**Scene-Carrier Coherence Rule (MANDATORY):**
The chosen carrier MUST be semantically and contextually appropriate to the new background scene. The Category → Pose Map provides a *pool* of allowed carriers; you MUST then **filter that pool by scene context** and pick the carrier that a real person would actually use in that scene. Reject carriers that are physically possible but contextually absurd.

Scene-Carrier selection priority:
- **Outdoor active scenes** (running track, beach, park, street, hiking trail, sports field) → prefer **a model wearing/using the product naturally in the scene** (e.g., model running on track, model walking on beach). Strongly avoid indoor-only carriers like hangers, dress forms, display busts, indoor furniture.
- **Indoor lifestyle scenes** (bedroom, living room, dressing room, boutique, closet) → both **model** and **indoor display carrier** (hanger, mannequin, dress form, stand) are acceptable; pick whichever fits the scene's narrative.
- **Studio / tabletop scenes** (white background, marble countertop, wooden table, fabric backdrop) → **display stand, mannequin, flat surface, hand** are all acceptable.
- **Workplace / functional scenes** (office desk, kitchen, workshop, garage) → use the carrier native to that function (desk for laptop, kitchen counter for cookware, workbench for tools).
- **Showroom / retail scenes** → display fixtures (mannequin, shelf, rack, stand) are preferred.

Negative examples to AVOID (contextually absurd carrier × scene combinations):
- Clothes hanger or dress form standing alone on an outdoor running track, beach, street, or hiking trail.
- Mannequin placed in the middle of a sports field or swimming pool.
- Furniture (sofa, bed) placed outdoors on grass or asphalt unless the scene is explicitly an outdoor furniture / camping context.
- Kitchen cookware placed on a bedroom dresser.
- Jewelry display bust placed on a beach or in a forest.

The product's pose MUST match its real-world usage state. Use the following **Category → Pose Map** as a hard guideline (then apply the Scene-Carrier Coherence Rule above to pick the best-fitting carrier for the given scene):

— APPAREL & SOFT GOODS —
- Dress / skirt / shirt / blouse / coat / pants / jeans / suit: MUST be **worn by a fully and modestly clothed model**, **displayed on a mannequin/dress form** (indoor / studio / retail scenes only), or **hanging on a clothes hanger** (indoor / closet / boutique scenes only). For outdoor active scenes, ONLY the model option is acceptable. NEVER standing upright by itself on the ground, NEVER flat on outdoor scene surfaces.
- Underwear / swimwear / lingerie: MUST be on a model or mannequin, in a contextually appropriate scene (beach / pool / bedroom / studio).
- Socks / tights: MUST be on legs (model) or laid on a studio surface.
- Scarves / ties: hanging on a rack, draped on a model, or arranged on a studio surface.

— FOOTWEAR —
- Shoes / sneakers / boots / sandals / high heels: MUST sit sole-down on a flat surface with correct contact shadow, OR be worn by a model. For outdoor active scenes, prefer the worn-by-model option.

— BAGS & ACCESSORIES —
- Handbag / backpack / tote / luggage: carried by a model (outdoor / lifestyle scenes), standing upright on a surface (studio / retail), or hanging from a hook (closet / retail). NEVER floating.
- Wallet / cardholder: held in hand (lifestyle), lying flat on a studio surface (studio), or on a display stand (retail).
- Belt: worn by a model (lifestyle), coiled on a surface (studio), or hanging on a hook (closet).
- Hat / cap: on a model's head (outdoor / lifestyle), on a hat stand (retail / studio), or upright on a flat surface (studio).

— JEWELRY & WATCHES —
- Necklace / bracelet / earrings / ring: on a fully clothed model (lifestyle), on a display bust/stand (studio / retail), on velvet/silk surface (studio), or held by a hand (lifestyle / studio). NEVER floating in air. NEVER use a display bust in outdoor scenes.
- Watch: on a wrist (lifestyle), on a watch stand (studio / retail), or on a flat studio surface.

— EYEWEAR —
- Sunglasses / eyeglasses: worn by a model (outdoor / lifestyle), on a display stand (studio / retail), folded on a flat surface (studio), or held by a hand.

— ELECTRONICS —
- Phone / tablet / laptop: on a desk (office / home), in a hand (lifestyle), on a stand (studio / retail).
- Earbuds / headphones: in a charging case, on a stand, on ears (model), or on a flat surface.
- Smart watch: on a wrist or watch stand.
- TV / monitor / appliance: on a stand, mounted on a wall, or in a furnished room context.

— HOME & FURNITURE —
- Sofa / chair / bed / table / cabinet: placed on the floor of a furnished room with correct floor contact and shadow. Avoid outdoor scenes unless the product is explicitly outdoor furniture.
- Lamp / floor lamp: standing on floor (floor lamp) or on a table (table lamp), upright.
- Rug / carpet: laid flat on the floor with natural edge contact.
- Curtain: hanging from a curtain rod with natural drape.
- Wall art / mirror / clock: mounted on a wall.

— KITCHEN & TABLEWARE —
- Cup / mug / bowl / plate / pot / bottle: sitting upright on a flat surface (table, counter, shelf). Liquids inside MUST have a flat horizontal surface.
- Cookware (pan, wok): on a stovetop or on a kitchen counter.
- Cutlery: laid flat on a surface or arranged in a holder.

— BEAUTY & PERSONAL CARE —
- Bottle / jar / tube / lipstick / perfume: upright on a flat surface (vanity, marble, fabric), or held by a hand.
- Brush / comb: on a vanity surface, in a holder, or held by a hand.

— TOYS & BABY —
- Plush toy / doll: sitting upright on a surface or held.
- Stroller / car seat / high chair: on the floor of a relevant scene (park path, nursery floor), wheels/legs touching the ground.
- Baby bottle: upright on a surface or held.

— SPORTS & OUTDOOR —
- Ball (soccer, basketball): resting on the ground/court with contact shadow, or in mid-action only if user requests motion.
- Bicycle / scooter: upright on wheels with kickstand or leaning naturally, NEVER floating.
- Yoga mat: rolled and standing, or unrolled flat on a studio/gym floor.
- Tent / camping gear: pitched on the ground in an outdoor setting.

— TOOLS & INDUSTRIAL / FASTENERS —
- Hand tool / power tool / fastener / hardware: laid flat on a workbench, placed flat inside a toolbox, held in a hand, or arranged flat on a studio surface. Emphasize stable, flat placement with correct contact shadow and no floating or tilted parts.

— AUTOMOTIVE —
- Car / motorcycle / tire: wheels firmly on the ground (road, showroom floor) with correct contact shadow.

Allowed transformations on the product (composition is free; identity is not):
- Camera angle, viewing perspective, shot distance/景别, framing, and subject position — change these actively to compose the best shot for the scene.
- Rotation and placement pose to interact naturally with the scene and its carrier.
- Natural deformation caused by gravity, contact, or being worn (e.g., fabric folds on a model, cushion compression on a sofa seat).
- Realistic shadow, reflection, and lighting interaction with the new background.

NOT allowed:
- Changing the product's category, silhouette, surface texture, color, pattern, print, logo, structural parts, or material appearance.
- Adding/removing functional product components.
- Flat-lay placement (unless explicitly requested by user input — see Section 4).
- Placing indoor-only carriers (hanger, dress form, mannequin, display bust, indoor furniture) in outdoor active scenes.
- Showing nudity, partial nudity, exposed private areas, or contextually inappropriate revealing clothing on any model.

5. Compose the Final Editing Prompt
Write a concise, fluent, and visually descriptive English prompt using the following base structure.

If the product name is simple and intuitive, making it easy for the image editing model to understand, use this template:
Using the provided image, restage the [product name] in [new scene description]. Place the [product name] in a physically plausible and scene-appropriate pose that matches real-world usage — specifically, [explicit carrier/placement instruction selected from the Category → Pose Map in Section 4 AND filtered by the Scene-Carrier Coherence Rule, e.g., "worn by a fully clothed female model jogging on the track", "standing upright on the showroom floor with correct contact shadow"]. The chosen carrier MUST fit the scene contextually (e.g., do NOT place a clothes hanger or mannequin alone on an outdoor track). If a human model is used, the model MUST be fully and modestly clothed with no nudity or exposed private areas, wearing the main product properly (if the product is apparel) or wearing neutral complete clothing (if the product is a non-apparel accessory). The [product name] MUST have correct contact shadow and ambient occlusion with its carrier or supporting surface, and MUST NOT float, hover, or stand unsupported in mid-air. Choose the camera angle, distance, and composition that best present the [product name] in this scene. Preserve the [product name]'s identity exactly — its shape, proportions, texture, color, material, prints, logo, and on-product text — but you are free to change the camera angle, framing, and pose.

If the product name is difficult to describe and may confuse the image editing model, use this template:
Using the provided image, restage the product in [new scene description]. Place the product in a physically plausible and scene-appropriate pose that matches real-world usage — specifically, [explicit carrier/placement instruction filtered by the Scene-Carrier Coherence Rule]. The chosen carrier MUST fit the scene contextually. If a human model is used, the model MUST be fully and modestly clothed with no nudity or exposed private areas, wearing the main product properly (if the product is apparel) or wearing neutral complete clothing (if the product is a non-apparel accessory). The product MUST have correct contact shadow and ambient occlusion with its carrier or supporting surface, and MUST NOT float, hover, or stand unsupported in mid-air. Choose the camera angle, distance, and composition that best present the product in this scene. Preserve the product's identity exactly — its shape, proportions, texture, color, material, prints, logo, and on-product text — but you are free to change the camera angle, framing, and pose.

The prompt should be:
Concise but descriptive.
Actionable (clearly tells the image-editing model what to do).
Focused on visual details only (no explanations, no reasoning text).
Must include the sentence: Preserve the main product's identity exactly, keeping its original shape, proportions, texture, color, material, prints, logo, and on-product text; the camera angle, framing, distance, and pose may be changed freely to compose the best shot for the new scene, as long as the product stays physically plausible.
Must include an explicit carrier-based placement instruction that is BOTH (a) selected from the Category → Pose Map in Section 4 AND (b) contextually appropriate to the scene per the Scene-Carrier Coherence Rule.
Must include an explicit anti-floating instruction (the product must not float or hover in mid-air).
Must include a model-clothing compliance instruction whenever a human model is referenced (fully clothed, no nudity, modest attire).

6. Output Format
Return valid JSON with exactly one field:
{
  "prompt": "..."
}
```

### Rewriter Output Contract

- **Mandatory**: The user's raw input must never be passed directly to `image_edit`; it must always be rewritten by the Rewriter Meta-Prompt first.
- The rewriter must return valid JSON with exactly one field: `"prompt"`.
- Use the value of `"prompt"` **verbatim** as the `Primary request:` block of the final assembled prompt — do not rephrase, trim, reorder, or summarize it.
- The rewriter result is an **assembly input, not the final prompt**. Wrap it with the remaining schema blocks per SKILL.md **Final Prompt Assembly** (`standard` tier: blocks 1, 3–8, 11–13; block 2 only when 2+ input images are passed). Do not inject other references' constraint text *inside* the `Primary request:` block, and do not merge a second scene instruction into it.
- Because the rewriter already states identity preservation, carrier placement, anti-floating, and model-clothing compliance, the surrounding `Product invariants:` / `Allowed changes:` / `Avoid:` blocks must stay consistent with it — they may sharpen those requirements, never contradict or relax them. Do not repeat what the rewriter already said: keep `Product invariants:` ≤ 3 lines and `Avoid:` ≤ 8 items, and keep the product's own material out of block 8.
- The 3–6 acceptance checks stay **agent-side** — never append an `Acceptance checks:` block to the prompt.
- **Intent validation (mandatory)**: before invoking `image_edit`, run the assembled prompt through SKILL.md **Prompt-Intent Validation Gate** (including the schema-conformance check). If it conflicts with the user's original scene request (wrong scene, altered product, or a fabricated element), do NOT call the tool — confirm with the user, then re-run the rewriter from the clarified intent.

## Tool Invocation

- Tool: `image_edit`
- Prompt source: run the **Rewriter Meta-Prompt** against the source image and user input; place the returned JSON `"prompt"` value verbatim into `Primary request:`, then assemble the full labeled prompt per SKILL.md **Final Prompt Assembly** (`standard` tier) and pass that string as the `prompt` parameter.
- Mode: **standard** scene — resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`). A rich or realistic background alone does not make it dense-layout.
- Dimensions (mandatory): follow SKILL.md Step 0.5 — in `auto_generation` pass the exact source `size` (measured pixel W×H) + closest `aspect_ratio`; in `simple`/`complex` fallback pass ONLY the closest `aspect_ratio`. Never let the tool default to a mismatched ratio/size when the source differs.

## Physical Realism Rules

These are the most common failure modes. Every scene prompt must actively prevent them:

1. **No floating**: the product must have a defined supporting surface and visible contact with it. Never leave it suspended in mid-air.
2. **Grounding shadow/reflection**: always request a soft shadow (or reflection on glossy surfaces) whose direction matches the stated light source. Missing or contradictory shadows are the clearest sign of a fake composite.
3. **Single consistent light**: use one dominant light direction and color temperature for both product and scene. Avoid conflicting or multiple hard shadows going in different directions.
4. **Composition is free, physics is not**: the camera angle, distance, framing, and product pose SHOULD be chosen actively to best present the product in the new scene — do not lock them to the original shot. The only constraints on this freedom are (a) the product's intrinsic identity stays unchanged, and (b) the chosen angle/pose remains physically plausible (correct grounding, shadow direction, and scale). Never distort the product's shape or invent detail in the name of a new angle.
5. **Believable scale**: size the product realistically against surrounding objects; never let scene props imply an impossible product size.
6. **Material coherence**: reflections, gloss, and ambient color bounce on the product surface should be consistent with the new environment, but must not repaint or restructure the product itself.

## Overlay Copy Typography (whenever the scene image carries text)

A lifestyle scene that carries copy is a **designed** image, and the copy must arrive as a real text block rather than a stamped label. **When the output will carry any overlay copy at all, load `selling-point.md` → Step 5: Typography Design and emit block 9 `Typography:`** (block 9 is required at any tier whose output contains added text, including this `standard` one). The rewriter never designs type.

**Division of labour:**

- The **rewriter** reserves the copy zone as real negative space in the scene wording ("the upper right third of the wall stays empty above the counter"), **sized to the text block's footprint** — 8–18% of the canvas for a corner / lower-third / side-column skeleton, 18–28% for a top band or split header (`selling-point.md` → Step 5 part 3 → **Text-block mass**) — and keeps the product, hands, and props out of it. It does not choose the font, colour, size, or position of the type.
- **Block 9** carries the type design per Step 5: the register's **concrete font class** (for Chinese copy, from the **CJK type voices** table — never a default 黑体), the skeleton and its zone, relative scale, weight/tracking, the contrast direction with the colour **sampled from the frame**, alignment and margin, the 2–3 devices, plus the glyph-integrity clause for CJK and any part 7 treatment.

**There is no single-line option.** A standalone scene may carry no copy when the photograph is the message. A **platform image-set supporting scene must carry a real text block whenever its platform permits copy**: at least two levels (H1+H2, or H1 + an H3 tracked feature strip) with 2–3 devices, at the footprint stated above, per `selling-point.md` → Step 5 part 3 → **Text-block mass**. It may not choose the no-copy fallback. A lone headline is not a deliverable no matter how well it is designed. On top of the two-level minimum, every text block still needs: (1) a named font class matching the product's register; (2) a colour sampled from the frame — its darkest neutral, or white/ivory over a shadowed area — never default pure black; (3) **optical alignment to a real scene edge** (table line, wall edge, window frame, product axis) instead of a floating corner; (4) its 2–3 devices (eyebrow, hairline rule, tracked strip, footnote); (5) copy that passes the **voice test** — a benefit, scenario, spec, or instruction. When only one message is verified, build the second level from the **same verified facts** (a 3–4 item feature strip, a one-line note) — **never lengthen the headline** to fill the space, and never ship the lone line.

**Canonical failure 1 — the corner stamp.** A heavy 黑体 / grotesk line in pure black dropped into a bottom corner of a warm lifestyle photo, naming what the picture already shows ("吸管饮用", "Straw Drinking", "Front View"). Four faults at once: a default heavy sans against a cozy/humanist register; unsampled pure black over wood; no optical alignment and no reserved zone, so the type reads as pasted on afterwards; and copy that **describes the photograph** instead of stating a benefit or scenario. Fix the copy first, then design it — never fix it by enlarging or bolding the same line.

**Canonical failure 2 — the well-designed lone line.** One headline in a register-appropriate font class, in a deep neutral sampled from the wood, sitting above a single hairline rule in the top-left corner ("Easy to Carry"). Every individual typographic decision is correct, and the result still fails: **one level plus one rule is not a text block**. It occupies ~3% of the canvas, so it carries no visual weight against the product and reads as a watermark. This is the failure the two-level minimum exists to stop — passing the font-class, colour-sampling, and alignment checks does not exempt a slot from **Text-block mass**. Fix a platform-set supporting slot by adding the second level from verified facts (subhead or a 3–4 item strip); removing the copy is allowed only for a standalone scene, not as a platform-set fallback.

## Notes

- **Product identity is the core requirement**: shape, proportions, color, texture, material details, prints, logo, on-product text, and structural features must stay consistent with the original (identity match per SKILL.md **Identity Match Contract**). Camera angle, framing, distance, and pose are NOT part of identity and may change freely.
- **Physical realism is equally required**: grounding, shadow direction, light consistency, perspective coherence, and scale must be physically plausible for the chosen composition. A preserved-but-floating product is still a failed result.
- **No fabrication of occluded areas**: if the user wants to show angles hidden in the original (e.g., back, interior), inform them that area is not visible and suggest providing a clearer reference image.
- **Environment + composition change; identity does not**: scene images replace or reshape the environment, lighting, and atmosphere, and may restage the product with a new camera angle, distance, framing, and pose. They never modify the product's intrinsic identity.
- If the user asks for platform/listing images, route through the Platform Product Image planner first, then use this scene as one planned sub-task.
- **Overlay copy is a design task, not a caption**: any text on a scene image goes through `selling-point.md` → Step 5 and block 9 — see **Overlay Copy Typography** above. A standalone scene may be copy-free. A platform image-set supporting scene must carry a ≥2-level text block at its footprint whenever the platform permits text; neither a blank frame nor a lone corner line is acceptable even when the photograph itself is good.
