# Update the existing GitHub Pages board

Prepared for `entomology-hau/career_opportunities`, 1 October 2026. These are upload-ready files; this package has not been committed or deployed to your account. Admin sign-in additionally needs the one-time Worker/GitHub App setup below.

## 1. Upload the project files

1. Download and extract `Entomology_Opportunities_GitHub_Pages.zip`.
2. Sign in to the **entomology-hau** GitHub account and open <https://github.com/entomology-hau/career_opportunities> on `main`.
3. Choose **Add file → Upload files**. Drag the extracted `site`, `scripts`, `data`, `tests` and `admin-backend` folders, plus `README.md`, `Admin_Setup.md`, `Search_Scope_and_Relevance.md` and this instructions file into the uploader. Preserve the folder structure; upload extracted files, not the ZIP or its enclosing download folder. The backend contains no credentials; do not upload local secret files.
4. Commit with a message such as `Add signed-in review for uncertain opportunities`.

GitHub may briefly run the old workflow for this first commit. Complete the workflow replacement below before judging the result.

The public advert dataset was taken from the repository before these changes. If you have edited `site/data/opportunities.json` since then, keep your newer version instead of replacing that file. If you have reviewed/rejected candidates since then, retain your newer queue and let the next run rediscover other candidates.

## 2. Replace the workflow

1. Open <https://github.com/entomology-hau/career_opportunities/blob/main/.github/workflows/pages.yml> and choose the pencil icon.
2. Open the extracted `.github/workflows/pages.yml` in a text editor and copy **all** its text over the existing file.
3. Commit with a message such as `Validate the admin portal and publish reviewed opportunities`.

4. If `.github/workflows/remove-advert.yml` already exists, retain it or replace its contents with the supplied version. Otherwise create it using **Add file → Create new file**, type that complete path as the filename, and paste the extracted file's contents. Commit it.
5. Also retain or create `.github/ISSUE_TEMPLATE/advert-report.md` from the supplied file. This provides a report template when someone opens an issue directly; card links already supply the advert ID and URL.

These workflows depend on the supplied `scripts/publish.py`, `scripts/moderate.py`, `scripts/review.py`, `scripts/validate.py` and `scripts/persist_checks.py`. Direct editing avoids hidden-folder upload problems.

## 3. Check deployment

1. In **Settings → Pages**, confirm the source is **GitHub Actions**.
2. Open **Actions → Check opportunities and publish Pages**. The workflow should run after the commit; you can also choose **Run workflow** on `main`.
3. Open the newest run. Validation and the build/deploy jobs should finish successfully. Its summary contains optional advert checks, and **Artifacts** contains an `opportunity-checks-...` download with the digest, public dataset, queue and health report.
4. Visit <https://entomology-hau.github.io/career_opportunities/> and refresh. Check the collector count, automatic-listing count and per-source status. Direct matches appear automatically; unsure matches wait for review. Previously automatic related-field entries are held until approved. Existing genuine reviews are preserved.

A collector failure is shown as incomplete coverage; inspect that source's entry in `site/data/health.json`. A successful workflow does not mean every source was reachable. A stale run skips deployment when a newer commit arrived; allow the newer run to finish. If persistence fails with a write-permission message, check Actions workflow write permissions and branch rules for this repository, then rerun it.

## 4. Enable reports and the removal shortcut

1. In repository **Settings → General → Features**, ensure **Issues** is enabled.
2. Open **Issues → Labels → New label**. Create the label exactly `remove-advert` (any colour).
3. At the top of the repository choose **Watch → Custom → Issues**. GitHub will notify the signed-in account of reports. Enable email notifications in your GitHub notification settings if you also want them by email.
4. On the site, **Report advert** opens a pre-filled issue. The reporter ticks irrelevant, closed/expired, incorrect details or other, adds context and submits. GitHub sign-in is required.
5. Read the report. To remove that listing, add the `remove-advert` label in the issue sidebar. The **Remove a reported advert** workflow saves a withdrawal/exclusion and starts the Pages workflow. No JSON editing is needed.
6. The bot acknowledgement links the removal audit. Wait for the requested Pages run to finish, then refresh the site. The listing stays excluded from future collection.

If you want to keep the advert, leave the label off and close the report after addressing it. Submitting a report alone does not remove anything. Removal requires repository write/maintain/admin access.

If a report was edited after you labelled it or the remote branch changed during withdrawal, review it again and remove/reapply the label. Alternatively, use **Actions → Remove a reported advert → Run workflow**, supplying the current issue number, advert ID and URL. The issue must remain open and labelled. Do not close it until the withdrawal is saved.

Reports can contain incorrect details rather than a removal request; you can correct the existing public record and commit instead. Removing a label after a completed withdrawal does not restore the advert.

## 5. Enable the signed-in admin queue

Follow [Admin_Setup.md](Admin_Setup.md) to register the repository-scoped GitHub App and deploy the supplied Cloudflare Worker. The public board remains on GitHub Pages. The Worker needs the extracted `admin-backend` and neighbouring `site` folders. Set the Worker URL in `site/admin-config.json` when setup is complete.

Visit the board's **Admin** page, sign in with the allowed GitHub account, open a pending advert and confirm relevance/current availability. Choose **Approve** to include it or **Reject** to exclude it. Decisions save to GitHub and the Pages workflow publishes the resulting change; wait for that run before expecting the public board to update. A changed queue requires reloading before deciding.

The Admin link shows setup availability until the backend is configured. Uploading these files alone does not create an authenticated service. No password, token or client secret belongs in the public website files.

## What changed

- Fixed RES parsing for its actual linked-heading markup, including same-site advert links.
- Added four official RSS collectors and title/description screening.
- Added deduplication, explicit-deadline suggestions, direct/context review priority and excluded-title checks.
- Direct matches publish automatically; unsure relevance matches wait in the signed-in admin queue. Explicit unknowns and inferred-category labels remain.
- Added GitHub App sign-in and queue-only saves through a small Cloudflare Worker.
- Added reports with verified ID/URL targeting, an owner-controlled removal label and persistent exclusions.
- Added visible collection health, per-source status, collection dates and optional page warnings.
- Replaced the failing blind push with bounded persistence that preserves human commits; pinned Ubuntu 24.04.

The HAU banner, logo, course links, light/dark themes, filters and pagination remain in the supplied site. Cards use **Relevance**.

Approval is required only for unsure matches. The daily workflow collects, publishes direct matches, applies saved decisions and expires listings. The queue retains pending candidates, exclusions, optional checks and decision history.
