#!/usr/bin/env bash
# Refuses to publish an APK that was not built from the tag's own commit.
#
# Why this is a script and not a few lines inside the workflow: the guard used
# to live in YAML, and the test that protected it matched text — so `if false;
# then … fi`, a `git checkout` before it, or a second publish step all disabled
# the guard while the test stayed green. A test can execute this file and check
# its exit code, which is a guarantee a regex cannot give.
#
# The commit being built comes from BUILT_COMMIT, captured once right after
# checkout. Deliberately not `git rev-parse HEAD` here: a checkout between the
# build and this step would move HEAD to the tag while the APK on disk stayed a
# branch build, and the guard would print a match.
#
# Inputs (environment):
#   RELEASE_TAG       required, the tag about to receive the APK
#   BUILT_COMMIT      required for a fresh build, the commit captured at checkout
#   REUSED_RUN        optional, a run whose artifact is being re-published
#   GITHUB_REPOSITORY optional, owner/repo for the API call
set -euo pipefail

RELEASE_TAG=${RELEASE_TAG:?RELEASE_TAG is required}
REUSED_RUN=${REUSED_RUN:-}

git fetch --force --quiet origin "+refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG"
TAG_SHA=$(git rev-parse "$RELEASE_TAG^{commit}")

if [[ -n "$REUSED_RUN" ]]; then
  BUILT_SHA=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$REUSED_RUN" --jq .head_sha)
  WHAT="reused APK from run $REUSED_RUN"
else
  BUILT_SHA=${BUILT_COMMIT:?BUILT_COMMIT is required for a fresh build}
  WHAT="APK built in this run"
fi

if [[ -z "$BUILT_SHA" || "$BUILT_SHA" != "$TAG_SHA" ]]; then
  echo "::error::$WHAT was built from ${BUILT_SHA:-nothing}, but $RELEASE_TAG is $TAG_SHA"
  exit 1
fi

echo "$WHAT matches $RELEASE_TAG ($TAG_SHA)."
