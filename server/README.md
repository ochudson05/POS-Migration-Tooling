# The Menu Hauler server

One small Linux VM that gives the website these extras:

| What | Used by |
|---|---|
| **Menu scraper** (`menu-scraper/`): opens JavaScript sites and ordering platforms, follows menu links | The converter, when you enter a web address (before the usual reading and Firecrawl) |
| **OCR** (RapidOCR, PaddleOCR's models): reads text and its position from a photo | A second opinion on prices Claude reads from photos; the reader itself when Claude is off |
| **Nightly database backups** | You, if something goes wrong |
| **Small local model** (Ollama), *optional, off for now* | Small jobs, if you turn it on and pick "Local model" on /admin. Needs a VM with 8 GB or more |

It runs on **Google Cloud** for now (an `e2-small`, paid from the trial credits). Nothing in this folder is
tied to Google. It's Docker Compose plus a Cloudflare Tunnel, so the same files run on any provider (see
[Moving to another provider](#moving-to-another-provider)). The server keeps no data of its own. The
database lives in Cloudflare D1, so a server can be thrown away and rebuilt in about half an hour.

Nothing on the server is open to the internet. Cloudflare Tunnel carries `https://server.menuhauler.com`
to a gateway that only answers requests with the key, and only the website's Worker has the key. Pages never
call the server directly. They go through `/api/server/*`, which checks the person is signed in.

```
browser ──> menuhauler.com (Worker) ──key──> Cloudflare Tunnel ──> gateway ──> scraper + OCR
                                                                         └──> local model (optional)
```

The website works exactly as before without this server. Each part switches on only when `SERVER_URL` and
`SERVER_KEY` are set on the Worker.

## Set it up (Google Cloud)

### 1. Make the VM (console.cloud.google.com)

1. Pick (or make) a project, and turn on **Compute Engine API** when asked.
2. **Billing > Budgets & alerts > Create budget**: US$40 a month, alerts at 50%, 90% and 100%. The trial
   credits hide the cost, so this is how you'll notice if something is bigger than it should be.
3. **Compute Engine > VM instances > Create instance**:
   - **Name:** `menuhauler`
   - **Region:** `australia-southeast1` (Sydney). Iowa (`us-central1`) is about 20% cheaper but further away.
   - **Machine:** E2 > `e2-small` (2 vCPU shared, 2 GB). Roughly US$15–18 a month in Sydney.
   - **Boot disk:** Change > Ubuntu > **Ubuntu 24.04 LTS (x86/64)**, Balanced persistent disk, **30 GB**.
   - **Firewall:** leave HTTP and HTTPS **unticked**. The server needs no open ports. Everything goes out
     through the tunnel, and you reach it with the console's SSH button.
   - **Security > Access scopes:** "Set access for each API", then **Storage: Read Write** (only needed
     for backups to Cloud Storage, step 6).
4. Create, wait a minute, then press **SSH** next to the VM. A terminal opens in the browser.
5. Check the VM can reach the internet: `curl -s -m 10 -o /dev/null -w "%{http_code}\n" https://github.com`
   should print `200`. If it times out and prints `000`, the VM has no external IP. Some organisations
   block external IPs with the policy "External IPs for VM instances". In that case, give the VM outbound
   internet through Cloud NAT instead. It only allows connections out, so nothing is opened to the
   internet. In **Cloud Shell** (the `>_` icon at the top of the console), run:

   ```bash
   gcloud compute routers create menuhauler-router --network default --region australia-southeast1
   gcloud compute routers nats create menuhauler-nat --router menuhauler-router --region australia-southeast1 \
     --auto-allocate-nat-external-ips --nat-all-subnet-ip-ranges
   ```

   Run the curl check again after a minute. Cloud NAT costs about US$1 a month plus a few cents per GB.

### 2. Get the code onto it

```bash
git clone https://github.com/ochudson05/POS-Migration-Tooling.git menuhauler
cd menuhauler
```

### 3. Make the tunnel (Cloudflare dashboard)

Zero Trust > Networks > **Tunnels** > Create a tunnel > **Cloudflared**:

1. Name it `menuhauler-server`.
2. On the install page, copy the long token after `--token` in any of the install commands. Don't run the
   install command itself, because the server runs cloudflared in Docker.
3. Run setup (step 4). The tunnel's page then shows it as **Healthy**. The page's Continue button stays
   greyed out until then.
4. Add the route on the tunnel's page: **Routes > Add route > Published application**. Older dashboards
   call this the **Public Hostname** tab. Set subdomain `server`, domain `menuhauler.com`, no path, service
   `http://gateway:8080`. Check the **Routes** count changes from 0 to 1. A tunnel with no route is Healthy,
   but nothing can reach it.

Cloudflare adds a `server` record of type **Tunnel** under menuhauler.com > DNS. It can take a few minutes to
show up everywhere, and some networks remember the earlier "doesn't exist" answer for a while. To check from
anywhere: `https://cloudflare-dns.com/dns-query?name=server.menuhauler.com&type=A` with the header
`accept: application/dns-json`. Don't add the record by hand. Cloudflare refuses it because the route already
made one.

### 4. Run the setup

```bash
bash server/setup.sh
```

The script:
- installs Docker
- adds swap (4 GB on a small VM)
- makes `server/.env` with a random gateway key
- asks for the tunnel token
- builds and starts everything (20–30 minutes the first time on an `e2-small`)
- adds the nightly backup

At the end it prints the key.

### 5. Tell the website (Cloudflare dashboard)

Workers & Pages > **menurunner** > Settings > Variables and Secrets:

| Name | Type | Value |
|---|---|---|
| `SERVER_URL` | Text | `https://server.menuhauler.com` |
| `SERVER_KEY` | Secret | the key setup.sh printed (`MH_KEY` in `server/.env`) |

### 6. Backups

1. Cloudflare dashboard > My Profile > API Tokens > Create token > Custom token: permission
   **Account > D1 > Edit**, for your account only.
2. Put it in `server/.env` as `CLOUDFLARE_API_TOKEN`, and the account ID as `CLOUDFLARE_ACCOUNT_ID`.
3. Optional, so backups also live off the server: Google Cloud console > **Cloud Storage > Buckets > Create**.
   Use the same region and Standard class, and leave public access prevented. Put `gs://<bucket name>/d1` in
   `server/.env` as `BACKUP_GCS_BUCKET`. The VM writes with its own service account (the access scope from
   step 1), so no key sits on disk. A few MB a month costs cents.
4. Test it: `bash server/backup.sh`, then `ls ~/menuhauler-backups`.

## Gemini for small jobs (optional)

The website can send its small jobs to Google's Gemini instead of Claude Haiku. Small jobs are review
summaries, staff lists and the converter's check. Gemini is priced and limited exactly like Claude on /admin,
and Haiku answers if Gemini fails.

1. Make a key at **aistudio.google.com > Get API key**, in the **same Google Cloud project** that has billing.
   Billing on means the paid tier, where Google doesn't use what's sent to improve its products. **Don't use a
   free-tier key**: on the free tier Google may use prompts for training, and staff lists are personal
   information.
2. Cloudflare > menurunner > Variables and Secrets: `GEMINI_KEY` (Secret). Optionally set `GEMINI_MODEL`
   (Text). It defaults to `gemini-2.5-flash-lite`, which costs about the same as Haiku (US$0.10 in / $0.40 out
   per million tokens). The website knows the prices of `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite` and
   `gemini-3.5-flash-lite`. Any other model is counted at the dearest rate, so the limits still hold.
3. On **/admin**, set "Model for small jobs" to Gemini.

Whether Gemini API usage comes out of the Google Cloud trial credits depends on Google's current terms.
Check **Billing > Reports** after a day of use.

## Check it

From the server:

```bash
cd ~/menuhauler/server
sudo docker compose ps
curl -s -H "X-MH-Key: $(grep ^MH_KEY .env | cut -d= -f2)" https://server.menuhauler.com/health
```

`/health` shows whether the browser and OCR are on. Without the key the gateway answers 401. A healthy
reply looks like `{"ok":true,"browser":true,"claude":false,...,"ocr":true}`. `claude` and `firecrawl` are
false on purpose. The website calls Claude itself, and Firecrawl is the scraper's optional last resort.

Then on the website: open the converter and enter a menu's web address. The card should say *"read from the
web page (… Menu Hauler server)"*. If it says only *"read from the web page"*, the website didn't use the
server. Check, in this order:

| Symptom | Fix |
|---|---|
| `curl` above says `Could not resolve host` | The route is missing or still spreading (step 3) |
| Cloudflare error 1033 or 530 | The tunnel isn't connected: `sudo docker compose logs --tail 30 tunnel` |
| `/health` works on the server, but the converter doesn't use it | `SERVER_URL` or `SERVER_KEY` on menurunner is missing or doesn't match `MH_KEY` in `.env`. Reload the page after fixing it |

To make a new key (for example, if the old one was shown somewhere), run the command below. Then put the
new `MH_KEY` in the Worker secret `SERVER_KEY`:

```bash
sed -i "s/^MH_KEY=.*/MH_KEY=$(openssl rand -hex 32)/" .env && sudo docker compose up -d --force-recreate gateway
```

## Update it

After changes are pushed to GitHub:

```bash
cd ~/menuhauler && git pull && cd server && sudo docker compose up -d --build --remove-orphans
```

## Bigger machine later

1. In the console: stop the VM, then Edit > Machine type, then start it again.
   - `e2-medium` (4 GB) gives the browser more room. Set `SCRAPER_MEM=3g` in `.env`.
   - `t2a-standard-2` (Arm, 8 GB) or `e2-standard-2` (8 GB) also fit the local model.
2. To turn on the local model, set `COMPOSE_PROFILES=local-model` in `.env`, run `bash server/setup.sh`
   again (it downloads the model), then set the Worker variable `LOCAL_MODEL_ON` to `1`. "Local model" then
   shows up on /admin.

Changing to an Arm machine type means a new VM, because the boot disk is x86. Follow
[Moving to another provider](#moving-to-another-provider). It's the same steps.

## Moving to another provider

Everything the server needs is in this folder and in `server/.env`. To move it:

1. Make any Ubuntu 24.04 VM, x86 or Arm (Google, Oracle, AWS Lightsail, Hetzner, DigitalOcean...). Give it
   at least 2 GB, no open ports, and SSH only.
2. Copy `server/.env` from the old server. It holds the gateway key, the tunnel token and the backup
   settings.
3. On the new VM: steps 2 and 4 above. setup.sh keeps the copied `.env`.
4. The tunnel follows the token, so `server.menuhauler.com` points at the new VM as soon as it starts. Nothing
   changes in Cloudflare or on the website.
5. Check `/health`, then delete the old VM. If you used Cloud Storage for backups, change
   `BACKUP_GCS_BUCKET` to `BACKUP_PUT_URL` (or leave the old bucket in place). The local backups in
   `~/menuhauler-backups` are worth copying across too.

**When the Google trial ends** (90 days, or when the US$500 is used up), Google stops the VM unless the
account is upgraded to a paid one, and deletes it about 30 days later. The website keeps working without
the server (each part switches off cleanly). Either upgrade (an `e2-small` is about US$15–18 a month) or
move it using the steps above before then.

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

- **The e2-small is tight but enough.** OCR and the scraper's plain reads are quick. Pages that need the
  browser (JavaScript sites) take longer, and two at once may swap. If scrapes start failing or timing out,
  move up to `e2-medium`.
- **OCR is a second opinion, not a replacement for Claude.** It reads letters, not layout. Prices it didn't
  see are worth a look, but it misses some, such as stylised fonts and prices printed apart from items.
- **The local model, if you turn it on, is slow.** Two CPU cores answer at a few words a second. If it takes
  over two minutes or fails, Haiku answers instead (and is charged as usual).
