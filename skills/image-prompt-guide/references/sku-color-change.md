# SKU Color Change

## Routing Header

- **Load when**: user asks to change product body color, recolor a product, create visible SKU color variants from a reference, or swap only the product's color.
- **Do not load when**: user asks to change background color, scene color, lighting color temperature, or packaging/text colors.
- **Merge notes**: product recolor can merge with a background/scene change in one merged edit call (resolved mode) for a single output image. Generate one output per requested SKU variant.
- **Hard stop**: do not change silhouette, texture structure, style, accessories, labels, lighting behavior, or non-target colors.

## Scene Description

Recolor the product body while strictly preserving the original style, silhouette, texture structure, and lighting effects for a natural, realistic color swap.

> **Hard constraint**: This scene ONLY changes the **product body color**. It does not change background color, accessory colors, or ambient light color temperature.
> - "Change the background color to blue" → route to **Scene Image** (background swap)
> - "Change the product color to blue" → this scene
> - "Change product color + change background" → multi-intent; load SKU Color Change + Scene Image, then use the Step 5 (Multi-Intent) planner. Prefer one merged edit call (resolved mode) for a single output unless the edit requires dense layout or separate outputs.

## Apply Method: Concatenate

Append the fixed constraint text after the user/Agent's color description prompt.

## Prompt Template

### User/Agent Generated Part

Describe the target color, e.g.: "Change the product color to navy blue" or "Recolor the handbag to burgundy red"

### Fixed Constraint Text

```
Preserve the original style, silhouette, texture structure, and lighting behavior. The color replacement must be natural and realistic, avoiding inconsistent color shifts or lighting artifacts. Preserve all non-subject details in the image (background, accessories, material reflections, etc.). IMPORTANT: Only the product body color may change — keep everything else visually consistent with the original.
```

### Complete Prompt Structure

```
{User/Agent color description} Preserve the original style, silhouette, texture structure, and lighting behavior. The color replacement must be natural and realistic, avoiding inconsistent color shifts or lighting artifacts. Preserve all non-subject details in the image (background, accessories, material reflections, etc.). IMPORTANT: Only the product body color may change — keep everything else visually consistent with the original.
```

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** scene — resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`).
- Dimensions (mandatory): follow SKILL.md Step 0.5 — in `auto_generation` pass the exact source `size` (measured pixel W×H) + closest `aspect_ratio`; in `simple`/`complex` fallback pass ONLY the closest `aspect_ratio`. Never let the tool default to a mismatched ratio/size when the source differs.

## Notes

- Style, silhouette, and texture structure must remain consistent with the original
- Lighting effects must match the original — no color shift or lighting artifacts
- Background, accessories, material reflections, and other non-subject details must be fully preserved
