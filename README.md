# Entomology, IPM & Biological Recording opportunities

A static opportunities board for Harper Adams MSc Entomology, MSc Integrated Pest Management and Biological Recording students. The design follows the postgraduate induction slides with navy/blue accents and Montserrat typography, with readable light and dark themes. The banner uses the supplied transparent HAU logo on a navy header that stays the same in light and dark mode. All three course links are prefixed “MSc / PgD / PgC”.

## What it is

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

## Search and subject curation

Each advert includes course-interest tags, a relevance tier and a brief “Why it fits” assessment. Core means a direct connection to at least one of the three courses. Species/habitat surveys and biodiversity data are core Biological Recording topics even without insects. Broad agronomy and molecular research may remain related fields. See `Search_Scope_and_Relevance.md` for the expanded search assessment.

The eight subject groups and terms are in `site/data/sources.json`, and visible in the board's “What do we look for?” section. They cover insect biology, IPM/crop protection, biological control, conservation, pollination, taxonomy/recording, vectors, and monitoring/environmental risk. Biological Recording searches include records centres, botanical identification, bryophytes, lichens, fungi, UKHab, NVC, biodiversity data, iRecord, QGIS and citizen science. Additional source cards link to CIEEM vacancies, Field Studies Council volunteering, the NBN scheme directory and ALERC centre finder; directories are clearly labelled and do not imply current vacancies.

Exact word matching avoids `bee` matching `been` and `tick` matching `ticket`. `IPM`, broad ecology, GIS, records/data roles, NVC and BNG require substantive biological or crop context. The collector only suggests candidates; it never publishes them, infers a salary, or treats “PhD required” as a studentship. Source-page type is not reliable: RES's jobs page includes PhDs.

The source list can be extended to direct university, research-institute, conservation and commercial employers, including Rothamsted, UKCEH, CABI, Fera, NIAB, Forest Research, museums, Wildlife Trusts, Buglife, Butterfly Conservation, Koppert and Biobest. Verify each integration and its terms first. Add only supported sources; changing a URL does not make an unsupported adapter work.

## Sources and credits

- [RES jobs](https://www.royensoc.co.uk/membership-and-community/careers-and-opportunities/job-opportunities/)
- [RES PhDs](https://www.royensoc.co.uk/membership-and-community/careers-and-opportunities/phd-opportunities/)
- [environmentjob](https://environmentjob.co.uk/)
- [FindAPhD](https://www.findaphd.com/)
- [GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub scheduled workflow guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [Google job-posting documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting): Google's Indexing API is for publisher notifications, not retrieving Google job results.
