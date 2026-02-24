# Deployment Guide

## Architecture
- **Frontend (Next.js)** → Vercel (free)
- **Backend (FastAPI)** → Your laptop (exposed via ngrok tunnel)
- **Database** → MongoDB Atlas (already migrated ✅)
- **Authentication** → Better Auth (runs inside Next.js on Vercel, stores in MongoDB Atlas)

Your laptop runs the backend 24/7. ngrok gives it a permanent public HTTPS URL that Vercel calls.
Better Auth runs as serverless functions inside Vercel — no extra server needed.

---

## Step 1: Set up ngrok (one-time)

1. Go to [ngrok.com](https://ngrok.com) and create a free account
2. Download ngrok: https://ngrok.com/download  
   Or with winget: `winget install ngrok`
3. Authenticate ngrok (one-time):
   ```
   ngrok config add-authtoken <your-token-from-ngrok-dashboard>
   ```
4. Claim your **free static domain** at:  
   https://dashboard.ngrok.com/cloud-edge/domains  
   Click **New Domain** → you get something like `fox-happy-cobra.ngrok-free.app`  
   **This URL never changes**, even after restarts.

---

## Step 2: Start the backend + tunnel

Run these two commands in separate terminals (from the project root):

**Terminal 1 — Backend:**
```powershell
$env:MONGO_URI="mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda"
$env:MONGO_DB_NAME="govinda_v2"
$env:OPENAI_API_KEY="sk-..."
$env:ALLOWED_ORIGINS="https://your-app.vercel.app,http://localhost:3000"
uvicorn app_backend.main:app --host 0.0.0.0 --port 8001
```

**Terminal 2 — ngrok tunnel (use your static domain):**
```
ngrok http --domain=fox-happy-cobra.ngrok-free.app 8001
```

Your backend is now publicly accessible at `https://fox-happy-cobra.ngrok-free.app`.

---

## Step 3: Deploy Frontend to Vercel (with Better Auth)

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New → Project**, import this repo
3. Set **Root Directory** to `web`
4. Framework will auto-detect as **Next.js**

### Set ALL Environment Variables in Vercel:

Go to **Settings → Environment Variables** and add every row below:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://fox-happy-cobra.ngrok-free.app` | Your ngrok static domain for the FastAPI backend |
| `BETTER_AUTH_SECRET` | *(run `openssl rand -base64 32` and paste result)* | **Min 32 chars.** This is the encryption key for sessions/tokens |
| `BETTER_AUTH_URL` | `https://your-app.vercel.app` | Your Vercel deployment URL (the full https URL) |
| `NEXT_PUBLIC_AUTH_URL` | `https://your-app.vercel.app` | Same as above — used by the client |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | Same as above — used for trusted origins |
| `MONGODB_URI` | `mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda` | Your existing Atlas connection string |
| `AUTH_DB_NAME` | `govinda_auth` | Separate database for auth data (auto-created) |

> **Important:** `BETTER_AUTH_URL` and `NEXT_PUBLIC_AUTH_URL` must be your **actual Vercel URL** (e.g. `https://govinda.vercel.app`), NOT localhost.

5. Click **Deploy** → Vercel gives you `https://govinda.vercel.app`

### After first deploy:
Better Auth will **automatically create** these collections in the `govinda_auth` database:
- `user` — user accounts
- `session` — active sessions
- `account` — auth provider links
- `verification` — email verification tokens

No manual MongoDB setup needed.

---

## Step 4: Update CORS

In Terminal 1, set `ALLOWED_ORIGINS` to include your Vercel URL:
```
ALLOWED_ORIGINS=https://govinda.vercel.app,http://localhost:3000
```
Restart the backend. Done.

---

## Step 5: Create the First User (Compliance Officer)

1. Go to `https://your-app.vercel.app/sign-in`
2. Click **Sign up** and create your account
3. This creates a `team_member` account by default
4. **Promote yourself to compliance_officer** — connect to your MongoDB Atlas and run:

```javascript
// In MongoDB Atlas → Browse Collections → govinda_auth → user
// Find your user document and update the role field:
db.user.updateOne(
  { email: "your-email@example.com" },
  { $set: { role: "compliance_officer" } }
)
```

Or use **MongoDB Compass** / **Atlas Data Explorer**:
- Navigate to `govinda_auth` → `user`
- Find your document
- Edit the `role` field from `"team_member"` to `"compliance_officer"`

5. Refresh the app — you now see the full compliance officer interface

---

## Step 6: Create Team Member Accounts

As a compliance officer, you can create team member accounts. They will:
- Only see the **Team Board** (Monday.com-style task table)
- Only see the **Reports** dashboard
- Be able to update task status and submit evidence files
- **NOT** see Documents, Research, History, Actionables, or Tracker

To assign a team member to a specific workstream, update their `team` field in MongoDB:
```javascript
db.user.updateOne(
  { email: "team-member@example.com" },
  { $set: { team: "Policy" } }  // Must match a workstream: Policy, Technology, Operations, etc.
)
```

---

## Roles Summary

| Role | Sees | Can Do |
|---|---|---|
| `compliance_officer` | Everything: Ingest, Documents, Research, History, Actionables, Tracker, Team Board, Reports | Full CRUD, approve/reject actionables, manage all teams |
| `team_member` | Team Board + Reports only | View assigned tasks, update status, submit evidence |

---

## Daily workflow (when you want the app live)

1. Open Terminal 1 → run the backend command above
2. Open Terminal 2 → run `ngrok http --domain=your-domain.ngrok-free.app 8001`
3. Frontend on Vercel is always live — no action needed
4. Auth is always live — runs inside Vercel serverless functions

---

## Local Development

```powershell
# Terminal 1 — Backend
$env:MONGO_URI="mongodb+srv://..."
$env:OPENAI_API_KEY="sk-..."
uvicorn app_backend.main:app --reload --port 8001

# Terminal 2 — Frontend
cd web
# Create .env.local with the variables from env.example
npm run dev
```

For local dev, set in `.env.local`:
```
BETTER_AUTH_SECRET=any-random-32-char-string-for-dev
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_URL=http://localhost:3000
MONGODB_URI=mongodb+srv://...your-atlas-uri...
AUTH_DB_NAME=govinda_auth
NEXT_PUBLIC_API_URL=http://localhost:8001
```

---

## Notes

- **PDFs** are stored in MongoDB Atlas GridFS — no local file storage needed.
- **ngrok free static domain** is permanent — the URL never changes between restarts.
- **Atlas M0** is free forever.
- **Vercel** free tier is more than enough for this app.
- **Better Auth** is self-hosted inside your Next.js app — no paid auth service needed.
- **Auth data** lives in a separate `govinda_auth` database in the same Atlas cluster — zero extra cost.
