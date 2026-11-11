#!/usr/bin/env bash
# One-time setup of the Menu Hauler Oracle server (Ubuntu 24.04 on an Ampere A1 VM). From the repo folder:
#   bash oracle/setup.sh
# Safe to run again: it keeps .env, rebuilds and restarts the services, and refreshes the cron job.
set -euo pipefail
cd "$(dirname "$0")"
here=$(pwd)

echo "== Docker"
if ! command -v docker >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
fi

echo "== Swap (building the images needs more than 12 GB at times)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "== Settings (.env)"
[ -f .env ] || cp .env.example .env
chmod 600 .env
if ! grep -q '^MH_KEY=.\+' .env; then
  sed -i "s/^MH_KEY=.*/MH_KEY=$(openssl rand -hex 32)/" .env
fi
if ! grep -q '^TUNNEL_TOKEN=.\+' .env; then
  read -rp "Paste the Cloudflare tunnel token (see README step 3): " tok
  [ -n "$tok" ] || { echo "No token given. Add TUNNEL_TOKEN to oracle/.env and run this again."; exit 1; }
  sed -i "s|^TUNNEL_TOKEN=.*|TUNNEL_TOKEN=$tok|" .env
fi
set -a; . ./.env; set +a

echo "== Building and starting (the first build takes 10-20 minutes)"
sudo docker compose up -d --build

echo "== Local model: ${LOCAL_MODEL:-qwen3:4b} (a few GB, downloaded once)"
sudo docker compose exec -T ollama ollama pull "${LOCAL_MODEL:-qwen3:4b}"

echo "== Nightly backup at 03:30 UTC"
chmod +x backup.sh
mkdir -p "$HOME/menuhauler-backups"
( crontab -l 2>/dev/null | grep -v 'oracle/backup.sh' || true
  echo "30 3 * * * $here/backup.sh >> $HOME/menuhauler-backups/backup.log 2>&1" ) | crontab -
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "   (backups will fail until CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are in oracle/.env)"
fi

echo "== Check"
sleep 5
sudo docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
echo
echo "Done. In Cloudflare (Workers & Pages > menurunner > Settings > Variables and Secrets) set:"
echo "   ORACLE_URL  (text)    https://<the tunnel's public hostname>"
echo "   ORACLE_KEY  (secret)  $MH_KEY"
