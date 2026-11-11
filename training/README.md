# Menu Reader 2.0 training

The converter learns from the onboarding team's finished pre-work: every product and modifier row
in the `04. Oolio Platform Pre-Work` folder (about 220 venues with real data, 45k items, 18k modifier rows).

## Retrain (when new venues are added to the folder)

```
python training/harvest.py "<path>/04. Oolio Platform Pre-Work" training/corpus.json
python training/build_knowledge.py training/corpus.json
python build_apps.py
```

- `harvest.py` pulls every product and modifier row out of the .xlsx and .csv files (any of the
  pre-work, import or POS-export layouts). Template folders are skipped.
- `build_knowledge.py` drops the template's example rows, maps each venue's category to the
  converter's high-level categories, and keeps only what several venues agree on. It writes
  `menu-knowledge.js` (shipped with the converter), `training/report.md`, and two local files for
  scoring: `testset.json` and `knowledge-train.json` (not committed: they hold venue data).
- `build_apps.py` bundles `menu-knowledge.js` into the launcher and the website.

## Score it

Serve the repo folder (launch config `tools-static`) and open `/training/eval.html`
(add `?page=apps.html` to test the built launcher). It compares the converter's word rules
alone with rules + knowledge learned from 80% of venues, on the other 20%:

| on held-out venues, from the item name only | rules only | rules + learned |
|---|---|---|
| Category (Wine, Pizza, Hot Coffee…) | 53.7% | 61.9% |
| Food or Beverage | 86.4% | 90.2% |
| Printer (coffee / bar / kitchen) | 77.5% | 81.3% |

(The wine and cocktail word lists were widened at the same time, which also lifted "rules only"
to 57.0%.) Most remaining misses can't be known from a name: winery names, house cocktail
names, and venues filing iced lattes under "Coffee".

`/training/smoke.html` checks that Word files are read and that Claude's add-ons come back as a
modifier table (with a stand-in Claude; put sample .docx menus in `training/_test-docs/` as a/b/c.docx).

## What the converter does with it

- `knowItem()` in menu-converter.html: an item name venues agree on sets its category, Food or
  Beverage and printer; an unseen name falls back to its last word, then any telling word
  (`knowToken`, e.g. "Barbera"), then the existing rules.
- Claude now also returns add-ons and choices (`options`) as a modifier table, turns flavours of one
  item into a modifier group (sizes stay variants), and reads text PDFs and Word documents too.
- Option presets (step 5) use the options and prices venues actually use: alternative milks $1,
  Bread Choice, Breakfast Extras and Milkshake Flavour are new.
