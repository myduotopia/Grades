"""SQLAlchemy engine + session factory."""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from config import settings

# Serverless (Vercel) note: each invocation may run in a fresh container, so a
# process-local SQLAlchemy pool can't be reused across requests. Hand pooling
# to Supabase PgBouncer (transaction mode, port 6543) and keep no local pool.
engine = create_engine(settings.database_url, poolclass=NullPool)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a Session, ensures it closes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
