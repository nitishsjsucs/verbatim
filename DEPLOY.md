# Deployment Guide

## Architecture
- **Frontend (Next.js)** → Vercel (free)
- **Backend (FastAPI)** → Your laptop (exposed via ngrok tunnel)
- **Database** → MongoDB Atlas (already migrated ✅)

Your laptop runs the backend 24/7. ngrok gives it a permanent public HTTPS URL that Vercel calls.

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

## Step 3: Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New → Project**, import this repo
3. Set **Root Directory** to `web`
4. Framework will auto-detect as **Next.js**

### Set this Environment Variable in Vercel:
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://fox-happy-cobra.ngrok-free.app` *(your ngrok static domain)* |

5. Click **Deploy** → Vercel gives you `https://govinda.vercel.app`

---

## Step 4: Update CORS

In Terminal 1, set `ALLOWED_ORIGINS` to include your Vercel URL:
```
ALLOWED_ORIGINS=https://govinda.vercel.app,http://localhost:3000
```
Restart the backend. Done.

---

## Daily workflow (when you want the app live)

1. Open Terminal 1 → run the backend command above
2. Open Terminal 2 → run `ngrok http --domain=your-domain.ngrok-free.app 8001`
3. Frontend on Vercel is always live — no action needed

---

## Local Development

```powershell
# Terminal 1 — Backend
$env:MONGO_URI="mongodb+srv://..."
$env:OPENAI_API_KEY="sk-..."
uvicorn app_backend.main:app --reload --port 8001

# Terminal 2 — Frontend
cd web
npm run dev
```

---

## Notes

- **PDFs** are stored in MongoDB Atlas GridFS — no local file storage needed.
- **ngrok free static domain** is permanent — the URL never changes between restarts.
- **Atlas M0** is free forever.
- **Vercel** free tier is more than enough for this app.
