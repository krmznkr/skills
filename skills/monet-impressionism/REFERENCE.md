# Reference — Palettes & Parameters

Progressive-disclosure detail for the `monet-impressionism` skill. Load this
only when you need exact palette anchors or parameter ranges.

## Series palettes

All values are HSB `(360, 100, 100)`. Each series is a **mood**, not a copy of
any specific painting. Anchors define the underpainting gradient; `shadow` is
the complementary foreground darkener; `hi` is the warm highlight fleck color.

| Series id           | Mood                          | Sky (top→bot)        | Water (top→bot)      | Sun / glow        | Shadow (complement) | Lilies |
|---------------------|-------------------------------|----------------------|----------------------|-------------------|---------------------|--------|
| `lilies-morning`    | cool dawn haze, mint water    | `205,28,94`→`190,20,97` | `190,34,84`→`172,40,55` | `52,30,100` @(.38,.22) | `255,42,40` violet | yes |
| `lilies-twilight`   | violet/rose dusk, deep pond   | `268,40,52`→`318,34,74` | `250,44,44`→`228,52,26` | `24,55,96` @(.62,.30) | `260,55,30` indigo | yes |
| `haystacks-sunset`  | amber/orange field, long light| `28,45,96`→`44,55,100`  | `40,50,80`→`18,60,52`   | `46,60,100` @(.30,.30) | `250,50,34` blue   | no  |
| `poplars-midday`    | bright green banks, blue sky  | `210,32,96`→`196,26,100`| `150,44,70`→`128,52,44` | `54,28,100` @(.5,.18)  | `235,48,36` blue   | no  |
| `rouen-fog`         | desaturated grey-gold mist    | `210,10,88`→`40,12,92`  | `210,14,78`→`220,20,58` | `45,18,96` @(.55,.26)  | `240,30,44` slate  | no  |

Accent hues (blossoms / flecks) per series live in `PALETTES[...].accents` in
`viewer.html`. Keep saturation moderate; never push a channel to a pure
primary.

### Adding a new series

Add an entry to `PALETTES` with the same keys (`skyTop, skyBot, waterTop,
waterBot, sun, sunPos, shadow, hi, accents, lily`) and append an `<option>` to
the `#pSeries` select. `sunPos` is `[u,v]` in 0..1 canvas space.

## Parameters

| Param         | Range          | Default | Effect |
|---------------|----------------|---------|--------|
| `series`      | 5 ids          | lilies-morning | Selects palette + whether lilies render |
| `strokeCount` | 1500–14000     | 7000    | Total dabs across all passes; density of the field |
| `strokeLength`| 6–42 px        | 20      | Base dab length before per-pass shrink + jitter |
| `strokeWidth` | 2–16 px        | 8       | Base dab width; impasto ridge scales from it |
| `colorJitter` | 0–30           | 12      | Per-stroke h/s/b spread → broken-color shimmer |
| `noiseScale`  | 0.002–0.02     | 0.008   | Perlin frequency for the orientation field |
| `waterlineY`  | 0.20–0.75      | 0.46    | Horizon: fraction of height where sky→water flips |
| `layerPasses` | 2–5            | 4       | Wash→dab→fleck passes; more = richer, slower |

### Tuning notes

- **Too noisy / no scene?** Lower `colorJitter` (→8–10), raise `strokeCount`,
  keep `layerPasses` ≥ 4 so the broad wash establishes composition first.
- **Too flat / muddy?** Raise `colorJitter` slightly and `strokeLength`.
- **Choppy water?** Lower `noiseScale` toward 0.004 for longer coherent ripples.
- **Higher horizon (more water)** → lower `waterlineY`; more sky → raise it.
- Render cost scales ~linearly with `strokeCount × layerPasses`. 7000×4 renders
  fast; 14000×5 is the heavy end.

## Determinism contract

`paint()` calls `randomSeed(seed); noiseSeed(seed);` before building the grid
and drawing. Given identical `params`, output pixels are identical. All UI glue
mutates `params` then calls `paint()` directly (no reliance on `redraw()`).
