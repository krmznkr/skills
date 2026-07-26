# Roadmap and known gaps

The repository currently ships one skill and a dependency-free renderer. Its
next improvements should increase determinism and maintainability without
turning the skill into a large framework.

```mermaid
flowchart LR
  current["Current<br/>one skill + renderer"]
  fixtures["Executable fixtures<br/>schema and coverage"]
  ci["CI<br/>links, scripts, examples"]
  release["Versioned releases<br/>upgrade notes"]
  expand{"Add another skill?"}
  shared["Extract shared conventions<br/>only after repetition"]

  current --> fixtures --> ci --> release --> expand
  expand -->|"yes, repeated needs"| shared
  expand -->|"no"| current

  classDef stable fill:#dbeafe,stroke:#2563eb,color:#172554,stroke-width:2px
  classDef next fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef decision fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef later fill:#dcfce7,stroke:#16a34a,color:#14532d
  class current stable
  class fixtures,ci next
  class expand decision
  class release,shared later
```

| Priority | Gap | Suggested outcome |
| --- | --- | --- |
| Next | Examples are not an automated contract | Render the checked-in example, validate every plan reference, and assert deterministic output structure |
| Next | No repository CI | Check shell syntax, list/link scripts, internal Markdown links, skill frontmatter, renderer fixtures, and generated example consistency |
| Next | No formal schema validation | Validate `plan.json` before rendering and return precise path/line-range errors |
| Later | No versioned release or upgrade policy | Tag meaningful skill/renderer changes and document compatibility expectations |
| Later | Single-skill layout may eventually repeat conventions | Extract shared tooling only after a second skill demonstrates a real common pattern |

Security-sensitive areas—untrusted diff text, generated HTML, file paths, and
prompt instructions—must continue to follow [`../SECURITY.md`](../SECURITY.md).
The architectural boundaries and failure behavior are in
[`architecture.md`](architecture.md).
