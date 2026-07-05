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
    reasoning: bool = True


class LlmConfigOut(BaseModel):
    mode: LlmMode | None
    provider: str | None
    model: str | None
    base_url: str | None
    has_key: bool
    caps: dict[str, int]
    reasoning: bool = True


class RunCreate(BaseModel):
    topic: str = Field(min_length=10, max_length=2000)


class RunOut(BaseModel):
    id: str
    topic: str
    status: str
    stage: str | None
    paper_count: int
    error: str | None
    created_at: datetime
    updated_at: datetime


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


DocumentTemplate = Literal["generic", "ieee", "apa"]


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


class DocumentOut(BaseModel):
    id: str
    run_id: str | None
    title: str
    template: str
    status: str
    sections: list[DocumentSection]
    authors: list[str]
    error: str | None
    references: list[PaperOut]
    created_at: datetime
    updated_at: datetime


class DocumentListItem(BaseModel):
    id: str
    title: str
    template: str
    status: str
    section_count: int
    created_at: datetime
    updated_at: datetime


class SectionEditIn(BaseModel):
    section_id: str
    command: Literal["rewrite", "expand", "condense", "academic_tone"]


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


class SearchIn(BaseModel):
    query: str = Field(min_length=3, max_length=500)
    year_from: int | None = None
    open_access_only: bool = False
    answer: bool = True


class SearchResultOut(BaseModel):
    results: list[PaperAddIn]
    answer: str | None
    answer_sources: list[int]
    sub_queries: list[str]
    in_library_dois: list[str]


class ConversationCreateIn(BaseModel):
    scope: Literal["library", "paper"] = "library"
    paper_id: str | None = None


class ConversationOut(BaseModel):
    id: str
    scope: str
    paper_id: str | None
    paper_title: str | None
    title: str
    created_at: datetime
    updated_at: datetime


class ChatCitation(BaseModel):
    paper_id: str
    title: str
    quote: str


class ChatMessageOut(BaseModel):
    id: int
    role: str
    content: str
    citations: list[ChatCitation] | None
    created_at: datetime


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class ExtractionColumn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=400)


class ExtractionCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    paper_ids: list[str] = Field(min_length=1, max_length=50)
    columns: list[ExtractionColumn] = Field(min_length=1, max_length=20)


class ExtractionOut(BaseModel):
    id: str
    name: str
    status: str
    columns: list[ExtractionColumn]
    rows: list[dict[str, Any]]
    error: str | None
    created_at: datetime
    updated_at: datetime
