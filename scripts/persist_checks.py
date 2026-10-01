#!/usr/bin/env python3
"""Save collected opportunities and checks without overwriting a newer human commit.

On a branch race, report stale=true and let the newer workflow publish instead.
The caller must skip artifact upload/deployment when stale is true. We deliberately
do not reset, rebase, force-push or merge a review queue: a human's exclusions and
approved adverts on the remote branch must win. Unrelated local edits stay intact.
"""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys


GENERATED_FILES = (
    "site/data/health.json",
    "data/review-queue.json",
    "site/data/opportunities.json",
)
BOT_NAME = "github-actions[bot]"
BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"


class PersistenceError(RuntimeError):
    pass


def _git(repo, *args, check=True):
    result = subprocess.run(
        ["git", *args], cwd=repo, text=True, capture_output=True,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )
    if check and result.returncode:
        raise PersistenceError(result.stderr.strip() or "Git command failed.")
    return result


def _fetch_head(repo, remote, branch, attempts):
    for _ in range(attempts):
        result = _git(repo, "fetch", "--no-tags", remote,
                      f"refs/heads/{branch}", check=False)
        if result.returncode == 0:
            return _git(repo, "rev-parse", "FETCH_HEAD").stdout.strip()
    raise PersistenceError("Could not fetch the latest branch: " + result.stderr.strip())


def persist(repo, branch="main", remote="origin", attempts=3):
    """Return stale/saved booleans; real permission/network failures raise."""
    repo = Path(repo)
    if not 1 <= attempts <= 3:
        raise PersistenceError("Attempts must be between 1 and 3.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", remote):
        raise PersistenceError("Use a configured remote name, such as origin.")
    _git(repo, "check-ref-format", "--branch", branch)
    base = _git(repo, "rev-parse", "HEAD").stdout.strip()
    if _git(repo, "diff", "--name-only", "--diff-filter=U").stdout.strip():
        raise PersistenceError("Resolve existing merge conflicts before saving checks.")

    latest = _fetch_head(repo, remote, branch, attempts)
    if latest != base:
        return {"stale": True, "saved": False}

    # The collector leaves its output unstaged. Do not absorb pre-existing staged
    # human changes to these same files into an automatic publication commit.
    staged = _git(repo, "diff", "--cached", "--name-only", "--",
                  *GENERATED_FILES).stdout.strip()
    if staged:
        raise PersistenceError("Generated files already contain staged edits; commit "
                               "or unstage those edits before automatic publication.")
    for filename in GENERATED_FILES:
        path = repo / filename
        if not path.is_file() or path.is_symlink():
            raise PersistenceError(f"Expected a generated regular file: {filename}")
    # Inspect generated changes, leaving unrelated human files alone.
    changed = _git(repo, "diff", "--quiet", "HEAD", "--", *GENERATED_FILES,
                   check=False)
    untracked = _git(repo, "ls-files", "--others", "--exclude-standard", "--",
                     *GENERATED_FILES).stdout.strip()
    if changed.returncode not in (0, 1):
        raise PersistenceError(changed.stderr.strip() or "Cannot inspect generated changes.")
    if changed.returncode == 0 and not untracked:
        return {"stale": False, "saved": False}

    _git(repo, "add", "--", *GENERATED_FILES)
    # --only prevents unrelated files already staged by a caller being committed.
    _git(repo, "-c", f"user.name={BOT_NAME}", "-c", f"user.email={BOT_EMAIL}",
         "commit", "--only", "-m", "Update opportunities and source checks",
         "--", *GENERATED_FILES)
    generated_head = _git(repo, "rev-parse", "HEAD").stdout.strip()

    for _ in range(attempts):
        pushed = _git(repo, "push", remote, f"HEAD:refs/heads/{branch}", check=False)
        if pushed.returncode == 0:
            return {"stale": False, "saved": True}
        latest = _fetch_head(repo, remote, branch, attempts)
        if latest == generated_head:
            # A push can reach the server even if its acknowledgement is lost.
            return {"stale": False, "saved": True}
        if latest != base:
            return {"stale": True, "saved": False}
    raise PersistenceError("Could not save checks; the remote branch did not move. "
                           "Check repository write permissions or branch rules. "
                           + pushed.stderr.strip())


def emit_outputs(result, output_path=None):
    output_path = output_path or os.environ.get("GITHUB_OUTPUT")
    lines = "".join(f"{key}={str(value).lower()}\n" for key, value in result.items())
    if output_path:
        with open(output_path, "a", encoding="utf-8") as stream:
            stream.write(lines)
    print(lines, end="")
    if result["stale"]:
        print("::warning::The branch changed during this run. Generated results were "
              "not pushed; skip this run's deployment and allow the newer run to publish.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--branch", default="main")
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--attempts", type=int, choices=range(1, 4), default=3)
    args = parser.parse_args()
    try:
        result = persist(args.repo, args.branch, args.remote, args.attempts)
    except (PersistenceError, OSError) as error:
        print(f"Unable to preserve generated checks: {error}", file=sys.stderr)
        return 1
    emit_outputs(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
