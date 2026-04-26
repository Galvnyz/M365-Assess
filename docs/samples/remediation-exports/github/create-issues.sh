# Bulk-create GitHub issues from these markdown files
# Usage:  cd github && bash create-issues.sh <owner>/<repo>
set -euo pipefail
REPO="${1:?owner/repo required}"
for f in *.md; do
  [[ "$f" == "create-issues.sh" || "$f" == "README.md" ]] && continue
  TITLE=$(head -1 "$f" | sed 's/^# //')
  gh issue create --repo "$REPO" --title "$TITLE" --body-file "$f"
done
