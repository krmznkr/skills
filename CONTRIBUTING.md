# Contributing

Thanks for improving pr-storyboard. This guide covers the principles that keep
the skill coherent and the checklist for changing it.

The vocabulary here is adapted from Matt Pocock's excellent
[writing-great-skills](https://github.com/mattpocock/skills) reference.

## The one goal: predictability

A skill's job is to wrangle determinism out of a stochastic system. The target
isn't the same *output* every run — it's the same *process*. The agent is the
reviewer; the renderer (`scripts/render.mjs`) is a deterministic,
dependency-free tool. Keep that split: intelligence in the agent, mechanism in
the script.

## Progressive disclosure

Keep `SKILL.md` tight. It holds the trigger and the steps. Everything
exhaustive — the `plan.json` schema, CLI flags, sub-file targeting rules — lives
in `REFERENCE.md`, loaded only when needed. The top stays legible; detail is one
hop away.

## Failure modes to prune

Read a draft sentence by sentence and cut against these:

- **Sprawl** — trying to cover too much in `SKILL.md`. Push it to `REFERENCE.md`.
- **Duplication** — the same instruction stated twice, or restated in a sibling
  file. Single source of truth.
- **Sediment** — leftover lines from an earlier version that no longer apply.
- **No-op** — a sentence that, if deleted, changes nothing about how the agent
  behaves. Delete it.
- **Premature completion** — letting the agent stop before the work is verified.
  Keep the explicit gate (open the result, check it against the rubric).

## Changing the skill — checklist

1. Update `skills/pr-storyboard/SKILL.md` (and `REFERENCE.md`, `templates/`,
   `scripts/` as needed).
2. Keep `SKILL.md` agent-facing and tight; push detail to `REFERENCE.md`.
3. Re-sync the human-facing `README.md`.
4. If the renderer's UI changed, regenerate the screenshots in `docs/images/`
   from the demo assets in `skills/pr-storyboard/examples/`.
5. Run `./scripts/list-skills.sh` to confirm it's still discovered, and
   `./scripts/link-skills.sh` to link it locally.

See [`CLAUDE.md`](CLAUDE.md) for the full repo conventions.
