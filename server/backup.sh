#!/usr/bin/env bash
# Nightly copy of the website's database (D1 "oolio-tools") as SQL, run by cron (setup.sh adds it, 03:30 UTC).
# Kept KEEP_DAYS days in ~/menuhauler-backups, and also copied off the server when one of these is set in .env:
#   BACKUP_GCS_BUCKET  gs://bucket/folder   Google Cloud Storage, using the VM's own service account (no key on disk)
#   BACKUP_PUT_URL     https://.../         any address that takes an HTTP PUT per file (an Oracle pre-authenticated
#                                           request, a WebDAV folder...); the file name is added to the end
# Cloudflare's own Time Travel covers the last 7 days on the free plan; this covers older mistakes, a deleted
# database and losing the Cloudflare account. To restore, see README.md.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN in server/.env}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID in server/.env}"

dir="${BACKUP_DIR:-$HOME/menuhauler-backups}"
mkdir -p "$dir"
f="oolio-tools-$(date -u +%Y-%m-%d).sql"

docker run --rm -e CLOUDFLARE_API_TOKEN -e CLOUDFLARE_ACCOUNT_ID -e WRANGLER_SEND_METRICS=false \
  -v "$dir":/out -w /tmp node:22.23.4-slim \
  npx -y wrangler@4.153.0 d1 export oolio-tools --remote --output "/out/$f"
gzip -f "$dir/$f"

copied=""
if [ -n "${BACKUP_GCS_BUCKET:-}" ]; then
  gcloud storage cp --quiet "$dir/$f.gz" "${BACKUP_GCS_BUCKET%/}/$f.gz" && copied=", copied to ${BACKUP_GCS_BUCKET}"
fi
if [ -n "${BACKUP_PUT_URL:-}" ]; then
  curl -fsS --retry 3 -T "$dir/$f.gz" "${BACKUP_PUT_URL%/}/$f.gz" && copied="$copied, uploaded"
fi
find "$dir" -name 'oolio-tools-*.sql.gz' -mtime +"${KEEP_DAYS:-30}" -delete
echo "$(date -u '+%F %T') backed up $f.gz ($(du -h "$dir/$f.gz" | cut -f1))$copied"
