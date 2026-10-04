# Tech Pack

## Routing Header

- **Load when**: user explicitly asks for tech pack, dimension drawing, production/OEM spec sheet, manufacturing process diagram, assembly diagram, exploded view, or BOM.
- **Do not load when**: user wants e-commerce selling-point specs, marketing callouts, or a visual feature infographic; load Selling Point instead.
- **Merge notes**: each requested tech-pack drawing type is a separate output image, but do not split one drawing into multiple AI calls unless the tool fails. Compliance analysis is text output and should not consume an image call.
- **Hard stop**: do not invent exact dimensions, materials, grades, certifications, tolerances, or compliance status unless provided by the user or visible/verifiable from the source.

## Scene Description

Generate production-grade tech packs from existing product images, including orthographic multi-view annotations, manufacturing process diagrams, and assembly exploded views, supplemented with compliance/safety analysis (text output). Designed for cross-border e-commerce sellers and OEM pre-production technical briefings.

Core principle: **Product appearance fidelity** — shape, color, and texture must remain consistent with the source. Only annotations, dimension lines, and craft notes may be added.

> **Trigger**: Only triggered when the user explicitly requests a tech pack / dimension drawing / spec sheet / manufacturing diagram / assembly diagram. Normal product design or image generation requests do not route here.

> **vs Image Detail**: Tech Pack requires dense technical annotations (dimensions, materials, craft). For purely zoomed-in views without any text annotations → route to Image Detail.

> **vs Selling Point Layout ③**: Tech Pack is for **production / OEM / technical specs** (multi-view drawings, exploded views, BOM). Selling Point Layout ③ Spec Infographic is for **e-commerce marketing display** (only used when user provides specific numeric values). For marketing use → route to Selling Point Image Layout ③.

## Workflow (On-Demand Progression)

Based on user request scope, output different drawing combinations:

| User Request | Output |
|-------------|--------|
| "tech pack" / "dimension drawing" / "spec sheet" | Multi-view drawing (1 combined image) + informational compliance analysis (text), unless the user asks for image output only |
| + "manufacturing" / "process" | Add: manufacturing process diagram (separate image) |
| + "assembly" / "exploded" / "BOM" | Add: assembly exploded view (separate image) |

**Execution order**: Multi-view → Manufacturing (if needed) → Assembly (if needed) → compliance analysis when requested or useful for the brief

## Prompt Templates

### Drawing 1: Multi-View (Always Required)

One combined image with Front + Side + Top/Back views.

```
Create a tech pack for this [PRODUCT].

【SUBJECT PRESERVATION】
Keep product appearance consistent with the source — do NOT intentionally change shape, color, or texture. Only ADD annotations.

【LAYOUT】
ONE image with 3+ views: Front, Side, Top/Back on white background.

【ANNOTATIONS PER VIEW】
- Dimensions: use user-provided values with units; if missing, label as "estimate" or leave placeholders rather than inventing exact values
- Materials: use user-provided or visibly identifiable material only; otherwise label "material TBD"
- Surface finish: use visible or user-provided finish only; otherwise label "finish TBD"

【STYLE】
Technical drawing, thin outlines, title block with Product Name + Scale.
```

### Drawing 2: Manufacturing Process Diagram (On-Demand)

Separate image showing production flow and craft details.

```
Create a manufacturing process diagram for this [PRODUCT].

【SUBJECT PRESERVATION】
Keep product appearance consistent with the source. Only ADD process flow, callouts, and annotations around it.

【LAYOUT】
Main product in center with numbered process steps around it (①②③...).

【CONTENT】
- Process Flow: Raw Material → Step 1 → Step 2 → ... → Finished
- Material specs at each stage only when provided or visibly identifiable
- Zoom callouts for critical craft (welding, stitching, molding)
- Tolerances and quality inspection points only when provided; otherwise label as "TBD by manufacturer"

【STYLE】
Technical illustration, numbered callouts, arrows showing sequence.
```

### Drawing 3: Assembly Exploded View (On-Demand)

Separate image showing parts breakdown and assembly relationships.

```
Create an assembly diagram for this [PRODUCT].

【SUBJECT PRESERVATION】
Keep each component's appearance consistent with the source. Only SEPARATE components along axis to show assembly relationship.

【LAYOUT】
Exploded view with components separated along axis.
- Part numbers (①②③...) next to each component
- Dashed assembly lines connecting mating parts
- BOM table in corner

【BOM FORMAT】
| # | Part | Material/TBD | Qty |

【DETAIL CALLOUTS】
- Zoom into connection points (screws, snap fits, adhesive)
- Show fastener types and sizes only if visible or user-provided; otherwise mark as TBD

【STYLE】
Isometric view, consistent spacing between exploded parts.
```

### Fixed Constraint Text (Shared Across All Drawings)

Append to every prompt:

```
Keep the product appearance consistent with the source image — do NOT intentionally alter shape, color, or texture. Only ADD technical annotations, dimension lines, and callout labels.
```

## Compliance & Safety Analysis (Text Output, When Useful)

Based on product type and target market, provide informational text analysis covering:
- **Potentially applicable regulations**: likely regulations for the target market
- **Certification considerations**: required/recommended certifications to verify
- **Material compliance considerations**: restricted substances and testing requirements to verify
- **Labeling considerations**: origin, composition, warning labels to verify

### Product Type Quick Reference

| Product Type | Key Standards |
|-------------|--------------|
| Electronics | FCC, CE, UL, RoHS |
| Toys / Children's Products | CPSIA, ASTM F963, EN 71 |
| Food Contact | FDA 21 CFR, EU 1935/2004 |
| Textiles / Apparel | Flammability, OEKO-TEX |
| Furniture | BIFMA, CA TB 117 |

### Dimension Reference

Use these only as rough sanity-check ranges. Do not convert them into exact product dimensions unless the user confirms them.

| Product | Typical Dimensions |
|---------|-------------------|
| Mug/Cup | H: 8–12cm, Ø: 7–10cm |
| Backpack | H: 40–50cm × W: 28–35cm × D: 12–18cm |
| Tote Bag | H: 35–45cm × W: 30–40cm |
| Candle/Aroma Lamp | H: 15–30cm, Ø: 8–15cm |
| Desk Lamp | H: 30–50cm, Base Ø: 12–20cm |

## Tool Invocation

| Drawing Type | Tool | Mode class |
|-------------|------|-----------|
| Multi-view | `image_edit` | dense-layout |
| Manufacturing process | `image_edit` | dense-layout |
| Assembly exploded view | `image_edit` | dense-layout |

> Tech Pack drawings contain multi-views + dense annotations, so they are **dense-layout** scenes. Resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `complex_generation`). Product fidelity remains required.
> **Dimensions**: follow SKILL.md Step 0.5 — in `auto_generation` pass the source `size` + closest `aspect_ratio`; otherwise pass the closest `aspect_ratio`.

## Notes

- **Product consistency is the core requirement**: shape, color, and texture must stay consistent with the original; only annotations and guide lines may be added
- **Multi-view must be a single combined image**: Front + Side + Top/Back in one image — not separate outputs
- **Manufacturing and assembly drawings must be separate**: do not merge with the multi-view image
- **Units are mandatory**: all provided or estimated dimension annotations must include units (cm / mm / inch)
- **Assembly drawings must include BOM**: part number, name, material, quantity
- **Prerequisite**: user must have a product image. If none is provided, ask the user to upload one first
- **Annotate only — no redesign**: never alter product design in the tech pack flow; only add technical annotations to existing images
- **Compliance analysis is informational**: include it unless the user asks only for image output, and label uncertain items as verification needed
