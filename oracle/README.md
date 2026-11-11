# The Oracle server

One free Oracle Cloud VM that gives the website four extra things:

| What | Used by |
|---|---|
| **Menu scraper** (`menu-scraper/`): opens JavaScript sites and ordering platforms, follows menu links | The converter, when you enter a web address (before the usual reading and Firecrawl) |
| **OCR** (RapidOCR, PaddleOCR's models): reads text and its position from a photo | A second opinion on prices Claude reads from photos; the reader itself when Claude is off |
| **Small local model** (Ollama, `qwen3:4b` by default) | Small jobs, if you pick "Local model" on /admin |
| **Nightly database backups** | You, if something goes wrong |

Nothing on the server is open to the internet. Cloudflare Tunnel carries
`https://oracle.menuhauler.com` to a gateway that only answers requests with the key, and only the
website's Worker has the key. Pages never call the server directly: they go through `/api/oracle/*`,
which checks the person is signed in.

```
browser ──> menuhauler.com (Worker) ──key──> Cloudflare Tunnel ──> gateway ──> scraper + OCR
                                                                         └──> local model
```

The website works exactly as before without this server: each part switches on only when
`ORACLE_URL` and `ORACLE_KEY` are set on the Worker.

## Set it up

### 1. Make the VM (Oracle Cloud console)

Compute > Instances > **Create instance**:

- **Image:** Canonical Ubuntu 24.04 (pick the aarch64 / Arm build).
- **Shape:** Ampere > `VM.Standard.A1.Flex`, **2 OCPUs, 12 GB memory** (the whole Always Free allowance).
- **Networking:** the default new VCN and public subnet are fine. Don't add any ingress rules: the
  server only needs SSH in, and everything else goes out through the tunnel.
- **SSH keys:** generate a pair and download the private key (or paste your own public key).
- **Boot volume:** 100 GB (Always Free allows 200 GB in total).

"Out of capacity" is common for Arm VMs. Try another availability domain, or try again later.

**Idle reclaim:** on a free-only account, Oracle may reclaim a VM whose CPU stays mostly idle for a week.
This server *is* idle most of the time. Upgrading the account to Pay As You Go stops that, and the VM stays
free as long as it stays within the Always Free limits above. Add a budget alert at $1 if you do.

### 2. Get the code onto it

```bash
ssh -i <your-key> ubuntu@<the VM's public IP>
git clone https://github.com/ochudson05/POS-Migration-Tooling.git menuhauler
cd menuhauler
```

### 3. Make the tunnel (Cloudflare dashboard)

Zero Trust > Networks > **Tunnels** > Create a tunnel > **Cloudflared**:

1. Name it `menuhauler-oracle`.
2. On the install page, copy the long token after `--token` in any of the install commands. Don't run
   the install command itself: the server runs cloudflared in Docker.
3. **Public hostname:** subdomain `oracle`, domain `menuhauler.com`, service **HTTP** `gateway:8080`.

### 4. Run the setup

```bash
bash oracle/setup.sh
```

It installs Docker, adds swap, makes `oracle/.env` with a random gateway key, asks for the tunnel token,
builds and starts everything (10–20 minutes the first time), downloads the local model and adds the
nightly backup. At the end it prints the key.

### 5. Tell the website (Cloudflare dashboard)

Workers & Pages > **menurunner** > Settings > Variables and Secrets:

| Name | Type | Value |
|---|---|---|
| `ORACLE_URL` | Text | `https://oracle.menuhauler.com` |
| `ORACLE_KEY` | Secret | the key setup.sh printed (`MH_KEY` in `oracle/.env`) |

Then on **/admin**, "Model for small jobs" offers "Local model on the Oracle server".

### 6. Backups

1. Cloudflare dashboard > My Profile > API Tokens > Create token > Custom token:
   permission **Account > D1 > Edit**, for your account only.
2. Put it in `oracle/.env` as `CLOUDFLARE_API_TOKEN`, and the account ID as `CLOUDFLARE_ACCOUNT_ID`.
3. Optional, so backups also live off the server: Oracle console > Storage > Buckets > create a bucket >
   Pre-Authenticated Requests > create one for the **bucket**, "Permit object writes", with a long expiry.
   Put the URL (ending in `/o/`) in `oracle/.env` as `BACKUP_PAR_URL`.
4. Test it: `bash oracle/backup.sh`, then `ls ~/menuhauler-backups`.

## Check it

From the server:

```bash
cd ~/menuhauler/oracle
docker compose ps
curl -s -H "X-MH-Key: $(grep ^MH_KEY .env | cut -d= -f2)" https://oracle.menuhauler.com/health
```

`/health` shows whether the browser and OCR are on. Without the key the gateway answers 401.

## Update it

After changes are pushed to GitHub:

```bash
cd ~/menuhauler && git pull && cd oracle && sudo docker compose up -d --build
```

## Restore a backup

Backups are SQL files. Restore into a **new** database first, check it, then point the Worker at it
(`database_id` in `wrangler.toml`):

```bash
gunzip -k oolio-tools-2026-11-12.sql.gz
npx wrangler d1 create oolio-tools-restored
npx wrangler d1 execute oolio-tools-restored --remote --file oolio-tools-2026-11-12.sql
```

For mistakes in the last 7 days, Cloudflare's Time Travel is quicker:
`npx wrangler d1 time-travel restore oolio-tools --timestamp <when>`.

## What to expect

- **The local model is slow.** Two Arm cores answer at a few words a second, and a long list can take
  minutes to read. If it takes over two minutes or fails, Haiku answers instead (and is charged as usual),
  so nothing breaks. Haiku is the better default; the local model suits short jobs like review summaries.
  A smaller model (`qwen3:1.7b`) is faster but less accurate. To change it, set `LOCAL_MODEL` in `.env` and
  the Worker variable `LOCAL_MODEL`, then run setup.sh again.
- **OCR is a second opinion, not a replacement for Claude.** It reads letters, not layout. Prices it didn't
  see are worth a look, but it misses some (stylised fonts, prices printed apart from items).
- **Memory:** scraper and browser up to 5 GB, local model up to 6 GB, gateway and tunnel very little.
