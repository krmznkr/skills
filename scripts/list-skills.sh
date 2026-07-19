#!/usr/bin/env bash
# List every skill in this repo with its description (parsed from SKILL.md
# frontmatter).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"

while IFS= read -r skill_md; do
  name="$(basename "$(dirname "$skill_md")")"
  desc="$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); print; exit}' "$skill_md")"
  printf '%-28s %s\n' "$name" "$desc"
done < <(find "$SKILLS_DIR" -mindepth 2 -name SKILL.md | sort)
