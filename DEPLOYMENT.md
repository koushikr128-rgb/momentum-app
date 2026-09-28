# Deploying Nifty Momentum Tracker to Vercel

This Next.js app + Python serverless functions can be deployed to Vercel for free.

## Why Vercel?

- **Free tier:** 100GB bandwidth, 1000 invocations per day
- **Python support:** Native Python serverless functions (no external API needed)
- **Works outside sandbox:** Vercel's IP pool isn't blocked by Yahoo Finance like our sandbox IP is

## Files for Vercel deployment

The repo now contains:

```
├── api/                          # Vercel Python serverless functions
│   ├── screen.py                 # Momentum screen backend (yfinance)
│   └── stops.py                  # Stop-loss monitor backend
├── requirements.txt              # Python deps: yfinance, pandas, numpy
├── vercel.json                   # Config: routes api/*.py to Python runtime
├── src/                          # Next.js frontend (TypeScript)
│   ├── app/                      # Pages + Next.js API routes
│   └── lib/                      # Strategy + indicators (TS)
└── package.json                  # Node deps
```

## How the hybrid backend works on Vercel

When deployed on Vercel:

1. User opens dashboard → Next.js `/api/screen` route called
2. Route detects `VERCEL=1` env var → calls `/api/screen.py` (Python serverless function)
3. Python function uses yfinance (with curl_cffi) → fetches from Yahoo without rate limits
4. Returns JSON to the Next.js route → returned to the browser

In sandbox (without Vercel):

1. User opens dashboard → Next.js `/api/screen` route called
2. `VERCEL=1` not set → tries `tryLocalPython()` which exec's the Python script directly
3. If Python unavailable → tries pure TypeScript (Yahoo v8 chart)
4. If all fail → serves stale cache

## Deploy steps

### Option 1: GitHub + Vercel dashboard (recommended)

1. Push your project to a GitHub repo
2. Go to https://vercel.com/new
3. Import the GitHub repo
4. Vercel auto-detects Next.js + Python (from `vercel.json` + `requirements.txt`)
5. Click "Deploy" — done in ~2 minutes

### Option 2: Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy from project root
cd /home/z/my-project
vercel

# Follow prompts — accept all defaults
# Vercel will detect:
#   - Next.js (auto)
#   - Python functions (from vercel.json)
#   - Install requirements.txt automatically

# After first deploy, assign a permanent URL
vercel --prod
```

## Verify deployment

After deployment:

1. Open the Vercel URL (e.g. `https://your-app.vercel.app`)
2. The screen should auto-load with Top 10 momentum stocks
3. The `backend` field in the API response should say `"vercel-python"`

Test the Python function directly:
```bash
curl "https://your-app.vercel.app/api/screen.py?topN=10"
```

## Troubleshooting

**If Python function returns 500:**
- Check Vercel logs: `vercel logs <deployment-url>`
- Most common: yfinance rate-limited (wait 5 min, retry)
- Or: `requirements.txt` not picked up (Vercel should auto-detect from `vercel.json`)

**If TypeScript route returns 500:**
- The Python function failed → TS fallback also failed (Yahoo rate-limited)
- Check `backend` field — should say which backend was used
- Try again in 5 minutes

**Slow first load (30-60s):**
- Vercel cold start for Python functions
- Subsequent loads cached for 30 minutes → instant

## Cost

- **Vercel Hobby (free):** 100GB bandwidth, 1000 serverless invocations/day
- This app uses ~1 invocation per screen refresh → 1000 refreshes/day free
- Python runtime: 60s timeout on Hobby tier (we set 120s — works on Pro)
