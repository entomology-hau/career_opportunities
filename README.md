# Entomology, IPM & Biological Recording opportunities

A static opportunities board for Harper Adams MSc Entomology, MSc Integrated Pest Management and Biological Recording students. The design follows the postgraduate induction slides with navy/blue accents and Montserrat typography, with readable light and dark themes. The banner uses the supplied transparent HAU logo on a navy header that stays the same in light and dark mode. All three course links are prefixed “MSc / PgD / PgC”.

## What is ready

- Twenty-two reviewed adverts as at **29 September 2026**: twelve paid roles, six PhDs, one internship and three volunteering schemes. Nineteen are in the UK; three are international. The unpaid internship also appears under volunteering.
- Light mode is the default, with explicit page and panel backgrounds. A dark-mode toggle saves the preference locally. Text colour/background pairs have been checked: minimum contrast 5.39:1 in light mode and 7.30:1 in dark mode; controls and focus indicators meet at least 3:1. This is a colour-pair check, not a full accessibility certification.
- Filters for paid jobs, PhD, MRes, internships and volunteering; all three course interests; core/related relevance; eight subject areas; UK/international/remote or hybrid locations; advert source; closing within 14 days.
- Biological Recording scope includes botanical and other taxonomic identification, species/habitat surveys, records centres, biodiversity data, GIS and citizen science. Thirteen stored adverts have a Biological Recording connection; twelve remain within their advertised deadlines on 30 September 2026.
- Pagination offers 10, 20, 30, 40 or 50 adverts per page (default 10), Previous/Next controls and result ranges. Changing any filter, sort or page size returns to page one.
- Keyword search, closing-date/title/review-date sorting and filter, page and page-size state in the URL.
- Salary or funding, eligibility, source links and individual review dates.
- Past deadlines and records older than 30 days hidden at display time, even if the update workflow stops.
- A daily GitHub Actions workflow for candidate discovery, link checks and publication.

**This is a curated board with assisted discovery. It is not an exhaustive live feed from every named website.** New records require review before publication. Google, environmentjob and FindAPhD are direct search links and sources for selected reviewed adverts; they have no connected automatic feed in this version. RES heading-link discovery is implemented but has not been verified end to end from a GitHub runner. The current execution environment blocked direct source HTTP requests, so live collection remains a deployment acceptance check.

The MRes filter is present but currently empty. EntoBites is in the review queue until its volunteering/payment terms are confirmed. Two apparently rolling Imperial projects were excluded because their bodies mention past interview/start dates.

## Publish on GitHub Pages

1. **Extract the supplied ZIP.** Open the extracted project folder; it contains `site`, `scripts`, `tests`, `data`, `README.md` and `.github`. The separate preview HTML is for review and does not need uploading.
2. **Create a repository on GitHub.** Choose **New repository**, name it (for example `entomology-opportunities`), select **Public**, tick **Add a README file**, and create it. Confirm the default branch is `main`. A public repository supports Pages on GitHub Free.
3. **Enable Pages.** Open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Skip the suggested workflow templates: this project already includes its workflow.
4. **Upload the project contents.** Open **Code → Add file → Upload files**. Drag the files and folders *inside* the extracted project folder into the upload area, keeping the folder structure. Upload the contents, not the ZIP or an extra enclosing folder. Choose **Commit changes** to `main`.
5. **Check the hidden workflow folder.** On GitHub, confirm `.github/workflows/pages.yml` exists. If your file picker missed it, choose **Add file → Create new file**, enter that exact path, paste the contents of the supplied `pages.yml`, and commit. Also retain `site/.nojekyll`. On macOS, Command–Shift–. shows hidden files; on Windows, enable hidden items in File Explorer.
6. **Run the workflow.** Open **Actions → Check opportunities and publish Pages**. The upload to `main` normally starts it automatically. If needed, select **Run workflow → main → Run workflow**. Wait for both `build` and `deploy` to turn green.
7. **Open the published site.** Use **Settings → Pages → Visit site**, or the deployment URL in the successful workflow run. Test the logo, course links, both themes, the Biological Recording filter and pagination on a phone and desktop.
8. **Check source results.** Open `site/data/health.json` and `data/review-queue.json` in the repository. They show successful/failed collection and candidates awaiting review. If a source is inaccessible or changes its layout, the workflow keeps the last reviewed data without claiming a new editorial review.

No personal access token, API key or additional secret is needed. The supplied workflow requests the specific repository-write and deployment permissions it needs. Leave repository-wide permission defaults alone unless a run reports a permissions problem. Organisation Actions restrictions or protected branches may need an administrator to allow the workflow or adapt its check-result commits to pull requests.

The workflow is scheduled daily at **05:17 UTC** (06:17 during British Summer Time). Scheduled runs can be delayed, and GitHub may disable schedules after 60 days without repository activity. Manual runs remain available. New repositories should permit Actions and the `github-pages` environment. Branch protection may require adapting the workflow to make a pull request instead of pushing check results.

Only `site/` is deployed. Documentation, tests and the review queue stay out of the published Pages website, although they remain visible in a public repository.

## Weekly editorial routine

1. Review `data/review-queue.json` and the original source sites. Also search the linked services that are not automatically collected. Check the whole advert: some headings conflict with dates or funding details further down the page.
2. Add approved adverts to `site/data/opportunities.json`. Copy an existing record, replace every field, use a new `id`, and set `lastChecked` to the date you actually reviewed it. Use a short original summary, not a copied advert body.
3. Keep pay, funding, nationality/fee eligibility, experience level and opportunity type separate. Do not infer eligibility or funding. Leave `deadline` null when no date is stated; preserve the source wording in `deadlineLabel`.
4. For a dated advert, use `YYYY-MM-DD` in `deadline`, its explicitly stated local time in `deadlineTime` (or omit), and an IANA timezone such as `Europe/London`. The workflow calculates `deadlineAt`. With no time given, it treats the end of that local calendar day as the display cutoff; the card still directs students to confirm with the provider.
5. Set `reviewStatus` to `approved`; select subjects exactly as named in `site/data/sources.json`. Set `courses` to one or more of `entomology`, `ipm`, `biological-recording` after assessing the actual duties; a course tag is not an eligibility claim. Use `status: closed` for a confirmed closure. Unreachable pages are labelled for checking, not automatically declared closed.
6. Add rejected candidates to the `excluded` array with a reason. Published/excluded candidates are removed from the pending queue on the next refresh.
7. Commit changes. The workflow validates the data and republishes.

An HTTP 200 response only means a page was reachable. It does **not** renew `lastChecked`, confirm an advert is open, or establish eligibility. Undated/rolling adverts also expire from display after 30 days without editorial review. Each card exposes failed link checks when available.

## Search and subject curation

Each advert includes course-interest tags, a relevance tier and a brief “Why it fits” assessment. Core means a direct connection to at least one of the three courses. Species/habitat surveys and biodiversity data are core Biological Recording topics even without insects. Broad agronomy and molecular research may remain related fields. See `Search_Scope_and_Relevance.md` for the expanded search assessment.

The eight subject groups and terms are in `site/data/sources.json`, and visible in the board's “What do we look for?” section. They cover insect biology, IPM/crop protection, biological control, conservation, pollination, taxonomy/recording, vectors, and monitoring/environmental risk. Biological Recording searches include records centres, botanical identification, bryophytes, lichens, fungi, UKHab, NVC, biodiversity data, iRecord, QGIS and citizen science. Additional source cards link to CIEEM vacancies, Field Studies Council volunteering, the NBN scheme directory and ALERC centre finder; directories are clearly labelled and do not imply current vacancies.

Exact word matching avoids `bee` matching `been` and `tick` matching `ticket`. `IPM`, broad ecology, GIS, records/data roles, NVC and BNG require substantive biological or crop context. The collector only suggests candidates; it never publishes them, infers a salary, or treats “PhD required” as a studentship. Source-page type is not reliable: RES's jobs page includes PhDs.

The source list can be extended to direct university, research-institute, conservation and commercial employers, including Rothamsted, UKCEH, CABI, Fera, NIAB, Forest Research, museums, Wildlife Trusts, Buglife, Butterfly Conservation, Koppert and Biobest. Verify each integration and its terms first. Add only supported sources; changing a URL does not make an unsupported adapter work.

## Technical details

- No build step, framework, database, analytics, accounts or third-party JavaScript. The only browser storage is the requested theme preference.
- Relative asset paths work under a GitHub Pages project path.
- Browser assets: `site/index.html`, `styles.css`, `app.js`, `assets/`, `data/`.
- Automation: Python 3.12 standard library; no package installation required.
- Behaviour tests use fixed historical fixtures in `tests/fixtures/`, separate from the live advert data, so routine editorial changes do not invalidate regression expectations.
- Source discovery: linked `<h3>` headings on the two RES indices. Navigation links are excluded. It follows robots rules, limits requests, does not bypass access restrictions, and retains earlier data on errors. No full advert text is stored.
- Existing advert links are checked conservatively. Unknown/failed robots requests prevent fetching; a genuine missing robots file (404) is handled normally.
- All published records have individual source URLs and editorial review dates. The board displays no personal student data.
- The self-contained HTML preview is a snapshot for review, not the continuously updated site.

To validate locally:

```sh
python scripts/validate.py --normalise
python -m unittest discover -s tests -v
node tests/test_board.cjs
python scripts/refresh.py --offline
```

Serve `site/` through any local static web server to preview the actual website. Opening `site/index.html` directly can block JSON requests; use the separate self-contained preview instead. `scripts/export_preview.py` regenerates that preview.

## Verification and remaining checks

Passed: data validation including course tags; JavaScript syntax; course filtering; pagination across all five page sizes, empty/last pages, filter resets and URL state; matching and false-positive tests; UK/international and type filters; closing-window logic; exact UK noon cutoffs and daylight saving; stale-record suppression; safe HTML rendering; conservative robots failure/denial handling. The 22 published listings were checked through source/employer content on 29 September 2026. Two trainee agronomist adverts returned by older search snapshots were removed when the fresh employer index no longer listed them. The current horticultural agronomist advert is included with its experience requirement explicit.

Remaining: visual/browser interaction QA (no local browser executable was available), live collector operation from GitHub, and successful public Pages deployment. These must not be represented as already completed.

## Sources and credits

- [RES jobs](https://www.royensoc.co.uk/membership-and-community/careers-and-opportunities/job-opportunities/)
- [RES PhDs](https://www.royensoc.co.uk/membership-and-community/careers-and-opportunities/phd-opportunities/)
- [environmentjob](https://environmentjob.co.uk/)
- [FindAPhD](https://www.findaphd.com/)
- [GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub scheduled workflow guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Google job-posting documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting): Google's Indexing API is for publisher notifications, not retrieving Google job results.

Montserrat is embedded from the supplied induction deck; copyright the Montserrat Project Authors, under the SIL Open Font License 1.1. The font licence is included in `site/assets/OFL.txt`. The user-supplied `HAU_logo.png` is used unchanged, with its original transparency, as `site/assets/harper-adams-logo.png`. The full header stays navy in both themes to keep the white artwork and course links clear. It remains university brand artwork, not an asset licensed by this project. The [Entomology](https://www.harper-adams.ac.uk/courses/postgraduate/201004/entomology), [Integrated Pest Management](https://www.harper-adams.ac.uk/courses/postgraduate/201005/integrated-pest-management) and [Biological Recording](https://www.harper-adams.ac.uk/courses/postgraduate/201243/biological-recording) course pages informed the course-interest mapping. Source adverts remain the responsibility of their advertisers.
