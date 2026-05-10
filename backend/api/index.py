"""Vercel Python serverless entry point.

Vercel detects this file under `api/` and serves it as a serverless function.
It just imports the FastAPI ASGI app from `main.py` (one directory up).
All `/api/*` paths are rewritten to this file via `vercel.json`.
"""
import sys
from pathlib import Path

# Make the `backend/` package importable so `from main import app` works
# when this file runs at `backend/api/index.py`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app  # noqa: E402,F401  (re-exported for Vercel's ASGI runtime)
