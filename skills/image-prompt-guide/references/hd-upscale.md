# HD Upscale

## Routing Header

- **Load when**: user asks to upscale, sharpen, enhance clarity, restore resolution, or make an existing image clearer without content changes.
- **Do not load when**: user asks only to increase file size, convert format, resize dimensions (load `references/image-resize.md`), crop, or change visual content.
- **Merge notes**: do not treat upscale as a separate paid AI step when the user mainly wants native delivery sizing. If content edits are needed, perform content edits first and upscale only when quality is still insufficient or the user explicitly requested it.
- **Hard stop**: this scene must not remove watermarks, change backgrounds, fix layout, edit text, or alter any image content.

## Scene Description

Enhance the resolution and sharpness of an existing image without modifying its content, composition, colors, or elements.

> **Hard constraint**: This scene only enhances clarity. It does not remove watermarks, change backgrounds, adjust elements, or alter image content in any way.

## Apply Method: Concatenate a short enhancement prompt

Pass the image with a short enhancement instruction (resolution/sharpness only), e.g., "enhance resolution and sharpness without changing any content". Do not add any content-changing description.

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** scene — express the enhancement in the prompt (e.g., "enhance resolution and sharpness without changing any content, colors, text, or layout") and resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`).
- Dimensions (mandatory): this is a resolution-changing task — follow SKILL.md Step 0.5: keep the source proportions and pass the target `size`/`resolution` (do not shrink below the source).

## Content-Type Pre-Check

Before running the enhancement, the Agent should assess the image content type:

| Content Type | Recommendation |
|-------------|----------------|
| Product photos, natural scenes, portraits | Proceed normally with the enhancement |
| **Text-heavy images** (posters, UI screenshots, infographics, documents) | **Warn the user AND continue**: inform the user that "AI HD upscale may cause text distortion or blurring on text-heavy images. Please verify key text and data after processing.", then immediately invoke `image_edit` to run the enhancement. Do **not** pause or stop after the warning. |
| **File size requests** ("I need it to be 2MB", "output is too small") | **This is NOT an AI task**. Route to resize tool or quality-parameter adjustment. Increasing file size ≠ increasing visual clarity. |

> **Warning is informational only**: the text-heavy warning is a risk disclosure, not a blocker. Unless the user explicitly cancels, the Agent must proceed with the HD upscale tool call right after delivering the warning.

## Resolution Routing

- **"Make it clearer / sharpen"** (no resolution specified) → run the enhancement in standard mode; keep source proportions.
- **"Upscale to 1K / 2K"** (explicit resolution) → this is a resolution-changing task. Translate the shorthand to concrete pixel targets and pass them per the resolved mode.

> For the full 1K/2K pixel translation, the 16-multiple rule, and the per-mode parameter shape, load `references/resolution-routing.md`.

**Key distinction**:
- "Make clearer / sharpen / upscale" = enhance existing image → run the enhancement (standard mode).
- "Upscale to XK" = specified output resolution → pass concrete parameters per `references/resolution-routing.md`; never assume simple mode without schema confirmation.

## Notes

- **Dimensions**: keep the original proportions and content; this is a resolution-changing task, so pass the target `size`/`resolution` per the mode rules above (see SKILL.md Step 0.5).
- **Single-operation constraint**: if the request includes 2 or more intents, platform/listing readiness, composition changes, lighting changes, or broad optimization language, do not treat it as a standalone HD Upscale task. Route to SKILL.md Step 5 (Multi-Intent Execution Planner) first, and only apply HD Upscale as a final quality step if the user explicitly requested it or if the output still lacks clarity after the primary edits.
- **No content modification**: this scene must not change composition, colors, elements, or background — only resolution and sharpness
