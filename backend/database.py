"""SQLAlchemy engine + session factory."""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from config import settings

# Serverless (Vercel) note: each invocation may run in a fresh container, so a
# process-local SQLAlchemy pool can't be reused across requests. Hand pooling
# to Supabase and keep no local pool.
#
# This REQUIRES DATABASE_URL to point at the transaction pooler on port 6543.
# NullPool opens a brand-new connection per request; against the session pooler
# (port 5432) that means a full TCP+TLS+SCRAM handshake every single time, which
# is what made every endpoint slow (#247). Transaction mode keeps warm upstream
# connections and hands one out cheaply.
#
# alembic must NOT use this URL — DDL needs session-scoped state, so migrations
# stay on the session pooler via settings.alembic_database_url.
#
# psycopg2 doesn't use server-side prepared statements by default, so it's safe
# in transaction mode. A future switch to asyncpg would need statement_cache_size=0.
engine = create_engine(settings.database_url, poolclass=NullPool)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a Session, ensures it closes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
