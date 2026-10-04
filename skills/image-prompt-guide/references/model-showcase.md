# Model Showcase

## Routing Header

- **Load when**: user wants a model wearing, holding, or naturally demonstrating the product while preserving the original product photo background.
- **Do not load when**: user asks for model plus a new lifestyle/background scene or marketing copy only; load Scene Image or Selling Point as the primary scene.
- **Platform set slots**: when a listing-set slot needs a person or hands **inside a new furnished room**, this file supplies the human-subject wording but `scene-image.md` owns the environment, and the quota, interaction level (hands / partial body / full body), persona lock, and staging fields come from `platform-product-guidelines.md` → **Human presence quota**. Human presence there is mandatory by quota, not optional.
- **Hard stop**: do not change product identity, product proportions, or introduce unrelated scene elements in the pure Model Showcase flow.

## Scene Description

Generate a high-quality e-commerce model showcase image from the product photo, with a model naturally demonstrating the product's wear or usage effect. Select one of three variants based on the user input:

- **Variant A** — a reference model photo is provided.
- **Variant B** — the model type is specified in text.
- **Variant C** — neither a reference model photo nor a model type is provided.

**Constraints & routing**:

- This scene preserves the original product image background as closely as possible.
- If the user also wants to **change the background** (outdoor, street, home scene) → route to **Scene Image** and include the model elements in that prompt.
- If the user wants **selling-point copy / layout / callouts** → route to **Selling Point Image** layout ④ (lifestyle).
- Use this scene only when the user **just wants to add a model** without a background change or marketing copy.

## Apply Method: Direct Apply

Select the variant based on priority: A (has reference model photo) > B (specified model type) > C (neither).

## Prompt Templates

**Subject identification (run first)**: Before filling a template, use the `read` tool to inspect the image(s) and identify the product subject — the item the model will showcase. Convert it into the simplest generic noun or category name (e.g., "backpack", "sneaker", "dress", "watch") — do NOT include brand, model number, or professional/technical jargon. If multiple images are provided (e.g., product photo plus model photo), analyze the instruction together with the image content to determine which item is most likely the product subject. When the subject comes from a specific image among several, state which image it is from and what it is (e.g., "the backpack in image 1", "the watch in image 2"). If the user explicitly specifies a subject, use it as the subject. If the subject cannot be identified clearly, you MUST confirm the intended subject with the user before proceeding — but multiple uploads alone are never a reason to ask: resolve the roles visually first and state the assignment.

**Model showcase design (run second)**: Combining the identified subject with the user's instruction, compose one model showcase description and assemble it into the `<model_showcase>` slot in the template below. Decide: (1) the model source — use the uploaded model reference photo if provided (Variant A), the user-specified model type if given (Variant B), or auto-select a model appearance appropriate to the product category otherwise (Variant C, e.g., adult model for apparel, parent/infant for baby products); (2) the display form — full-body model, or only the relevant body part appearing (e.g., hand/wrist for a watch, feet for shoes); (3) the model's characteristics (age, gender, ethnicity). Describe accurately and clearly how the model is edited into the input image so it naturally demonstrates the product's wear or usage effect.

### Variant A — User uploaded a model reference photo

User provides both a product photo and a model photo:

```
Based on the uploaded product image of the <subject> and the model image, generate a high-quality e-commerce model showcase image:

## Requirements:
- <model_showcase>
- Preserve the original product image background as closely as possible.
- The <subject>'s shape, structure, color, lighting, material, and details must remain consistent with the original image.
- The model should naturally showcase the product, making the product the visual focus and demonstrating wear or usage effect.
- Product and model proportions must be harmonious and realistic, with no unnatural scale mismatch.
```

### Variant B — No model photo, but model type specified

User provides only a product photo and describes the desired model type (e.g., "Asian female model, mid-20s"):

```
Based on the uploaded product image of the <subject>, generate a high-quality e-commerce model showcase image:

## Requirements:
- <model_showcase>
- Preserve the original product image background as closely as possible.
- The <subject>'s shape, structure, color, lighting, material, and details must remain consistent with the original image.
- The model should naturally showcase the product, making the product the visual focus and demonstrating wear or usage effect.
- Product and model proportions must be harmonious and realistic, with no unnatural scale mismatch.
```

### Variant C — No model photo, no model type specified

User provides only a product photo without model preferences:

```
Based on the uploaded product image of the <subject>, generate a high-quality e-commerce model showcase image:

## Requirements:
- <model_showcase>
- Preserve the original product image background as closely as possible.
- The <subject>'s shape, structure, color, lighting, material, and details must remain consistent with the original image.
- The model should naturally showcase the product, making the product the visual focus and demonstrating wear or usage effect.
- Product and model proportions must be harmonious and realistic, with no unnatural scale mismatch.
```

Replace `<model_showcase>` with the model showcase description composed in the run-second step (display form + model characteristics + how the model is edited into the input image).

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** scene — resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`).
- Dimensions (mandatory): follow SKILL.md Step 0.5 — in `auto_generation` pass the exact source `size` (measured pixel W×H) + closest `aspect_ratio`; in `simple`/`complex` fallback pass ONLY the closest `aspect_ratio`. Never let the tool default to a mismatched ratio/size when the source differs.

## Notes

- **Variant priority**: A (has reference model photo) > B (specified model type) > C (neither).
- **Product fidelity**: the subject's shape, structure, color, lighting, material, and details must remain consistent with the original image.
- **Background preservation**: preserve the original product image background as closely as possible; do not introduce new scene elements, outdoor environments, or re-create the lighting atmosphere. For background changes use Scene Image; for marketing copy use Selling Point Image layout ④.
- **Showcase method**: match the model's action to the product category (wearing, carrying, using, etc.), as composed in the run-second step.
- **Non-wearable categories**: for appliances, home devices, and tools the human layer is an **interaction**, not a wear shot — hands operating/removing/refilling a part, or a partial-body person kneeling or seated beside the product. State which hand touches which part, the gaze, five correct fingers, and that the person must not cover the product's key structural features.