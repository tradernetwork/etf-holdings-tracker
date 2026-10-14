"""scripts/push_holdings.sh against a throwaway remote: main moves mid-scrape."""
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "push_holdings.sh"
ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
       "GIT_COMMITTER_EMAIL": "t@t", "PATH": "/usr/bin:/bin:/usr/local/bin", "HOME": "/tmp"}


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, env=ENV, check=True, capture_output=True, text=True).stdout


def setup(tmp_path):
    remote = tmp_path / "remote.git"
    git(tmp_path, "init", "--bare", "-b", "main", str(remote))
    seed = tmp_path / "seed"
    git(tmp_path, "clone", str(remote), str(seed))
    (seed / "etf-dashboard/public/data/history").mkdir(parents=True)
    (seed / "etf-dashboard/public/data/history/h.csv").write_text("old\n")
    (seed / "normalized_holdings.csv").write_text("old\n")
    (seed / "app.py").write_text("v1\n")
    (seed / "stats.json").write_text("{}\n")  # tracked by-product the scraper rewrites
    git(seed, "add", "-A"); git(seed, "commit", "-m", "init"); git(seed, "push", "origin", "HEAD:main")
    work = tmp_path / "work"
    git(tmp_path, "clone", str(remote), str(work))
    return remote, seed, work


def run_push(work):
    return subprocess.run(["bash", str(SCRIPT), "main", "3", "0"], cwd=work, env=ENV, capture_output=True, text=True)


def scrape_commit(work, content="new\n"):
    (work / "etf-dashboard/public/data/history/h.csv").write_text(content)
    (work / "normalized_holdings.csv").write_text(content)
    git(work, "add", "normalized_holdings.csv", "etf-dashboard/public/data/")
    git(work, "commit", "-m", "chore: auto-update holdings [2026-10-14]")


def test_main_moved_with_unstaged_and_untracked_leftovers(tmp_path):
    remote, seed, work = setup(tmp_path)
    scrape_commit(work)
    (work / "stats.json").write_text('{"dirty": true}\n')      # unstaged tracked change
    (work / "scratch.tmp").write_text("junk\n")                 # untracked leftover
    (seed / "app.py").write_text("v2\n")                        # main advances (app PR)
    git(seed, "commit", "-am", "app change"); git(seed, "push", "origin", "HEAD:main")
    r = run_push(work)
    assert r.returncode == 0, r.stdout + r.stderr
    log = git(remote, "log", "--format=%s", "main")
    assert "chore: auto-update holdings [2026-10-14]" in log and "app change" in log
    assert git(remote, "show", "main:app.py") == "v2\n"
    assert git(remote, "show", "main:normalized_holdings.csv") == "new\n"


def test_conflict_on_holdings_takes_fresh_scrape(tmp_path):
    remote, seed, work = setup(tmp_path)
    scrape_commit(work, "fresh\n")
    (seed / "normalized_holdings.csv").write_text("someone else\n")
    (seed / "etf-dashboard/public/data/history/h.csv").write_text("someone else\n")
    git(seed, "commit", "-am", "conflicting data edit"); git(seed, "push", "origin", "HEAD:main")
    r = run_push(work)
    assert r.returncode == 0, r.stdout + r.stderr
    assert git(remote, "show", "main:normalized_holdings.csv") == "fresh\n"
    assert git(remote, "show", "main:etf-dashboard/public/data/history/h.csv") == "fresh\n"


def test_plain_push_when_main_unchanged(tmp_path):
    remote, _seed, work = setup(tmp_path)
    scrape_commit(work)
    assert run_push(work).returncode == 0
    assert git(remote, "show", "main:normalized_holdings.csv") == "new\n"
