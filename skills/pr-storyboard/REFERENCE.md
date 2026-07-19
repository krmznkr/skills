# pr-storyboard — reference

Deep detail for the `pr-storyboard` skill. Load when you need the exact
`plan.json` schema or the full CLI surface. Everyday use is covered in
`SKILL.md`.

## `plan.json` schema

```jsonc
{
  // Big heading in the storyboard. Optional; defaults to "Change storyboard".
  "title": "Add rate limiting to the API",

  // Small line under the title — good for "branch → base · N files". Optional.
  "subtitle": "feature/rate-limit → main",

  // Ordered list of steps. Rendered top to bottom, numbered from 1.
  "steps": [
    {
      // Action-phrase heading for the step. Required.
      "title": "Rename the middleware module",

      // Step commentary. A string OR an array of bullet strings (rendered as a
      // readable list). Explain intent (the WHY), not a restatement. Strongly
      // recommended — it's the point of the storyboard.
      "summary": ["Renamed auth.ts to guards.ts.", "It now holds more than auth."],

      // Entries are new-side file paths (string) OR sub-file target objects
      // (see below). For a rename, use the destination path. Anything not
      // shown falls into a trailing "Everything else" step. Required.
      "files": ["src/middleware/guards.ts", "src/app.ts"]
    }
  ]
}
```

### Sub-file targeting

A `files` entry may be a string (whole file) or an object addressing part of a
file. Use the object form to attach a `note` (recommended for every changed
file) and to split a rename from its edits.

```jsonc
"files": [
  { "file": "src/guards.ts", "part": "rename", "note": "Just the move." },
  { "file": "src/guards.ts", "part": "content", "note": ["Bullet one.", "Bullet two."] },
  { "file": "src/big.ts",    "hunks": [0, 2],   "note": "..." },
  { "file": "src/api.ts",    "lines": "10-40, 120-135", "note": "..." }
]
```

| Field   | Effect                                                                          |
| ------- | ------------------------------------------------------------------------------- |
| `file`  | New-side path (same matching as a string entry). Required in object form.       |
| `note`  | The file's description — a string or an array of bullets — rendered prominently above its diff. **Required for any file with content changes**; a changed file without one renders a visible "No description provided" warning. Not needed for `part: "rename"`. |
| `part`  | `"rename"` = move banner only, no diff, 0 ±. `"content"` = edits only, drops the rename arrow (renders as Modified). |
| `hunks` | Array of 0-based hunk indices to include.                                       |
| `lines` | New-side line ranges (`"a-b, c"`); includes hunks overlapping any range.        |

`hunks` / `lines` may be combined with `part: "content"`. Uncovered hunks (and
an unshown rename) auto-collect into "Everything else", so partial targeting is
always safe.

Notes:

- Path matching is exact against the diff's new path, with a fallback that
  strips a leading `b/`. A listed path that isn't in the diff still renders as a
  greyed "not in diff" placeholder so you can see the mismatch and fix it.
- Every change (hunk or rename) present in the diff but absent from all steps is
  collected into a final **"Everything else"** step. An empty leftover step is
  omitted. Use it as a checklist.
- The same file may appear in multiple steps (e.g. rename, then content); the
  renderer gives each view a unique id so anchors and state stay independent.
- Steps render in array order — that order *is* the narrative.
- If you pass no `--plan`, the renderer falls back to one step per file titled
  "All changes". The plan is what makes it a storyboard.

## Generating the diff (rename detection)

Renames only appear as renames when the diff was produced with rename detection.
`git diff` enables it, but **pass `-M` explicitly** and be aware `gh pr diff`
does not — without it a move is a delete + add.

```bash
git diff -M main...HEAD            # detect renames (default similarity 50%)
git diff -M30% main...HEAD         # recover renames that were also heavily edited
```

A file that is renamed *and* edited appears as one `diff --git` block with
`rename from`/`rename to` **and** `@@` hunks — split it with `part`/`lines`.

## CLI

```
node scripts/render.mjs [options]
```

| Flag              | Meaning                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `--plan <path>`   | Path to `plan.json`. Omit to get a flat one-step fallback.        |
| `--diff <path>`   | Path to a unified diff file. If omitted, diff is read from stdin. |
| `--out <path>`    | Output HTML path. Default `storyboard.html`.                      |
| `--title <text>`  | Override the title (else `plan.title`, else a default).           |
| `--open`          | Open the result in the OS default browser after writing.          |
| `--no-open`       | Explicitly don't open (default).                                  |

Diff source is **either** `--diff <file>` **or** piped stdin:

```bash
# from a file
node scripts/render.mjs --plan plan.json --diff changes.diff --out out.html --open

# from a pipe
git diff main...HEAD | node scripts/render.mjs --plan plan.json --out out.html --open
```

Open command per platform: `open` (macOS), `xdg-open` (Linux),
`start` (Windows).

## What the renderer parses

Standard `git diff` unified output, including:

- `diff --git a/… b/…` file boundaries.
- `new file` / `deleted file` / `rename from|to` → status badges.
- `--- ` / `+++ ` old/new path lines.
- `@@ … @@` hunk headers (the trailing context label is shown).
- `Binary files …` / `GIT binary patch` → "binary, no textual diff".

For each modified line pair (a `-` line followed by a `+` line), it runs an
LCS word diff and highlights only the changed tokens (`.w.wadd` / `.w.wdel`),
so a one-character edit doesn't light up the whole line. Generate the diff with
default context; you don't need `--word-diff` (the renderer does word-level
itself).

## UI features (all built in)

- **shadcn-styled** design system: HSL design tokens, zinc/neutral palette,
  consistent radius and spacing, real button / badge / card / segmented-control
  / kbd components. Single dependency-free HTML file; opens from `file://`.
- **Paginated walkthrough**: only the current step's changes are shown (no long
  scroll, no accidental drift). **Next / Previous** buttons plus the sidebar move
  between steps; the current step is persisted in `localStorage`. `#step-N` in
  the URL deep-links to a step.
- Wide, GitHub-like layout; content width follows the viewport with a
  fixed-width sidebar, so switching steps causes no layout shift.
- **Unified / Split** segmented toggle (keyboard `U`), persisted in
  `localStorage`. Split is side-by-side old|new with aligned rows.
- **Theme**: defaults to the OS `prefers-color-scheme`; the toggle sets an
  explicit light/dark override persisted in `localStorage`.
- Sticky header (its height is measured into `--header-h` so sticky offsets stay
  exact) with a **progress bar**, **Expand all** / **Collapse all**, a **theme
  toggle**, totals, and a **keyboard-shortcuts overlay** (`?`).
- Left **step navigator** with full, wrapping step titles (no click-to-read) and
  reviewed check marks.
- **Per-file descriptions** rendered as prominent bullets above each file's diff
  (from the plan's `note`s); a changed file with no note shows a visible warning.
- **"Reviewed" checkbox** per step; persisted in `localStorage` keyed by a hash
  of the diff, filling the header progress bar.
- File cards open by default, collapsible, with a **copy-path** button; long
  paths keep the **filename prominent** and reveal the full path on hover.
- **Word-level** highlighting plus a lightweight, dependency-free **syntax
  highlighter** — both compose in unified and split views.
- Long unchanged context **folds** into a "Show N unchanged lines" control
  (`CONTEXT_FOLD` / `CONTEXT_KEEP` constants).
- Line numbers are **anchored** for deep-linking; rows highlight on hover.

### Keyboard shortcuts (intuitive, non-vim)

| Keys | Action |
| ---- | ------ |
| `↑` / `↓` / `←` / `→` | Previous / next step |
| `1`–`9`, `⌘/Ctrl+1`–`9` | Jump to step N |
| `Home` / `End` | First / last step |
| `Enter` / `R` | Toggle "reviewed" on the current step |
| `U` | Switch Unified / Split |
| `E` / `C` | Expand / collapse all files |
| `T` | Toggle theme |
| `?` | Show shortcuts overlay |
| `Esc` | Close overlay |

- Responsive; fully self-contained (no network, no external assets).

## Determinism

No randomness, no dependencies (Node ≥ 16 stdlib only). The same `plan.json`
and diff always produce byte-identical HTML.
