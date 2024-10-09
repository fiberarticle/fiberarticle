"""Word-based chunking. Targets roughly 800-1200 tokens per chunk with ~15% overlap.

Token counts are approximated as words / 0.75 (a common heuristic), so the
defaults below land inside the target token window without a tokenizer dependency.
"""

_CHUNK_WORDS = 750
_OVERLAP_WORDS = 110


def chunk_text(text: str) -> list[str]:
    words = text.split()
    if not words:
        return []
    if len(words) <= _CHUNK_WORDS:
        return [" ".join(words)]

    chunks: list[str] = []
    step = _CHUNK_WORDS - _OVERLAP_WORDS
    for start in range(0, len(words), step):
        chunk_words = words[start : start + _CHUNK_WORDS]
        if len(chunk_words) < 50 and chunks:
            break
        chunks.append(" ".join(chunk_words))
        if start + _CHUNK_WORDS >= len(words):
            break
    return chunks
