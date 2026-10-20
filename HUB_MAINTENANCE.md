# Entomology hub maintenance

The student landing page is `site/hub/`. Its two feeds combine authored highlights with dated news and journal metadata. The opportunities board remains independent.

## Daily collection

Run from the repository root:

```sh
python scripts/refresh_hub.py
python -m unittest discover -s tests -p 'test_hub_feed.py' -v
```

The collector uses only Python's standard library. The daily GitHub Actions build runs it before `scripts/persist_checks.py` and persists `site/hub/data/feed.json` alongside the generated opportunities data, source-health data, review queue and digest. GitHub Pages then serves the generated JSON; visitors do not call publishers' APIs directly.

The existing schedule is `17 5 * * *` (05:17 UTC, 06:17 during British Summer Time). The workflow also runs after a push to `main` and through **Actions → Check opportunities and hub, then publish Pages → Run workflow**. A failed source does not discard cached content or stop publication of the rest of the hub.

## Files

- `site/hub/data/curated.json`: authored highlights, as a JSON array. Edit this to add, revise or remove a selected item.
- `site/hub/data/sources.json`: collection sources, as a JSON array. Each entry identifies an RSS/Atom feed or a Crossref journal endpoint, with a separate `homepage` for the reader-facing source link.
- `site/hub/data/feed.json`: generated public output. Do not hand-edit; the collector replaces it.
- `scripts/refresh_hub.py`: validation, tagging, collection, deduplication and cache handling.
- `tests/test_hub_feed.py`: offline tests for dates, unsafe links, duplicates, source failures and editorial priority.

## Add a highlight

Use a stable, unique `id`, an exact publication date confirmed on the source page, and the original article or DOI link. Write a short original `summary` and `why` after reading the source. Distinguish findings from interpretation; a study title alone is insufficient to write a research summary.

```json
{
  "id": "chosen-paper-short-name",
  "kind": "research",
  "title": "Exact title of the paper",
  "source": "Journal name",
  "url": "https://doi.org/10.1234/example",
  "doi": "10.1234/example",
  "published": "2026-10-16",
  "region": "global",
  "areas": ["Biological control"],
  "curated": true,
  "summary": "A short, checked description of the study and its findings.",
  "why": "Why it may be useful for students or researchers."
}
```

Set `kind` to `news` or `research`, and `region` to `uk` or `global`. Region describes the article's stated coverage; a UK publisher does not make an international study UK research. The source can be UK-based while the item has global coverage.

Available topic labels exactly match the opportunities board:

- Insect biology & behaviour
- Crop protection & IPM
- Biological control
- Ecology & conservation
- Pollination & beneficial insects
- Taxonomy & biodiversity recording
- Vectors & veterinary entomology
- Monitoring & environmental risk

Curated items take priority when the same DOI or canonical URL is discovered automatically. They remain until removed from `curated.json`, including after the automatic feed's age limit. Invalid or future-dated curated entries are not published.

## Automatic source coverage

News: Entomology Today, Royal Entomological Society, Buglife, CABI and PlantwisePlus. Mixed-topic feeds must mention insects, relevant arthropods or pollination in their title or supplied feed description to be eligible. Descriptions help determine relevance but are not republished.

Research metadata: Ecological Entomology, Agricultural and Forest Entomology, Insect Conservation and Diversity, Physiological Entomology, Systematic Entomology, Medical and Veterinary Entomology, Insect Molecular Biology and Biological Control. Crossref supplies publisher-deposited titles, DOIs and publication dates. Biological Control is filtered for entomology because its scope also includes non-insect work. This is a selected journal watchlist, not an exhaustive search or a ranking of research quality.

Source URLs and journal identifiers were tested on 16 October 2026. Public endpoints can change; check the source-health panel if a feed becomes unavailable.

## Automatic publication rules

- RSS/Atom posts marked as sponsored content, sponsored posts, sponsored articles, paid content or advertorials in the title, categories or supplied text are excluded. This uses the publisher’s metadata; it cannot identify undisclosed sponsorship.
- Automatic records are `curated: false` with `tagMethod: "automatic-keywords"` and empty `summary` and `why` fields. They must be presented as automatically collected links, not read or endorsed editorial highlights.
- Topic tags use title keywords, falling back to the journal/feed's configured subject scope. These approximate filters can miss or misclassify articles.
- Automatic UK coverage is assigned only when the title explicitly names the UK or a constituent nation. All other records are `global`; this does not assert that each study spans the globe.
- Only HTTP(S) public links and valid publication dates are accepted. RSS publication dates and Atom `published` dates are used; Atom `updated` is deliberately insufficient.
- Crossref requires day-level publication metadata. Online publication can precede a future print issue; the earliest eligible actual publication date is used. Records with only a year/month are omitted rather than given invented days.
- Future-dated records, records older than 120 days, journal issues and missing/invalid publication metadata are omitted.
- DOI and canonical URL deduplication removes tracking parameters and prioritises authored records. At most 120 automatic records are retained, plus all valid curated records.
- The initial automatic feed can contain many research papers. Use curated highlights and the filters to keep the student entry point approachable.

## Availability and stale data

Each source has `status`, `lastAttempt`, `lastSuccess`, `count`, and an optional concise `error`. `count` is the number of eligible records retrieved or recovered before the overall cap and deduplication.

- `ok`: the source returned valid XML/JSON, including when no eligible articles were found.
- `cached`: the latest request failed; previously fetched eligible records are retained.
- `error`: the request failed and there were no eligible cached records.

`updatedAt` records the collection attempt. `lastSuccessfulUpdate` advances only when at least one source is retrieved successfully. Cached items must also have passed the current content checks; older cached records created before the sponsored-content filter are discarded. Individual `lastSuccess` values provide the accurate freshness of each source; one successful source does not mean all sources succeeded. A source successfully returning an empty eligible set replaces that source's previous records, while a failed request retains eligible cached records.

Requests use eight-second socket timeouts, at most two attempts, a 3 MB response limit and four parallel workers. HTTP rate limits and temporary server errors receive one short retry; permanent HTTP errors do not. Errors are recorded without publishing response bodies. Normal runs take well under three minutes. Tests use fixtures and never require external network access.

## Sensible next additions

A staff-maintained events calendar, student project showcase and practical learning resources can extend the hub without turning the automatically gathered feeds into unreviewed advice. An external source can be added to `sources.json` after checking its feed/API, publication-date fields, scope and public reuse terms.

## Hub views and HAU information

The hub loads `../styles.css` to share the opportunities board's masthead, logo treatment, typography and colour tokens. `site/hub/hub.css` contains hub-specific layouts. Main navigation switches between highlights, HAU courses and research groups, the practical toolkit, and sources. Links such as `hub/?section=courses` open a view directly; fragment links can reveal a target in another view.

The course and staff overview in `site/hub/index.html` was checked on 20 October 2026 against the linked official HAU course, group and staff pages. Staff affiliation and ordering follow the [postgraduate induction presentation](https://benclunie.github.io/hau-pg-induction/): group leads above teams, Joe Roberts first within Applied, and Jack Bamber within Ecology, Evolution and Conservation. This is a research-affiliation overview rather than a line-management chart. Review the official pages when staff or course details change.

The careers section adapts the portfolio guidance in `Graduate_Outcomes_2026-27.pptx`: applied science, ecology and conservation, research, and communication. It publishes no individual graduate records or employment-rate claims.
