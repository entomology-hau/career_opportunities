# Entomology, IPM & Biological Recording opportunities

A static opportunities board for the Harper Adams Applied Ecology postgraduate community: MSc / PgD / PgC Entomology, Integrated Pest Management and Biological Recording.

## What it is

- Direct subject matches and related-field source matches publish automatically. Each card identifies missing information and any uncertainty about relevance, so students can judge the match and check the original advert. Existing human-reviewed records retain their review provenance.
- Light mode is the default, with explicit page and panel backgrounds. A dark-mode toggle saves the preference locally. Text colour/background pairs have been checked: minimum contrast 5.39:1 in light mode and 7.30:1 in dark mode; controls and focus indicators meet at least 3:1. This is a colour-pair check, not a full accessibility certification.
- Filters for jobs, PhD, MRes, internships, volunteering and other opportunities; all three course interests; core/related relevance; eight subject areas; location; advert source; closing within 14 days. Unspecified locations remain discoverable in the default UK view and are clearly labelled.
- Biological Recording scope includes botanical and other taxonomic identification, species/habitat surveys, records centres, biodiversity data, GIS and citizen science.
- Pagination offers 10, 20, 30, 40 or 50 adverts per page (default 10), Previous/Next controls and result ranges. Changing any filter, sort or page size returns to page one.
- Keyword search, closing-date/title/latest-source-date sorting and filter, page and page-size state in the URL.
- Source-supplied details, collection dates and original advert links. Individual editorial dates remain on previously reviewed entries; automatic records do not claim a human review.
- Dates on the public board use full month names, such as **4 October 2026**. Explicit closing times use the 24-hour clock, such as **12:00 UK time**. Date-only adverts do not acquire an invented closing time; ongoing and year-round opportunities retain their availability wording.
- Past deadlines and records older than 30 days hidden at display time, even if the update workflow stops.
- A daily GitHub Actions workflow for collection and publication, plus report-driven withdrawal.
- No admin login or approval step is required for automatic publication. GitHub Pages and the collection workflow provide the active service.

**This board uses curated search rules, automatic publication and assisted searches.** Enabled collectors cover the RES jobs and PhD indices, environmentjob jobs and volunteering RSS, Bath jobs RSS and Harper Adams jobs RSS. Each collector's success, failure or stale check is visible on the board. A working feed can legitimately return no relevant candidates. Google, FindAPhD, jobs.ac.uk and the remaining directories are assisted searches; coverage across all providers is not exhaustive.

Collectors check robots rules, follow bounded redirects, respect delays and keep only minimal discovery metadata. The RSS descriptions are used transiently for screening; full adverts are not stored or republished. CIEEM stays manual because its terms require written permission for inclusion in an electronic retrieval service. Source-access notes and supported modes are in `site/data/sources.json`.

With `publication.mode` set to `automatic` in `site/data/sources.json`, qualifying direct and related-field matches from enabled sources publish on collection. Related matches can include broad ecology, biodiversity, GIS and specialist-source titles whose connection to a course needs checking. The next collection also reconsiders qualifying source matches held under the earlier approval mode. Exclusions, freshness limits and known closing dates still apply.

Missing pay or funding, eligibility, deadline, location or opportunity type does not by itself prevent publication. Cards list information that remains unspecified and explain uncertain relevance where applicable; inferred classifications remain labelled. A keyword match does not establish eligibility or guarantee that an advert is suitable. Follow the original advert for full details before applying. Full descriptions are used transiently for matching and are not republished.

For example, a card may say **“Check main advert for: salary, eligibility and closing date.”** Its field list depends on the information available. Related automatic matches also ask readers to check relevance to their interests.

Source sightings refresh `lastSeen`, while `lastChecked` records a genuine editorial review. Collection does not invent review dates or convert automatic matches into human-reviewed records. Known expired deadlines and withdrawn records are hidden; entries whose latest source sighting or editorial review is over 30 days old are also hidden at display time. Earlier explicit exclusions remain in place, including adverts whose bodies revealed past interview or start dates.

## Admin setup is paused

The public **Admin** link has been removed. Admin frontend and backend files are retained for possible future use, but they are not part of the active publication process. [Admin_Setup.md](Admin_Setup.md) is a paused setup guide, not a prerequisite for using or updating the board. No GitHub App registration, Cloudflare deployment or admin secrets are needed for the current service.

The review queue remains useful for discovery records, exclusions and audit history. Optional editorial checks and report-driven withdrawals can improve the board after publication.

## Search and subject curation

Each advert includes course-interest tags, a relevance tier and a brief “Relevance” assessment. On automatic entries these are keyword-derived connections; the card's caveats distinguish missing facts from uncertain relevance. Eligibility must be checked in the original advert. Species/habitat surveys and biodiversity data can be core Biological Recording topics without insects. See `Search_Scope_and_Relevance.md` for the expanded scope.

The eight subject groups and terms are in `site/data/sources.json`, and visible in the board's “What do we look for?” section. They cover insect biology, IPM/crop protection, biological control, conservation, pollination, taxonomy/recording, vectors, and monitoring/environmental risk. Biological Recording searches include records centres, botanical identification, bryophytes, lichens, fungi, UKHab, NVC, biodiversity data, iRecord, QGIS and citizen science. Additional source cards link to CIEEM vacancies, Field Studies Council volunteering, the NBN scheme directory and ALERC centre finder; directories are clearly labelled and do not imply current vacancies.

Exact word matching avoids `bee` matching `been` and `tick` matching `ticket`. Screening uses source titles/descriptions, with title exclusions for HR, fundraising, trusteeships, research administration and internal-only calls. The curated RES indices provide additional scope evidence. Generic source titles, grants and mixed opportunity pages can appear under Other opportunity. Reports let the community flag marginal matches or incorrect classifications after publication.

The source list can be extended to direct university, research-institute, conservation and commercial employers, including Rothamsted, UKCEH, CABI, Fera, NIAB, Forest Research, museums, Wildlife Trusts, Buglife, Butterfly Conservation, Koppert and Biobest. Verify each integration and its terms first. Add only supported sources; changing a URL does not make an unsupported adapter work.

## Upload and deployment

For the separate `entomology-hau` GitHub account, follow `GitHub_Update_Instructions.md`. The focused `Opportunities_Simplified_Update.zip` contains only changed code, configuration, documentation and tests. Replace the matching files in the existing repository, preserving their folders.

The focused update deliberately excludes generated `site/data/opportunities.json`, `data/review-queue.json` and `site/data/health.json`, protecting newer listings, exclusions and checks already in the repository. Keep those existing files. The collection workflow uses the updated rules to generate the next publication. Publishing still needs a successful run in that account; local verification does not confirm deployment.

The workflow runs daily at 05:17 UTC and on pushes/manual requests. Its checks digest appears in the run summary and a downloadable artifact. Generated data is validated before saving. If `main` changes during a run, the bounded persistence helper skips the stale deployment and preserves human changes. Both collection and removal workflows share a queue with up to 100 pending runs. Ubuntu 24.04 is pinned.

## Reporting and removing an advert

Every card has **Report advert**, opening a pre-filled GitHub issue containing its ID, URL and reasons: irrelevant, closed/expired, incorrect details or other. Reporters need GitHub sign-in. Enable repository Issues and Watch → Custom → Issues; GitHub notifications (and email if enabled in your account) bring reports to you.

Create one repository label, exactly `remove-advert`. Read a report and apply that label to remove its listing. The **Remove a reported advert** action verifies that the labeler has repository write/maintain/admin access, checks the advert ID/URL, marks the record withdrawn, records exclusions and requests Pages publication. The reporter's submission alone cannot remove an advert.

Keep an advert by leaving the label off; you can close the report after addressing it. For incorrect details, edit the existing record and commit. A human-edited, verified record should use `reviewStatus: approved` and a genuine review date, so collection preserves its details. This is optional enrichment, not required for inclusion.

If the report changes after you add the label or `main` changes during withdrawal, the action stops without applying an unintended removal. Read the current report and remove/reapply the label. Manual reruns are also available, using its issue number, advert ID and URL. The issue stays available and the bot acknowledgement links the removal audit; acknowledgement means the withdrawal was saved and publication requested, not that deployment has already finished.

To restore a removed record deliberately, change its status back to open and remove its corresponding URL exclusions from `data/review-queue.json`, then commit both files. Removing the issue label alone does not restore it.

The existing `scripts/review.py` remains available for optional checks and manually supplied records. Both direct and related-field source matches remain eligible for automatic publication; no signed-in admin queue is required.

## Local checks

```sh
python scripts/validate.py
python -m unittest discover -s tests -v
node tests/test_board.cjs
python scripts/refresh.py --offline
python scripts/refresh.py --discovery-only
python scripts/refresh.py
```

`--offline` validates configuration without requests or writes. `--discovery-only` collects and publishes qualifying direct and related-field source matches without fetching existing destination pages, retaining earlier link-check timestamps. A normal refresh also checks individually reviewed advert links; automatic records use feed/index sightings. Failed collectors produce visible health warnings and preserve prior records until their freshness/expiry limits. All three generated data files are saved together by the persistence helper.

## Sources and credits

- [RES jobs](https://www.royensoc.co.uk/membership-and-community/careers-and-opportunities/job-opportunities/)
- [RES PhDs](https://www.royensoc.co.uk/membership-and-community/careers-and-opportunities/phd-opportunities/)
- [environmentjob](https://environmentjob.co.uk/)
- [FindAPhD](https://www.findaphd.com/)
- [GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub scheduled workflow guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Google job-posting documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting): Google's Indexing API is for publisher notifications, not retrieving Google job results.
