# White Background

## Routing Header

- **Load when**: user asks for pure white (#FFFFFF) background, white-background hero image, or platform/listing image requiring a white background.
- **Do not load when**: user asks for non-white background, lifestyle scene, color background, native crop/resize only, or selling-point layout.
- **Merge notes**: when white-background replacement accompanies other product-fidelity edits targeting the same output image (e.g., centering, shadow, lighting cleanup, logo placement, or platform-hero styling), prefer one merged edit prompt (resolved mode) instead of chaining separate AI calls.
- **Hard stop**: only the background changes — keep the product's shape, color, lighting, labels, and attached text/logos consistent with the original.

## Scene Description

Remove the background around the subject and fully replace it with a pure white (#FFFFFF), minimalist background. Keep the subject's shape, structure, color, and lighting from the original image exactly consistent. By default, preserve the original composition — only cut out the target subject and swap the surrounding background; do not re-center, re-crop, or reframe the subject unless the user explicitly asks for centering.

## Output Format Decision (decide first)

Analyze the user's input to decide the output format:

1. **Transparent requested** — the input asks for a transparent background / transparent PNG / cutout to transparency ("transparent background", "PNG with transparency", "cutout", "no background", "alpha channel", etc.) → run the white-background generation below FIRST, then you MUST finish with the **Transparent PNG Post-Processing** step at the end.
2. **Otherwise** — proceed with the white-background generation logic in this file and output the pure white (#FFFFFF) background image (no transparency step).

## Apply Method: Direct Apply

Use the appropriate prompt variant as the **content** of the `Primary request:` block (verbatim), then assemble the final labeled prompt per SKILL.md **Final Prompt Assembly** (`minimal` tier). Adding the schema blocks is required; adding creative scene, layout, or marketing content beyond the fixed preservation constraints in this file is not allowed.

## Routing Modes

| Mode | When to Use | Execution |
|------|-------------|-----------|
| `pure_background_replacement` | User only wants the existing product on pure white | Prefer native background removal/compositing if available; otherwise use `image_edit` under the resolved mode (see Tool Invocation below). |
| `platform_white_hero` | User asks for platform/listing/main image with white background, centering, coverage, shadow, or final size | Use the platform workflow in `SKILL.md`; this scene supplies the white-background sub-task only. Final resize/format is native. |

Do not use this scene as a one-step solution for multi-image listing sets, SKU batches, selling-point layouts, text edits, or crop/resize/format-only requests.

## Prompt Templates

**Subject identification (run first)**: Before filling a template, use the `read` tool to inspect the image and identify the main subject. Convert it into the simplest generic noun (e.g., "backpack", "mug", "sneaker") — do NOT include brand, model number, or professional/technical jargon. If the subject cannot be identified, default to `product`. If the user explicitly specifies a subject, use it as the subject.

### Variant A — No brand elements visible on product

```
Using the provided image of the <subject>, please remove the background around the <subject> from the scene.
Ensure the change is: replace the background around the <subject> with a pure white (#FFFFFF), minimalist white background, and keep the <subject>'s shape, structure, color, lighting, material, and composition exactly consistent with the original image.
```

### Variant B — Brand logo/text visible on product

```
Using the provided image of the <subject>, please remove the background around the <subject> from the scene.
Ensure the change is: replace the background around the <subject> with a pure white (#FFFFFF), minimalist white background, and keep the <subject>'s shape, structure, color, lighting, material, composition, brand logos, and all text/labels exactly consistent with the original image.
```

**Selection rule**: Agent visually inspects the image for brand logos/text on the product. If uncertain, default to Variant B (safer — protects more elements).

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** scene — express "replace background with pure white (#FFFFFF)" in the prompt and resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`).
- Dimensions (mandatory): follow SKILL.md Step 0.5 — in `auto_generation`, pass the exact source `size` (measured pixel W×H) + closest `aspect_ratio`; in `simple` fallback, pass ONLY the closest `aspect_ratio`. Never let the tool default to `1:1`/`2:3`/`16:9` when the source differs.

## Transparent PNG Post-Processing (only if transparent output was requested)

Run this as the FINAL step, and only when the input requested a transparent-background PNG:

1. Generate the pure white (#FFFFFF) background image first using the flow above.
2. Convert that white background to transparency with PIL (Pillow) and export a PNG with an alpha channel. If Pillow is not installed, install it first: `pip install Pillow`.
3. Only background pixels become transparent — do NOT alter the subject. Reference implementation:

```python
from PIL import Image

threshold = 245  # pixels brighter than this are treated as background

img = Image.open('...').convert("RGBA")
new_data = []
for r, g, b, a in img.getdata():
    if r >= threshold and g >= threshold and b >= threshold:
        new_data.append((r, g, b, 0))
    else:
        new_data.append((r, g, b, a))
img.putdata(new_data)
img.save('...', "PNG")
```

4. Output the alpha-channel PNG.

## Notes

- In the white-background output, the subject's shape, structure, color, lighting, material, and composition must remain 100% identical to the subject in the original image
- **Keep the original composition by default**: only cut out the target subject and replace the surrounding background — do not re-center, re-crop, or reframe the subject unless the user explicitly requests centering
- **Do not complete a truncated subject**: if the subject is cropped/cut off at the image edge in the original, keep it exactly as-is — do NOT extend, fill in, or reconstruct the missing parts
- Product-attached elements (labels, tags, logos, text) are part of the product and must be preserved
- White-background editing prompt must never redraw or "beautify" the image. If the model changes the product, treat the result as failed and retry with a narrower/native approach.
- This scene only handles background replacement to pure white — for watermark removal, use the Watermark Removal scene
- **Dimensions follow the source**: preserve source proportions per SKILL.md Step 0.5 (auto → source `size` + closest `aspect_ratio`; non-auto → ONLY closest `aspect_ratio`), or use the user's value when specified. The prompt still follows this scene's template.
- **Single-operation constraint**: if the request includes 2 or more intents, platform/listing readiness, composition changes, lighting changes, or broad optimization language, use a merged edit or `true_sequential` plan only when required by SKILL.md Step 5 (Multi-Intent Execution Planner).