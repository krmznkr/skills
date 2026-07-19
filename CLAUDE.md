# Repository conventions

This file is the shared source of truth for agents and contributors working in
this repo. `AGENTS.md` is a symlink to it, so every harness reads the same
instructions.

This repository ships a single skill, **pr-storyboard**, but keeps a small,
conventional layout so it stays easy to reason about (and easy to grow later).

## Layout

```
skills/pr-storyboard/
  SKILL.md            # required, agent-facing: when + how
  REFERENCE.md        # deep detail (plan.json schema, CLI), loaded on demand
  templates/          # starting-point plan.json
  scripts/            # the dependency-free renderer (render.mjs)
  examples/           # a worked diff + plan used for the docs screenshots
README.md             # human-facing product page
docs/images/          # screenshots used by the README
scripts/              # link-skills.sh, list-skills.sh
```

The skill folder name **must** match the `name` in the `SKILL.md` frontmatter.

## SKILL.md frontmatter

```yaml
---
name: pr-storyboard        # kebab-case, matches the folder
description: One or two sentences. Front-load the concrete trigger words the
  user is likely to say. Gate with "Use ONLY when…" if it should stay quiet on
  adjacent topics.
---
```

Keep `SKILL.md` tight and agent-facing. Push exhaustive detail (schema tables,
CLI flags, worked examples) into `REFERENCE.md` and point to it from `SKILL.md`.
This is **progressive disclosure** — the top stays legible, detail loads only
when needed.

## Agent-facing vs human-facing

- `SKILL.md` is **agent-facing**: terse, trigger-tuned instructions.
- `README.md` is **human-facing**: prose + screenshots for people browsing the
  repo.

Keep both in sync when behavior changes.

## When you change the skill

Keep everything honest — a stale doc is worse than none:

1. Update `SKILL.md` (and `REFERENCE.md`, `templates/`, `scripts/` as needed).
2. Re-sync the human-facing `README.md`.
3. If the UI changed, regenerate the screenshots in `docs/images/` from
   `skills/pr-storyboard/examples/` (see that folder for the demo diff/plan).
4. Confirm `scripts/list-skills.sh` still lists it and `scripts/link-skills.sh`
   still links it.

## Authoring principles

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The core idea: a skill's job is to make
a stochastic agent **predictable** — the same *process* every run, not the same
output. The intelligence lives in the agent; the renderer is a deterministic,
dependency-free tool.
