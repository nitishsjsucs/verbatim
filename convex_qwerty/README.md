# convex_qwerty

Convex backend for **govinda's qwerty mode**. Deploy this folder as the
Convex project pointed to by `QWERTY_CONVEX_URL`.

This is fully separate from anything in the actual qwerty (Lunar) repo.

## Setup

```bash
cd convex_qwerty
npm install convex
npx convex dev          # first run will prompt to create / link a deployment
```

Set the deployment URL into govinda's backend env:

```
QWERTY_CONVEX_URL=https://<your-deployment>.convex.cloud
QWERTY_CONVEX_DEPLOY_KEY=<deploy key from convex dashboard>
```

## Schema

- `qwertyFiles` — one row per ingested PDF
- `qwertyChunks` — one row per ~600-token chunk
- `qwertyConversations` — chat sessions
- `qwertyMessages` — chat messages with citation arrays

## HTTP Actions (called by Python backend)

All mounted under `${QWERTY_CONVEX_HTTP_PATH}` (default `/qwerty`):

- `POST /qwerty/files/insert`
- `POST /qwerty/files/status`
- `POST /qwerty/chunks/bulkInsert`
- `POST /qwerty/chunks/getByIds`
- `POST /qwerty/messages/append`

## Reactive queries (used by web frontend)

- `qwertyFiles.list`
- `qwertyConversations.list`
- `qwertyMessages.byConversation`
