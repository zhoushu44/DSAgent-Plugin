# Resolution Routing

## Routing Header

- **Load when**: the user specifies an output resolution (1K / 2K / explicit pixel target) — whether upscaling an existing image or generating from scratch at a target resolution. For from-scratch generation, use only the pixel-translation and per-mode parameter rules below; the scene routing still comes from the Scene Router.
- **Do not load when**: the request has no resolution intent (generic edit, background change, recolor, native compress/format only).
- **Depends on**: `SKILL.md` **Execution Mode Resolution** — that section owns the authoritative parameter-shape table (which parameters each mode accepts). This file only covers pixel translation and routing.

> **Current skill scope**: 1K and 2K resolution targets are supported. 4K is **not** supported; if the user asks for 4K, inform them only up to 2K is supported and offer 2K instead.

When the user specifies an output resolution, translate the shorthand into concrete pixel targets and pass them explicitly. Do **not** rely on tool defaults, which often fall back to 1024×1024.

## Common resolution shorthand

| Shorthand | Long-edge pixel target | Typical `size` / `resolution` value |
|-----------|------------------------|-------------------------------------|
| 1K | 1024 px | `1024x1024` (or match source aspect ratio, e.g. `1024x768`) |
| 2K | 2048 px | `2048x2048` (or match source aspect ratio, e.g. `2048x1536`) |

> For non-square images, keep the **long edge** at the target pixel value and compute the short edge from the source aspect ratio. Both dimensions must be rounded to multiples of 16. Do not stretch or crop the image to a square unless the user or platform explicitly requires it.

> **16-multiple rule**: when computing `size` for `auto`/`auto_generation`, the width and height must both be divisible by 16. Round the computed short edge to the nearest multiple of 16 (e.g. `1365` → `1360` or `1376`). Example: source `1920x1080`, target 2K → `size: "2048x1152"`.

> **Size area bounds**: the final `size` area (W × H) must stay within 655360–8294400 px². If a computed resolution target lands outside this range, clamp it proportionally and re-round to 16 per SKILL.md **Execution Mode Resolution → Size area bounds**. (2K on a normal aspect ratio is within range; this mainly guards extreme long/ultra-wide targets.)

> **Long-edge minimum (default only)**: when no size is specified, the derived `size` long edge must be at least **1024 px** — so 1K is the default lowest target requested from the AI tool (per SKILL.md **Execution Mode Resolution → Long-edge minimum**). This is a **default, not an override**: a size the user asked for, or a size mandated by a platform spec (e.g. `1000×1000`), takes precedence and is delivered exactly as specified — generate at the nearest tool-legal size on the same aspect ratio and native-resize down to the specified pixels when the exact value is not directly requestable.

## How to express the target per mode

The parameter shape (which fields each mode accepts, and which are forbidden) is defined once in `SKILL.md` **Execution Mode Resolution → parameter-shape table**. Resolve the mode there first, then express the resolution as follows:

- **`auto` / `auto_generation`** → pass concrete `size` (long edge = target px, short edge from source ratio, both multiples of 16).
- **`simple` / `simple_generation`** → pass the closest supported `aspect_ratio` (Auto-Match Table) + `resolution: "1K"` or `"2K"`. Do NOT pass raw pixel `size`.
- **`complex` / `complex_generation`** → same as simple. HD upscale is a standard scene and should prefer `auto`/`simple` when possible.

## Routing by request type

| Request | Action |
|---------|--------|
| "Make it clearer / sharpen" (no resolution specified) | Use the HD Upscale scene (standard mode, see `references/hd-upscale.md`) with source proportions. |
| "Generate at 1K / 2K" or explicit resolution from scratch | Use `image_generate` with the target `size`/`resolution` per the mode rules above. |
| Upscale an existing image to 1K / 2K | Use `image_edit` under the resolved standard mode; pass parameters per the mode rules above (see `references/hd-upscale.md`). Keep source proportions. |
| "4K" or higher | **Not supported**. Inform the user and offer 2K as the maximum. |

> **Why results become 1024×1024**: most image tools default to 1024×1024 when no explicit `size`/`resolution` is provided. Always pass the concrete target pixel dimensions or the `resolution` enum for resolution-changing requests.

## Pre-invocation check

Before calling the image tool for a 1K/2K request, confirm the constructed parameters match the mode resolved in `SKILL.md` **Execution Mode Resolution**. If they do not match that section's parameter-shape table, correct the parameter set before invoking the tool.
