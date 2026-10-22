#!/bin/bash
# =============================================================================
# VPS Deployment Script — Momentum Trading Platform
# =============================================================================
# Run this ON THE VPS after SSHing in as root.
#
# Usage:
#   ssh root@your-vps-ip
#   curl -sL https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/deploy.sh | bash
#
# OR clone the repo first, then:
#   chmod +x deploy.sh && ./deploy.sh
#
# Prerequisites: A fresh Ubuntu 22.04 / 24.04 VPS with root access.
# =============================================================================

set -e

# --- Config ---
APP_DIR="/home/deploy/momentum-app"
APP_USER="deploy"
NODE_VERSION="20"
DOMAIN=""  # Set this to your domain, or leave empty for IP-only access

echo "=========================================="
echo "  Momentum Trading Platform — VPS Deploy"
echo "=========================================="

# --- Step 1: Create deploy user ---
if ! id "$APP_USER" &>/dev/null; then
    echo "→ Creating user '$APP_USER'..."
    useradd -m -s /bin/bash "$APP_USER"
    usermod -aG sudo "$APP_USER"
    echo "$APP_USER ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/$APP_USER
fi

# --- Step 2: Install system packages ---
echo "→ Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
    curl git build-essential \
    nginx certbot python3-certbot-nginx \
    python3 python3-pip python3-venv \
    libssl-dev libffi-dev libcurl4-openssl-dev

# Detect architecture (ARM64 vs x86)
ARCH=$(uname -m)
echo "→ Detected architecture: $ARCH"
if [ "$ARCH" = "aarch64" ]; then
    echo "→ ARM64 detected — installing additional build tools for curl_cffi"
    apt-get install -y -qq gcc-aarch64-linux-gnu
fi

# --- Step 3: Install Node.js 20 ---
if ! command -v node &>/dev/null || [[ "$(node -v)" != v$NODE_VERSION* ]]; then
    echo "→ Installing Node.js $NODE_VERSION..."
    curl -fsSL https://deb.nodesource.com/setup_$NODE_VERSION.x | bash -
    apt-get install -y -qq nodejs
fi

# --- Step 4: Install PM2 ---
if ! command -v pm2 &>/dev/null; then
    echo "→ Installing PM2..."
    npm install -g pm2
fi

# --- Step 5: Setup app directory ---
echo "→ Setting up app directory..."
mkdir -p "$APP_DIR"
chown -R $APP_USER:$APP_USER "$APP_DIR"

# --- Step 6: Clone or pull repo ---
if [ -d "$APP_DIR/.git" ]; then
    echo "→ Pulling latest code..."
    cd "$APP_DIR"
    sudo -u $APP_USER git pull
else
    if [ -n "$1" ]; then
        REPO_URL="$1"
    else
        read -p "Enter your GitHub repo URL (e.g. https://github.com/user/repo.git): " REPO_URL
    fi
    echo "→ Cloning repo: $REPO_URL"
    sudo -u $APP_USER git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# --- Step 7: Install Python dependencies ---
echo "→ Installing Python dependencies..."
sudo -u $APP_USER python3 -m venv /home/$APP_USER/venv
sudo -u $APP_USER /home/$APP_USER/venv/bin/pip install --upgrade pip
sudo -u $APP_USER /home/$APP_USER/venv/bin/pip install -r requirements.txt

# Make yfinance available system-wide too (for Next.js exec() calls)
# On ARM64, curl_cffi might need compilation — fall back to yfinance without it if needed
pip3 install yfinance multitasking peewee protobuf pandas numpy || echo "yfinance install warning"
pip3 install curl_cffi || echo "curl_cffi not available — yfinance will use default fetcher (more rate-limited but works)"

# --- Step 8: Install Node dependencies + build ---
echo "→ Installing Node dependencies..."
sudo -u $APP_USER npm install

echo "→ Building Next.js app..."
sudo -u $APP_USER npm run build

# --- Step 9: Create .env.local ---
echo "→ Creating .env.local..."
read -p "Enter Kite API Key (or press Enter for default): " KITE_KEY
KITE_KEY=${KITE_KEY:-mrotfrt78mmjv00p}
read -p "Enter Kite API Secret (or press Enter for default): " KITE_SECRET
KITE_SECRET=${KITE_SECRET:-7rqlb307keo1wj5fgl5io3s1wbziyrsk}

if [ -n "$DOMAIN" ]; then
    REDIRECT_URI="https://$DOMAIN/zerodha-callback.html"
else
    read -p "Enter your domain or VPS IP for redirect URI: " DOMAIN_IP
    REDIRECT_URI="https://$DOMAIN_IP/zerodha-callback.html"
fi

cat > "$APP_DIR/.env.local" << EOF
KITE_API_KEY=$KITE_KEY
KITE_API_SECRET=$KITE_SECRET
KITE_REDIRECT_URI=$REDIRECT_URI
PYTHON_BACKEND_URL=http://127.0.0.1:5001
EOF
chown $APP_USER:$APP_USER "$APP_DIR/.env.local"

# --- Step 10: Start PM2 ---
echo "→ Starting PM2 processes..."
# Update ecosystem.config.js to use the venv Python
sudo -u $APP_USER pm2 delete all 2>/dev/null || true
sudo -u $APP_USER pm2 start ecosystem.config.js
sudo -u $APP_USER pm2 save

# --- Step 11: Setup PM2 startup ---
echo "→ Configuring PM2 startup on boot..."
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $APP_USER --hp /home/$APP_USER
sudo -u $APP_USER pm2 save

# --- Step 12: Configure nginx ---
echo "→ Configuring nginx..."
cat > /etc/nginx/sites-available/momentum-app << 'NGINX'
server {
    listen 80;
    server_name _;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
    }

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;
}
NGINX

ln -sf /etc/nginx/sites-available/momentum-app /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
systemctl enable nginx

# --- Step 13: SSL (if domain provided) ---
if [ -n "$DOMAIN" ]; then
    echo "→ Setting up SSL for $DOMAIN..."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@$DOMAIN --redirect || echo "SSL setup failed — run manually: certbot --nginx -d $DOMAIN"
fi

# --- Done ---
PUBLIC_IP=$(curl -s ifconfig.me)
echo ""
echo "=========================================="
echo "  ✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "  App URL:   http://$PUBLIC_IP"
if [ -n "$DOMAIN" ]; then
    echo "  Domain:    https://$DOMAIN"
fi
echo ""
echo "  PM2 status:   pm2 status"
echo "  PM2 logs:     pm2 logs"
echo "  Nginx config: /etc/nginx/sites-available/momentum-app"
echo "  App dir:      $APP_DIR"
echo ""
echo "  Next steps:"
echo "  1. Update Zerodha redirect URI to: https://$PUBLIC_IP/zerodha-callback.html"
echo "     (or https://$DOMAIN/zerodha-callback.html if you have a domain)"
echo "  2. Go to https://developers.kite.trade/apps → your app → Edit"
echo "  3. Set the redirect URL"
echo "  4. Open the app URL in your browser"
echo ""
echo "=========================================="
