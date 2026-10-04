# Image Detail

## Routing Header

- **Load when**: user wants a pure close-up, zoom-in, or detail crop of visible product material, stitching, structure, logo, or craftsmanship.
- **Do not load when**: user wants marketing copy, callouts, leader lines, dimensions, annotations, or a selling-point layout.
- **Merge notes**: if the user wants a detail callout inside a marketing image, load Selling Point instead and do not generate a separate detail image unless the user requested separate outputs. **Not a platform set slot**: never plan a bare macro crop as one of a listing set's images — inside a set, shoot the close range within a real furnished scene and add labels or a hand (see `platform-product-guidelines.md` → **Scene layer richness** / **Supporting-slot enrichment mandate**).
- **Hard stop**: do not invent hidden details or add text/layout elements.

## Scene Description

Crop and enlarge a key area of the product from the original image to clearly show local details (material texture, craft details, functional structure, stitching, logos, etc.). Only content that already exists in the original image may be shown.

> **vs Selling Point Image**: Detail images are purely "local zoom-in" — no marketing copy, no layout design, no added visual elements. For feature highlights with copy, use Selling Point Image.

> **vs Tech Pack**: Detail images must NOT add any text, dimension annotations, leader lines, or craft notes. For zoom + annotations (production/OEM/technical specs), route to Tech Pack.

## Apply Method: Concatenate

Append the fixed constraint text after the user/Agent's detail description prompt.

## Prompt Template

### User/Agent Generated Part

Describe the area to zoom into. Example: "Zoom in on the zipper and stitching details"

### Fixed Constraint Text

```
A detail image is purely a local zoom-in based on the original product image — nothing more. Only crop and enlarge the existing detail area from the original image. Do NOT add any text, captions, typography, or layout design. Do NOT generate, add, or fabricate any visual elements that do not exist in the original image.
```

### Complete Prompt Structure

```
{User/Agent detail description} + {Fixed Constraint Text above}
```

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** scene — resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`).
- Dimensions (mandatory): follow SKILL.md Step 0.5 — in `auto_generation` pass the exact source `size` (measured pixel W×H) + closest `aspect_ratio`; in `simple`/`complex` fallback pass ONLY the closest `aspect_ratio`. Never let the tool default to a mismatched ratio/size when the source differs.

## Notes

- **Product consistency is the core requirement**: the detail image must stay consistent with the original — no distortion, color shift, or structural changes
- **No fabricated content**: only enlarge existing details from the original; never add textures, structures, labels, text, or elements not present in the original
- **No fabrication of occluded areas**: if the user wants to zoom into an area hidden by hands, packaging, or the product itself, inform them it's not visible and suggest a clearer reference image
- **No layout or copy**: detail images only zoom in — no marketing text, no visual design overlays
