# Text Editing

## Routing Header

- **Load when**: user asks to replace, fix, update, or remove specific visible text in-place while preserving the rest of the image.
- **Do not load when**: user asks to translate all visible text into another language, remove ownership watermarks, or add new marketing copy/layout.
- **Merge notes**: local text removal/replacement may merge with other same-output product-fidelity edits only when the target text is precise and the merged prompt can preserve all other text. For multiple difficult text regions, consider dense-layout.
- **Hard stop**: replacement text must come from the user. At least one of original text or location must be provided or visually unambiguous.

## Scene Description

Precisely replace/modify **specified text** in the original image. Everything except the targeted text — background, product, other text, layout, lighting — must remain unchanged. The replacement text should match the original in font, weight, size, color, kerning, and any applied effects (perspective, curvature, shadow, etc.) as closely as the tool allows.

> **Hard constraints**:
> - **Only modifies text content itself** — no font style changes, no layout repositioning, no other element modifications.
> - **Minimum input**: user must provide at least one of `<original_text>` (text to replace) or `<location>` (where in the image). `<new_text>` (replacement) must always come from the user — Agent must never infer it.
> - **vs Image Translation**: Translation converts ALL visible text to another language. Text Editing replaces only the USER-SPECIFIED text, which can be same-language (typo fix, price update, date change).
> - **vs Selling Point Image**: Selling Point adds NEW marketing copy + layout. Text Editing only replaces existing text in-place.
> - **vs Watermark Removal**: Watermark Removal removes ownership/contact/platform overlays. Text Editing handles user-specified product/package text replacement and local text removal.
> - **Local text removal**: If the user asks to delete specified product/package text without replacement, use the local text removal template below rather than Watermark Removal, unless the target is clearly an ownership watermark/URL/contact overlay.

## Apply Method: Concatenate

Agent assembles the prompt from the user's three-element specification, then concatenates with fixed constraints.

## Prompt Template

### Required Three Elements

| Element | Description | Example |
|---------|-------------|---------|
| `<original_text>` | Text in the image to be replaced (wrap in quotes) | `"SALE 50%"` |
| `<new_text>` | Replacement text (wrap in quotes) | `"SALE 70%"` |
| `<location>` | Position in the image (describe location + visual anchor) | `inside the red label at the top-right corner` |

### Complete Prompt Template

```
Replace only the text "<original_text>" located at <location> in the original image with "<new_text>". Keep all other elements completely unchanged.
Strictly follow these rules:
## Font Consistency:
- The new text should match the original text's font, weight (bold/regular/italic), size, color, kerning, and line spacing as closely as the tool allows.
- Match any perspective distortion, curvature, shadow, stroke, 3D effect, texture, or gradient applied to the original text as closely as possible.
- If the original text has lighting/reflection/wear/print texture, the new text must preserve the same quality.
## Position and Layout Preservation:
- The new text must occupy the exact same position and layout alignment (left/center/right) as the original.
- Do not move, scale, or rotate the text area.
- If the new text differs in length, adjust kerning within the original text's visual boundary — do NOT exceed the original text area.
## Original Image Fidelity:
- Preserve the original image's background, product, composition, all other text, decorative elements, and lighting effects without any modification.
- Do not modify any pixels outside the target text area.
- Do not cause any redrawing, style drift, or quality degradation due to the text replacement.
## Seamless Integration:
- The new text must blend naturally with the background — no visible seams, color blocks, or aliasing artifacts.
- Shadow, reflection, and perspective must be consistent with the original image's light source direction.
- No garbled text, spelling errors, or typos allowed.
```

### Example

User: "Change the 50% in the red SALE label at the top-right to 70%"

Filled prompt:

```
Replace only the text "50%" located at inside the red SALE label at the top-right corner in the original image with "70%". Keep all other elements completely unchanged.
Strictly follow these rules:
## Font Consistency:
- The new text should closely match the original text's font, weight...
...(full constraint text as above)
```

## Local Text Removal

Use this when the user asks to remove/delete a specific visible text string or label from a product/package image without replacement, and the target is not a third-party watermark or ownership mark.

Required input:
- `<target_text>` or a precise `<location>`; ask if neither is provided and multiple text regions exist.

Prompt template:

```
Remove only the specified text "<target_text>" located at <location>.
Reconstruct the underlying background/material naturally within that exact text area.
Keep every other element completely unchanged, including all other text, product labels, logos, packaging layout, product structure, colors, materials, background, lighting, and camera angle.
Do not remove or modify any unspecified text. Do not redraw the product. Do not change the layout.
```

Tool:
- `image_edit`
- Mode: **standard** for one local text region; **dense-layout** for multiple selected regions or difficult perspective/curved text. (Mode resolved once in the Tool Invocation section below.)

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** (default, single region) / **dense-layout** (multiple text regions or complex perspective/lighting) — resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`).
- Dimensions (mandatory): follow SKILL.md Step 0.5 — in `auto_generation` pass the exact source `size` (measured pixel W×H) + closest `aspect_ratio`; in `simple`/`complex` fallback pass ONLY the closest `aspect_ratio`. Never let the tool default to a mismatched ratio/size when the source differs.
- Input: 1 original image + user's three-element specification

## Handling Missing Elements

### General Rules

- `<new_text>` **must always be provided by the user**. If missing, ask directly. Never infer.
- `<original_text>` and `<location>` — **at least one must come from the user**. The Agent infers the other via visual recognition. If both are missing, enter the "dual-missing" flow.

### Single Element Missing

| Missing | Action |
|---------|--------|
| Only `<original_text>` missing (user gave location) | Agent visually identifies text at the specified location. If multiple text segments exist at that location → ask the user to choose. |
| Only `<location>` missing (user gave original text) | Agent visually locates the text in the image. If the same text appears at ≥2 locations → enter "multiple-match" flow below. |
| `<new_text>` missing | Ask the user for the replacement copy — never infer it. Ask it **in the same message** as any pending region choice, not as a follow-up round. |

> **One ask, not a chain** (`SKILL.md` → Step 3): when both the target region and the replacement text are open, request them in a **single** interaction — list the detected regions as selectable options and ask for the new copy in the same message. Never resolve the region first and come back for the copy. Font, size, colour, weight, and alignment are always inferred from the source, never asked.

### Multiple-Match Flow

When the user's `<original_text>` matches ≥2 locations in the image:

1. Agent lists all matched locations with position descriptions
2. Ask the user to select which location(s) to modify; use a multi-select prompt if the host supports it
3. For multiple selected locations, list each position explicitly in the prompt (never use "all occurrences")
4. Multiple locations selected → treat as **dense-layout**

### Dual-Missing Flow (both `<original_text>` and `<location>` missing)

1. Agent visually scans the image and lists all editable text regions
2. If only one text region exists → use it directly, no clarification needed
3. If multiple regions exist → ask the user to select the target
4. After selection, proceed with the standard three-element prompt

## Notes

- **Precision targeting**: only modify the user-specified text. Never "helpfully" fix other text
- **Style consistency is a hard requirement**: font, weight, size, color, and all effects should closely match the original
- **Position unchanged**: new text occupies the original text's exact position
- **Cross-language edits → use Image Translation**: if the user wants to translate text to another language, route to Image Translation instead
- **Adding new text → use Selling Point Image**: if the user wants to add new marketing copy/text that doesn't exist in the original, route to Selling Point Image
- **Deleting specified product/package text without replacement → use Local Text Removal above**
- **Deleting ownership watermark/URL/contact/platform mark → use Watermark Removal**
- **Complex perspective/lighting**: when the original text has strong perspective, curved surface adherence, or 3D effects, treat as **dense-layout**
