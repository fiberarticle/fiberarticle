from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

LlmMode = Literal["fiberarticle_ai", "byok", "local"]

# No run limits: every mode gets the same generous paper budget per run.
CAPS: dict[str, dict[str, int]] = {
    "fiberarticle_ai": {"papers_per_run": 40},
    "byok": {"papers_per_run": 40},
    "local": {"papers_per_run": 40},
}


class LlmConfigIn(BaseModel):
    mode: LlmMode
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    # Fiberarticle AI managed mode: max reasoning (thorough) vs fast.
    # Defaults off: the fast model is the zero-friction default.
    reasoning: bool = False


class LlmConfigOut(BaseModel):
    mode: LlmMode | None
    provider: str | None
    model: str | None
    base_url: str | None
    has_key: bool
    caps: dict[str, int]
    reasoning: bool = False


class PreferencesIn(BaseModel):
    citation_style: str | None = Field(default=None, min_length=1, max_length=120)
    ai_language: str | None = Field(default=None, min_length=2, max_length=20)


class PreferencesOut(BaseModel):
    citation_style: str
    citation_style_title: str
    ai_language: str


class RunFilters(BaseModel):
    year_from: int | None = Field(default=None, ge=1800, le=2100)
    year_to: int | None = Field(default=None, ge=1800, le=2100)
    quartiles: list[Literal["Q1", "Q2", "Q3", "Q4"]] | None = None
    open_access_only: bool = False
    min_citations: int | None = Field(default=None, ge=0)
    max_papers: int | None = Field(default=None, ge=5, le=60)


class RunCreate(BaseModel):
    topic: str = Field(min_length=10, max_length=2000)
    mode: Literal["research", "literature_review"] = "research"
    filters: RunFilters | None = None
    # Inclusion/exclusion criteria applied during screening.
    criteria: str | None = Field(default=None, max_length=2000)
    # Library papers the user attached to this task: always included in the
    # run alongside fresh search results.
    seed_paper_ids: list[str] | None = Field(default=None, max_length=20)


class RunOut(BaseModel):
    id: str
    topic: str
    # AI-generated one-line title; falls back to the topic until it exists.
    title: str
    pinned: bool = False
    mode: str = "research"
    status: str
    stage: str | None
    paper_count: int
    error: str | None
    created_at: datetime
    updated_at: datetime


class RunUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None


class PaperOut(BaseModel):
    id: str
    title: str
    authors: list[str]
    year: int | None
    venue: str | None
    doi: str | None
    url: str | None
    source: str
    is_open_access: bool
    abstract: str | None
    quartile: str | None = None


class RunDetailOut(RunOut):
    report: str | None
    papers: list[PaperOut]


class RunEventOut(BaseModel):
    id: int
    stage: str
    type: str
    message: str
    data: dict[str, Any] | None
    ts: datetime


DocumentTemplate = Literal[
    "generic", "ieee", "apa", "acm", "elsevier", "springer", "neurips"
]


class DocumentSection(BaseModel):
    id: str
    heading: str
    content: str


class DocumentCreate(BaseModel):
    template: DocumentTemplate = "generic"


class DocumentUpdate(BaseModel):
    title: str | None = None
    template: DocumentTemplate | None = None
    sections: list[DocumentSection] | None = None
    authors: list[str] | None = None
    citation_style: str | None = Field(default=None, min_length=1, max_length=120)
    pinned: bool | None = None


class DocumentOut(BaseModel):
    id: str
    run_id: str | None
    title: str
    template: str
    status: str
    # Planned section count while generating; written count once done. Lets
    # the editor show real "n of m sections" progress.
    total_sections: int = 0
    sections: list[DocumentSection]
    authors: list[str]
    citation_style: str | None = None
    error: str | None
    references: list[PaperOut]
    created_at: datetime
    updated_at: datetime


class DocumentListItem(BaseModel):
    id: str
    title: str
    template: str
    status: str
    pinned: bool = False
    section_count: int
    created_at: datetime
    updated_at: datetime


EditCommand = Literal[
    "rewrite",
    "expand",
    "condense",
    "academic_tone",
    "improve",
    "simplify",
    "humanize",
    "tone",
    "translate",
    "custom",
]

EditTone = Literal["academic", "formal", "confident", "friendly", "persuasive"]


class SectionEditIn(BaseModel):
    section_id: str
    command: EditCommand
    # Free-form author instruction; required when command == "custom".
    instruction: str | None = Field(default=None, max_length=2000)
    # Required when command == "tone".
    tone: EditTone | None = None
    # Language code from prefs.LANGUAGES; required when command == "translate".
    language: str | None = Field(default=None, min_length=2, max_length=20)
    # Selection mode: revise only this passage. The server returns the
    # replacement without persisting; the editor splices it in locally and
    # autosaves. Contexts anchor the passage boundaries for the model.
    selected_text: str | None = Field(default=None, min_length=1, max_length=8000)
    context_before: str = Field(default="", max_length=300)
    context_after: str = Field(default="", max_length=300)


class SectionEditOut(BaseModel):
    section_id: str
    content: str


class PaperDetailOut(PaperOut):
    notes: str | None
    summary: dict[str, Any] | None
    cited_by_count: int
    full_text_parsed: bool
    collection_ids: list[str]
    chunk_count: int
    run_id: str | None
    created_at: datetime


class PaperAddIn(BaseModel):
    source: str = "search"
    external_id: str | None = None
    title: str = Field(min_length=1, max_length=1000)
    authors: list[str] = []
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    url: str | None = None
    abstract: str | None = None
    is_open_access: bool = False
    oa_pdf_url: str | None = None
    cited_by_count: int = 0
    issn: str | None = None
    quartile: str | None = None


class PaperAddByDoiIn(BaseModel):
    doi: str = Field(min_length=6, max_length=300)


class PaperUpdateIn(BaseModel):
    notes: str | None = None
    collection_ids: list[str] | None = None


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CollectionOut(BaseModel):
    id: str
    name: str
    paper_count: int
    created_at: datetime


class ConversationCreateIn(BaseModel):
    scope: Literal["library", "paper"] = "library"
    paper_id: str | None = None


class ConversationOut(BaseModel):
    id: str
    scope: str
    paper_id: str | None
    paper_title: str | None
    title: str
    pinned: bool = False
    created_at: datetime
    updated_at: datetime


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None


class ChatCitation(BaseModel):
    # None for sources found live on the web rather than in the library.
    paper_id: str | None = None
    title: str
    quote: str
    url: str | None = None


class ChatMessageOut(BaseModel):
    id: int
    role: str
    content: str
    citations: list[ChatCitation] | None
    # ReAct chain of thought: [{type: "thought"|"action", ...}]
    steps: list[dict[str, Any]] | None = None
    created_at: datetime


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    # True when the user attached/uploaded files with this message: forces
    # one library_search pass so the attached documents are always consulted.
    search_library_first: bool = False


class ExtractionColumn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=400)


class ExtractionCreateIn(BaseModel):
    # Blank name: a background AI title is generated from the column spec.
    name: str = Field(default="", max_length=200)
    paper_ids: list[str] = Field(min_length=1, max_length=50)
    columns: list[ExtractionColumn] = Field(min_length=1, max_length=20)


class ExtractionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    pinned: bool | None = None


class ExtractionOut(BaseModel):
    id: str
    name: str
    status: str
    pinned: bool = False
    # How many papers this extraction covers, so the UI can show real
    # "n of m papers" progress while rows stream in.
    total_papers: int = 0
    columns: list[ExtractionColumn]
    rows: list[dict[str, Any]]
    error: str | None
    created_at: datetime
    updated_at: datetime
