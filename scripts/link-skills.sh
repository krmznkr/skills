#!/usr/bin/env bash
# Symlink every skill in this repo into the local agent skill directories, so a
# `git pull` keeps installed skills current. Idempotent — safe to re-run after
# adding, removing, or renaming a skill.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"

# Target skill directories, one per harness. Add more as needed.
TARGETS=(
  "$HOME/.config/opencode/skill"
  "$HOME/.claude/skills"
)

linked=0

for target in "${TARGETS[@]}"; do
  mkdir -p "$target"
  # Find every skill folder (contains a SKILL.md).
  while IFS= read -r skill_md; do
    skill_dir="$(dirname "$skill_md")"
    name="$(basename "$skill_dir")"
    link="$target/$name"

    # Refresh an existing symlink; refuse to clobber a real directory.
    if [ -L "$link" ]; then
      rm "$link"
    elif [ -e "$link" ]; then
      echo "skip: $link exists and is not a symlink" >&2
      continue
    fi

    ln -s "$skill_dir" "$link"
    echo "linked: $link -> $skill_dir"
    linked=$((linked + 1))
  done < <(find "$SKILLS_DIR" -mindepth 2 -name SKILL.md)
done

echo "done: $linked link(s) created/updated across ${#TARGETS[@]} target(s)."
