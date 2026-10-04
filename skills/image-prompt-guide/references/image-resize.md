# Image Resize

## Routing Header

- **Load when**: user asks to resize, rescale, or change the pixel dimensions / aspect ratio of an existing image, and the request is limited to size change only.
- **Do not load when**: user wants content changes (background, color, objects, text, style, enhancement), cropping, compression, format conversion, file-size-only changes, or a platform image-set final delivery resize (those remain native).
- **Merge notes**: do not merge with content-changing scenes in the same `image_edit` call. Image Resize is a single-operation, resolution-changing task with deterministic dimension parameters.
- **Hard stop**: do not alter image content, composition, colors, text, or visual elements beyond what is necessary to fit the new dimensions.

## Scene Description

Resize the source image to the requested pixel dimensions or aspect ratio using `image_edit` while keeping the background and main subject completely unchanged.

> **Hard constraint**: This scene only changes the output dimensions. It does not enhance quality, replace backgrounds, remove objects, edit text, or change visual style. The background and subject must remain identical except for the scaling/fitting operation itself.

## Supported User Inputs

| User says | Interpretation |
|-----------|----------------|
| `1024x768`, `1024*768`, `1024 by 768`, `width 1024 height 768` | Exact target pixel dimensions |
| `16:9`, `4:3`, `1:1`, `aspect ratio 16:9` | Target aspect ratio only |
| `width 800px`, `make it 800px wide` | Scale width, keep source aspect ratio |
| `height 1200px`, `make it 1200px tall` | Scale height, keep source aspect ratio |
| `square`, `make it square` | Target ratio `1:1` |

If the request contains no usable numbers, derive the target from the platform spec, the image-set slot, or a size already agreed earlier in the session. Ask only when none of those yields a number.

## Target Dimension Computation

Before calling `image_edit`, measure the source image and compute the final output size.

1. Record source dimensions `src_w` × `src_h`.
2. The final width and height must both be **multiples of 16**.
3. Use:

```python
def round16(x):
    return max(16, round(x / 16) * 16)
```

4. A **user-requested** size is the deliverable and is never rounded up to the 1024 long-edge default — that floor only applies to sizes the skill derives on its own (SKILL.md **Execution Mode Resolution → Long-edge minimum**). Only the tool's hard limits (**Size area bounds**, multiple-of-16 edges) can change what you request: when the user's target violates one of them, ask the AI tool for the nearest legal size on the same aspect ratio, then downscale to the requested pixels with a native resize and report both numbers.

### Explicit pixel dimensions (WxH)

```python
out_w = round16(target_w)
out_h = round16(target_h)
```

### Aspect ratio only (W:H)

Keep the output area close to the source image area.

```python
r = target_w / target_h
src_area = src_w * src_h
h_float = (src_area / r) ** 0.5
w_float = h_float * r
out_w = round16(w_float)
out_h = round16(h_float)
```

Example: a 2048×1024 source resized to `4:3` yields roughly 1669×1252, which rounds to `1664×1248`.

### One side specified

Preserve the source aspect ratio (`src_r = src_w / src_h`) and scale the missing side.

- Width specified:
  ```python
  out_w = round16(target_w)
  out_h = round16(out_w / src_r)
  ```

- Height specified:
  ```python
  out_h = round16(target_h)
  out_w = round16(out_h * src_r)
  ```

### Square output (`1:1`)

```python
side = round16((src_w * src_h) ** 0.5)
out_w = out_h = side
```

## Preservation Constraint

Image Resize must keep the **main subject** completely unchanged and at the same proportion within the image as in the original. The **background** should also be preserved as much as possible; when the target aspect ratio differs from the source ratio (and the difference is not just 16-multiple rounding), achieve the target ratio by either cropping the background or seamlessly extending the background. No element may be redrawn, added, recolored, relit, repositioned, stretched, or compressed.

Rules when the target ratio differs from the source:
- Do not stretch or distort the subject or background.
- Keep the subject at the same scale and occupy the same proportion of the image as in the original.
- Prefer cropping background edges or extending the background to fill the new canvas; do not alter the subject.

## Apply Method: Direct Apply

Use the prompt template below. The prompt explicitly states the target dimensions and the strict preservation requirement. Do not add creative scene, layout, or content-changing instructions.

### Prompt Template — Exact pixel dimensions

```
Resize this image to exactly {out_w}×{out_h} pixels.
CRITICAL: Keep the main subject completely unchanged — same scale, same position, same proportion within the image as in the original. Preserve every visual element, composition, color, texture, text, label, shadow, and detail exactly as in the original.
If the target aspect ratio differs from the original, crop or extend the background as needed to match the target ratio. Do not stretch, compress, redraw, add, or remove the subject or any background element.
Do not introduce new backgrounds, objects, shadows, lighting, or effects.
```

### Prompt Template — Aspect ratio only

```
Resize this image to a {target_ratio} aspect ratio at {out_w}×{out_h} pixels, keeping the total image area close to the original.
CRITICAL: Keep the main subject completely unchanged — same scale, same position, same proportion within the image as in the original. Preserve every visual element, composition, color, texture, text, label, shadow, and detail exactly as in the original.
If the target aspect ratio differs from the original, crop or extend the background as needed to match the target ratio. Do not stretch, compress, redraw, add, or remove the subject or any background element.
Do not introduce new backgrounds, objects, shadows, lighting, or effects.
```

## Tool Invocation

- Tool: `image_edit`
- Mode: **standard** scene — express the resize operation in the prompt and resolve the `task_type` via SKILL.md **Execution Mode Resolution** (prefer `auto_generation`; otherwise `simple_generation`).
- Dimensions (mandatory): this is a **resolution-changing task** with user-specified target dimensions. Pass the computed target `size` (`{out_w}×{out_h}`) and the closest supported `aspect_ratio` from SKILL.md's Auto-Match Table. In `simple`/`complex` fallback, pass ONLY the closest supported `aspect_ratio`.
- The user's explicit target dimensions override the source-following rule in SKILL.md Step 0.5.

## Result Reporting

Report the final output:

- Source dimensions (`src_w` × `src_h`)
- Target interpretation (exact size / ratio / one-side scale)
- Final computed dimensions (`out_w` × `out_h`)

If the 16-multiple rounding changed the requested dimensions by more than 5%, briefly note the adjusted size and why.

## Examples

| Source | User request | Computed output |
|--------|--------------|-----------------|
| 2048×1024 | `1024x768` | `1024×768` |
| 2048×1024 | `16:9` | `1920×1088` |
| 1920×1080 | `4:3` | `1664×1248` |
| 800×600 | `width 400px` | `400×304` |
| 800×600 | `square` | `688×688` |

## Notes

- This scene is for standalone resize requests only. Platform image-set final delivery resize/format should still use native tools.
- Do not use this scene as a one-step solution for multi-intent requests that also require background changes, lighting changes, text edits, or quality enhancement.
- If the user asks to "make it clearer" at the same time, route to **HD Upscale** or run **HD Upscale** after Image Resize if the output still lacks clarity.
- **Acceptance criteria**: the output must show the same subject at the same scale and proportion as the source; the background may be cropped or extended only to match the target aspect ratio. No stretching, distortion, redraw, or added elements are allowed.
