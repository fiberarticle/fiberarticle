export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type RunMode = "research" | "literature_review";

export interface Run {
  id: string;
  topic: string;
  /** AI-generated one-line title; the API falls back to the topic. */
  title: string;
  pinned: boolean;
  mode: RunMode;
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

export type Quartile = "Q1" | "Q2" | "Q3" | "Q4";

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
  quartile: Quartile | null;
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

export type DocumentTemplate =
  | "generic"
  | "ieee"
  | "apa"
  | "acm"
  | "elsevier"
  | "springer"
  | "neurips";

export interface TemplateInfo {
  id: DocumentTemplate;
  label: string;
  description: string;
  latex: boolean;
}

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
  /** Planned section count while generating; written count once done. */
  total_sections: number;
  sections: DocumentSection[];
  authors: string[];
  citation_style: string | null;
  error: string | null;
  references: Paper[];
  created_at: string;
  updated_at: string;
}

export interface PaperDetail extends Paper {
  cited_by_count: number;
  full_text_parsed: boolean;
  run_id: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  scope: "library" | "paper";
  paper_id: string | null;
  paper_title: string | null;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatCitation {
  /** null for sources found live on the web rather than among your papers. */
  paper_id: string | null;
  title: string;
  quote: string;
  url: string | null;
}

export interface ChatStep {
  type: "thought" | "action";
  /** thought steps */
  text?: string;
  /** action steps */
  tool?: string;
  input?: string;
  result?: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations: ChatCitation[] | null;
  steps: ChatStep[] | null;
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
  pinned: boolean;
  /** How many papers this extraction covers (rows grow toward this). */
  total_papers: number;
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
  pinned: boolean;
  section_count: number;
  created_at: string;
  updated_at: string;
}

export interface Bibliography {
  style: string;
  numeric: boolean;
  entries: string[];
}

export interface DocumentChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface DocumentChatResult {
  reply: string;
  changed: boolean;
  document: DocumentDetail;
}

export interface Preferences {
  citation_style: string;
  citation_style_title: string;
  ai_language: string;
}

export interface CitationStyle {
  id: string;
  title: string;
  format: string | null;
}

export interface LanguageOption {
  value: string;
  label: string;
}
