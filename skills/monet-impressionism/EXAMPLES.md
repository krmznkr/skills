# Examples — Prompt → Series & Parameters

Concrete mappings from typical user requests to opening `params`. Start from
`templates/viewer.html`, set these on the `params` object (and/or the UI
sliders), then render and iterate.

## 1. "A calm water lily pond in the morning"

Cool, hazy, mint water with floating pads.

```js
params.series      = 'lilies-morning';
params.seed        = 12;
params.strokeCount = 8000;
params.strokeLength= 22;
params.strokeWidth = 8;
params.colorJitter = 11;
params.noiseScale  = 0.006;   // longer, calmer ripples
params.waterlineY  = 0.40;    // low horizon → lots of water
params.layerPasses = 4;
```

Why: low `waterlineY` maximizes pond area for lilies; low `noiseScale` keeps the
water coherent; modest jitter reads as gentle dawn light.

## 2. "Dreamy violet twilight over the water, moody"

Deep dusk pond, rose-violet sky, richer impasto.

```js
params.series      = 'lilies-twilight';
params.seed        = 7;
params.strokeCount = 10000;
params.strokeLength= 26;
params.strokeWidth = 10;
params.colorJitter = 16;      // more shimmer for the glowing dusk
params.noiseScale  = 0.007;
params.waterlineY  = 0.44;
params.layerPasses = 5;       // extra pass for depth
```

Why: higher passes + jitter build luminous broken color; `lilies-twilight`
supplies indigo complementary shadows against warm sun reflection.

## 3. "Golden haystacks at sunset in a field"

No water/lilies; warm amber field, long low light.

```js
params.series      = 'haystacks-sunset';
params.seed        = 21;
params.strokeCount = 7000;
params.strokeLength= 20;
params.strokeWidth = 9;
params.colorJitter = 14;
params.noiseScale  = 0.010;   // freer, hay-like stroke flow
params.waterlineY  = 0.58;    // high horizon → dominant field foreground
params.layerPasses = 4;
```

Why: high `waterlineY` turns the lower two-thirds into field; blue `shadow`
complements the amber for classic sunset contrast.

## 4. "Foggy, muted riverside — soft and grey"

Low-contrast, desaturated atmosphere (Rouen–Fog).

```js
params.series      = 'rouen-fog';
params.seed        = 3;
params.strokeCount = 6000;
params.strokeLength= 18;
params.strokeWidth = 7;
params.colorJitter = 8;       // low jitter keeps it hushed
params.noiseScale  = 0.005;
params.waterlineY  = 0.5;
params.layerPasses = 3;
```

Why: minimal jitter + fewer passes preserve the flat, dissolved fog; the
grey-gold palette avoids any hard focal point.

## Bonus: "Bright green poplars by a blue river, midday"

```js
params.series      = 'poplars-midday';
params.seed        = 44;
params.strokeCount = 9000;
params.strokeLength= 24;
params.strokeWidth = 8;
params.colorJitter = 13;
params.noiseScale  = 0.011;   // free vertical-ish foliage strokes
params.waterlineY  = 0.5;
params.layerPasses = 4;
```

## Iterating

If a render reads as noise: drop `colorJitter` a few points, raise
`layerPasses` to ≥4 so the broad wash lands first, and confirm `waterlineY`
matches the scene (low for ponds, high for fields). See `REFERENCE.md` → Tuning.
