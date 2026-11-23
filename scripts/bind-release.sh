#!/usr/bin/env bash
# Refuses to publish an APK that was not built from the tag's own commit.
#
# Why this is a script and not a few lines inside the workflow: the guard used
# to live in YAML, and the test that protected it matched text — so `if false;
# then … fi`, a `git checkout` before it, or a second publish step all disabled
# the guard while the test stayed green. A test can execute this file and check
# its exit code, which is a guarantee a regex cannot give.
#
# The commit being built comes from BUILT_COMMIT, written to $GITHUB_ENV in the
# step immediately before the build. Deliberately not `git rev-parse HEAD` here:
# a checkout between the build and this step would move HEAD to the tag while
# the APK on disk stayed a branch build, and the guard would print a match.
#
# Inputs (environment):
#   RELEASE_TAG       required, the tag about to receive the APK
#   BUILT_COMMIT      required for a fresh build, the commit captured at checkout
#   EXPECTED_TAG      optional, the tag the version in app.json implies (vX.Y.Z)
#   REUSED_RUN        optional, a run whose artifact is being re-published
#   GITHUB_REPOSITORY optional, owner/repo for the API call
set -euo pipefail

RELEASE_TAG=${RELEASE_TAG:?RELEASE_TAG is required}
REUSED_RUN=${REUSED_RUN:-}

# A tag whose name disagrees with the version inside the APK would put a
# 0.3.23 build on the v0.3.24 release; the commit check below cannot see that.
EXPECTED_TAG=${EXPECTED_TAG:-}
if [[ -n "$EXPECTED_TAG" && "$RELEASE_TAG" != "$EXPECTED_TAG" ]]; then
  echo "::error::Tag $RELEASE_TAG does not match the built $EXPECTED_TAG"
  exit 1
fi

git fetch --force --quiet origin "+refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG"
TAG_SHA=$(git rev-parse "$RELEASE_TAG^{commit}")

if [[ -n "$REUSED_RUN" ]]; then
  # Only a push run builds the commit it reports: a dispatch may carry an APK
  # from an earlier run, and a pull_request run checks out a merge commit that is
  # not head_sha. Without this, a chain of two dispatches could publish an APK
  # whose commit was never compared with the tag.
  RUN_EVENT=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$REUSED_RUN" --jq .event)
  if [[ "$RUN_EVENT" != "push" ]]; then
    echo "::error::run $REUSED_RUN is a '$RUN_EVENT' run, not a push build; its APK is not a build of its own commit"
    exit 1
  fi
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
