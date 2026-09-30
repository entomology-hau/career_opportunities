# Update the existing GitHub Pages board

Prepared for `entomology-hau/career_opportunities`, 30 September 2026. These are upload-ready files; this package has not been committed or deployed to your account.

## 1. Upload the project files

1. Download and extract `Entomology_Opportunities_GitHub_Pages.zip`.
2. Sign in to the **entomology-hau** GitHub account and open <https://github.com/entomology-hau/career_opportunities> on `main`.
3. Choose **Add file → Upload files**. Drag the extracted `site`, `scripts`, `data` and `tests` folders, plus `README.md`, `Search_Scope_and_Relevance.md` and this instructions file into the uploader. Preserve the folder structure; upload extracted files, not the ZIP or its enclosing download folder.
4. Commit with a message such as `Improve opportunity collection and review tracking`.

GitHub may briefly run the old workflow for this first commit. Complete the workflow replacement below before judging the result.

The public advert dataset was taken from the repository before these changes. If you have edited `site/data/opportunities.json` since then, keep your newer version instead of replacing that file. If you have reviewed/rejected candidates since then, retain your newer queue and let the next run rediscover other candidates.

## 2. Replace the workflow

1. Open <https://github.com/entomology-hau/career_opportunities/blob/main/.github/workflows/pages.yml> and choose the pencil icon.
2. Open the extracted `.github/workflows/pages.yml` in a text editor and copy **all** its text over the existing file.
3. Commit with a message such as `Preserve checks safely and publish current runs`.

Editing this file directly avoids hidden-folder upload problems. It depends on the new `scripts/review.py` and `scripts/persist_checks.py`, which are supplied in step 1.

## 3. Check deployment

1. In **Settings → Pages**, confirm the source is **GitHub Actions**.
2. Open **Actions → Check opportunities and publish Pages**. The workflow should run after the commit; you can also choose **Run workflow** on `main`.
3. Open the newest run. Validation and the build/deploy jobs should finish successfully. Its summary contains the review digest, and **Artifacts** contains an `opportunity-review-...` download with the digest, queue and health report.
4. Visit <https://entomology-hau.github.io/career_opportunities/> and refresh. Check the visible collector count and per-source status under Sources. The number of pending candidates is separate from the reviewed adverts shown in results.

A collector failure is shown as incomplete coverage; inspect that source's entry in `site/data/health.json`. A successful workflow does not mean every source was reachable. A stale run skips deployment when a newer commit arrived; allow the newer run to finish. If persistence fails with a write-permission message, check Actions workflow write permissions and branch rules for this repository, then rerun it.

## What changed

- Fixed RES parsing for its actual linked-heading markup, including same-site advert links.
- Added four official RSS collectors and title/description screening.
- Added deduplication, explicit-deadline suggestions, direct/context review priority and excluded-title checks.
- Added review tasks for changed pages, unavailable links and ageing editorial reviews, without renewing review dates automatically.
- Added visible collection health, per-source status and changed-advert warnings.
- Replaced the failing blind push with bounded persistence that preserves human commits; pinned Ubuntu 24.04.

The HAU banner, logo, course links, light/dark themes, filters and pagination remain in the supplied site. Cards use **Relevance**.

New candidates require editorial review. See the README's reviewing section; nothing in the queue is automatically published.
