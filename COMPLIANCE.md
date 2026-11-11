# Website legal and compliance: status

How Menu Hauler (the website at menurunner.ochudson05.workers.dev and the claude.ai copy) covers each item on the
*Website Legal and Compliance Checklist* (11 Nov 2026). The public pages are in `legal.html`. The business details are in
`BUSINESS` in `build_apps.py`. Run `python build_apps.py` after changing either.

What the site is matters here: an internal tool for approved staff, behind Cloudflare Access sign-in. It's free, so there
are no sales, payments, subscriptions, deliveries, marketing, public user content or social features. Many items below are
"not applicable" for that reason. **If any of that changes, look at those items again.**

A lawyer should review the final set before you rely on it. The checklist says the same: it wasn't checked against recent changes in the law.

## Still to do (owner)

1. **Contact details.** Email and phone are set (11 Nov 2026). No postal address is published. Add one to `address` in
   `BUSINESS` if you get a business or PO box address.
2. **ABN Lookup has no record of ABN 60 219 896 086 yet** (checked 11 Nov 2026). The number is valid (it passes the checksum), so it may not be active yet.
   The owner confirmed the name "Oscar Hudson" on 11 Nov 2026. Once ABN Lookup shows the record, check that `operator` matches it exactly. Add `trading_name` if you use a registered business name, and `acn` if it's a company.
3. **Governing law state.** Queensland (confirmed 11 Nov 2026).
4. **Make the policies readable without signing in.** In Cloudflare Zero Trust → Access → Applications → menurunner,
   add a policy with action **Bypass**, include **Everyone**, for the paths `/legal/*` and `/.well-known/*`.
   Also add a link to `/legal/#privacy` in the Access login page's custom text. That is the collection notice at the sign-in form.
5. **GST.** Register when GST turnover reaches $75,000. If you register, add "GST registered" next to the ABN in the footer.
6. **Trade mark.** The site was renamed "Menu Hauler" on 11 Nov 2026. Search ATMOSS (IP Australia) for "Menu Hauler" before
   using it widely. The tools still mention "Oolio" and "Oolio One" only to describe the products they work with.
7. **Yearly review** (each November): delete venues no longer being set up (the Privacy Policy promises this),
   check this file, update `updated` in `BUSINESS`, and renew `Expires` in security.txt (it's written by `build_apps.py`).

## Checklist

| Item | Status | Where |
|---|---|---|
| **Legal pages** | | |
| Privacy Policy (APP 1 and 5) | Done | `#privacy`, `/legal/#privacy` |
| Collection notice at every form | Done for the venue form, Restaurant Lookup and file upload. The sign-in form needs owner step 4 | `venue-link.js`, `restaurant-lookup.html`, `menu-converter.html` |
| Terms of Use | Done | `#terms` |
| Acceptable Use Policy (accounts exist) | Done | `#use` |
| Cookie notice / consent banner | Done. Only a strictly necessary sign-in cookie and local storage, so no banner is needed | `#cookies` |
| Industry disclaimer | Done (not tax, legal or financial advice; check every result) | `#disclaimer` |
| Refund/Returns (ACL wording) | Done within the Terms (free service; ACL guarantees not excluded) | `#terms` §5 |
| Shipping/Delivery | Not applicable: nothing is shipped | |
| Contact details | Done: name, ABN, email and phone. No postal address | `#contact` |
| **Business disclosures** | | |
| Business name, ABN, ACN | Name and ABN in the footer of every page and on Contact. No ACN (not a company) | footer |
| Trading name disclosed | Field ready (`trading_name`) | |
| GST / tax invoices | Not registered yet; no sales, so no invoices. See owner step 5 | |
| Modern Slavery Statement | Not applicable (under $100m revenue) | |
| Industry licences | None needed | |
| **Australian Consumer Law** | | |
| No misleading claims | Reviewed: the tool descriptions say what they do; "free" claims are accurate on the website (Firecrawl is the team's capped account) | |
| All-in pricing / drip pricing | Not applicable: no prices | |
| Subscriptions | Not applicable | |
| Sponsorship / affiliate disclosure | Disclaimer states there are none | `#disclaimer` |
| Claim substantiation | Not applicable: no product claims | |
| Unfair contract terms | Terms avoid penalties. Changes are notified, and users can stop at any time | `#terms` §9 |
| **Privacy and data** | | |
| Consent/notice at collection; marketing opt-in | Notices added; no marketing | |
| Data breach response plan (NDB) | Done | below |
| HTTPS, hashed passwords, access control, encryption at rest | HTTPS (workers.dev); no passwords (one-time codes); every /api call checks the Access JWT; D1 is encrypted at rest by Cloudflare | `relay-worker.js` |
| Overseas disclosure list | Done (table of every service and its country) | `#privacy` |
| Retention and deletion schedule | Done | `#privacy`, below |
| Access and correction (response time) | 30 days | `#privacy` |
| Children | Not for under 18s; stated | `#privacy`, `#terms` |
| Online Safety Act | Not applicable: no public user content or social features | |
| **Marketing** | Not applicable: no marketing emails, SMS, calls or pixels. The Privacy Policy states Spam Act terms if this changes | |
| **Intellectual property** | | |
| Copyright notice | Footer and Terms §4 | |
| Licence records for assets | `THIRD_PARTY_NOTICES.md`; each photo folder has its own credits list | |
| Open-source attribution | `THIRD_PARTY_NOTICES.md`, `#credits` | |
| Trade mark clearance | Owner step 6 | |
| Notice and takedown | Done, with response times and an appeal route | `#use` |
| **Accessibility** | | |
| WCAG 2.2 AA target, statement, feedback, timeline | Statement done (5 business days to reply, 30 days to fix). A full screen-reader audit hasn't been done yet | `#accessibility` |
| Alt text, contrast, labels, focus | Existing pages have labels and focus outlines. The new pages use theme colours and visible focus | |
| **Payments** | Not applicable: no payments | |
| **User content and reviews** | | |
| Review policy | Google reviews shown as Google's, unedited and unpaid | `#use` |
| Moderation, reporting, removal, appeal, defamation | Content complaints process | `#use` |
| **Technical and operational** | | |
| Contact form/email with response time | 2 business days | `#contact` |
| Uptime / SLA | No commitment; stated | `#terms` §6 |
| security.txt / vulnerability disclosure | Done | `public/.well-known/security.txt`, `#security` |
| Backups and incident response | D1 point-in-time history and the Setup Tracker backup; plan below | |
| Third-party services listed | Done | `#privacy` |
| AI disclosure | Done | `#ai`, notice at file upload |
| **EU/UK, US extras** | Rights and lawful basis in the Privacy Policy; no selling or sharing (CCPA). The tools aren't offered to EU/UK/US consumers, so DSA trader disclosures, withdrawal rights, COPPA and auto-renewal laws don't apply | `#privacy` |

## Data breach response plan (Notifiable Data Breaches scheme)

1. **Contain** (same day): in Cloudflare, revoke Access sessions (Zero Trust → Users → Revoke), rotate the affected secrets
   (`FIRECRAWL_KEY`, `GOOGLE_KEY`, `RELAY_TOKEN`, `ABR_GUID`), and remove any account that shouldn't have access.
2. **Assess** (within 30 days, sooner if possible): what was exposed, whose information it was, and whether serious harm is likely.
   D1 Time Travel can show what changed and when: `wrangler d1 time-travel info oolio-tools`.
3. **Notify**: if serious harm is likely, tell the affected people and the OAIC (https://www.oaic.gov.au/privacy/notifiable-data-breaches/report-a-data-breach) as soon as practicable.
   If the operator is exempt from the Privacy Act as a small business, still notify the affected people.
4. **Review**: write down what happened and what changed, and keep that record with this file.

## Retention schedule

| Data | Kept | How it's removed |
|---|---|---|
| Venue records (D1 `docs`) | Until deleted; reviewed yearly | Delete the venue in the tools, or run D1 SQL |
| Firecrawl usage counts (D1 `usage`) | 24 months | `DELETE FROM usage WHERE month < '<yyyy-mm>'` |
| Access sign-in logs | Cloudflare plan default | Automatic |
| Browser caches | 7 to 14 days | Automatic, or clear the site's data |
