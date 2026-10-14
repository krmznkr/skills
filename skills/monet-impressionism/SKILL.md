---
name: monet-impressionism
description: Use when the user asks to generate original impressionist / Monet-style paintings, water lilies, haystacks, or "make an impressionism generative art" p5.js artifact. Produces a self-contained interactive HTML studio (seeded, reproducible) with an underpainting-driven brushstroke engine. Use ONLY for original works in the impressionist style — never to reproduce a specific existing painting.
---

# Monet Impressionism — Generative Art

Generate **original** impressionist paintings in the spirit of Monet as an
interactive p5.js artifact. Never copy a specific canvas — produce new work in
the style (broken color, colored shadows, soft dissolved edges).

## How to use this skill

1. Start from `templates/viewer.html` — a complete, working studio. Copy it as
   the artifact; do not rebuild from scratch.
2. Pick a **series** palette (see `REFERENCE.md`) matching the user's mood, and
   set the opening `params` (seed + sliders). `EXAMPLES.md` maps common prompts
   to concrete choices.
3. If tuning the algorithm, keep the design below intact — it is what makes the
   output read as a scene rather than colored noise.
4. Self-verify with `scripts/render.mjs` before delivering (see Verification).

## The algorithm (non-negotiable)

The key is an **underpainting map** built before any stroke:

1. Low-res scene grid (~90×120 cells), each holding a target `[h,s,b]`:
   sky→water vertical gradient, a seeded sun/atmosphere glow, horizontal ripple
   banding in the water, complementary-shadow darkening toward the foreground.
2. **Every stroke samples its color from that map** at its own x/y (+ per-stroke
   h/s/b jitter). Composition emerges from the map.
3. **Impasto stroke** = 3 stacked ellipses: darker drag-shadow edge, body,
   offset warm highlight ridge.
4. **Layered passes**: broad low-alpha wash → mid dabs → sparse high-alpha
   highlight flecks (decreasing size + count).
5. **Orientation field** via Perlin noise: water near-horizontal (ripples), sky
   gently horizontal, banks/foliage free.
6. **Water-lily series**: floating pads (flattened ellipses, larger toward
   foreground) + 6-petal blossom dabs with bright centers.
7. **Finish**: canvas grain flecks + soft vignette.

## Aesthetic rules (encode these)

- Broken color / optical mixing — **no flat fills**.
- **No pure black or white.** Shadows are colored (violet/blue/teal);
  highlights are warm cream/pink.
- Complementary-colored shadows. Soft dissolved edges. Weak / no single focal point.

## Technical requirements

- **Seeded & reproducible**: `randomSeed(seed); noiseSeed(seed);` at the top of
  `paint()` — same seed ⇒ identical output.
- 5 series palettes (curated HSB moods, not fixed images): Water Lilies–Morning,
  Water Lilies–Twilight, Haystacks–Sunset, Poplars–Midday, Rouen–Fog.
- Sliders: `series, strokeCount, strokeLength, strokeWidth, colorJitter,
  noiseScale, waterlineY, layerPasses`.
- Single self-contained HTML — p5.js from CDN, everything inline, no build.
- Canvas 900×1200 portrait, `colorMode(HSB,360,100,100,100)`, `noLoop()` after render.
- UI glue calls `paint()` **directly** — `noLoop()` with no `draw()` makes
  `redraw()` a no-op; do not rely on it.

## Verification (gate before finishing)

1. Extract the inline `<script>` and confirm it parses (Node `new Function`,
   stubbing p5 globals).
2. `node scripts/render.mjs --series lilies-twilight --seed 7` then **Read the
   PNG**. It must look like an impressionist pond, not noise. Iterate palettes /
   params until it does.

## Quality checklist (must all pass)

- [ ] No pure `#000` / `#fff`; shadows are colored
- [ ] Composition visibly reads (sky / water / light), not uniform noise
- [ ] Edges soft; broken-color shimmer present
- [ ] Same seed reproduces an identical image
- [ ] All params wired to working sliders; PNG downloads

## Constraint

Original work **in the style of** Monet only — never reproduce a specific
painting (copyright).
