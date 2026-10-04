# Process Flowchart

## Routing Header

- **Load when**: user asks for a manufacturing/production process flowchart, process diagram, craft flow, or "how it's made" infographic based on a product image and category.
- **Do not load when**: user wants a tech pack / OEM spec drawing (load `references/tech-pack.md`), a selling-point feature infographic (load `references/selling-point.md`), or only text explanation without an image.
- **Merge notes**: do not merge with other layout-heavy scenes in the same `image_edit` call; process flowcharts require a dedicated, stage-count-controlled output.
- **Hard stop**: do not fabricate product facts, hidden craft details, exact material grades, or certifications; only infer process stages that are plausible for the visible product type and category.

## Scene Description

Generate a clean, realistic industrial-manufacturing process flowchart from a product image and its category. The flowchart must show 3–6 core production stages, each with a realistic stage photo, a clear title, and a one-line operation description, connected by unidirectional arrows.

> **vs Tech Pack**: Tech Pack is for OEM/production specs (dimensions, multi-view, assembly). Process Flowchart is a consumer-friendly "how it's made" infographic with numbered stages and realistic scene photos.
>
> **vs Selling Point Image**: Selling Point highlights marketing features. Process Flowchart explains the production journey from raw material to finished product.

## Workflow

### Step 1 — Intake

Before building the flowchart, inspect the provided product image and category:

- Main product and visible material/structure
- Product category and typical manufacturing/craft logic
- Any visible craft clues (sewing, welding, molding, printing, weaving, coating, etc.)
- Do NOT infer hidden or occluded details

### Step 2 — Stage Planning

Based on the product type and category, plan **3–6 core stages** that cover the full journey from raw material/preparation to finished product. Skip minor intermediate steps.

| Product Category | Example Stages |
|------------------|----------------|
| Textile / Apparel | Raw Fabric → Cutting → Sewing → Finishing → Inspection |
| Ceramic / Pottery | Clay Preparation → Shaping → Drying → Glazing → Firing → Quality Check |
| Metal / Hardware | Material Cutting → Forging/Molding → Machining → Surface Treatment → Assembly |
| Wood / Furniture | Timber Selection → Cutting → Shaping → Assembly → Surface Finish |
| Electronics / Gadgets | PCB/Shell Prep → Component Assembly → Soldering → Testing → Packaging |
| Food / Beverage | Ingredient Prep → Mixing → Processing → Packaging → Quality Control |

Rules:

- Stage count must be **between 3 and 6**, inclusive.
- Each stage must represent a real, coherent step in the product's manufacturing logic.
- Stages must progress forward; no loops, branches, or skipped numbering.

### Step 3 — Stage Source & Confirmation

| Situation | Condition | Agent Behavior |
|-----------|-----------|----------------|
| **User provided specific stages** | User explicitly lists process stages or says "show X, Y, Z steps" | Use user's stages directly. Agent only adapts wording (translate to English, control word count). **No confirmation needed — execute directly.** |
| **User did not provide stages** | User only asks for a process flowchart without specifying stages | Agent proposes stages based on product type and category. **Must confirm with the user before generating.** |
| **Mixed** | User provided partial stages | Use user's stages as core. Agent supplements remaining stages. **Supplemented parts must be confirmed with the user.** |

#### Stage Confirmation

When the Agent infers/supplements stages, present the proposal to the user **before** image generation. Use the host's prompt/selection UI when available; otherwise ask a concise question in chat.

**Step 1 — Confirmation popup** (stage plan in the title, only 2 options):

```
Title (markdown, blank line between each stage):

Based on the product and category, here is the proposed process flowchart plan:

**Process Stages**:

Step 1: {English Title} — {English Description}

Step 2: {English Title} — {English Description}

...

Step N: {English Title} — {English Description}

Layout direction: {horizontal / vertical / square}

Options:
- Confirm & Generate
- Edit Stages
```

**Step 2 — If user clicks "Edit"**, show a second popup with the full stage plan pre-filled in the input field for the user to modify. After submission, treat the edited content as user-provided stages and execute directly without further confirmation.

**Rules**:
- Only ask for confirmation when the Agent infers/supplements stages
- One round of confirmation only — no second-guessing after user confirms or edits
- **Merge, never chain**: this is the SAME single interaction described in `SKILL.md` → Step 3 (**One ask, not a chain**) — combine it with any other open item rather than adding a round; layout, icon style, and palette are inferred, never asked
- Edited content = user-provided stages; Agent only adapts wording, never overrides intent

### Step 4 — Stage Description Output

For each stage, produce two parts **directly in English**:

1. **Stage Title** — a concise phrase, 2–6 English words.
2. **Stage Description** — one sentence summarizing the concrete operation, ≤10 English words.

The English text will appear directly in the final image, so keep it clear, short, and readable.

Example (ceramic mug):

| # | Stage Title | Stage Description |
|---|-------------|-------------------|
| 1 | Clay Mixing | Select and blend clay materials |
| 2 | Shaping | Form the cup body on a wheel |
| 3 | Bisque Firing | Fire once to harden the body |
| 4 | Glazing | Apply glaze evenly to surface |
| 5 | Glaze Firing | Final firing to finish the mug |

### Step 5 — Build the `<user_prompt>` Block

Replace `<process_num>` with the actual stage count and embed the stage list as the `<user_prompt>` block:

```
Process stages (<process_num> total):

Step 1: {English Title} — {English Description}
Step 2: {English Title} — {English Description}
...
Step <process_num>: {English Title} — {English Description}
```

### Step 6 — Construct the Final Image Prompt

Use the template below. The final prompt must be in English so all on-image text is rendered in English.

```
Create a manufacturing process infographic showing how the product in the reference image is made. The infographic MUST contain exactly <process_num> core stages, no more and no fewer.

<user_prompt>

## Generation Requirements:

### Stage Count (Most Important):
- The number of stages in the flowchart must be strictly equal to <process_num>. Do not add or remove any stages.
- Each stage's content must correspond one-to-one with the user description above. Do not invent extra steps.

### Numbering (Strictly Unique):
- Every stage must be clearly labeled with a unique number, starting from 1 and increasing to <process_num>.
- Each number may appear only once in the entire image. Duplicate numbers (e.g., two Step 3 labels) are forbidden.
- Each number must correspond to exactly one realistic stage photo and one stage description.
- The final image must contain exactly Step 1 through Step <process_num>, with no missing and no extra numbers.

### Arrow Direction:
- All stages must be connected in sequence by single-direction arrows: Step 1 → Step 2 → Step 3 → ... → Step <process_num>.
- Arrow direction must only point from the previous stage to the next stage (forward progression). No bidirectional arrows, looping arrows, or skipping arrows.

### Overall Style:
- Clean industrial-manufacturing infographic style; photorealistic and intuitive; tidy background; uniform typography.
- Each stage includes: number + title + key point label + corresponding realistic photo.
- Image and text layout must not block key information.
- All text on the image must be in English and clearly legible.
- Ensure every stage photo in the flowchart is realistic and true-to-life.
```

## Apply Method: Use as Final Prompt

The block above is the complete **content** of the prompt: place it verbatim into the `Primary request:` block and wrap it with the schema blocks defined in SKILL.md **Final Prompt Assembly** (`dense` tier — block 1 prepended, blocks 11–13 appended; block 2 only when 2+ input images are passed). Do not concatenate extra scene descriptions or selling-point layouts, do not reword the block, and do not add any content beyond the schema blocks. The stage-count and arrow-direction rules above already act as constraints, so keep the appended blocks short and do not restate them.

## Tool Invocation

- Tool: `image_edit`
- Mode class: **dense-layout** (multi-stage infographic with text, photos, and arrows)
- Resolve `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `complex_generation`)
- Dimensions (mandatory):
  1. **Default: follow SKILL.md Step 0.5** — preserve source proportions. In `auto_generation` pass the exact source `size` (measured pixel W×H) + closest `aspect_ratio`; in `simple`/`complex` fallback pass ONLY the closest `aspect_ratio`.
  2. **User override**: if the user explicitly specifies a size or aspect ratio, use it instead of source-following.
  3. **Layout-driven override (use sparingly)**: only if the source aspect ratio is clearly unsuitable for a readable flowchart and the user did not specify dimensions, you may choose the best fit from `1024x1024`, `1536x1024`, or `1024x1536` based on stage count and intended flow direction. In this case, briefly inform the user that source proportions are being overridden for layout readability.
     - **Landscape / wide flow (4–6 stages arranged horizontally)**: `1536x1024`
     - **Square / balanced layout (3 stages or near-square source)**: `1024x1024`
     - **Portrait / vertical flow (tall source or stages stacked vertically)**: `1024x1536`

## Acceptance Criteria

- Stage count is exactly 3–6 and matches the planned stages.
- Each stage has a unique, sequential number with no duplicates or gaps.
- Arrows point forward only, in a single continuous chain.
- Stage titles and descriptions are in English and legible.
- Stage photos are realistic, not illustrations or icons.
- Product identity from the reference image is preserved where shown.

## Notes

- This workflow requires a product image. If the user has not uploaded one, ask for it first.
- If the user provides only a category without an image, ask for a representative product image before generating the flowchart.
- Do not fabricate hidden craft steps or material details; stick to what is plausible for the visible product and stated category.
- Keep stage titles and descriptions short; long text reduces legibility in the infographic.
- The agent must present the planned English stage list (title + description) to the user for confirmation before calling `image_edit` with the English prompt; if the user provided the stages explicitly, output the list once for visibility and execute directly.
