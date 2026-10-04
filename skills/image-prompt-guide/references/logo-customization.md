# Logo Customization

## Routing Header

- **Load when**: user has an existing logo or logo reference and wants it applied, printed, engraved, embossed, embroidered, stamped, or mocked up on a product.
- **Do not load when**: user asks to design a brand-new logo from scratch; load Logo Design instead.
- **Merge notes**: logo application can usually merge with listing-hero cleanup, white/light background, scene styling, and product-fidelity constraints in one merged edit call (resolved mode).
- **Hard stop**: require both a product image and logo reference before compositing. Do not invent a logo.

## Scene Description

Composite the user's Logo image onto a product photo using a specified craft technique, placed at a contextually appropriate position for the craft type and product category. The Logo itself must remain strictly unchanged — preserve its original design, colors, proportions, typography, and details exactly as provided.

## Apply Method: Concatenate

Select a craft technique (craft_prompt), then concatenate with the fixed compositing prompt.

## Prompt Template

### Step 1: Select Craft Technique (craft_prompt)

Choose one from the following list:

- Laser Engraving
- Screen Printing
- Heat Transfer
- Laser Printing
- Sticker / Transfer Decal
- Hot Stamping / Foil Stamping
- UV Printing
- Digital Printing
- Embroidery
- 3D Printing
- Embossing / Debossing
- Inkjet Printing
- Standard / Color Printing
- Single-color / Dual-color Printing

### Step 2: Identify Inputs

Before building the prompt, identify the two required inputs:
- **`<product_image>`** — the product photo onto which the logo will be applied.
- **`<logo_image>`** — the logo image to composite onto the product.

If the user uploaded more than two images, determine each image's role visually (which is the product, which is the logo artwork) and state the assignment in the reply; ask only when the roles stay genuinely unreadable. If only one image is uploaded and it already contains both the product and the logo, treat that single image as `<product_image>` and ask for a separate logo file if the logo needs to be preserved at higher fidelity.

### Step 3: Build Complete Prompt

```
Composite the entire Logo from <logo_image> onto the main product in <product_image>, applying "{craft_prompt}" technique, and place it at a position appropriate for this craft type and the product category. Remove only the background and edges around the Logo, retaining the Logo itself for a clean, transparent blend. CRITICAL: The Logo must remain strictly unchanged — do not redraw, re-interpret, simplify, or alter its design, colors, proportions, typography, or details in any way. IMPORTANT: Keep the product in <product_image> unchanged — shape, color, texture, and details must remain consistent with the original.
```

Replace `{craft_prompt}` with the selected craft technique name, and replace `<product_image>` / `<logo_image>` with the actual identified images.

### Example

If "Hot Stamping / Foil Stamping" is selected and the product image is the first upload while the logo image is the second:

```
Composite the entire Logo from [second uploaded image] onto the main product in [first uploaded image], applying "Hot Stamping / Foil Stamping" technique, and place it at a position appropriate for this craft type and the product category. Remove only the background and edges around the Logo, retaining the Logo itself for a clean, transparent blend. CRITICAL: The Logo must remain strictly unchanged — do not redraw, re-interpret, simplify, or alter its design, colors, proportions, typography, or details in any way. IMPORTANT: Keep the product in [first uploaded image] unchanged — shape, color, texture, and details must remain consistent with the original.
```

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** scene — resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`).
- Dimensions (mandatory): follow SKILL.md Step 0.5 — in `auto_generation` pass the exact source `size` (measured pixel W×H of the product image) + closest `aspect_ratio`; in `simple`/`complex` fallback pass ONLY the closest `aspect_ratio`. Never let the tool default to a mismatched ratio/size.
- Input: Two images — Image 1 (product photo) and Image 2 (Logo image)

## Notes

- Craft technique should be specified by the user or recommended based on product category
- Logo background and edges must be removed for clean integration; the Logo design itself must not be altered
- Placement position must be appropriate for the selected craft and product type
- The Logo must remain strictly unchanged — exact design, colors, proportions, typography, and details
- The product in Image 1 must remain completely unchanged
