from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import persist_checks as checks


class PersistChecksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / "remote.git"
        self.runner = self.root / "runner"
        self.editor = self.root / "editor"
        self.git(self.root, "init", "--bare", "--initial-branch=main", str(self.remote))
        self.git(self.root, "clone", str(self.remote), str(self.runner))
        self.identity(self.runner)
        for filename, contents in {
            "site/data/health.json": {"lastRun": "old"},
            "data/review-queue.json": {"candidates": [], "excluded": []},
            "site/data/opportunities.json": {"opportunities": [{"id": "approved-original"}]},
        }.items():
            self.write(self.runner, filename, contents)
        self.git(self.runner, "add", ".")
        self.git(self.runner, "commit", "-m", "Initial editorial data")
        self.git(self.runner, "push", "origin", "main")
        self.git(self.root, "clone", str(self.remote), str(self.editor))
        self.identity(self.editor)
        self.base = self.git(self.runner, "rev-parse", "HEAD")

    def git(self, cwd, *args):
        result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def identity(self, repo):
        self.git(repo, "config", "user.name", "Test Editor")
        self.git(repo, "config", "user.email", "editor@example.test")

    def write(self, repo, filename, value):
        path = repo / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value) + "\n")

    def generated(self):
        self.write(self.runner, "site/data/health.json", {"lastRun": "new"})
        self.write(self.runner, "data/review-queue.json", {
            "candidates": [{"url": "https://example.test/candidate"}], "excluded": []})

    def editorial_commit(self):
        self.write(self.editor, "site/data/opportunities.json", {
            "opportunities": [{"id": "human-approved-latest"}]})
        self.write(self.editor, "data/review-queue.json", {
            "candidates": [], "excluded": [{"url": "https://example.test/candidate"}]})
        self.git(self.editor, "add", ".")
        self.git(self.editor, "commit", "-m", "Human approves and excludes candidates")
        self.git(self.editor, "push", "origin", "main")
        return self.git(self.editor, "rev-parse", "HEAD")

    def test_only_generated_files_are_pushed_and_staged_human_edits_survive(self):
        self.generated()
        human = {"opportunities": [{"id": "local-human-edit"}]}
        self.write(self.runner, "site/data/opportunities.json", human)
        self.git(self.runner, "add", "site/data/opportunities.json")
        self.assertEqual(checks.persist(self.runner), {"stale": False, "saved": True})
        committed = self.git(self.runner, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
        self.assertEqual(set(committed.splitlines()), set(checks.GENERATED_FILES))
        self.assertEqual(self.git(self.runner, "diff", "--cached", "--name-only"),
                         "site/data/opportunities.json")
        self.assertEqual(json.loads((self.runner / "site/data/opportunities.json").read_text()), human)
        self.assertEqual(self.git(self.remote, "rev-parse", "main"),
                         self.git(self.runner, "rev-parse", "HEAD"))

    def test_branch_moved_before_commit_skips_without_changing_checkout(self):
        self.generated()
        latest = self.editorial_commit()
        self.assertEqual(checks.persist(self.runner), {"stale": True, "saved": False})
        self.assertEqual(self.git(self.runner, "rev-parse", "HEAD"), self.base)
        self.assertEqual(self.git(self.remote, "rev-parse", "main"), latest)
        self.assertIn("human-approved-latest", self.git(self.remote, "show", "main:site/data/opportunities.json"))
        self.assertIn("https://example.test/candidate", self.git(self.remote, "show", "main:data/review-queue.json"))

    def test_push_race_preserves_latest_human_exclusions(self):
        self.generated()
        real_git = checks._git
        push_count = 0

        def with_race(repo, *args, **kwargs):
            nonlocal push_count
            if args[0] == "push":
                push_count += 1
                self.editorial_commit()
            return real_git(repo, *args, **kwargs)

        with patch.object(checks, "_git", side_effect=with_race):
            self.assertEqual(checks.persist(self.runner), {"stale": True, "saved": False})
        self.assertEqual(push_count, 1)
        self.assertIn("human-approved-latest", self.git(self.remote, "show", "main:site/data/opportunities.json"))
        queue = json.loads(self.git(self.remote, "show", "main:data/review-queue.json"))
        self.assertEqual(queue["candidates"], [])
        self.assertEqual(queue["excluded"][0]["url"], "https://example.test/candidate")

    def test_denied_push_fails_after_bounded_attempts(self):
        self.generated()
        hook = self.remote / "hooks/pre-receive"
        hook.write_text("#!/bin/sh\necho 'Repository write denied' >&2\nexit 1\n")
        hook.chmod(0o755)
        real_git = checks._git
        with patch.object(checks, "_git", wraps=real_git) as calls:
            with self.assertRaisesRegex(checks.PersistenceError, "remote branch did not move"):
                checks.persist(self.runner, attempts=2)
        self.assertEqual(sum(call.args[1] == "push" for call in calls.call_args_list), 2)
        self.assertEqual(self.git(self.remote, "rev-parse", "main"), self.base)

    def test_fetch_failure_is_bounded_and_does_not_commit(self):
        self.generated()
        self.git(self.runner, "remote", "set-url", "origin", str(self.root / "missing.git"))
        with patch.object(checks, "_git", wraps=checks._git) as calls:
            with self.assertRaisesRegex(checks.PersistenceError, "Could not fetch"):
                checks.persist(self.runner, attempts=2)
        self.assertEqual(sum(call.args[1] == "fetch" for call in calls.call_args_list), 2)
        self.assertEqual(self.git(self.runner, "rev-parse", "HEAD"), self.base)

    def test_unchanged_files_do_not_create_commit(self):
        self.assertEqual(checks.persist(self.runner), {"stale": False, "saved": False})
        self.assertEqual(self.git(self.runner, "rev-parse", "HEAD"), self.base)

    def test_action_outputs(self):
        output = self.root / "github-output"
        with redirect_stdout(io.StringIO()):
            checks.emit_outputs({"stale": True, "saved": False}, output)
        self.assertEqual(output.read_text(), "stale=true\nsaved=false\n")


if __name__ == "__main__":
    unittest.main()
