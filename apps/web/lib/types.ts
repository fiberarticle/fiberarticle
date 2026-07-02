export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Run {
  id: string;
  topic: string;
  status: RunStatus;
  stage: string | null;
  paper_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunEvent {
  id: number;
  stage: string;
  type: string;
  message: string;
  data: Record<string, unknown> | null;
  ts: string;
}

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  source: string;
  is_open_access: boolean;
  abstract: string | null;
}

export type LlmMode = "fiberarticle_ai" | "byok" | "local";

export interface LlmConfig {
  mode: LlmMode | null;
  provider: string | null;
  model: string | null;
  base_url: string | null;
  has_key: boolean;
  caps: {
    papers_per_run: number;
  };
  reasoning: boolean;
}

export interface RunDetail extends Run {
  report: string | null;
  papers: Paper[];
}

export type DocumentTemplate = "generic" | "ieee" | "apa";

export interface DocumentSection {
  id: string;
  heading: string;
  content: string;
}

export interface DocumentDetail {
  id: string;
  run_id: string | null;
  title: string;
  template: DocumentTemplate;
  status: "generating" | "ready" | "failed";
  sections: DocumentSection[];
  authors: string[];
  error: string | null;
  references: Paper[];
  created_at: string;
  updated_at: string;
}

export interface PaperDetail extends Paper {
  notes: string | null;
  summary: {
    tldr?: string;
    key_findings?: string[];
    methodology?: string;
    limitations?: string[];
  } | null;
  cited_by_count: number;
  full_text_parsed: boolean;
  collection_ids: string[];
  chunk_count: number;
  run_id: string | null;
  created_at: string;
}

export interface Collection {
  id: string;
  name: string;
  paper_count: number;
  created_at: string;
}

export interface SearchResultPaper {
  source: string;
  external_id: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  is_open_access: boolean;
  oa_pdf_url: string | null;
  cited_by_count: number;
}

export interface SearchResponse {
  results: SearchResultPaper[];
  answer: string | null;
  answer_sources: number[];
  sub_queries: string[];
  in_library_dois: string[];
}

export interface Conversation {
  id: string;
  scope: "library" | "paper";
  paper_id: string | null;
  paper_title: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatCitation {
  paper_id: string;
  title: string;
  quote: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations: ChatCitation[] | null;
  created_at: string;
}

export interface ExtractionColumn {
  name: string;
  description: string;
}

export interface ExtractionRow {
  paper_id: string;
  title: string;
  year: number | null;
  cells: Record<string, { value: string; quote: string | null }>;
}

export interface Extraction {
  id: string;
  name: string;
  status: "running" | "ready" | "failed";
  columns: ExtractionColumn[];
  rows: ExtractionRow[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentListItem {
  id: string;
  title: string;
  template: DocumentTemplate;
  status: "generating" | "ready" | "failed";
  section_count: number;
  created_at: string;
  updated_at: string;
}
