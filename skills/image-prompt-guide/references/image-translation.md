# Image Translation

## Routing Header

- **Load when**: user asks to translate visible image text into another language and expects the image itself to be updated.
- **Do not load when**: user asks to replace only specific same-language text, fix a typo, update a price/date, or add new marketing copy.
- **Merge notes**: translation is usually one `image_edit` call for the full image. Do not split by text region unless tool limitations require it.
- **Hard stop**: never answer with text translation only when the user requested an edited image. When the target language is not stated, derive it in this order — the target platform's **Default In-Image Language** (`references/platform-product-guidelines.md`) → the target market named in the request → the language the user is writing in — and state the resolved language. Ask only when none of the three yields an answer.

## Scene Description

Translate all visible text in the image into the target language and replace the original text directly on the image, producing a translated version that is visually identical to the original except for the text language.

> **Mandatory constraint**: This scene must call `image_edit` to produce a translated image once the target language and source image are available. Do not output translations as text only or ask whether the user wants an image output.

## Apply Method: Direct Apply

Use the prompt template below, replacing `<target_lang>` with the user's specified target language.

## Prompt Template

```
Translate all visible text in the provided image into <target_lang>, and replace all original text with the translated text. The final result must be visually indistinguishable from the original image except for the language change.
Strictly follow these rules:
## Font Matching:
- Match the original text's font, weight, size, color, and kerning as closely as the tool allows.
- Match any perspective distortion, curvature, or warping effects applied to the original characters as closely as possible.
## Background Integrity:
- Preserve the original image background without any changes.
- Do not alter the product or scene's shape, structure, or composition.
## Seamless Integration:
- Ensure the new text blends naturally with the background. No visible edges, cut marks, or color block differences.
- Simulate realistic lighting effects: the new text must cast/receive shadows consistent with the scene's light source.
## Content Accuracy:
- Translations must be grammatically correct and contextually appropriate.
- Do not modify any text outside the target areas.
- No garbled text, spelling errors, or typos allowed.
```

Replace `<target_lang>` with the user's specified target language (e.g., English, Japanese, Korean, Spanish, etc.).

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** scene — resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`).
- Dimensions (mandatory): follow SKILL.md Step 0.5 — in `auto_generation` pass the exact source `size` (measured pixel W×H) + closest `aspect_ratio`; in `simple`/`complex` fallback pass ONLY the closest `aspect_ratio`. Never let the tool default to a mismatched ratio/size when the source differs.

> **Execution mandatory rule**: After matching this scene and confirming required inputs, call `image_edit`. The following behaviors are not acceptable:
> 1. Extracting text and outputting translation as text only
> 2. Outputting text translation first, then asking if the user wants an image
> 3. Skipping the tool call and replying with translated text in any form

## Notes

- **Output must be a translated image when image editing is requested** — do not substitute a text-only translation
- The target language must be specified by the user
- Font, weight, size, color, and kerning should closely match the original
- Background must not be altered in any way
- Lighting effects must be consistent with the scene
- Translations must be grammatically correct and contextually appropriate
- Do not modify text outside the target areas
