"""Which bibliographic databases a paper is demonstrably indexed in.

Reviewers are expected to state where each record was found. Fiberarticle
only ever claims coverage it can prove from data already on the record, so
the column is evidence, not a guess:

- Scopus       : the journal matched Scimago (SJR is computed from Scopus).
- PubMed       : the index returned a PubMed id for the work.
- arXiv        : the record came from arXiv, or its URL/DOI points there.
- Crossref     : the work has a registered DOI.
- Publisher    : the DOI registrant prefix identifies the host platform
                 (IEEE Xplore, ACM Digital Library, ScienceDirect, ...).

Web of Science is deliberately never claimed: nothing in the record proves
it, and an unverifiable claim in a literature review is worse than a gap.
"""

# DOI registrant prefix -> the full-text platform that hosts the work.
_DOI_PLATFORMS: dict[str, str] = {
    "10.1109": "IEEE Xplore",
    "10.1145": "ACM Digital Library",
    "10.1016": "ScienceDirect",
    "10.1007": "SpringerLink",
    "10.1057": "SpringerLink",
    "10.1002": "Wiley Online Library",
    "10.1111": "Wiley Online Library",
    "10.1038": "Nature Portfolio",
    "10.1126": "Science (AAAS)",
    "10.1371": "PLOS",
    "10.3390": "MDPI",
    "10.1080": "Taylor and Francis",
    "10.1177": "SAGE Journals",
    "10.3389": "Frontiers",
    "10.1017": "Cambridge Core",
    "10.1093": "Oxford Academic",
    "10.1186": "BioMed Central",
    "10.1155": "Hindawi",
    "10.1049": "IET Digital Library",
    "10.1061": "ASCE Library",
    "10.1115": "ASME Digital Collection",
    "10.1021": "ACS Publications",
    "10.1039": "RSC Publishing",
    "10.1063": "AIP Publishing",
    "10.1103": "APS Physical Review",
    "10.1287": "INFORMS PubsOnline",
    "10.1136": "BMJ Journals",
    "10.1056": "NEJM",
    "10.2196": "JMIR Publications",
    "10.5194": "Copernicus",
    "10.1101": "bioRxiv / medRxiv",
    "10.48550": "arXiv",
    "10.1590": "SciELO",
    "10.1108": "Emerald Insight",
    "10.18653": "ACL Anthology",
    "10.24963": "IJCAI Proceedings",
    "10.1609": "AAAI Proceedings",
    "10.5555": "ACM / conference proceedings",
}

# Where the record itself was discovered. Useful provenance, but weaker than
# the verified coverage above, so it always sorts last.
_DISCOVERY_LABELS: dict[str, str] = {
    "openalex": "OpenAlex",
    "semantic_scholar": "Semantic Scholar",
    "crossref": "Crossref",
    "arxiv": "arXiv",
    "upload": "Uploaded by you",
    "manual": "Added by you",
}


def derive_indexes(paper: dict) -> list[str]:
    """Databases this paper is provably indexed in, strongest evidence first."""
    doi = (paper.get("doi") or "").lower().strip()
    url = (paper.get("url") or "").lower()
    source = (paper.get("source") or "").lower()
    found: list[str] = []

    def add(label: str | None) -> None:
        if label and label not in found:
            found.append(label)

    # Scimago rank == present in Scopus source list.
    if paper.get("quartile"):
        add("Scopus")
    if paper.get("pmid"):
        add("PubMed")
    if source == "arxiv" or "arxiv.org" in url or doi.startswith("10.48550"):
        add("arXiv")
    if doi:
        add(_DOI_PLATFORMS.get(doi.split("/", 1)[0]))
        add("Crossref")
    add(_DISCOVERY_LABELS.get(source))
    return found
