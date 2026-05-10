"""JWT validation for Supabase Auth bearer tokens.

Supabase projects can sign tokens with HS256 (legacy, shared secret) or with
asymmetric keys (ES256/RS256, default for new projects). We support both by
fetching the project's JWKS endpoint — for asymmetric tokens we use the
matching public key; for HS256 we fall back to SUPABASE_JWT_SECRET.
"""
from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from config import settings

security = HTTPBearer()

# Cache JWKS in memory — Supabase rotates keys rarely; refresh on miss.
_jwks_cache: dict[str, Any] | None = None


def _fetch_jwks() -> dict[str, Any]:
    url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
    response = httpx.get(url, timeout=10.0)
    response.raise_for_status()
    return response.json()


def _get_jwks(*, force_refresh: bool = False) -> dict[str, Any]:
    global _jwks_cache
    if _jwks_cache is None or force_refresh:
        _jwks_cache = _fetch_jwks()
    return _jwks_cache


def _find_key(jwks: dict[str, Any], kid: str | None) -> dict[str, Any] | None:
    for k in jwks.get("keys", []):
        if k.get("kid") == kid:
            return k
    return None


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
) -> dict[str, Any]:
    """Decode and verify a Supabase Auth JWT.

    Returns the JWT payload. Useful claims:
      - sub: user UUID (Supabase auth.users.id)
      - email
      - role: 'authenticated' for normal users
      - exp: expiration timestamp
    """
    token = credentials.credentials

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token header: {e}",
        )

    alg = header.get("alg", "")
    kid = header.get("kid")

    try:
        if alg == "HS256":
            # Legacy symmetric signing — verify with shared secret.
            key: Any = settings.supabase_jwt_secret
        else:
            # Asymmetric signing — look up the matching public key from JWKS.
            jwks = _get_jwks()
            key = _find_key(jwks, kid)
            if key is None:
                # Possibly a newly-rotated key — refresh cache once and retry.
                jwks = _get_jwks(force_refresh=True)
                key = _find_key(jwks, kid)
            if key is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Unknown signing key kid={kid}",
                )

        payload = jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience="authenticated",
        )
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )
    return payload


def require_user_id(
    payload: Annotated[dict[str, Any], Depends(get_current_user)],
) -> UUID:
    """Resolve the JWT payload to the Supabase auth.users.id UUID.

    Every router that needs per-user data isolation should depend on this
    instead of get_current_user — it returns just the UUID, which is what
    every query actually filters by.
    """
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub claim",
        )
    try:
        return UUID(sub)
    except (TypeError, ValueError) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token sub is not a UUID: {e}",
        )
