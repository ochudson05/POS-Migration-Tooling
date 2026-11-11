#!/usr/bin/env bash
# One-time setup of the Menu Hauler server on any Ubuntu/Debian VM (x86 or Arm). From the repo folder:
#   bash server/setup.sh
# Safe to run again: it keeps .env, rebuilds and restarts the services, and refreshes the cron job.
# Nothing here depends on the cloud provider; see README.md for making the VM on Google Cloud.
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

# small VMs (2 GB) need swap for building the images and for Chromium on busy pages
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
swap_gb=${SWAP_GB:-$([ "$mem_mb" -lt 6000 ] && echo 4 || echo 2)}
echo "== Swap (${swap_gb} GB; this VM has ${mem_mb} MB of memory)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l "${swap_gb}G" /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
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
  [ -n "$tok" ] || { echo "No token given. Add TUNNEL_TOKEN to server/.env and run this again."; exit 1; }
  sed -i "s|^TUNNEL_TOKEN=.*|TUNNEL_TOKEN=$tok|" .env
fi
set -a; . ./.env; set +a

echo "== Building and starting (the first build takes 10-30 minutes on a small VM)"
sudo docker compose up -d --build --remove-orphans

if [[ ",${COMPOSE_PROFILES:-}," == *",local-model,"* ]]; then
  echo "== Local model: ${LOCAL_MODEL:-qwen3:4b} (a few GB, downloaded once)"
  sudo docker compose exec -T ollama ollama pull "${LOCAL_MODEL:-qwen3:4b}"
else
  echo "== Local model: off (COMPOSE_PROFILES=local-model in .env turns it on, on a VM with 8 GB or more)"
fi

echo "== Nightly backup at 03:30 UTC"
chmod +x backup.sh
mkdir -p "$HOME/menuhauler-backups"
( crontab -l 2>/dev/null | grep -v '/backup.sh' || true
  echo "30 3 * * * $here/backup.sh >> $HOME/menuhauler-backups/backup.log 2>&1" ) | crontab -
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "   (backups will fail until CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are in server/.env)"
fi

echo "== Check"
sleep 5
sudo docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
echo
echo "Done. In Cloudflare (Workers & Pages > menurunner > Settings > Variables and Secrets) set:"
echo "   SERVER_URL  (text)    https://<the tunnel's public hostname>"
echo "   SERVER_KEY  (secret)  $MH_KEY"
if [[ ",${COMPOSE_PROFILES:-}," == *",local-model,"* ]]; then
  echo "   LOCAL_MODEL_ON (text) 1"
fi
