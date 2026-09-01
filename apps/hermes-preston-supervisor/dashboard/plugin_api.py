"""Preston Supervisor - Hermes dashboard plugin API routes.

Mounted by the Hermes dashboard at /api/plugins/preston-supervisor/*
BEHIND the dashboard's own auth gate (unauthenticated requests are
rejected with 401 before these handlers run). Every route here is a
GET-only pass-through to the seven supported Preston Control reads in
preston_client.py. There are no write routes, no admin routes, and no
access to Hermes cron/MCP/gateway/config surfaces - Preston authority
never derives from Hermes admin capability.

Handlers are plain sync functions: FastAPI runs them in its
threadpool, so the stdlib HTTP client in preston_client never blocks
the event loop.
"""

import pathlib
import sys

# Drop-in plugin idiom: the dashboard imports this file by path, so
# the sibling module is resolved from this directory explicitly.
_HERE = str(pathlib.Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import preston_client  # noqa: E402

from fastapi import APIRouter  # noqa: E402

router = APIRouter()


@router.get("/link")
def link():
    """Secret-free link status for the UI banner."""
    return preston_client.link_state()


@router.get("/status")
def status():
    return preston_client.fetch_op("status")


@router.get("/goals/{goal_id}")
def goal(goal_id: str):
    return preston_client.fetch_op("goal", {"goal_id": goal_id})


@router.get("/jobs/{job_id}")
def job(job_id: str):
    return preston_client.fetch_op("job", {"job_id": job_id})


@router.get("/approvals")
def approvals():
    return preston_client.fetch_op("approvals")


@router.get("/events")
def events(cursor: str = "", limit: str = ""):
    return preston_client.fetch_op(
        "events", None, {"cursor": cursor, "limit": limit}
    )


@router.get("/evidence")
def evidence(goal_id: str = "", job_id: str = ""):
    return preston_client.fetch_op(
        "evidence", None, {"goal_id": goal_id, "job_id": job_id}
    )


@router.get("/artifacts/{artifact_id}")
def artifact(artifact_id: str):
    return preston_client.fetch_op("artifact", {"artifact_id": artifact_id})
