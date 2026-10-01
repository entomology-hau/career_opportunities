# Update the GitHub Pages board for automatic publication

Prepared for `entomology-hau/career_opportunities`, 1 October 2026. This update publishes current direct and related-field source matches automatically. Each card explains its relevance and flags information that still needs checking in the original advert. Admin login setup is paused: no GitHub App, Cloudflare or secret configuration is needed for this update.

## 1. Upload the focused update

1. Download and extract **Opportunities_Simplified_Update.zip**.
2. Sign in to the GitHub account that can update [entomology-hau/career_opportunities](https://github.com/entomology-hau/career_opportunities) and select `main`.
3. Choose **Add file → Upload files**. Drag the extracted folders and documents into the uploader, preserving their paths. Upload the extracted contents, not the ZIP or an extra enclosing download folder.
4. Confirm that GitHub is updating the existing files at their correct paths, then commit with a message such as `Publish relevant source matches with advert caveats`.

The focused package contains changed website code and configuration, publishing code, matching tests and documentation. In particular, update `site/app.js`, `site/index.html`, `site/styles.css`, `site/data/sources.json`, `scripts/publish.py`, and the supplied tests. Upload `scripts/refresh.py` too if it is included. The current deployment workflow can run unchanged; there is no workflow replacement or backend deployment step for this update.

**Preserve the repository's current advert and review data.** This focused package intentionally omits `site/data/opportunities.json`, `data/review-queue.json` and `site/data/health.json`. Do not replace them from an older full-project ZIP. The next workflow run uses the current repository data, retains genuine reviews and exclusions, and applies the new publication policy.

For a small correction later, open the relevant file in GitHub, choose the pencil button, make the change and select **Commit changes**. No local terminal or software installation is required.

## 2. Check publication

1. Open **Actions → Check opportunities and publish Pages**. The workflow should start after the commit. You can also choose **Run workflow** on `main`.
2. Open the newest run and wait for its validation, build and deployment to succeed.
3. Visit [the public board](https://entomology-hau.github.io/career_opportunities/) and refresh.
4. Check that direct and related-field matches appear, that the cards show relevant caveats, and that the public Admin link is gone. A missing salary, eligibility statement or deadline should be identified as unspecified, not filled with a guess.
5. Check collection health and each source's status. The run summary and its `opportunity-checks-...` artifact contain the publication digest, public dataset, queue and health report.

The daily workflow collects source matches, applies exclusions and publishes eligible records without an approval step. Related-field entries that were previously held for relevance review can return automatically when supported by current source evidence. An old queue entry alone does not establish that an advert is still available. Known expired, withdrawn, excluded and stale listings stay out of the public board.

A successful workflow does not mean every source was reachable. Collector failures appear as incomplete coverage; inspect the source's entry in `site/data/health.json` for details. If a newer commit arrives during a run, the older run can skip deployment to preserve that change; allow the newer run to finish. If persistence reports a write-permission failure, check Actions workflow write permissions and branch rules, then rerun.

If Pages publishing itself is not configured, open **Settings → Pages** and select **GitHub Actions** as its source. An already working board needs no change here.

## 3. Keep reports and removals available

The existing reporting and removal mechanism remains active:

1. In repository **Settings → General → Features**, ensure **Issues** is enabled.
2. Under **Issues → Labels**, retain or create the label exactly `remove-advert`.
3. Choose **Watch → Custom → Issues** to receive reports. Enable email notifications in your GitHub notification settings if wanted.
4. On the site, **Report advert** opens a pre-filled GitHub issue with the advert's ID and URL. Reporters can flag irrelevant, closed or incorrect listings; submitting requires GitHub sign-in.
5. Read a report. To withdraw its advert, apply `remove-advert`. The **Remove a reported advert** workflow verifies repository authority and the advert ID/URL, saves the withdrawal and exclusions, and requests Pages publication.
6. Wait for the Pages run to finish before expecting the card to disappear. The exclusion prevents the same advert's known URLs from being collected again.

Reporting alone cannot remove an advert. Leave the label off if you want to keep it. For incorrect details, you can edit the existing public record and commit a correction instead. Preserve a genuine review date when recording a human verification.

If the report changes after labelling or the branch changes during withdrawal, read the report again and remove/reapply the label. Alternatively, use **Actions → Remove a reported advert → Run workflow**, supplying the current issue number, advert ID and URL. Keep the issue open and labelled until withdrawal is saved. The bot acknowledgement links the removal audit; it confirms a saved withdrawal and publication request, not a completed deployment.

Removing the label after a completed withdrawal does not restore the advert. Deliberate restoration requires changing its record back to open and removing the relevant URL exclusions from `data/review-queue.json`.

## What readers will see

Current source matches appear automatically, including broader ecology, biodiversity and recording opportunities. Cards distinguish a clear subject connection from a broader related-field connection and make missing information visible. Inferred classifications remain identified as such. Readers follow the original advert to confirm the role, eligibility, pay or funding, location and deadline before applying.

A card may say **“Check main advert for: salary, eligibility and closing date.”** The list varies with each advert; related automatic matches also flag relevance to the reader's interests.

All advert dates use the same full-month format, for example **4 October 2026**, in both the card heading and expanded details. Stated times use the 24-hour clock, for example **12:00 UK time**. Collection and review dates follow the same date format. Missing closing times remain unspecified.

The HAU appearance, course links, filters, pagination, light/dark themes, original advert links and reporting remain. The board still cannot promise complete coverage: some providers have working collectors, while Google, FindAPhD, jobs.ac.uk and other directories are assisted searches.

The admin interface and backend files remain available for possible future development. [Admin_Setup.md](Admin_Setup.md) is retained as a paused setup reference; it is not part of the current upload or publication process.
