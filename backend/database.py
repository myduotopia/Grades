"""SQLAlchemy engine + session factory."""
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,  # detect dead connections before reusing
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a Session, ensures it closes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
