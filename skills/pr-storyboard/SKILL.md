---
name: pr-storyboard
description: Use when the user wants to review, understand, or walk through a PR, a diff, the current branch vs. a base branch, or their uncommitted local changes as an ordered, narrated "storyboard" — grouped into logical steps with commentary and opened in the browser (e.g. "walk me through this PR", "explain these changes step by step", "review my branch against main", "turn this diff into a Graphite-style storyboard"). YOU read the diff and decide the steps; a deterministic renderer paints the HTML UI.
---

# PR Storyboard — Group a Diff into Narrated Steps

**You are the reviewer. The script is the renderer.** The intelligence is
yours: you read the diff, figure out the *story* of the change, and group files
into an ordered sequence of steps ("first the rename, then the new module, then
the wiring, then the tests") — each with a plain-language explanation. You write
that plan as JSON; `scripts/render.mjs` turns it plus the raw diff into a single
self-contained HTML storyboard and opens it in the browser.

The renderer does **not** understand the change. It parses the unified diff,
computes word-level highlights, and paints the UI. The grouping and the
commentary are your job — that's what makes the result good.

## The process (do every step)

### 1. Get the diff (with rename detection)
Produce a unified diff of whatever the user means. Common cases:

```bash
git diff -M main...HEAD            > /tmp/changes.diff   # branch vs base (merge-base)
git diff -M main                   > /tmp/changes.diff   # branch vs base (direct)
git diff -M                        > /tmp/changes.diff   # unstaged local changes
git diff -M --staged              > /tmp/changes.diff   # staged local changes
gh pr diff <number>               > /tmp/changes.diff   # a GitHub PR
```

**Always pass `-M` (rename detection).** Without it — and note `gh pr diff`
omits it — a move shows as a full delete + a full add, doubling the noise and
hiding the story. If a file was moved *and* heavily edited, git may still split
it; lower the threshold with `-M30%` (or `-M20%`) to recover the rename:

```bash
git diff -M30% main...HEAD > /tmp/changes.diff
```

If the user didn't say what base to compare against, ask (or default to the
repo's main branch via `git symbolic-ref refs/remotes/origin/HEAD`). Prefer
`main...HEAD` (three dots) so you see only what the branch introduced.

### 2. Read the whole diff and find the story
Read it end to end **before** grouping. Identify distinct *kinds* of change and
their natural order — the sequence a good author would present them in a review:

- structural moves first (renames, file moves, extractions),
- then new building blocks (new modules/classes/functions),
- then wiring (call sites, registration, config),
- then supporting changes (types, errors, styles),
- then tests and docs last.

Group **related files together** into a step even if the diff lists them apart.
A step is a *coherent idea*, not a single file.

**Destructure files when one file holds two stories.** A single file often
carries changes that belong to *different* steps — most commonly a **rename plus
edits**: the move is structural (step 1), the content tweaks are behavioural
(a later step). Don't dump both into one step just because they share a file.
The plan can target *part* of a file:

- the **rename/move only** (banner, no diff), leaving the edits for later;
- **specific hunks** (by index) or **new-side line ranges**.

Any hunk you don't place lands in "Everything else", so you can carve a file
deliberately and let the remainder collect itself. See step 4 for the syntax.

### 3. Choose the step count
The user may ask for a target (5 / 10 / 15 steps). Treat it as a **suggestion**,
not a quota — pick the count that makes the change legible. Guidance:

- small PR (< ~5 files): 2–4 steps.
- medium: 4–8 steps.
- large: up to ~15; never split one idea across steps just to hit a number, and
  never merge unrelated ideas to shrink the count.

If the user gave a number, aim near it but say so if the change reads better
with more or fewer.

### 4. Write the plan
Author `plan.json`. Copy `templates/plan.json` as a starting point. Shape:

```json
{
  "title": "Add rate limiting to the API",
  "subtitle": "feature/rate-limit → main",
  "steps": [
    {
      "title": "Tighten the guard check",
      "summary": [
        "One bullet per idea — WHAT changed and WHY, in plain language.",
        "Bullets render as a readable list; a single string also works."
      ],
      "files": [
        {
          "file": "src/middleware/guards.ts",
          "note": [
            "checkAuth gains a strict mode requiring a longer token.",
            "requireUser opts into strict mode."
          ]
        }
      ]
    }
  ]
}
```

Rules for a good plan:
- Every `title` is an action phrase ("Extract the parser", "Wire it in").
- Every `summary` explains the step's *intent* — why these changes, together.
  Prefer an **array of short bullets** over a wall of text; the UI renders them
  as a readable list. A single string is fine for one-liners.
- **Every file with content changes needs a `note`** — a short, bulleted
  description of *what changed in that file and why*, written for a human. This
  is not optional: a changed file without a note renders a visible "No
  description provided" warning. Renames shown as `part: "rename"` don't need one
  (the move is self-explanatory). Keep notes concrete — name the functions,
  flags, or behaviours that changed, not "updated the file".
- Order the `steps` array in reading order — step 1 is where a reviewer starts.
- Any file (or hunk) you don't assign lands in a final "Everything else" step,
  so cover them all deliberately.

**Sub-file targeting.** A `files` entry may be a plain path string *or* an
object. Use the object form to attach a `note` (recommended for every changed
file) and to split a rename from its edits:

```json
"files": [
  { "file": "src/guards.ts", "part": "rename", "note": "Just the move." },
  { "file": "src/guards.ts", "part": "content", "note": ["Bullet one.", "Bullet two."] },
  { "file": "src/big.ts",    "hunks": [0, 2],   "note": "..." },
  { "file": "src/api.ts",    "lines": "10-40, 120-135", "note": "..." }
]
```

- `note: "…"` or `note: ["…","…"]` — the file's description; a string or an
  array of bullets. **Required for any file with content changes.**
- `part: "rename"` — show only the move banner, no diff (0 additions/deletions).
- `part: "content"` — show the edits as a plain modification (drops the rename
  arrow), so the same file can appear as a move in one step and edits in another.
- `hunks: [i, …]` — only those 0-based hunk indices.
- `lines: "a-b, c"` — only hunks touching those **new-side** line ranges.

Whatever hunks (or an unshown rename) you leave uncovered appear automatically in
the trailing "Everything else" step.

See `REFERENCE.md` for the full schema and every CLI flag.

### 5. Render and open
```bash
node scripts/render.mjs --plan plan.json --diff /tmp/changes.diff \
  --out storyboard.html --open
```
`--open` launches the user's default browser. The HTML is self-contained (no
assets, no network) — one file the user can keep or share.

### 6. Look and refine  ← the step that makes it good
Open the result and read it as a reviewer would. Check it against the rubric
below; if a step is muddy or a summary restates the code instead of the intent,
**edit `plan.json` and re-render**. Don't deliver a first pass you haven't seen.

## Quality rubric (must pass before delivering)

- [ ] Steps are in a sensible reading order; step 1 is a natural starting point.
- [ ] Each step is one coherent idea; related files are grouped, not scattered.
- [ ] Every summary explains **why**, not a restatement of the diff.
- [ ] **Every changed file has a `note`** — concrete, bulleted, human-readable.
      No file with edits shows the "No description provided" warning.
- [ ] Step count fits the change (near the user's target if given) — not padded,
      not crammed.
- [ ] Every changed file is assigned deliberately; "Everything else" is empty or
      intentional.
- [ ] Renames/moves show as such and read cleanly; a rename that also edits the
      file is split (move in one step, edits in another) rather than lumped.
- [ ] The HTML opened and word-level highlights point at the real edits.

## The UI (built in — don't rebuild it)

The renderer produces a polished, shadcn-styled review surface — a single,
dependency-free HTML file that opens from `file://`. It already includes:

- **One step at a time.** The storyboard is a *paginated walkthrough* — only the
  current step's changes are shown, so there's no giant scroll and no accidental
  drift into the next section. **Next / Previous** buttons and the sidebar move
  between steps; the current step is remembered between visits.
- A **Unified / Split** segmented toggle (persisted); split shows old|new side by
  side with aligned rows.
- A wide, GitHub-like layout with a readable **step navigator** (full titles, no
  click-to-understand) and a header **progress bar**.
- A repository-style **changed-file tree for the current step**, nested from the
  project root. Clicking a file opens its card, scrolls to its diff, and briefly
  highlights it.
- **Per-file descriptions rendered as prominent bullets**, above each file's
  diff — this is what your `note`s become, so write them well.
- File cards expanded by default, collapsible, with a **copy-path** button;
  **long paths are truncated with the filename kept prominent and the full path
  on hover**.
- **"Reviewed" checkboxes** per step, persisted in `localStorage` (keyed to the
  diff), driving the progress bar.
- **Word-level** highlighting and **syntax highlighting**; long unchanged context
  **folds** behind a "Show N unchanged lines" control.
- **Intuitive keyboard support** (not vim): `↑`/`↓`/`←`/`→` move between steps,
  `1`–`9` (and `⌘/Ctrl+1`–`9`) jump to a step, `Home`/`End` first/last,
  `Enter`/`R` toggle reviewed, `U` switch unified/split, `E`/`C` expand/collapse
  files, `T` theme, `?` help, `Esc` close.

Don't add these — spend your effort on the *grouping and commentary*.

## Constraint

The renderer is deterministic and dependency-free (Node ≥ 16, no `npm install`).
Same `plan.json` + diff ⇒ same HTML. All quality comes from your plan, not the
script.
