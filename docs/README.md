# Documentation index

This repository packages an agent-facing skill and a deterministic browser
renderer. Human-facing product documentation and agent instructions are kept
separate so each audience gets the right level of detail.

```mermaid
flowchart LR
  product["README<br/>human-facing product page"]
  skill["SKILL.md<br/>agent workflow"]
  reference["REFERENCE.md<br/>schema + CLI reference"]
  architecture["Architecture<br/>boundaries + data flow"]
  contributing["CONTRIBUTING<br/>authoring rules"]
  roadmap["Roadmap<br/>missing safeguards"]

  product --> skill --> reference
  product --> architecture
  architecture --> contributing
  contributing --> roadmap

  classDef entry fill:#dbeafe,stroke:#2563eb,color:#172554,stroke-width:2px
  classDef agent fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef guide fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef action fill:#fef3c7,stroke:#d97706,color:#78350f
  class product entry
  class skill,reference,architecture agent
  class contributing guide
  class roadmap action
```

| Document | Audience and purpose |
| --- | --- |
| [`../README.md`](../README.md) | People evaluating, installing, or invoking the skill |
| [`../skills/pr-storyboard/SKILL.md`](../skills/pr-storyboard/SKILL.md) | Agents executing the required storyboard process |
| [`../skills/pr-storyboard/REFERENCE.md`](../skills/pr-storyboard/REFERENCE.md) | Maintainers and agents needing the complete plan schema and renderer CLI |
| [`architecture.md`](architecture.md) | Maintainers reasoning about boundaries, coverage, artifacts, trust, and failure behavior |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Contributors changing the skill, renderer, fixtures, or screenshots |
| [`roadmap.md`](roadmap.md) | Maintainers tracking quality and release-system gaps |
| [`../SECURITY.md`](../SECURITY.md) | Private reporting for executable or prompt/data-boundary risks |
