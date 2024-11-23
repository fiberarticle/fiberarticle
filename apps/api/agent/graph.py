"""LangGraph research pipeline.

plan → generate_queries → search → dedupe_rank → screen → fetch_oa_pdfs
→ parse → chunk_embed → extract → coverage_check
→ (insufficient → generate_queries, max 2 loops)
→ [literature review only: review_matrix → review_synthesis]
→ synthesize → report

A fixed staged graph, not a freeform ReAct loop: deterministic order,
bounded looping, and a clean stage-to-SSE mapping.

A literature review takes the same route with two extra stages: every
selected paper is tabulated on its own (review_matrix), then the whole
table is read at once for trends, methods, datasets, gaps, and future work
(review_synthesis). Both feed the narrative writer that follows.
"""

from langgraph.graph import END, START, StateGraph

from agent.nodes import ResearchNodes
from agent.state import ResearchState
from llm.client import ResolvedLlm


STAGES = [
    "plan",
    "generate_queries",
    "search",
    "dedupe_rank",
    "screen",
    "fetch_oa_pdfs",
    "parse",
    "chunk_embed",
    "extract",
    "coverage_check",
    "review_matrix",
    "review_synthesis",
    "synthesize",
    "report",
]

# Stages that only ever run for mode == "literature_review".
REVIEW_STAGES = ("review_matrix", "review_synthesis")


def _after_coverage(state: ResearchState) -> str:
    if not state.get("coverage_ok"):
        return "generate_queries"
    if state.get("mode") == "literature_review":
        return "review_matrix"
    return "synthesize"


def build_graph(run_id: str, user_id: str, llm: ResolvedLlm, entry: str = "plan"):
    nodes = ResearchNodes(run_id, user_id, llm)
    graph = StateGraph(ResearchState)

    graph.add_node("plan", nodes.plan)
    graph.add_node("generate_queries", nodes.generate_queries)
    graph.add_node("search", nodes.search)
    graph.add_node("dedupe_rank", nodes.dedupe_rank)
    graph.add_node("screen", nodes.screen)
    graph.add_node("fetch_oa_pdfs", nodes.fetch_oa_pdfs)
    graph.add_node("parse", nodes.parse)
    graph.add_node("chunk_embed", nodes.chunk_embed)
    graph.add_node("extract", nodes.extract)
    graph.add_node("coverage_check", nodes.coverage_check)
    graph.add_node("review_matrix", nodes.review_matrix)
    graph.add_node("review_synthesis", nodes.review_synthesis)
    graph.add_node("synthesize", nodes.synthesize)
    graph.add_node("report", nodes.report)

    # Resume support: a failed run re-enters the graph at the stage it died
    # in, with its saved state. Fresh runs always enter at "plan".
    graph.add_edge(START, entry if entry in STAGES else "plan")
    graph.add_edge("plan", "generate_queries")
    graph.add_edge("generate_queries", "search")
    graph.add_edge("search", "dedupe_rank")
    graph.add_edge("dedupe_rank", "screen")
    graph.add_edge("screen", "fetch_oa_pdfs")
    graph.add_edge("fetch_oa_pdfs", "parse")
    graph.add_edge("parse", "chunk_embed")
    graph.add_edge("chunk_embed", "extract")
    graph.add_edge("extract", "coverage_check")
    graph.add_conditional_edges(
        "coverage_check",
        _after_coverage,
        {
            "generate_queries": "generate_queries",
            "review_matrix": "review_matrix",
            "synthesize": "synthesize",
        },
    )
    graph.add_edge("review_matrix", "review_synthesis")
    graph.add_edge("review_synthesis", "synthesize")
    graph.add_edge("synthesize", "report")
    graph.add_edge("report", END)

    return graph.compile()
