"""Server-side embeddings: fastembed, bge-small-en-v1.5, 384 dimensions, CPU.

Always local to the API server. Never billed to the user and never dependent
on the user's LLM provider.
"""

import asyncio

_model = None
_lock = asyncio.Lock()

MODEL_NAME = "BAAI/bge-small-en-v1.5"
DIMENSIONS = 384


async def _get_model():
    global _model
    if _model is None:
        async with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                _model = await asyncio.to_thread(TextEmbedding, MODEL_NAME)
    return _model


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    model = await _get_model()
    embeddings = await asyncio.to_thread(lambda: list(model.embed(texts)))
    return [e.tolist() for e in embeddings]


async def embed_query(text: str) -> list[float]:
    model = await _get_model()
    embeddings = await asyncio.to_thread(lambda: list(model.query_embed([text])))
    return embeddings[0].tolist()
