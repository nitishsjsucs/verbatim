"""Chat API router — team chat + global chat system.

Extracted from main.py as part of Phase 4 — Backend Layered Architecture.
"""
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app_backend.constants import (
    Collection, ChatChannel, UserRole,
    PRIVILEGED_ROLES, TEAM_ROLES,
    INTERNAL_CHAT_ROLES, COMPLIANCE_CHAT_ROLES,
    CHAT_CHANNEL_PREFIX_INTERNAL, CHAT_CHANNEL_PREFIX_COMPLIANCE,
    CHAT_CHANNEL_COMPLIANCE_INTERNAL,
)
from app_backend.models.schemas import (
    TeamChatMessageRequest, GlobalChatPostRequest, RenameChatChannelRequest,
)

logger = logging.getLogger("backend")

router = APIRouter(tags=["chat"])

CHAT_COLLECTION = Collection.GLOBAL_CHATS


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _chat_channel_allowed(channel: str, role: str, team: str) -> bool:
    """Strict role-based permission check for a chat channel (hierarchy-aware)."""
    if channel == CHAT_CHANNEL_COMPLIANCE_INTERNAL:
        return role in PRIVILEGED_ROLES

    # Get the team referenced in the channel
    ch_team = ""
    if channel.startswith(CHAT_CHANNEL_PREFIX_INTERNAL):
        ch_team = channel.split(":", 1)[1]
    elif channel.startswith(CHAT_CHANNEL_PREFIX_COMPLIANCE):
        ch_team = channel.split(":", 1)[1]
    else:
        return False

    if role in PRIVILEGED_ROLES:
        return channel.startswith(CHAT_CHANNEL_PREFIX_COMPLIANCE)

    if role not in TEAM_ROLES:
        return False

    # Allow access if ch_team is the user's team or a descendant of it
    if ch_team == team:
        return True
    from utils.mongo import get_db
    db = get_db()
    col = db[Collection.TEAMS]
    descendants = [d["name"] for d in col.find({"path": team}, {"name": 1})]
    return ch_team in descendants


# ---------------------------------------------------------------------------
# Team Chat Endpoints
# ---------------------------------------------------------------------------

@router.get("/team-chat/{team}/{channel}")
def get_team_chat(team: str, channel: str):
    """
    Get messages for a team chat channel.
    channel: "internal" (team only) or "compliance" (team + CO).
    """
    if channel not in ("internal", "compliance"):
        raise HTTPException(status_code=400, detail="Channel must be 'internal' or 'compliance'")

    from utils.mongo import get_db
    db = get_db()
    doc = db[Collection.TEAM_CHATS].find_one({"team": team, "channel": channel})
    messages = doc.get("messages", []) if doc else []
    return {"team": team, "channel": channel, "messages": messages}


@router.post("/team-chat/{team}/{channel}")
def post_team_chat_message(team: str, channel: str, body: TeamChatMessageRequest):
    """
    Post a message to a team chat channel.
    internal: team_member, team_reviewer, team_lead can post.
    compliance: team_member, team_reviewer, team_lead, compliance_officer can post.
    """
    if channel not in (ChatChannel.INTERNAL, ChatChannel.COMPLIANCE):
        raise HTTPException(status_code=400, detail="Channel must be 'internal' or 'compliance'")

    allowed = COMPLIANCE_CHAT_ROLES if channel == ChatChannel.COMPLIANCE else INTERNAL_CHAT_ROLES

    if body.role not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{body.role}' cannot post to '{channel}' channel"
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": str(uuid.uuid4()),
        "author": body.author,
        "role": body.role,
        "text": body.text,
        "timestamp": now_iso,
    }

    from utils.mongo import get_db
    db = get_db()
    db[Collection.TEAM_CHATS].update_one(
        {"team": team, "channel": channel},
        {"$push": {"messages": msg}, "$setOnInsert": {"team": team, "channel": channel}},
        upsert=True,
    )
    return msg


# ---------------------------------------------------------------------------
# Standalone Global Chat System
# ---------------------------------------------------------------------------

@router.get("/chat/channels")
def list_chat_channels(role: str = Query(...), team: str = Query("")):
    """
    Return the list of channels visible to this role+team, along with
    per-channel unread counts (messages after a stored read cursor).
    """
    from utils.mongo import get_db
    db = get_db()

    channels: list[dict] = []

    if role in PRIVILEGED_ROLES:
        # 1. Compliance internal
        channels.append({
            "channel": CHAT_CHANNEL_COMPLIANCE_INTERNAL,
            "label": "Internal Compliance Chat",
            "type": "compliance_internal",
        })
        # 2. One entry per team for team↔compliance (dynamic from DB)
        all_teams = [t["name"] for t in db[Collection.TEAMS].find({"is_system": {"$ne": True}}, {"name": 1})]
        for t in all_teams:
            channels.append({
                "channel": f"team_compliance:{t}",
                "label": f"{t}",
                "type": "team_compliance",
            })
    else:
        # Team roles see their own channels + descendant team channels
        if team:
            # Own team channels
            channels.append({
                "channel": f"team_internal:{team}",
                "label": f"{team} Internal",
                "type": "team_internal",
            })
            channels.append({
                "channel": f"team_compliance:{team}",
                "label": f"{team} ↔ Compliance",
                "type": "team_compliance",
            })
            # Descendant team channels (hierarchy-aware)
            col = db[Collection.TEAMS]
            desc_names = [d["name"] for d in col.find({"path": team}, {"name": 1})]
            for dt in desc_names:
                channels.append({
                    "channel": f"team_internal:{dt}",
                    "label": f"{dt} Internal",
                    "type": "team_internal",
                })
                channels.append({
                    "channel": f"team_compliance:{dt}",
                    "label": f"{dt} ↔ Compliance",
                    "type": "team_compliance",
                })

    # Compute unread counts
    read_cursors = db[Collection.CHAT_READ_CURSORS].find_one(
        {"role": role, "team": team}
    ) or {}
    cursors = read_cursors.get("cursors", {})

    # Fetch custom channel names
    custom_names = {}
    name_docs = db[Collection.CHAT_CHANNEL_NAMES].find()
    for doc in name_docs:
        custom_names[doc["channel"]] = doc["custom_name"]

    for ch in channels:
        cid = ch["channel"]
        # Use custom name if available
        if cid in custom_names:
            ch["label"] = custom_names[cid]
            ch["has_custom_name"] = True
        else:
            ch["has_custom_name"] = False
        
        last_read = cursors.get(cid, "")
        doc = db[CHAT_COLLECTION].find_one({"channel": cid})
        msgs = doc.get("messages", []) if doc else []
        if last_read:
            unread = sum(1 for m in msgs if m.get("timestamp", "") > last_read)
        else:
            unread = len(msgs)
        ch["unread"] = unread

    return {"channels": channels}


@router.get("/chat/messages/{channel:path}")
def get_chat_messages(channel: str, role: str = Query(...), team: str = Query("")):
    """Return all messages for a given channel (with role check)."""
    if not _chat_channel_allowed(channel, role, team):
        raise HTTPException(status_code=403, detail="Access denied to this channel")

    from utils.mongo import get_db
    db = get_db()
    doc = db[CHAT_COLLECTION].find_one({"channel": channel})
    messages = doc.get("messages", []) if doc else []
    return {"channel": channel, "messages": messages}


@router.post("/chat/messages/{channel:path}")
def post_chat_message(channel: str, body: GlobalChatPostRequest):
    """Post a message to a chat channel (with role check)."""
    if not _chat_channel_allowed(channel, body.role, body.team):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{body.role}' (team '{body.team}') cannot post to '{channel}'"
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    msg = {
        "id": str(uuid.uuid4()),
        "author": body.author,
        "role": body.role,
        "team": body.team,
        "text": body.text,
        "timestamp": now_iso,
    }

    from utils.mongo import get_db
    db = get_db()
    db[CHAT_COLLECTION].update_one(
        {"channel": channel},
        {"$push": {"messages": msg}, "$setOnInsert": {"channel": channel}},
        upsert=True,
    )
    return msg


@router.post("/chat/mark-read/{channel:path}")
def mark_chat_read(channel: str, role: str = Query(...), team: str = Query("")):
    """Mark a channel as fully read for this user context."""
    if not _chat_channel_allowed(channel, role, team):
        raise HTTPException(status_code=403, detail="Access denied")

    now_iso = datetime.now(timezone.utc).isoformat()
    from utils.mongo import get_db
    db = get_db()
    db[Collection.CHAT_READ_CURSORS].update_one(
        {"role": role, "team": team},
        {"$set": {f"cursors.{channel.replace('.', '_')}": now_iso}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/chat/unread-total")
def get_chat_unread_total(role: str = Query(...), team: str = Query("")):
    """Return total unread count across all visible channels for badge display."""
    from utils.mongo import get_db
    db = get_db()

    visible_channels: list[str] = []
    if role in PRIVILEGED_ROLES:
        visible_channels.append(CHAT_CHANNEL_COMPLIANCE_INTERNAL)
        for t in [t["name"] for t in db[Collection.TEAMS].find({"is_system": {"$ne": True}}, {"name": 1})]:
            visible_channels.append(f"team_compliance:{t}")
    else:
        if team:
            visible_channels.append(f"team_internal:{team}")
            visible_channels.append(f"team_compliance:{team}")
            # Include descendant team channels (hierarchy-aware)
            col = db[Collection.TEAMS]
            desc_names = [d["name"] for d in col.find({"path": team}, {"name": 1})]
            for dt in desc_names:
                visible_channels.append(f"team_internal:{dt}")
                visible_channels.append(f"team_compliance:{dt}")

    read_cursors = db[Collection.CHAT_READ_CURSORS].find_one({"role": role, "team": team}) or {}
    cursors = read_cursors.get("cursors", {})

    total = 0
    for cid in visible_channels:
        last_read = cursors.get(cid, "")
        doc = db[CHAT_COLLECTION].find_one({"channel": cid})
        msgs = doc.get("messages", []) if doc else []
        if last_read:
            total += sum(1 for m in msgs if m.get("timestamp", "") > last_read)
        else:
            total += len(msgs)

    return {"unread": total}


@router.post("/chat/rename/{channel:path}")
def rename_chat_channel(channel: str, body: RenameChatChannelRequest, role: str = Query(...), team: str = Query("")):
    """Allow team_lead to rename their team's chat channels."""
    # Only team_lead can rename channels
    if role != UserRole.TEAM_LEAD:
        raise HTTPException(status_code=403, detail="Only Team Leads can rename channels")
    
    # Verify permission to rename this channel
    if not _chat_channel_allowed(channel, role, team):
        raise HTTPException(status_code=403, detail="Access denied to this channel")
    
    # Only allow renaming team_internal and team_compliance channels
    if not (channel.startswith("team_internal:") or channel.startswith("team_compliance:")):
        raise HTTPException(status_code=400, detail="Cannot rename this channel type")
    
    from utils.mongo import get_db
    db = get_db()
    
    # Store custom name in chat_channel_names collection
    db[Collection.CHAT_CHANNEL_NAMES].update_one(
        {"channel": channel},
        {"$set": {"custom_name": body.custom_name, "renamed_by": role, "team": team}},
        upsert=True,
    )
    
    return {"ok": True, "channel": channel, "custom_name": body.custom_name}
