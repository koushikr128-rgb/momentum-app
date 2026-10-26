# VPS Deployment Guide — Momentum Trading Platform

Deploy the app to a VPS for a permanent, never-resetting installation.

## What You Need

1. **A VPS** (Virtual Private Server)
   - **Recommended:** Hetzner Cloud CX22 — €4/month, 4GB RAM, 40GB SSD
   - **Alternative:** DigitalOcean Droplet — $6/month, 1GB RAM
   - **Alternative:** AWS Lightsail — $5/month, 1GB RAM

2. **A GitHub repo** with your code (push the project from the sandbox first)

3. **A domain name** (optional but recommended for SSL)
   - Buy from Namecheap (~$10/year) or use a free .tk domain
   - OR just use the VPS IP address directly

## Step-by-Step

### Step 1: Push Your Code to GitHub

In the sandbox terminal:

```bash
cd /home/z/my-project

# Initialize git if not already
git init
git add -A
git commit -m "Momentum trading platform - full deploy"

# Create a new repo on GitHub first (https://github.com/new), then:
git remote add origin https://github.com/YOUR_USERNAME/momentum-app.git
git branch -M main
git push -u origin main
```

### Step 2: Rent a VPS

**Hetzner Cloud (cheapest, recommended):**
1. Go to https://console.hetzner.cloud
2. Create project → Add server
3. Location: Falkenstein (Germany) or Mumbai (closest to NSE)
4. Image: Ubuntu 22.04
5. Type: CX22 (€4/month, 4GB RAM)
6. Add your SSH key
7. Create

You'll get a public IP like `49.12.x.x`

### Step 3: SSH Into the VPS

```bash
ssh root@YOUR_VPS_IP
```

### Step 4: Run the Deploy Script

```bash
# Clone your repo
git clone https://github.com/YOUR_USERNAME/momentum-app.git /home/deploy/momentum-app
cd /home/deploy/momentum-app

# Make deploy script executable
chmod +x deploy.sh

# Run it
./deploy.sh
```

The script will:
1. Install Node.js 20, Python 3, nginx, PM2
2. Install all npm + pip dependencies
3. Build the Next.js app
4. Create `.env.local` with your Kite credentials
5. Start PM2 (Next.js + Python backend)
6. Configure nginx as reverse proxy
7. Set up SSL (if you have a domain)

### Step 5: Update Zerodha Redirect URI

1. Go to https://developers.kite.trade/apps
2. Click your app → Edit
3. Set **Redirect URL** to:
   ```
   http://YOUR_VPS_IP/zerodha-callback.html
   ```
   Or if you have a domain:
   ```
   https://your-domain.com/zerodha-callback.html
   ```
4. Save

### Step 6: Open the App

Visit in your browser:
```
http://YOUR_VPS_IP
```
Or:
```
https://your-domain.com
```

Done! The app is now permanently running. No more sandbox resets.

---

## Optional: Set Up a Domain + SSL

If you want `https://momentum.yourdomain.com` instead of a raw IP:

1. **Buy a domain** (Namecheap, GoDaddy, etc.)

2. **Point DNS to your VPS:**
   - Add an A record: `momentum` → `YOUR_VPS_IP`

3. **Run certbot on the VPS:**
   ```bash
   ssh root@YOUR_VPS_IP
   certbot --nginx -d momentum.yourdomain.com
   ```

4. **Update Zerodha redirect URI** to `https://momentum.yourdomain.com/zerodha-callback.html`

---

## Managing the App

### SSH into VPS
```bash
ssh root@YOUR_VPS_IP
cd /home/deploy/momentum-app
```

### Check status
```bash
pm2 status
```

### View logs
```bash
pm2 logs                    # all logs
pm2 logs momentum-app       # Next.js only
pm2 logs python-backend     # Python only
```

### Restart the app
```bash
pm2 restart all
```

### Update code (after pushing to GitHub)
```bash
cd /home/deploy/momentum-app
git pull
npm run build
pm2 restart all
```

### Install new pip packages
```bash
pip3 install package_name
# Also install in venv:
/home/deploy/venv/bin/pip install package_name
pm2 restart python-backend
```

---

## Architecture

```
Browser → nginx (port 443/80) → Next.js (port 3000) → Python backend (port 5001)
                                                              ↓
                                                     yfinance → Yahoo Finance
                                                              ↓
                                                     Kite API (if connected)
```

- **nginx** — handles SSL, reverse proxy, static file caching
- **PM2** — keeps Next.js + Python running, auto-restarts on crash
- **Next.js** (port 3000) — the dashboard UI + API routes
- **Python** (port 5001) — yfinance data fetching (Flask + gunicorn)
- **yfinance** — bypasses Yahoo rate-limiting via curl_cffi

---

## Cost Breakdown

| Service | Cost |
|---------|------|
| Hetzner CX22 VPS | €4/month (~₹370) |
| Domain (optional) | ~$10/year (~₹830) |
| **Total** | **~₹370/month** |

Compare to:
- Zerodha Kite Connect Historical Data: ₹2000/month (you don't need this — yfinance is free)
- Vercel Pro: $20/month (but 10s timeout on free tier kills the bridge screen)

---

## Troubleshooting

### "502 Bad Gateway"
```bash
pm2 status                    # is momentum-app running?
pm2 restart momentum-app      # restart it
```

### "yfinance not found"
```bash
pip3 install yfinance curl_cffi
pm2 restart python-backend
```

### Screen times out
```bash
# Check nginx timeout
grep proxy_read_timeout /etc/nginx/sites-available/momentum-app
# Should be 120s
```

### Zerodha connection fails
```bash
cat /home/deploy/momentum-app/.env.local
# Verify KITE_API_KEY and KITE_API_SECRET are set
```

### Check Python backend
```bash
curl http://127.0.0.1:5001/health
# Should return: {"status":"ok","service":"yfinance-backend"}
```

---

## Why VPS Over Vercel?

| Feature | VPS | Vercel Free |
|---------|-----|-------------|
| Timeout | 120s+ | 10s (screen times out) |
| Python | ✅ Full | ❌ None |
| yfinance | ✅ Persistent | ❌ N/A |
| localStorage | ✅ Persistent | ✅ Yes |
| Cost | ₹370/mo | Free |
| SSL | ✅ certbot | ✅ Auto |
| Custom domain | ✅ | ✅ |

The 10-second timeout on Vercel free tier is a dealbreaker — the bridge screen takes 17-70 seconds. VPS has no such limit.
