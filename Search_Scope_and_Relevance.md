# Search scope and relevance

Current policy: 1 October 2026. The board serves the Harper Adams postgraduate courses in Entomology, Integrated Pest Management and Biological Recording. Current direct and related-field source matches publish automatically, with per-card caveats. The admin approval setup is paused.

## What qualifies for inclusion?

A source entry must pass the configured subject screening and publication checks. Direct insect, IPM or biological-recording matches are included alongside broader ecology, biodiversity, agronomy and research opportunities that could interest these students. Broad relevance is explained rather than presented as proof of an ideal course fit.

Missing salary, funding, eligibility, country, opportunity type or closing date does not by itself block inclusion. The card identifies missing details and any inferred classifications. Known exclusions, withdrawals, past deadlines and stale records are filtered out. Existing human-reviewed records retain their genuine review dates and verified information; automated source sightings do not become human reviews.

A match does not guarantee graduate-level entry, funding eligibility, an insect component or current availability at the destination page. Readers should follow the original advert before applying. A current source listing is useful evidence, but a feed or directory can retain outdated entries.

## Search terms and interpretation

| Search terms | Course connection | Reader caveat or screening rule |
| --- | --- | --- |
| Entomology, insect biology, insect rearing, pollinators, invertebrates | Core Entomology; other courses where relevant | Check the taxonomic focus and required laboratory, field or husbandry experience. |
| Integrated pest management / IPM, crop protection, biological control, biocontrol | Core IPM and often Entomology | Require crop, pest or biological context: IPM alone is ambiguous. Commercial roles may have sales or experience requirements. |
| Plant health, plant pathology, biosecurity, protective microbes | IPM routes in pest, weed and disease management | Not every project involves insects; laboratory prerequisites and the biological focus matter. |
| Agronomy, horticultural advice, crop trials, agricultural science technician | Crop-management, experimental and data skills | An experienced agronomist post is not automatically a graduate scheme. |
| Biological recording, taxonomic identification, records centres, specimen digitisation | Core Biological Recording | Check the organism group, identification level and whether duties involve curation, validation or biological information. |
| Habitat survey, UKHab, NVC, botanical survey, protected species, biodiversity net gain / BNG | Biological Recording and applied ecology | Taxonomic skills, licences, travel and professional experience may be required. |
| Biodiversity data, ecological GIS, species distributions, iRecord, NBN Atlas, citizen science | Biological Recording and monitoring | Generic GIS or administrative record keeping without biological context is outside scope. |
| Biodiversity, graduate/assistant ecologist, conservation, ecological assessment | Useful related-field opportunities; sometimes core Biological Recording | The role may focus on habitats or vertebrates. Confirm substantive ecological duties and entry requirements. |
| Agroecology, agroforestry, landscape ecology, wildlife connectivity | IPM, ecological research and recording | Insect work is not guaranteed. Check field, analytical and funding requirements. |
| eDNA, metabarcoding, molecular biodiversity | Specialist identification and analytical routes | The biological focus may be microbial or otherwise peripheral to entomology; prerequisites can be substantial. |
| Sustainability, environment or conservation alone | Broad discovery signals | Exclude generic administration, fundraising, trusteeships, research administration and unrelated roles using title/context screening. |

The eight subject groups and keyword rules are in `site/data/sources.json`, with their search scope shown on the website. Exact word matching avoids examples such as `bee` matching `been` or `tick` matching `ticket`. Titles and source descriptions provide screening evidence; source context, particularly the specialised RES indices, can also help identify relevant leads.

The **Relevance** filter distinguishes core connections from broader related fields. The **Course interest** filter identifies one or more courses. Automatic mappings are keyword-derived assessments, not verified eligibility decisions. A senior ecological post can show a relevant career route without being suitable for a student to apply for immediately.

## Biological Recording scope

The [Biological Recording course](https://www.harper-adams.ac.uk/courses/postgraduate/201243/biological-recording) covers identification and recording across taxonomic groups, habitat surveys, monitoring and biodiversity information. An insect keyword is not required for a Biological Recording connection.

Useful terms include botanical identification, bryophytes, lichens, mycology, biological records, records centres, LERC, UKHab, NVC, QGIS, biodiversity data and citizen science. Species/habitat surveys and biodiversity data can be core topics. Crop advice, insect rearing and IPM decision support are not automatically labelled Biological Recording.

Volunteer monitoring schemes can help build practical identification and recording experience. A scheme accepting enquiries is different from immediate fieldwork: readers should check season dates, training, location, expenses and time commitment. The same care applies to internships, which must not be assumed to be paid.

## Collection coverage and its limits

Enabled automatic discovery covers the RES jobs and PhD indices and official RSS feeds for environmentjob jobs, environmentjob volunteering, Bath jobs and Harper Adams jobs. Collectors check robots rules, use bounded requests and retain minimal discovery metadata. Descriptions can be used transiently for screening; full adverts are not republished.

Google jobs/search, FindAPhD, jobs.ac.uk and other provider links remain assisted searches, not comprehensive automated feeds. The board therefore cannot claim to contain all relevant opportunities. A successful collector can return no relevant matches, and a failed collector means incomplete coverage. Per-source health and collection dates make that visible.

CIEEM remains a manual source because its terms require written permission for inclusion in an electronic retrieval service. Other useful starting points include [CIEEM vacancies](https://cieem.net/ecology-and-environmental-management-jobs/), [Field Studies Council volunteering](https://www.field-studies-council.org/jobs-at-field-studies-council/volunteering-with-field-studies-council/), the [NBN recording-scheme directory](https://nbn.org.uk/tools-and-resources/useful-websites/database-of-wildlife-surveys-and-recording-schemes/) and the [ALERC records-centre finder](https://www.alerc.org.uk/lerc-finder.html). The last two are directories, not vacancy feeds; check current opportunities with individual providers.

Potential extensions include university and research-institute careers pages, museums, Wildlife Trusts, Buglife, Butterfly Conservation, Rothamsted, UKCEH, CABI, Fera, NIAB, Forest Research, Koppert and Biobest. Each source needs an accessible, permitted and tested integration. Adding its address to a configuration file does not make an unsupported adapter work.

## Caveats and community corrections

Cards should make uncertainty concrete: identify missing pay/funding, eligibility, location or deadline information, explain broad relevance and flag inferred classifications. These caveats help readers decide what to check; they do not substitute for the original advert.

The card wording is specific to the advert, for example **“Check main advert for: salary, eligibility and closing date.”** Related automatic matches also ask readers to check relevance to their interests. An unspecified field means it was not established in the collected record; the original advert may contain it.

Every card retains **Report advert**. A reader can submit a pre-filled GitHub issue for an irrelevant, closed or incorrect listing. A maintainer with repository authority can apply `remove-advert` to withdraw it and exclude its known URLs from future collection. Reports require GitHub sign-in, and submitting a report alone does not remove anything.

The workflow continues collecting and publishing without an approval gate. Its stored queue remains useful for discovery evidence, exclusions, optional checks and existing decision history. Old held candidates are not blindly treated as current; publication still depends on source evidence and expiry/freshness checks. The dormant admin implementation is retained for possible future use, with no public Admin link or login prerequisite in the current board.
