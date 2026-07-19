#!/usr/bin/env node
// pr-storyboard renderer.
//
// Turns a unified git diff + an agent-authored plan.json into a single
// self-contained storyboard.html and opens it in the default browser.
//
//   node render.mjs --plan plan.json --diff changes.diff --out storyboard.html [--open]
//   git diff main...HEAD | node render.mjs --plan plan.json --out storyboard.html --open
//
// The renderer is deterministic and dependency-free. All intelligence
// (grouping files into ordered steps, the commentary) lives in plan.json,
// which the agent authors. The renderer only parses, diffs at word level,
// and paints the UI.

import fs from "node:fs"
import { spawn } from "node:child_process"

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const a = { open: false }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === "--plan") a.plan = argv[++i]
    else if (t === "--diff") a.diff = argv[++i]
    else if (t === "--out") a.out = argv[++i]
    else if (t === "--title") a.title = argv[++i]
    else if (t === "--open") a.open = true
    else if (t === "--no-open") a.open = false
  }
  return a
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Small stable hash (djb2) → base36, for anchor ids and localStorage keys.
function hash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// Map a file extension to a language bucket + a small icon glyph.
const LANG_BY_EXT = {
  js: "js", jsx: "js", mjs: "js", cjs: "js", ts: "js", tsx: "js",
  json: "json", py: "py", rb: "rb", go: "go", rs: "rs", java: "clike",
  c: "clike", h: "clike", cpp: "clike", cc: "clike", hpp: "clike", cs: "clike",
  php: "clike", swift: "clike", kt: "clike", scala: "clike",
  css: "css", scss: "css", less: "css", html: "xml", xml: "xml", vue: "xml",
  svelte: "xml", md: "md", markdown: "md", yml: "yaml", yaml: "yaml",
  sh: "sh", bash: "sh", zsh: "sh", toml: "toml", sql: "sql",
}
const ICON_BY_LANG = {
  js: "JS", json: "{}", py: "PY", rb: "RB", go: "GO", rs: "RS", clike: "C",
  css: "#", xml: "<>", md: "M↓", yaml: "Y", sh: "$", toml: "T", sql: "DB",
  txt: "·",
}
function langOf(path) {
  const ext = (path.split(".").pop() || "").toLowerCase()
  return LANG_BY_EXT[ext] || "txt"
}
function iconOf(lang) {
  return ICON_BY_LANG[lang] || "·"
}

// Split a path into { dir, name } for a filename-prominent display.
function splitPath(p) {
  const s = String(p || "")
  const i = s.lastIndexOf("/")
  return i === -1 ? { dir: "", name: s } : { dir: s.slice(0, i + 1), name: s.slice(i + 1) }
}

// Normalize a note into an array of bullet strings. Accepts a string
// (optionally with newlines or "- " bullets) or an array of strings.
function toBullets(note) {
  if (note == null) return []
  if (Array.isArray(note)) return note.map((s) => String(s).trim()).filter(Boolean)
  const s = String(note).trim()
  if (!s) return []
  // Split on newlines or leading bullet markers; else keep as a single item.
  const parts = s
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(Boolean)
  return parts.length ? parts : [s]
}

function renderBullets(note, cls) {
  const items = toBullets(note)
  if (!items.length) return ""
  if (items.length === 1) return `<p class="${cls}">${esc(items[0])}</p>`
  return `<ul class="${cls}">${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
}

// ---------------------------------------------------- unified diff parser
// Returns a map: filePath -> { oldPath, newPath, status, hunks:[{header, lines:[{type,old,new,text}]}], binary, additions, deletions }
function parseDiff(text) {
  const files = {}
  const lines = text.split("\n")
  let cur = null
  let hunk = null
  let oldLn = 0
  let newLn = 0

  const push = () => {
    if (cur) files[cur.path] = cur
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]

    if (l.startsWith("diff --git")) {
      push()
      const m = l.match(/^diff --git a\/(.+?) b\/(.+)$/)
      const p = m ? m[2] : l.slice(11)
      cur = {
        path: p,
        oldPath: m ? m[1] : p,
        newPath: m ? m[2] : p,
        status: "modified",
        hunks: [],
        binary: false,
        additions: 0,
        deletions: 0,
      }
      hunk = null
      continue
    }
    if (!cur) continue

    if (l.startsWith("new file")) cur.status = "added"
    else if (l.startsWith("deleted file")) cur.status = "deleted"
    else if (l.startsWith("rename from")) cur.status = "renamed"
    else if (l.startsWith("rename to")) cur.status = "renamed"
    else if (l.startsWith("Binary files") || l.startsWith("GIT binary patch")) cur.binary = true
    else if (l.startsWith("--- ")) {
      const p = l.slice(4)
      if (p !== "/dev/null") cur.oldPath = p.replace(/^a\//, "")
    } else if (l.startsWith("+++ ")) {
      const p = l.slice(4)
      if (p !== "/dev/null") cur.newPath = p.replace(/^b\//, "")
    } else if (l.startsWith("@@")) {
      const m = l.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
      oldLn = m ? parseInt(m[1], 10) : 0
      newLn = m ? parseInt(m[2], 10) : 0
      hunk = { header: m ? m[3].trim() : "", lines: [], newStart: newLn, newEnd: newLn, oldStart: oldLn }
      cur.hunks.push(hunk)
    } else if (hunk) {
      const c = l[0]
      if (c === "+") {
        hunk.lines.push({ type: "add", old: null, new: newLn++, text: l.slice(1) })
        hunk.newEnd = newLn - 1
        cur.additions++
      } else if (c === "-") {
        hunk.lines.push({ type: "del", old: oldLn++, new: null, text: l.slice(1) })
        cur.deletions++
      } else if (c === "\\") {
        // "\ No newline at end of file" — ignore
      } else {
        hunk.lines.push({ type: "ctx", old: oldLn++, new: newLn++, text: l.slice(1) })
        hunk.newEnd = newLn - 1
      }
    }
  }
  push()
  return files
}

// -------------------------------------------------- word-level intra diff
// Given adjacent del/add line pairs, compute word-level highlights so we
// only emphasise what actually changed on a modified line.
function tokenize(s) {
  return s.match(/\s+|\w+|[^\s\w]/g) || []
}

// LCS-based word diff between two token arrays.
function wordDiff(aStr, bStr) {
  const a = tokenize(aStr)
  const b = tokenize(bStr)
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const aOut = []
  const bOut = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      aOut.push({ t: a[i], c: false })
      bOut.push({ t: b[j], c: false })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      aOut.push({ t: a[i], c: true })
      i++
    } else {
      bOut.push({ t: b[j], c: true })
      j++
    }
  }
  while (i < n) aOut.push({ t: a[i++], c: true })
  while (j < m) bOut.push({ t: b[j++], c: true })
  return { aOut, bOut }
}

function renderTokens(tokens, cls) {
  return tokens
    .map((tk) => (tk.c ? `<span class="w ${cls}">${esc(tk.t)}</span>` : esc(tk.t)))
    .join("")
}

// ------------------------------------------------ lightweight syntax color
// Deterministic, dependency-free. Highlights the common lexical categories
// (comments, strings, numbers, keywords, functions) across the languages the
// storyboard is likely to show. Not a full parser — intentionally coarse so
// it never breaks the diff. Emits HTML with `esc`aped content.
const KEYWORDS = new Set(
  ("const let var function return if else for while do switch case break continue " +
    "class extends new this super import export from as default async await yield " +
    "try catch finally throw typeof instanceof in of void delete null undefined true false " +
    "def elif except with lambda pass raise global nonlocal not and or is None True False " +
    "func type struct interface map range go defer chan select fn impl trait pub use mod " +
    "match enum static public private protected void int string bool float double " +
    "package namespace using self end then begin module require").split(" "),
)
const COMMENT_PREFIX = ["//", "#", "--"]

function highlight(text, lang) {
  if (lang === "txt" || lang === "md") return esc(text)
  let i = 0
  const n = text.length
  let out = ""
  const isWord = (c) => /[A-Za-z0-9_$]/.test(c)

  while (i < n) {
    const c = text[i]
    const two = text.slice(i, i + 2)

    // leading whitespace / plain
    if (c === " " || c === "\t") {
      out += esc(c)
      i++
      continue
    }
    // block comment /* ... */
    if (two === "/*") {
      let j = text.indexOf("*/", i + 2)
      if (j === -1) j = n
      else j += 2
      out += `<span class="t-com">${esc(text.slice(i, j))}</span>`
      i = j
      continue
    }
    // line comment
    if (COMMENT_PREFIX.some((p) => text.startsWith(p, i))) {
      out += `<span class="t-com">${esc(text.slice(i))}</span>`
      break
    }
    // strings
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1
      while (j < n) {
        if (text[j] === "\\") j += 2
        else if (text[j] === c) {
          j++
          break
        } else j++
      }
      out += `<span class="t-str">${esc(text.slice(i, j))}</span>`
      i = j
      continue
    }
    // numbers
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(text[i + 1] || ""))) {
      let j = i
      while (j < n && /[0-9a-fA-FxXbBoO._]/.test(text[j])) j++
      out += `<span class="t-num">${esc(text.slice(i, j))}</span>`
      i = j
      continue
    }
    // identifiers / keywords / function calls
    if (isWord(c)) {
      let j = i
      while (j < n && isWord(text[j])) j++
      const word = text.slice(i, j)
      let k = j
      while (k < n && (text[k] === " " || text[k] === "\t")) k++
      if (KEYWORDS.has(word)) out += `<span class="t-kw">${esc(word)}</span>`
      else if (text[k] === "(") out += `<span class="t-fn">${esc(word)}</span>`
      else out += esc(word)
      i = j
      continue
    }
    // punctuation / operators
    out += esc(c)
    i++
  }
  return out
}

// Render word-diff tokens with syntax highlighting inside each token.
function renderTokensHi(tokens, cls, lang) {
  return tokens
    .map((tk) =>
      tk.c ? `<span class="w ${cls}">${highlight(tk.t, lang)}</span>` : highlight(tk.t, lang),
    )
    .join("")
}

// Build a structured row model for a hunk, then render it to either a unified
// or split (side-by-side) table. Long runs of unchanged context fold.
const CONTEXT_FOLD = 8 // fold unchanged runs longer than this
const CONTEXT_KEEP = 3 // lines kept visible on each side of a fold

// Cell = { n, html } | null.  Row types:
//   ctx   { left:{n,html}, right:{n,html} }           (both sides equal)
//   pair  { left:{n,html}, right:{n,html} }           (a modified del/add pair)
//   del   { left:{n,html}, right:null }
//   add   { left:null,     right:{n,html} }
//   fold  { count, foldId }
function buildRows(lines, lang, fileId, hunkIdx) {
  const rows = []
  let idx = 0
  let ctxRun = 0

  const emitCtx = (run) => {
    const asRow = (l) => ({
      kind: "ctx",
      left: { n: l.old, html: highlight(l.text, lang) },
      right: { n: l.new, html: highlight(l.text, lang) },
    })
    if (run.length > CONTEXT_FOLD) {
      const head = run.slice(0, CONTEXT_KEEP)
      const mid = run.slice(CONTEXT_KEEP, run.length - CONTEXT_KEEP)
      const tail = run.slice(run.length - CONTEXT_KEEP)
      head.forEach((l) => rows.push(asRow(l)))
      const foldId = `fold-${fileId}-${hunkIdx}-${ctxRun++}`
      rows.push({ kind: "fold", count: mid.length, foldId })
      mid.forEach((l) => rows.push(Object.assign(asRow(l), { foldId })))
      tail.forEach((l) => rows.push(asRow(l)))
    } else {
      run.forEach((l) => rows.push(asRow(l)))
    }
  }

  let pending = []
  const drain = () => {
    if (pending.length) {
      emitCtx(pending)
      pending = []
    }
  }

  while (idx < lines.length) {
    const line = lines[idx]
    if (line.type === "ctx") {
      pending.push(line)
      idx++
      continue
    }
    drain()
    const dels = []
    while (idx < lines.length && lines[idx].type === "del") dels.push(lines[idx++])
    const adds = []
    while (idx < lines.length && lines[idx].type === "add") adds.push(lines[idx++])
    const pairs = Math.min(dels.length, adds.length)
    for (let k = 0; k < pairs; k++) {
      const { aOut, bOut } = wordDiff(dels[k].text, adds[k].text)
      rows.push({
        kind: "pair",
        left: { n: dels[k].old, html: renderTokensHi(aOut, "wdel", lang) },
        right: { n: adds[k].new, html: renderTokensHi(bOut, "wadd", lang) },
      })
    }
    for (let k = pairs; k < dels.length; k++)
      rows.push({ kind: "del", left: { n: dels[k].old, html: highlight(dels[k].text, lang) }, right: null })
    for (let k = pairs; k < adds.length; k++)
      rows.push({ kind: "add", left: null, right: { n: adds[k].new, html: highlight(adds[k].text, lang) } })
  }
  drain()
  return rows
}

function anchorId(fileId, side, n) {
  return n != null ? `${fileId}-${side}${n}` : ""
}

function gutterCell(fileId, side, n) {
  const id = anchorId(fileId, side, n)
  const href = id ? `#${id}` : ""
  return `<td class="gutter"><a class="lnref" href="${href}">${n ?? ""}</a></td>`
}

function foldMemberAttr(foldId) {
  return foldId ? ` data-fold-member="${foldId}" hidden` : ""
}

// ---- unified renderer ----
function renderUnified(rows, fileId) {
  return rows
    .map((r) => {
      if (r.kind === "fold") return foldRow(r, 4)
      const fm = foldMemberAttr(r.foldId)
      if (r.kind === "ctx") {
        const id = anchorId(fileId, "R", r.right.n)
        return (
          `<tr class="ln ctx"${id ? ` id="${id}"` : ""}${fm}>` +
          gutterCell(fileId, "L", r.left.n) +
          gutterCell(fileId, "R", r.right.n) +
          `<td class="sign"> </td><td class="code">${r.left.html || "&nbsp;"}</td></tr>`
        )
      }
      const out = []
      if (r.left) {
        const id = anchorId(fileId, "L", r.left.n)
        out.push(
          `<tr class="ln del"${id ? ` id="${id}"` : ""}${fm}>` +
            gutterCell(fileId, "L", r.left.n) +
            `<td class="gutter"></td><td class="sign">-</td>` +
            `<td class="code">${r.left.html || "&nbsp;"}</td></tr>`,
        )
      }
      if (r.right) {
        const id = anchorId(fileId, "R", r.right.n)
        out.push(
          `<tr class="ln add"${id ? ` id="${id}"` : ""}${fm}>` +
            `<td class="gutter"></td>` +
            gutterCell(fileId, "R", r.right.n) +
            `<td class="sign">+</td>` +
            `<td class="code">${r.right.html || "&nbsp;"}</td></tr>`,
        )
      }
      return out.join("")
    })
    .join("")
}

// ---- split renderer ----
function splitCell(side, cell, cls) {
  if (!cell) return `<td class="gutter empty"></td><td class="code ${cls} empty">&nbsp;</td>`
  return (
    `<td class="gutter"><a class="lnref">${cell.n ?? ""}</a></td>` +
    `<td class="code ${cls}">${cell.html || "&nbsp;"}</td>`
  )
}

function renderSplit(rows) {
  return rows
    .map((r) => {
      if (r.kind === "fold") return foldRow(r, 4)
      const fm = foldMemberAttr(r.foldId)
      let lc = "",
        rc = ""
      if (r.kind === "del") lc = "del"
      else if (r.kind === "add") rc = "add"
      else if (r.kind === "pair") {
        lc = "del"
        rc = "add"
      }
      return (
        `<tr class="ln ${r.kind}"${fm}>` +
        splitCell("L", r.left, lc) +
        splitCell("R", r.right, rc) +
        `</tr>`
      )
    })
    .join("")
}

function foldRow(r, colspan) {
  return (
    `<tr class="fold-row">` +
    `<td class="fold-cell" colspan="${colspan}">` +
    `<button class="fold-btn" data-target="${r.foldId}">` +
    `<span class="fold-ic">⋯</span> Show ${r.count} unchanged line${r.count === 1 ? "" : "s"}</button>` +
    `</td></tr>`
  )
}

// --------------------------------------------------------------- plan
function loadPlan(planPath) {
  if (!planPath) return null
  const raw = fs.readFileSync(planPath, "utf8")
  return JSON.parse(raw)
}

// Build steps. If a plan is given, follow it. Otherwise one step per file.
//
// A step's `files` entry can be:
//   "path"                                 whole file
//   { file, part:"rename" }                just the rename/move, no hunks
//   { file, part:"content" }               content hunks only (drops rename banner)
//   { file, hunks:[0,2] }                  only those hunk indices (0-based)
//   { file, lines:"10-40,120" }            hunks touching those new-side lines
//   { file, ..., note:"..." }              a per-file caption
// This lets a rename go in one step and the file's edits go in another.
function parseLineRanges(spec) {
  const ranges = []
  for (const part of String(spec).split(",")) {
    const t = part.trim()
    if (!t) continue
    const m = t.match(/^(\d+)\s*(?:-\s*(\d+))?$/)
    if (!m) continue
    const a = +m[1]
    const b = m[2] ? +m[2] : a
    ranges.push([Math.min(a, b), Math.max(a, b)])
  }
  return ranges
}

function hunkTouchesRanges(h, ranges) {
  return ranges.some(([a, b]) => h.newStart <= b && (h.newEnd || h.newStart) >= a)
}

// Produce a filtered *view* of a parsed file for one step, and record which
// hunks it consumed so the coverage tracker knows what's left.
function fileView(file, spec, seq) {
  const view = {
    ...file,
    viewId: `${seq}`, // makes ids unique when a file appears in several steps
  }
  let selected = file.hunks
  let part = null
  let note = null

  if (typeof spec === "object" && spec) {
    note = spec.note || null
    part = spec.part || null
    if (part === "rename") {
      selected = []
      view.renderMode = "rename-only"
    } else if (part === "content") {
      view.suppressRename = true
    }
    if (Array.isArray(spec.hunks)) {
      selected = spec.hunks.map((i) => file.hunks[i]).filter(Boolean)
    } else if (spec.lines != null) {
      const ranges = parseLineRanges(spec.lines)
      selected = file.hunks.filter((h) => hunkTouchesRanges(h, ranges))
    }
  }

  view.hunks = selected
  view.note = note
  view.consumedHunks = new Set(selected.map((h) => file.hunks.indexOf(h)))
  view.consumedRename = part !== "content" // "content" leaves the rename for another step
  view.additions = selected.reduce((n, h) => n + h.lines.filter((l) => l.type === "add").length, 0)
  view.deletions = selected.reduce((n, h) => n + h.lines.filter((l) => l.type === "del").length, 0)
  if (part === "rename") {
    view.additions = 0
    view.deletions = 0
  }
  return view
}

function buildSteps(plan, files) {
  const steps = []
  // Track, per file path, which hunks + the rename banner have been shown.
  const coverage = {}
  for (const p of Object.keys(files)) {
    coverage[p] = { hunks: new Set(), rename: false, file: files[p] }
  }
  let seq = 0

  if (plan && Array.isArray(plan.steps)) {
    for (const s of plan.steps) {
      const stepFiles = []
      for (const raw of s.files || []) {
        const spec = typeof raw === "string" ? { file: raw } : raw
        const path = spec.file || spec.path
        const match = files[path] || files[String(path).replace(/^b\//, "")]
        if (!match) {
          stepFiles.push({ path, missing: true, hunks: [], additions: 0, deletions: 0 })
          continue
        }
        const view = fileView(match, spec, seq++)
        const cov = coverage[match.path]
        view.consumedHunks.forEach((i) => cov.hunks.add(i))
        if (view.consumedRename && match.status === "renamed") cov.rename = true
        if (view.renderMode === "rename-only") cov.rename = true
        stepFiles.push(view)
      }
      steps.push({ title: s.title || "Step", summary: s.summary || "", files: stepFiles })
    }
  }

  // Leftover: any file with un-shown hunks (or an un-shown rename) gets a
  // trailing view containing only what wasn't placed in a step.
  const leftover = []
  for (const p of Object.keys(coverage)) {
    const { hunks: shown, rename, file } = coverage[p]
    const remainingHunks = file.hunks.filter((_, i) => !shown.has(i))
    const renameUnshown = file.status === "renamed" && !rename
    if (!plan) {
      leftover.push({ ...file, viewId: `${seq++}` })
    } else if (remainingHunks.length || (renameUnshown && !shown.size && !file.hunks.length)) {
      const view = { ...file, viewId: `${seq++}`, hunks: remainingHunks }
      if (!renameUnshown) view.suppressRename = true
      view.additions = remainingHunks.reduce((n, h) => n + h.lines.filter((l) => l.type === "add").length, 0)
      view.deletions = remainingHunks.reduce((n, h) => n + h.lines.filter((l) => l.type === "del").length, 0)
      leftover.push(view)
    }
  }
  if (leftover.length) {
    steps.push({
      title: plan ? "Everything else" : "All changes",
      summary: plan ? "Changes not assigned to a step above." : "",
      files: leftover,
    })
  }
  return steps
}

// ------------------------------------------------------------- file card
const ICONS = {
  chevron: '<svg viewBox="0 0 24 24" class="i"><path d="M6 9l6 6 6-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" class="i"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  check: '<svg viewBox="0 0 24 24" class="i"><path d="M20 6L9 17l-5-5"/></svg>',
  file: '<svg viewBox="0 0 24 24" class="i"><path d="M14 3v5h5"/><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" class="i"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" class="i"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" class="i" style="display:inline;vertical-align:middle"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
}

function statusBadge(status) {
  const map = { added: "added", deleted: "deleted", renamed: "renamed", modified: "modified" }
  const s = map[status] || "modified"
  const label = { added: "Added", deleted: "Deleted", renamed: "Renamed", modified: "Modified" }[s]
  return `<span class="badge ${s}">${label}</span>`
}

function fileDomId(f) {
  return "f" + hash((f.newPath || f.path) + "|" + (f.oldPath || "") + "|" + (f.viewId || ""))
}

// Build a compact repository-style tree for the files shown in one step.
// Directories sort before files; paths always start at the repository root.
function renderFileTree(files) {
  const root = { dirs: new Map(), files: [] }
  for (const f of files.filter((file) => !file.missing)) {
    const path = f.newPath || f.path
    const parts = String(path).split("/").filter(Boolean)
    let node = root
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] })
      node = node.dirs.get(dir)
    }
    node.files.push({ name: parts[parts.length - 1] || path, path, file: f })
  }

  const renderNodes = (node) => {
    const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b))
    const leafs = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
    return (
      dirs
        .map(
          ([name, child]) =>
            `<li class="tree-node"><details class="tree-dir" open>` +
            `<summary><span class="tree-chev">${ICONS.chevron}</span><span class="tree-folder">${ICONS.folder}</span>` +
            `<span class="tree-name">${esc(name)}</span></summary>` +
            `<ul>${renderNodes(child)}</ul></details></li>`,
        )
        .join("") +
      leafs
        .map(({ name, path, file }) => {
          const status = file.suppressRename && file.status === "renamed" ? "modified" : file.status || "modified"
          const lang = langOf(path)
          return (
            `<li class="tree-node"><button class="tree-file" data-file-target="${fileDomId(file)}" title="${esc(path)}">` +
            `<span class="tree-indent"></span><span class="ficon lang-${lang}">${iconOf(lang)}</span>` +
            `<span class="tree-name">${esc(name)}</span><span class="tree-status ${esc(status)}" aria-hidden="true"></span>` +
            `<span class="sr-only">${esc(status)}</span></button></li>`
          )
        })
        .join("")
    )
  }

  const count = files.filter((file) => !file.missing).length
  return (
    `<aside class="file-tree" aria-label="Changed files in this step">` +
    `<div class="tree-head"><span>Changed files</span><span>${count}</span></div>` +
    `<ul class="tree-root">${renderNodes(root)}</ul></aside>`
  )
}

function renderFile(f) {
  if (f.missing) {
    return (
      `<div class="file placeholder" data-file><div class="file-head">` +
      `<span class="ficon ph">${ICONS.file}</span>` +
      `<span class="path" title="${esc(f.path)}"><span class="p-name">${esc(splitPath(f.path).name)}</span></span>` +
      `<span class="badge missing">Not in diff</span></div></div>`
    )
  }
  const lang = langOf(f.newPath || f.path)
  const fileId = fileDomId(f)
  const copyPath = f.newPath || f.path
  const isRename = f.status === "renamed" && f.oldPath !== f.newPath
  const showRenameTitle = isRename && !f.suppressRename
  const fullPath = showRenameTitle ? `${f.oldPath} → ${f.newPath}` : f.newPath || f.path
  // Filename-prominent title; directory subdued; full path on hover.
  let title
  if (showRenameTitle) {
    const a = splitPath(f.oldPath)
    const b = splitPath(f.newPath)
    title =
      `<span class="p-dir">${esc(a.dir)}</span><span class="p-name">${esc(a.name)}</span>` +
      `<span class="arrow">${ICONS.arrow}</span>` +
      `<span class="p-dir">${esc(b.dir)}</span><span class="p-name">${esc(b.name)}</span>`
  } else {
    const s = splitPath(f.newPath || f.path)
    title = `<span class="p-dir">${esc(s.dir)}</span><span class="p-name">${esc(s.name)}</span>`
  }
  const badgeStatus = f.suppressRename && isRename ? "modified" : f.status

  let body
  if (f.renderMode === "rename-only") {
    body =
      `<div class="rename-note">${ICONS.file}` +
      `<div><div class="rn-title">File moved</div>` +
      `<div class="rn-paths"><span class="mono">${esc(f.oldPath)}</span> ${ICONS.arrow} <span class="mono">${esc(f.newPath)}</span></div>` +
      (f.hunks.length ? `<div class="rn-hint">Content edits shown in a later step.</div>` : "") +
      `</div></div>`
  } else if (f.binary) {
    body = `<div class="binary">Binary file — no textual diff.</div>`
  } else if (!f.hunks.length) {
    body = `<div class="binary">${isRename ? "Pure move — no content changes." : "No content changes."}</div>`
  } else {
    body = f.hunks
      .map((h, hi) => {
        const rows = buildRows(h.lines, lang, fileId, hi)
        return (
          `<div class="hunk-head">${esc(h.header || "@@")}</div>` +
          `<table class="diff unified lang-${lang}"><tbody>${renderUnified(rows, fileId)}</tbody></table>` +
          `<table class="diff split lang-${lang}"><colgroup><col class="cg"><col><col class="cg"><col></colgroup>` +
          `<tbody>${renderSplit(rows)}</tbody></table>`
        )
      })
      .join("")
  }

  // Per-file description. Required for files with content changes; renders as
  // readable bullets. A missing note on a changed file surfaces a visible hint.
  const hasChanges = f.renderMode !== "rename-only" && f.hunks.length > 0
  let noteHtml = ""
  const bullets = toBullets(f.note)
  if (f.renderMode === "rename-only") {
    noteHtml = "" // the "File moved" panel already explains it
  } else if (bullets.length) {
    noteHtml = `<div class="file-note">${renderBullets(f.note, "note-list")}</div>`
  } else if (hasChanges) {
    noteHtml = `<div class="file-note file-note--missing">No description provided for this file's changes.</div>`
  }

  return (
    `<details class="file" id="${fileId}" data-file open>` +
    `<summary class="file-head">` +
    `<span class="chev">${ICONS.chevron}</span>` +
    `<span class="ficon lang-${lang}">${iconOf(lang)}</span>` +
    `<span class="path" title="${esc(fullPath)}">${title}</span>` +
    `<button class="icon-btn copy" data-copy="${esc(copyPath)}" title="Copy path" onclick="event.preventDefault()">${ICONS.copy}</button>` +
    `<span class="stat"><span class="plus">+${f.additions}</span> <span class="minus">−${f.deletions}</span></span>` +
    statusBadge(badgeStatus) +
    `</summary>` +
    `<div class="file-body">${noteHtml}${body}</div>` +
    `</details>`
  )
}

function renderStep(step, i, total) {
  const real = step.files.filter((f) => !f.missing)
  const add = real.reduce((n, f) => n + (f.additions || 0), 0)
  const del = real.reduce((n, f) => n + (f.deletions || 0), 0)
  const n = i + 1
  const prev =
    i > 0
      ? `<button class="btn step-nav-btn" data-goto="${i - 1}">‹ Previous</button>`
      : `<span></span>`
  const next =
    i < total - 1
      ? `<button class="btn step-nav-btn primary" data-goto="${i + 1}">Next step ›</button>`
      : `<button class="btn step-nav-btn" data-goto="top">Back to top ↑</button>`
  return (
    `<section class="step" id="step-${n}" data-step="${n}" tabindex="-1">` +
    renderFileTree(step.files) +
    `<div class="step-body">` +
    `<div class="step-head">` +
    `<span class="step-num">${n}</span>` +
    `<div class="step-title"><h2>${esc(step.title)}</h2>` +
    `<div class="step-meta"><span class="plus">+${add}</span> <span class="minus">−${del}</span><span class="dotsep">·</span>${real.length} file${real.length === 1 ? "" : "s"}<span class="dotsep">·</span>step ${n} of ${total}</div></div>` +
    `<label class="review" title="Mark reviewed (R)"><input type="checkbox" class="review-box" data-step="${n}"><span class="review-face"><span class="review-check">${ICONS.check}</span></span><span class="review-label">Reviewed</span></label>` +
    `</div>` +
    (toBullets(step.summary).length ? `<div class="step-summary">${renderBullets(step.summary, "summary-list")}</div>` : "") +
    `<div class="files">${step.files.map(renderFile).join("")}</div>` +
    `<div class="step-foot">${prev}${next}</div>` +
    `</div>` +
    `</section>`
  )
}

// --------------------------------------------------------------- html
function renderHtml({ title, subtitle, steps, docId }) {
  const totalAdd = steps.reduce((n, s) => n + s.files.reduce((m, f) => m + (f.additions || 0), 0), 0)
  const totalDel = steps.reduce((n, s) => n + s.files.reduce((m, f) => m + (f.deletions || 0), 0), 0)
  const nav = steps
    .map(
      (s, i) =>
        `<a class="nav-item" href="#step-${i + 1}" data-nav="${i + 1}" title="${esc(s.title)}">` +
        `<span class="ni">${i + 1}</span>` +
        `<span class="nt">${esc(s.title)}</span>` +
        `<span class="nchk">${ICONS.check}</span></a>`,
    )
    .join("")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
/* ---- shadcn-style design tokens (zinc / neutral) ---- */
:root{
  color-scheme:dark;
  --radius:.5rem;
  --background:240 10% 4%;
  --card:240 6% 8%;
  --card-2:240 5% 11%;
  --popover:240 8% 6%;
  --border:240 5% 18%;
  --input:240 5% 16%;
  --foreground:0 0% 96%;
  --muted:240 4% 46%;
  --muted-2:240 4% 64%;
  --primary:263 70% 62%;
  --primary-fg:0 0% 100%;
  --ring:263 70% 62%;
  --accent:217 91% 60%;
  --green:142 71% 45%;
  --red:0 72% 58%;
  --add-bg:142 60% 45% / .10;
  --del-bg:0 72% 58% / .10;
  --wadd:142 71% 45% / .30;
  --wdel:0 72% 58% / .30;
  --t-kw:355 78% 68%;
  --t-str:210 90% 78%;
  --t-num:210 100% 72%;
  --t-com:240 4% 55%;
  --t-fn:270 80% 78%;
}
:root[data-theme="light"], :root.light{
  color-scheme:light;
  --background:0 0% 100%;
  --card:0 0% 100%;
  --card-2:240 5% 96%;
  --popover:0 0% 100%;
  --border:240 6% 90%;
  --input:240 6% 90%;
  --foreground:240 10% 8%;
  --muted:240 4% 46%;
  --muted-2:240 4% 40%;
  --primary:263 70% 55%;
  --primary-fg:0 0% 100%;
  --ring:263 70% 55%;
  --accent:217 91% 50%;
  --green:142 71% 38%;
  --red:0 72% 51%;
  --add-bg:142 76% 45% / .12;
  --del-bg:0 72% 55% / .10;
  --wadd:142 71% 40% / .28;
  --wdel:0 72% 51% / .24;
  --t-kw:355 65% 47%;
  --t-str:214 90% 30%;
  --t-num:212 92% 38%;
  --t-com:240 4% 50%;
  --t-fn:270 70% 50%;
}
@media(prefers-color-scheme:light){:root:not([data-theme]):not(.dark){
  color-scheme:light;
  --background:0 0% 100%;--card:0 0% 100%;--card-2:240 5% 96%;--popover:0 0% 100%;
  --border:240 6% 90%;--input:240 6% 90%;--foreground:240 10% 8%;--muted:240 4% 46%;--muted-2:240 4% 40%;
  --primary:263 70% 55%;--primary-fg:0 0% 100%;--ring:263 70% 55%;--accent:217 91% 50%;
  --green:142 71% 38%;--red:0 72% 51%;--add-bg:142 76% 45% / .12;--del-bg:0 72% 55% / .10;
  --wadd:142 71% 40% / .28;--wdel:0 72% 51% / .24;
  --t-kw:355 65% 47%;--t-str:214 90% 30%;--t-num:212 92% 38%;--t-com:240 4% 50%;--t-fn:270 70% 50%;
}}

/* ---- base ---- */
*{box-sizing:border-box;border-color:hsl(var(--border))}
html{scroll-behavior:smooth}
body{margin:0;background:hsl(var(--background));color:hsl(var(--foreground));
  font:14px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.mono,.code,.diff,.hunk-head,.path,kbd{font-family:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace}
a{color:inherit;text-decoration:none}
svg.i{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;display:block}
.muted{color:hsl(var(--muted))}
.plus{color:hsl(var(--green));font-variant-numeric:tabular-nums}
.minus{color:hsl(var(--red));font-variant-numeric:tabular-nums}
.dotsep{margin:0 6px;color:hsl(var(--border))}

/* ---- buttons ---- */
.btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:calc(var(--radius) - 2px);
  border:1px solid hsl(var(--border));background:hsl(var(--card));color:hsl(var(--foreground));
  font-size:13px;font-weight:500;cursor:pointer;transition:background .12s,border-color .12s,color .12s;white-space:nowrap;line-height:1}
.btn:hover{background:hsl(var(--card-2))}
.btn:focus-visible{outline:none;box-shadow:0 0 0 2px hsl(var(--background)),0 0 0 4px hsl(var(--ring))}
.btn.icon-only{width:32px;padding:0;justify-content:center}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;
  border:none;background:transparent;color:hsl(var(--muted));cursor:pointer;transition:background .12s,color .12s}
.icon-btn:hover{background:hsl(var(--card-2));color:hsl(var(--foreground))}

/* ---- segmented control (Unified / Split) ---- */
.segmented{display:inline-flex;padding:3px;gap:2px;background:hsl(var(--card-2));border:1px solid hsl(var(--border));
  border-radius:calc(var(--radius) - 2px)}
.segmented button{height:26px;padding:0 12px;border:none;background:transparent;color:hsl(var(--muted));
  font-size:12.5px;font-weight:500;border-radius:5px;cursor:pointer;transition:background .12s,color .12s}
.segmented button[aria-selected="true"]{background:hsl(var(--card));color:hsl(var(--foreground));
  box-shadow:0 1px 2px rgba(0,0,0,.15)}

/* ---- badges ---- */
.badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;font-size:11px;font-weight:600;
  border-radius:999px;border:1px solid transparent;line-height:1;letter-spacing:.01em}
.badge.added{color:hsl(var(--green));background:hsl(var(--green)/.12);border-color:hsl(var(--green)/.3)}
.badge.deleted{color:hsl(var(--red));background:hsl(var(--red)/.12);border-color:hsl(var(--red)/.3)}
.badge.renamed{color:hsl(var(--primary));background:hsl(var(--primary)/.12);border-color:hsl(var(--primary)/.3)}
.badge.modified{color:hsl(var(--accent));background:hsl(var(--accent)/.12);border-color:hsl(var(--accent)/.3)}
.badge.missing{color:hsl(var(--muted));background:hsl(var(--card-2))}

kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;
  font-size:11px;border-radius:5px;border:1px solid hsl(var(--border));background:hsl(var(--card-2));
  color:hsl(var(--muted-2));box-shadow:0 1px 0 hsl(var(--border))}

/* ---- header ---- */
header.top{position:sticky;top:0;z-index:40;background:hsl(var(--background)/.92);backdrop-filter:blur(12px);
  border-bottom:1px solid hsl(var(--border))}
.top-inner{max-width:1800px;margin:0 auto;padding:14px 28px 0}
.title-row{display:flex;align-items:flex-start;gap:16px}
h1{font-size:18px;font-weight:650;margin:0;letter-spacing:-.01em}
.sub{color:hsl(var(--muted));margin-top:3px;font-size:13px}
.title-block{min-width:0}
.title-block .sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head-actions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.toolbar{display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap}
.totals{margin-left:auto;color:hsl(var(--muted));font-size:12.5px;display:flex;align-items:center;gap:2px}
.totals strong{color:hsl(var(--foreground));font-weight:600}
.progress{height:2px;background:hsl(var(--border));margin-top:12px}
.progress-bar{height:100%;width:0;background:hsl(var(--primary));transition:width .3s ease}

/* ---- layout (wide, no shift) ---- */
:root{--header-h:96px}
.wrap{max-width:1800px;margin:0 auto;padding:20px 28px 96px}
.layout{display:grid;grid-template-columns:248px minmax(0,1fr);gap:24px;align-items:start}

/* ---- sidebar ---- */
nav.sidebar{position:sticky;top:calc(var(--header-h) + 12px);display:flex;flex-direction:column;gap:3px;
  max-height:calc(100vh - var(--header-h) - 28px);overflow:auto;padding-right:4px}
.sidebar-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:hsl(var(--muted));
  padding:2px 8px 8px}
.nav-item{display:flex;align-items:flex-start;gap:10px;padding:9px 11px;border-radius:calc(var(--radius) - 2px);
  color:hsl(var(--muted-2));font-size:13px;line-height:1.4;border:1px solid transparent;
  transition:background .12s,color .12s,border-color .12s}
.nav-item:hover{background:hsl(var(--card-2));color:hsl(var(--foreground))}
.nav-item.active{background:hsl(var(--card-2));color:hsl(var(--foreground));border-color:hsl(var(--border))}
.nav-item .ni{display:inline-flex;width:22px;height:22px;flex:none;align-items:center;justify-content:center;margin-top:1px;
  border-radius:6px;background:hsl(var(--card));border:1px solid hsl(var(--border));font-size:11px;font-weight:600;
  color:hsl(var(--muted-2));font-variant-numeric:tabular-nums}
.nav-item.active .ni{background:hsl(var(--primary));color:hsl(var(--primary-fg));border-color:transparent}
/* readable: wrap up to 3 lines, no click-to-understand */
.nav-item .nt{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.nav-item .nchk{margin-left:auto;color:hsl(var(--green));opacity:0;flex:none;display:inline-flex;margin-top:2px}
.nav-item .nchk .i{width:14px;height:14px}
.nav-item.done .nchk{opacity:1}
.nav-item.done .nt{color:hsl(var(--muted));text-decoration:line-through}

/* ---- steps: one at a time (paginated) ---- */
main{min-width:0}
.step{display:none;scroll-margin-top:calc(var(--header-h) + 8px)}
.step.current{display:grid;grid-template-columns:216px minmax(0,1fr);gap:24px;animation:fade .18s ease}
@keyframes fade{from{opacity:.4}to{opacity:1}}
.step:focus{outline:none}
.step-body{min-width:0}
.step-head{display:flex;align-items:flex-start;gap:14px;padding-bottom:4px}
.step-num{display:inline-flex;width:32px;height:32px;flex:none;align-items:center;justify-content:center;
  border-radius:9px;background:hsl(var(--primary));color:hsl(var(--primary-fg));font-weight:700;font-size:15px;
  font-variant-numeric:tabular-nums}
.step.done .step-num{background:hsl(var(--green))}
.step-title{min-width:0;flex:1}
.step-head h2{font-size:20px;font-weight:650;margin:0;letter-spacing:-.01em;line-height:1.25}
.step-meta{color:hsl(var(--muted));font-size:12.5px;margin-top:4px}
.review{margin-left:auto;display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;flex:none;
  font-size:13px;color:hsl(var(--muted-2));padding:6px 12px;border-radius:calc(var(--radius) - 2px);
  border:1px solid hsl(var(--border));background:hsl(var(--card));transition:background .12s,color .12s,border-color .12s}
.review:hover{background:hsl(var(--card-2))}
.review input{position:absolute;opacity:0;pointer-events:none}
.review-face{width:16px;height:16px;border-radius:5px;border:1.5px solid hsl(var(--border));display:inline-flex;
  align-items:center;justify-content:center;color:transparent;transition:background .12s,border-color .12s,color .12s}
.review-face .i{width:11px;height:11px;stroke-width:3}
.review input:checked + .review-face{background:hsl(var(--green));border-color:transparent;color:#fff}
.step.done .review{color:hsl(var(--green));border-color:hsl(var(--green)/.4)}

/* readable summary + notes: bigger text, real bullets */
.step-summary{background:hsl(var(--card));border:1px solid hsl(var(--border));
  border-radius:var(--radius);padding:14px 18px;margin:14px 0 16px}
.summary-list{margin:0;font-size:15px;line-height:1.65;color:hsl(var(--foreground))}
ul.summary-list{padding-left:20px}
ul.summary-list li{margin:3px 0}
p.summary-list{margin:0}
.ficon{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 5px;flex:none;
  border-radius:5px;font-size:9.5px;font-weight:700;letter-spacing:.02em;background:hsl(var(--card-2));
  border:1px solid hsl(var(--border));color:hsl(var(--muted))}
.ficon .i{width:14px;height:14px}
.ficon.lang-js{color:#e3b341}.ficon.lang-py{color:#6ea8dc}.ficon.lang-css{color:#c586e0}
.ficon.lang-md{color:#589bff}.ficon.lang-json{color:#a1a1aa}.ficon.lang-go{color:#2bcadf}
.ficon.lang-rs{color:#e0a483}.ficon.ph{color:hsl(var(--muted))}

/* ---- changed-file tree ---- */
.file-tree{position:sticky;top:calc(var(--header-h) + 12px);min-width:0;max-height:calc(100vh - var(--header-h) - 28px);
  overflow:auto;padding:0 16px 8px 0;border-right:1px solid hsl(var(--border))}
.tree-head{display:flex;align-items:center;justify-content:space-between;padding:2px 6px 9px;
  color:hsl(var(--muted));font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.tree-head span:last-child{font-variant-numeric:tabular-nums}
.tree-root,.tree-dir ul{list-style:none;padding:0;margin:0}
.tree-dir ul{padding-left:14px;margin-left:9px;border-left:1px solid hsl(var(--border)/.8)}
.tree-dir>summary,.tree-file{width:100%;min-width:0;display:flex;align-items:center;gap:6px;height:30px;padding:0 6px;
  border:0;border-radius:5px;background:transparent;color:hsl(var(--muted-2));font:12.5px/1.2 inherit;
  text-align:left;list-style:none;cursor:pointer;transition:background .12s,color .12s}
.tree-dir>summary::-webkit-details-marker{display:none}
.tree-dir>summary:hover,.tree-file:hover{background:hsl(var(--card-2));color:hsl(var(--foreground))}
.tree-chev{display:inline-flex;flex:none;transition:transform .12s;color:hsl(var(--muted))}
.tree-chev .i{width:12px;height:12px}
.tree-dir:not([open])>summary .tree-chev{transform:rotate(-90deg)}
.tree-folder{display:inline-flex;flex:none;color:hsl(var(--muted))}
.tree-folder .i{width:15px;height:15px}
.tree-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree-indent{width:0;flex:none}
.tree-file .ficon{min-width:19px;width:19px;height:18px;padding:0;font-size:8px;border:0;background:transparent}
.tree-file.active{background:hsl(var(--primary)/.12);color:hsl(var(--foreground))}
.tree-status{width:6px;height:6px;border-radius:999px;flex:none;margin-left:auto;background:hsl(var(--accent))}
.tree-status.added{background:hsl(var(--green))}.tree-status.deleted{background:hsl(var(--red))}
.tree-status.renamed{background:hsl(var(--primary))}.tree-status.missing{background:hsl(var(--muted))}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

/* per-step nav footer */
.step-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:24px;
  padding-top:20px;border-top:1px solid hsl(var(--border))}
.step-nav-btn{height:38px;padding:0 18px;font-size:14px}
.step-nav-btn.primary{background:hsl(var(--primary));color:hsl(var(--primary-fg));border-color:transparent}
.step-nav-btn.primary:hover{background:hsl(var(--primary)/.9)}

/* ---- file card ---- */
.files{display:flex;flex-direction:column;gap:14px}
.file{background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:var(--radius);overflow:hidden;
  scroll-margin-top:calc(var(--header-h) + 16px)}
.file.file-targeted{animation:file-target 1.35s ease}
@keyframes file-target{0%,72%{border-color:hsl(var(--primary));box-shadow:0 0 0 3px hsl(var(--primary)/.16)}100%{border-color:hsl(var(--border));box-shadow:none}}
.file.placeholder{border-style:dashed;background:transparent}
.file-head{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;list-style:none;
  user-select:none;background:hsl(var(--card))}
details.file[open] .file-head{border-bottom:1px solid hsl(var(--border))}
.file-head::-webkit-details-marker{display:none}
.chev{color:hsl(var(--muted));transition:transform .15s;display:inline-flex;flex:none}
details.file:not([open]) .chev{transform:rotate(-90deg)}
/* path: filename prominent, dir subdued + truncated, full path on hover */
.path{min-width:0;flex:1;display:flex;align-items:center;font-size:13.5px;
  font-family:ui-monospace,Menlo,Consolas,monospace}
.path .p-dir{color:hsl(var(--muted));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;
  unicode-bidi:plaintext;flex:0 1 auto;min-width:0}
.path .p-name{color:hsl(var(--foreground));font-weight:600;flex:none;white-space:nowrap}
.path .arrow{flex:none;display:inline-flex;color:hsl(var(--muted));margin:0 4px}
.arrow{color:hsl(var(--muted))}
.copy{opacity:0;transition:opacity .12s;flex:none}
.file-head:hover .copy,.copy:focus-visible{opacity:1}
.copy.copied{opacity:1;color:hsl(var(--green))}
.stat{flex:none;font-size:12px;white-space:nowrap;display:flex;gap:8px;font-variant-numeric:tabular-nums;margin-left:4px}
.file-body{overflow-x:auto}


/* ---- diff table ---- */
.hunk-head{background:hsl(var(--card-2));color:hsl(var(--muted));padding:5px 14px;font-size:12px;
  border-top:1px solid hsl(var(--border));font-family:ui-monospace,Menlo,Consolas,monospace}
.file-body>.hunk-head:first-child{border-top:none}
table.diff{width:100%;border-collapse:collapse;font-size:12.5px;line-height:1.5;table-layout:fixed}
table.diff.split{table-layout:fixed}
table.diff.split .cg{width:44px}
table.diff.split col:not(.cg){width:calc(50% - 44px)}
table.diff.split td.code{overflow:hidden;text-overflow:ellipsis}
tr.ln>td{padding:0 6px;white-space:pre;vertical-align:top;overflow-wrap:normal}
tr.ln:hover>td{background:hsl(var(--foreground)/.03)}
tr.ln:target>td{background:hsl(var(--wadd))}
td.gutter{color:hsl(var(--muted));text-align:right;width:48px;min-width:48px;user-select:none;padding:0 8px;
  font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,Consolas,monospace}
td.gutter .lnref{color:inherit;opacity:.55}
td.gutter .lnref:hover{opacity:1;text-decoration:underline}
td.sign{width:16px;min-width:16px;user-select:none;text-align:center;color:hsl(var(--muted));padding:0}
td.code{width:auto;white-space:pre-wrap;word-break:break-word;padding-right:12px}
tr.add>td.code,tr.add>td.gutter{background:hsl(var(--add-bg))}
tr.del>td.code,tr.del>td.gutter{background:hsl(var(--del-bg))}
tr.add>td.sign{color:hsl(var(--green))}tr.del>td.sign{color:hsl(var(--red))}
/* split cells */
table.split td.code.del{background:hsl(var(--del-bg))}
table.split td.code.add{background:hsl(var(--add-bg))}
table.split td.empty{background:hsl(var(--card-2)/.4)}
table.split td.gutter{border-right:1px solid hsl(var(--border)/.6)}
.w{border-radius:3px;padding:0 1px;margin:0 -1px}
.w.wadd{background:hsl(var(--wadd))}
.w.wdel{background:hsl(var(--wdel))}
.fold-row>td{padding:0}
.fold-btn{width:100%;text-align:left;background:hsl(var(--card-2)/.5);border:none;
  border-top:1px solid hsl(var(--border));border-bottom:1px solid hsl(var(--border));
  color:hsl(var(--muted));cursor:pointer;padding:5px 14px;font-size:12px;font-family:inherit;transition:color .12s,background .12s}
.fold-btn:hover{color:hsl(var(--accent));background:hsl(var(--card-2))}
.fold-ic{margin-right:8px;letter-spacing:2px}
.t-kw{color:hsl(var(--t-kw))}.t-str{color:hsl(var(--t-str))}.t-num{color:hsl(var(--t-num))}
.t-com{color:hsl(var(--t-com));font-style:italic}.t-fn{color:hsl(var(--t-fn))}
.binary{padding:16px;color:hsl(var(--muted));font-style:italic;font-size:13px}
.file-note{padding:12px 16px;background:hsl(var(--card-2)/.5);border-bottom:1px solid hsl(var(--border))}
.file-note .note-list{margin:0;font-size:14px;line-height:1.6;color:hsl(var(--foreground))}
.file-note ul.note-list{padding-left:20px}
.file-note ul.note-list li{margin:3px 0}
.file-note p.note-list{margin:0}
.file-note--missing{color:hsl(var(--red)/.9);font-size:13px;font-style:italic;background:hsl(var(--red)/.06)}
.rename-note{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;color:hsl(var(--muted-2))}
.rename-note .i{width:20px;height:20px;color:hsl(var(--primary));flex:none;margin-top:1px}
.rn-title{font-weight:600;color:hsl(var(--foreground));font-size:13px}
.rn-paths{font-size:12.5px;margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.rn-paths .i{width:15px;height:15px;color:hsl(var(--muted))}
.rn-hint{font-size:12px;margin-top:6px;color:hsl(var(--muted))}

/* ---- split / unified visibility ---- */
.diff.split{display:none}
body[data-view="split"] .diff.split{display:table}
body[data-view="split"] .diff.unified{display:none}

/* ---- shortcuts overlay ---- */
.overlay{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;
  background:hsl(240 10% 2% / .6);backdrop-filter:blur(2px)}
.overlay.open{display:flex}
.sheet{width:min(520px,92vw);max-height:82vh;overflow:auto;background:hsl(var(--popover));
  border:1px solid hsl(var(--border));border-radius:calc(var(--radius) + 2px);box-shadow:0 24px 64px rgba(0,0,0,.5)}
.sheet-head{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid hsl(var(--border))}
.sheet-head h3{margin:0;font-size:15px;font-weight:600}
.sheet-head .icon-btn{margin-left:auto}
.sheet-body{padding:8px 20px 20px}
.kb-group{margin-top:14px}
.kb-group h4{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:hsl(var(--muted));margin:0 0 8px}
.kb-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;font-size:13px}
.kb-row .keys{display:flex;gap:5px}

@media(max-width:1150px){
  .layout{grid-template-columns:1fr}
  nav.sidebar{position:static;flex-direction:row;flex-wrap:wrap;max-height:none;margin-bottom:12px}
  .sidebar-label{width:100%}
  .nav-item{flex:0 1 auto}
  .nav-item .nt{-webkit-line-clamp:1;max-width:180px}
  .file-head{position:static}
}
@media(max-width:760px){
  .top-inner,.wrap{padding-left:16px;padding-right:16px}
  .step.current{grid-template-columns:1fr;gap:18px}
  .file-tree{position:static;max-height:240px;padding:0 0 12px;border-right:0;border-bottom:1px solid hsl(var(--border))}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}.step.current,.file.file-targeted{animation:none}
}
</style>
</head>
<body data-view="unified">
<header class="top"><div class="top-inner">
  <div class="title-row">
    <div class="title-block">
      <h1>${esc(title)}</h1>
      ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}
    </div>
    <div class="head-actions">
      <div class="segmented" role="tablist" aria-label="Diff view">
        <button id="viewUnified" role="tab" aria-selected="true" title="Unified view (U)">Unified</button>
        <button id="viewSplit" role="tab" aria-selected="false" title="Split view (U)">Split</button>
      </div>
      <button class="btn icon-only" id="themeToggle" title="Toggle theme (T)" aria-label="Toggle theme"><span aria-hidden="true">◐</span></button>
      <button class="btn icon-only" id="helpBtn" title="Keyboard shortcuts (?)" aria-label="Shortcuts">${ICONS.keyboard}</button>
    </div>
  </div>
  <div class="toolbar">
    <button class="btn" id="expandAll" title="Expand all files (E)">Expand all</button>
    <button class="btn" id="collapseAll" title="Collapse all files (C)">Collapse all</button>
    <span class="totals"><strong id="reviewedCount">0</strong>/${steps.length} reviewed<span class="dotsep">·</span><span class="plus">+${totalAdd}</span>&nbsp;<span class="minus">−${totalDel}</span><span class="dotsep">·</span>${steps.length} steps</span>
  </div>
  <div class="progress"><div class="progress-bar" id="progressBar"></div></div>
</div></header>

<div class="wrap"><div class="layout">
  <nav class="sidebar">
    <div class="sidebar-label">Steps</div>
    ${nav}
  </nav>
  <main>${steps.map((s, i) => renderStep(s, i, steps.length)).join("")}</main>
</div></div>

<div class="overlay" id="overlay">
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
    <div class="sheet-head"><h3>Keyboard shortcuts</h3><button class="icon-btn" id="helpClose" aria-label="Close">✕</button></div>
    <div class="sheet-body">
      <div class="kb-group"><h4>Navigate</h4>
        <div class="kb-row"><span>Next / previous step</span><span class="keys"><kbd>→</kbd><kbd>←</kbd></span></div>
        <div class="kb-row"><span>Next / previous step</span><span class="keys"><kbd>↓</kbd><kbd>↑</kbd></span></div>
        <div class="kb-row"><span>Jump to step</span><span class="keys"><kbd>1</kbd>…<kbd>9</kbd></span></div>
        <div class="kb-row"><span>First / last step</span><span class="keys"><kbd>Home</kbd><kbd>End</kbd></span></div>
      </div>
      <div class="kb-group"><h4>Act on current step</h4>
        <div class="kb-row"><span>Toggle reviewed</span><span class="keys"><kbd>Enter</kbd><kbd>R</kbd></span></div>
      </div>
      <div class="kb-group"><h4>View</h4>
        <div class="kb-row"><span>Unified / Split</span><span class="keys"><kbd>U</kbd></span></div>
        <div class="kb-row"><span>Expand / collapse all files</span><span class="keys"><kbd>E</kbd><kbd>C</kbd></span></div>
        <div class="kb-row"><span>Toggle theme</span><span class="keys"><kbd>T</kbd></span></div>
        <div class="kb-row"><span>Show this help</span><span class="keys"><kbd>?</kbd></span></div>
        <div class="kb-row"><span>Close dialog</span><span class="keys"><kbd>Esc</kbd></span></div>
      </div>
    </div>
  </div>
</div>

<script>
(function(){
  var DOC="prstory:${docId}";
  var TOTAL=${steps.length};
  var qa=function(s,r){return [].slice.call((r||document).querySelectorAll(s))};
  var files=function(){return qa("details.file")};
  var steps=qa(".step");
  var cur=0;

  /* keep sticky offsets exact: measure header height into --header-h */
  var header=document.querySelector("header.top");
  function measure(){ document.documentElement.style.setProperty("--header-h", header.offsetHeight+"px"); }
  measure(); window.addEventListener("resize",measure);

  /* theme: default = system; toggle sets explicit override (persist) */
  var savedTheme=localStorage.getItem(DOC+":theme");
  if(savedTheme) document.documentElement.setAttribute("data-theme",savedTheme);
  function toggleTheme(){
    var t=document.documentElement.getAttribute("data-theme");
    if(!t) t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
    var next=t==="dark"?"light":"dark";
    document.documentElement.setAttribute("data-theme",next);
    localStorage.setItem(DOC+":theme",next);
  }
  document.getElementById("themeToggle").onclick=toggleTheme;

  /* view mode: unified | split (persist) */
  var uBtn=document.getElementById("viewUnified"), sBtn=document.getElementById("viewSplit");
  function setView(v){
    document.body.setAttribute("data-view",v);
    uBtn.setAttribute("aria-selected",v==="unified");
    sBtn.setAttribute("aria-selected",v==="split");
    localStorage.setItem(DOC+":view",v);
  }
  uBtn.onclick=function(){setView("unified")};
  sBtn.onclick=function(){setView("split")};
  setView(localStorage.getItem(DOC+":view")||"unified");
  function toggleView(){setView(document.body.getAttribute("data-view")==="split"?"unified":"split")}

  /* ---- paginated steps: only the current step is visible ---- */
  var navLinks={}; qa("[data-nav]").forEach(function(a){navLinks[a.dataset.nav]=a});
  function showStep(i,opts){
    cur=Math.max(0,Math.min(steps.length-1,i));
    steps.forEach(function(s,idx){ s.classList.toggle("current", idx===cur); });
    Object.keys(navLinks).forEach(function(k){navLinks[k].classList.remove("active")});
    var id=steps[cur].dataset.step; if(navLinks[id])navLinks[id].classList.add("active");
    localStorage.setItem(DOC+":step", cur);
    if(!opts||!opts.noScroll){ window.scrollTo({top:0,behavior:(opts&&opts.instant)?"auto":"smooth"}); }
  }

  /* sidebar + any [data-goto] button drive pagination */
  qa("[data-nav]").forEach(function(a){
    a.onclick=function(e){e.preventDefault(); showStep(+a.dataset.nav-1);};
  });
  document.addEventListener("click",function(e){
    var b=e.target.closest("[data-goto]"); if(!b) return;
    e.preventDefault();
    if(b.dataset.goto==="top"){ showStep(0); } else { showStep(+b.dataset.goto); }
  });

  /* changed-file tree: reveal, select, and focus the matching diff */
  var targetTimer;
  document.addEventListener("click",function(e){
    var b=e.target.closest("[data-file-target]"); if(!b) return;
    var target=document.getElementById(b.dataset.fileTarget); if(!target) return;
    e.preventDefault();
    qa(".tree-file.active").forEach(function(x){x.classList.remove("active");x.removeAttribute("aria-current")});
    b.classList.add("active"); b.setAttribute("aria-current","true");
    target.open=true;
    target.classList.remove("file-targeted"); void target.offsetWidth; target.classList.add("file-targeted");
    var reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({behavior:reduced?"auto":"smooth",block:"start"});
    clearTimeout(targetTimer); targetTimer=setTimeout(function(){target.classList.remove("file-targeted")},1400);
  });

  /* expand / collapse all */
  document.getElementById("expandAll").onclick=function(){files().forEach(function(d){d.open=true})};
  document.getElementById("collapseAll").onclick=function(){files().forEach(function(d){d.open=false})};

  /* copy path */
  document.addEventListener("click",function(e){
    var b=e.target.closest(".copy"); if(!b) return; e.preventDefault();
    navigator.clipboard&&navigator.clipboard.writeText(b.dataset.copy);
    b.classList.add("copied"); setTimeout(function(){b.classList.remove("copied")},900);
  });

  /* fold unchanged context */
  document.addEventListener("click",function(e){
    var b=e.target.closest(".fold-btn"); if(!b) return;
    qa('[data-fold-member="'+b.dataset.target+'"]').forEach(function(r){r.hidden=false});
    qa('.fold-btn[data-target="'+b.dataset.target+'"]').forEach(function(x){var r=x.closest(".fold-row"); if(r)r.remove()});
  });

  /* review state */
  var reviewed=JSON.parse(localStorage.getItem(DOC+":reviewed")||"{}");
  function refreshProgress(){
    var n=Object.keys(reviewed).filter(function(k){return reviewed[k]}).length;
    document.getElementById("reviewedCount").textContent=n;
    document.getElementById("progressBar").style.width=(TOTAL?n/TOTAL*100:0)+"%";
  }
  function applyReviewed(id,on){
    var s=document.getElementById("step-"+id), nv=document.querySelector('[data-nav="'+id+'"]');
    if(s)s.classList.toggle("done",on); if(nv)nv.classList.toggle("done",on);
  }
  qa(".review-box").forEach(function(box){
    var id=box.dataset.step; box.checked=!!reviewed[id]; applyReviewed(id,box.checked);
    box.onchange=function(){reviewed[id]=box.checked;localStorage.setItem(DOC+":reviewed",JSON.stringify(reviewed));applyReviewed(id,box.checked);refreshProgress()};
  });
  refreshProgress();
  function toggleReviewed(i){var b=steps[i]&&steps[i].querySelector(".review-box"); if(b){b.checked=!b.checked;b.onchange()}}

  /* keyboard shortcuts overlay */
  var overlay=document.getElementById("overlay");
  function openHelp(){overlay.classList.add("open")}
  function closeHelp(){overlay.classList.remove("open")}
  document.getElementById("helpBtn").onclick=openHelp;
  document.getElementById("helpClose").onclick=closeHelp;
  overlay.onclick=function(e){if(e.target===overlay)closeHelp()};

  /* intuitive (non-vim) keymap */
  document.addEventListener("keydown",function(e){
    var tag=(e.target.tagName||"").toLowerCase();
    if(tag==="input"||tag==="textarea"||e.target.isContentEditable) return;
    if(e.key==="Escape"){ closeHelp(); return; }
    if(overlay.classList.contains("open")) return;
    if(e.metaKey||e.ctrlKey){
      if(e.key>="1"&&e.key<="9"){var n=+e.key-1; if(n<steps.length){e.preventDefault();showStep(n)}}
      return;
    }
    if(e.altKey) return;
    switch(e.key){
      case "ArrowRight": case "ArrowDown": e.preventDefault(); showStep(cur+1); break;
      case "ArrowLeft": case "ArrowUp": e.preventDefault(); showStep(cur-1); break;
      case "Home": e.preventDefault(); showStep(0); break;
      case "End": e.preventDefault(); showStep(steps.length-1); break;
      case "Enter": e.preventDefault(); toggleReviewed(cur); break;
      case "u": case "U": toggleView(); break;
      case "e": case "E": files().forEach(function(d){d.open=true}); break;
      case "c": case "C": files().forEach(function(d){d.open=false}); break;
      case "r": case "R": toggleReviewed(cur); break;
      case "t": case "T": toggleTheme(); break;
      case "?": openHelp(); break;
      default:
        if(e.key>="1"&&e.key<="9"){var m=+e.key-1; if(m<steps.length){e.preventDefault();showStep(m)}}
    }
  });

  /* restore last-viewed step; support #step-N deep links */
  var start=0;
  var hash=(location.hash.match(/step-(\d+)/)||[])[1];
  if(hash){ start=+hash-1; }
  else { var saved=+localStorage.getItem(DOC+":step"); if(saved>=0&&saved<steps.length) start=saved; }
  showStep(start,{instant:true,noScroll:true});
})();
</script>
</body>
</html>`
}

// --------------------------------------------------------------- main
function openInBrowser(path) {
  const plat = process.platform
  const cmd = plat === "darwin" ? "open" : plat === "win32" ? "cmd" : "xdg-open"
  const args = plat === "win32" ? ["/c", "start", "", path] : [path]
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref()
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const diffText = args.diff ? fs.readFileSync(args.diff, "utf8") : readStdin()
  if (!diffText.trim()) {
    console.error("No diff provided. Pipe `git diff` in, or pass --diff <file>.")
    process.exit(1)
  }
  const plan = loadPlan(args.plan)
  const files = parseDiff(diffText)
  const steps = buildSteps(plan, files)
  const title = args.title || (plan && plan.title) || "Change storyboard"
  const subtitle = (plan && plan.subtitle) || ""
  const docId = hash((plan && plan.title ? plan.title + "|" : "") + diffText)
  const html = renderHtml({ title, subtitle, steps, docId })
  const out = args.out || "storyboard.html"
  fs.writeFileSync(out, html)
  const abs = fs.realpathSync(out)
  console.error(`Wrote ${out} — ${steps.length} steps, ${Object.keys(files).length} files.`)
  if (args.open) {
    openInBrowser(abs)
    console.error("Opened in default browser.")
  } else {
    console.error(`Open with:  file://${abs}`)
  }
}

main()
