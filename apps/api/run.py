"""Entry point. On Windows, psycopg's async pool requires the selector event
loop, but uvicorn's own runner installs the proactor loop. So we create the
loop ourselves and await uvicorn's server directly: python run.py
"""

import asyncio
import sys

import uvicorn

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def main() -> None:
    config = uvicorn.Config("main:app", host="0.0.0.0", port=5000, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
