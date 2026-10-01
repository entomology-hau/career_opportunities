# Entomology, IPM & Biological Recording opportunities

A static opportunities board for the Harper Adams Applied Ecology postgraduate community: MSc / PgD / PgC Entomology, Integrated Pest Management and Biological Recording.

## What it is

- Direct relevance matches publish automatically. Unsure matches wait for a signed-in admin decision; the 24 previously human-reviewed records are preserved. The supplied update migrates previously automatic related-field entries into the review queue rather than treating them as reviewed. The **1 October 2026** collection has **29 visible adverts (7 automatic)** and **54 pending relevance checks**, with all six collectors working. Existing destination-page checks were not rerun in this scan.
- Light mode is the default, with explicit page and panel backgrounds. A dark-mode toggle saves the preference locally. Text colour/background pairs have been checked: minimum contrast 5.39:1 in light mode and 7.30:1 in dark mode; controls and focus indicators meet at least 3:1. This is a colour-pair check, not a full accessibility certification.
- Filters for jobs, PhD, MRes, internships, volunteering and other opportunities; all three course interests; core/related relevance; eight subject areas; location; advert source; closing within 14 days. Unspecified locations remain discoverable in the default UK view and are clearly labelled.
- Biological Recording scope includes botanical and other taxonomic identification, species/habitat surveys, records centres, biodiversity data, GIS and citizen science.
- Pagination offers 10, 20, 30, 40 or 50 adverts per page (default 10), Previous/Next controls and result ranges. Changing any filter, sort or page size returns to page one.
- Keyword search, closing-date/title/latest-source-date sorting and filter, page and page-size state in the URL.
- Source-supplied details, collection dates and original advert links. Individual editorial dates remain on previously reviewed entries; automatic records do not claim a human review.
- Past deadlines and records older than 30 days hidden at display time, even if the update workflow stops.
- A daily GitHub Actions workflow for collection and publication, plus report-driven withdrawal.
- A separate **Admin** page with GitHub sign-in, pending adverts, Approve/Reject controls and decision history. A small Cloudflare Worker handles authentication and saves queue decisions to GitHub.

**This is a curated board with automatic discovery and assisted searches.** Six collectors cover the RES jobs and PhD indices, environmentjob jobs and volunteering RSS, Bath jobs RSS and Harper Adams jobs RSS. Each collector's success, failure or stale check is visible on the board. A working feed can legitimately return no relevant candidates. Google, FindAPhD, jobs.ac.uk and the remaining directories are assisted searches; coverage across all providers is not exhaustive.

Collectors check robots rules, follow bounded redirects, respect delays and keep only minimal discovery metadata. The RSS descriptions are used transiently for screening; full adverts are not stored or republished. CIEEM stays manual because its terms require written permission for inclusion in an electronic retrieval service. Source-access notes and supported modes are in `site/data/sources.json`.

Direct subject matches currently listed in enabled sources publish automatically. Context-only matches wait in `data/review-queue.json` for approval. These include broad ecology, biodiversity, GIS and generic specialist-source titles where the keyword evidence alone needs a closer relevance check. Missing eligibility, salary, deadline, country or type alone does not require approval. Type, subject and course mappings remain inferred and labelled. Full descriptions are used transiently for matching and are not republished.

Source sightings refresh `lastSeen`, while `lastChecked` records genuine editorial reviews, including an explicit inclusion decision in the admin page. Expired, withdrawn, pending and stale entries are hidden from the public board. Two previously excluded Imperial projects remain excluded because their bodies mention past interview/start dates.

## Admin approvals

Open the board's **Admin** link and sign in with the configured GitHub account. For each unsure advert, follow the original link and confirm that it is relevant and active. Tick that confirmation and choose **Approve**, or choose **Reject** to exclude it. No JSON editing is needed after setup.

Decisions save to the repository with the reviewer and date, then the normal Pages workflow applies them and publishes the update. The interface distinguishes a saved decision from a completed deployment. Decisions use the exact candidate you saw and the queue's current GitHub file SHA; a concurrent edit requires reloading rather than overwriting it. Rejections prevent rediscovery. Stale source sightings and known expired deadlines cannot be approved.

Follow [Admin_Setup.md](Admin_Setup.md) to register the repository-scoped GitHub App and deploy the supplied Cloudflare Worker. The public board remains on GitHub Pages. Admin credentials stay in Worker secrets and encrypted HttpOnly cookies; the frontend receives no GitHub token. The API checks the allowed username and repository write access. The repository remains public, so its advert metadata and decision audit are publicly readable; sign-in restricts actions, not the repository's visibility.

The Worker and Pages copies of the admin interface both need updating when those files change. The supplied configuration starts with an empty `site/admin-config.json` backend address and fails closed until setup is complete.

## Search and subject curation

Each advert includes course-interest tags, a relevance tier and a brief “Relevance” assessment. On automatic entries these are keyword-derived connections; eligibility must be read in the original advert. Species/habitat surveys and biodiversity data can be core Biological Recording topics without insects. See `Search_Scope_and_Relevance.md` for the expanded scope.

The eight subject groups and terms are in `site/data/sources.json`, and visible in the board's “What do we look for?” section. They cover insect biology, IPM/crop protection, biological control, conservation, pollination, taxonomy/recording, vectors, and monitoring/environmental risk. Biological Recording searches include records centres, botanical identification, bryophytes, lichens, fungi, UKHab, NVC, biodiversity data, iRecord, QGIS and citizen science. Additional source cards link to CIEEM vacancies, Field Studies Council volunteering, the NBN scheme directory and ALERC centre finder; directories are clearly labelled and do not imply current vacancies.

Exact word matching avoids `bee` matching `been` and `tick` matching `ticket`. Screening uses source titles/descriptions, with title exclusions for HR, fundraising, trusteeships, research administration and internal-only calls. The curated RES indices provide additional scope evidence. Generic source titles, grants and mixed opportunity pages can appear under Other opportunity. Reports let the community flag marginal matches or incorrect classifications after publication.

The source list can be extended to direct university, research-institute, conservation and commercial employers, including Rothamsted, UKCEH, CABI, Fera, NIAB, Forest Research, museums, Wildlife Trusts, Buglife, Butterfly Conservation, Koppert and Biobest. Verify each integration and its terms first. Add only supported sources; changing a URL does not make an unsupported adapter work.

## Upload and deployment

For the separate `entomology-hau` GitHub account, follow `GitHub_Update_Instructions.md`. The archive contains the repository files, ready to replace their counterparts. Publishing still needs a successful run in that account; local verification does not confirm deployment.

The workflow runs daily at 05:17 UTC and on pushes/manual requests. Its checks digest appears in the run summary and a downloadable artifact. Generated data is validated before saving. If `main` changes during a run, the bounded persistence helper skips the stale deployment and preserves human changes. Both collection and removal workflows share a queue with up to 100 pending runs. Ubuntu 24.04 is pinned.

## Reporting and removing an advert

Every card has **Report advert**, opening a pre-filled GitHub issue containing its ID, URL and reasons: irrelevant, closed/expired, incorrect details or other. Reporters need GitHub sign-in. Enable repository Issues and Watch → Custom → Issues; GitHub notifications (and email if enabled in your account) bring reports to you.

Create one repository label, exactly `remove-advert`. Read a report and apply that label to remove its listing. The **Remove a reported advert** action verifies that the labeler has repository write/maintain/admin access, checks the advert ID/URL, marks the record withdrawn, records exclusions and requests Pages publication. The reporter's submission alone cannot remove an advert.

Keep an advert by leaving the label off; you can close the report after addressing it. For incorrect details, edit the existing record and commit. A human-edited, verified record should use `reviewStatus: approved` and a genuine review date, so collection preserves its details. This is optional enrichment, not required for inclusion.

If the report changes after you add the label or `main` changes during withdrawal, the action stops without applying an unintended removal. Read the current report and remove/reapply the label. Manual reruns are also available, using its issue number, advert ID and URL. The issue stays available and the bot acknowledgement links the removal audit; acknowledgement means the withdrawal was saved and publication requested, not that deployment has already finished.

To restore a removed record deliberately, change its status back to open and remove its corresponding URL exclusions from `data/review-queue.json`, then commit both files. Removing the issue label alone does not restore it.

The existing `scripts/review.py` remains available for optional checks and manually supplied records. Unsure relevance matches use the signed-in admin queue; clear matches remain automatic.

## Local checks

```sh
python scripts/validate.py
python -m unittest discover -s tests -v
node tests/test_board.cjs
node tests/test_admin.cjs
node --test admin-backend/test-worker.mjs
python scripts/refresh.py --offline
python scripts/refresh.py --discovery-only
python scripts/refresh.py
```

`--offline` validates configuration without requests or writes. `--discovery-only` collects direct matches, holds context matches and applies saved admin decisions without fetching existing destination pages, retaining earlier link-check timestamps. A normal refresh also checks individually reviewed advert links; automatic and pending records use feed/index sightings. Failed collectors produce visible health warnings and preserve prior records until their freshness/expiry limits. All three generated data files are saved together by the persistence helper.

## Sources and credits

- [RES jobs](https://www.royensoc.co.uk/membership-and-community/careers-and-opportunities/job-opportunities/)
- [RES PhDs](https://www.royensoc.co.uk/membership-and-community/careers-and-opportunities/phd-opportunities/)
- [environmentjob](https://environmentjob.co.uk/)
- [FindAPhD](https://www.findaphd.com/)
- [GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub scheduled workflow guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Google job-posting documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting): Google's Indexing API is for publisher notifications, not retrieving Google job results.
