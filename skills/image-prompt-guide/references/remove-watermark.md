# Watermark Removal

## Routing Header

- **Load when**: user asks to remove a watermark, website URL, contact information, QR code, accidental overlay, stain, dust, scanner mark, or non-product visual clutter.
- **Do not load when**: target is product/package text, product brand marks, same-language text replacement, full-image translation, or new marketing copy.
- **Merge notes**: small non-product clutter can often merge into one edit call (resolved mode) with background/listing cleanup. Dense watermarks may require a separate removal step.
- **Hard stop**: do not remove the product's own brand logo, packaging text, product labels, or specifications — preserve all product-related marks and text.

## Scene Description

Remove watermarks, website URLs, contact information, QR codes, accidental overlays, stains, dust, scanner marks, and other non-product visual clutter from the image, while preserving all product-related text and visual elements.

This scene is for non-product overlays only. It is not the default route for deleting specified product/package text.

## Route Boundary

| Request Type | Route |
|--------------|-------|
| Remove watermark, URL, QR code, contact info, accidental overlay, stain, dust, scanner mark, or non-product clutter | This Watermark Removal scene |
| Remove specified product/package text but keep the rest of the layout | Use Text Editing's local text removal flow (standard / dense-layout) |
| Replace text with new text | Text Editing |
| Translate all visible text | Image Translation |
| Remove text + change background / platform image / resize | Multi-step pipeline |

## Apply Method: Direct Apply

Agent should visually inspect whether the image has a clear product brand logo or poster text anywhere in the image so it can be preserved.

## Target Analysis (Dynamic Input)

Before applying the template, the Agent should combine the user's input with a visual inspection of the image (using the `read` tool) to produce a short description of the **location and type** of item to be removed — watermark, website URL, contact information, QR code, accidental overlay, stain, dust, scanner mark, or non-product visual clutter (e.g., "semi-transparent website URL watermark across the bottom-right corner; a QR code in the top-left"). This description is injected into the prompt template as the dynamic input `{targets_to_remove}`.

## Prompt Template

```
Remove only the {targets_to_remove} from the image. Preserve product-related text and any product brand logo or poster text that is visibly present in the ORIGINAL image. Keep the product shape, structure, color, lighting, material, composition, brand logos, and all non-target text/labels unchanged. Do not remove or alter any product labels, packaging text, specifications, brand marks that are part of the product, or non-target text.
```

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** scene — express the removal in the prompt and resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`).
- Dimensions (mandatory): follow SKILL.md Step 0.5 — in `auto_generation` pass the exact source `size` (measured pixel W×H) + closest `aspect_ratio`; in `simple`/`complex` fallback pass ONLY the closest `aspect_ratio`. Never let the tool default to a mismatched ratio/size when the source differs.

## Pre-execution Guidance

Before calling the tool, the Agent should:
1. Assess watermark complexity (simple corner watermark vs. dense/full-image overlay)
2. For dense/complex watermarks, proactively inform the user: "The AI watermark removal may have limited effectiveness on complex watermarks. I'll attempt it, but the result may need manual refinement."
3. After execution, if the result is poor (text garbled, watermark partially remaining), suggest the user try a dedicated watermark removal tool

## Notes

- Product-related text (product name, specifications, etc.) must be preserved
- Only remove watermarks, URLs, contact info, QR codes, accidental overlays, stains, dust, scanner marks, and other non-product visual clutter
- Do not use this scene for product/package text removal or product brand removal
- **Dimensions follow the source**: preserve source proportions per SKILL.md Step 0.5 (auto → source `size` + closest `aspect_ratio`; non-auto → ONLY closest `aspect_ratio`), or use the user's value when specified. Prompt still follows this scene's template.
- **Single-operation constraint**: if the request includes 2 or more intents, platform/listing readiness, composition changes, lighting changes, or broad optimization language, use a merged edit or `true_sequential` plan only when required by SKILL.md Step 5 (Multi-Intent Execution Planner).