"""Converter regression check: re-scores Menu Reader on the held-out venues and fails if anything got worse.

    python training/regress.py            # score the built launcher (apps.html) and compare with training/baseline.json
    python training/regress.py --update   # same, then save these scores as the new baseline
    python training/regress.py --page menu-converter.html

Run it after any change to menu-converter.html, menu-knowledge.js or the build, before pushing. It serves the repo on
127.0.0.1, opens training/eval.html in headless Edge or Chrome (no install needed), reads the scores, and compares
category, food/drink and printer accuracy with the baseline. A drop of more than TOLERANCE points fails (exit code 1).
Needs training/testset.json and knowledge-train.json (made by build_knowledge.py; local only, they hold venue data).
"""
import functools, http.server, json, os, re, shutil, socketserver, subprocess, sys, threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BASE = HERE / "baseline.json"
TOLERANCE = 0.5  # percentage points
METRICS = ("category", "food_or_drink", "printer")


def browser():
    cands = [os.environ.get("MH_BROWSER", ""),
             r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
             r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
             shutil.which("msedge") or "", shutil.which("google-chrome") or "", shutil.which("chromium") or ""]
    for c in cands:
        if c and Path(c).exists():
            return c
    sys.exit("No Edge or Chrome found. Set MH_BROWSER to the browser's .exe.")


def scores(page):
    for f in ("testset.json", "knowledge-train.json"):
        if not (HERE / f).exists():
            sys.exit("training/" + f + " is missing. Run training/build_knowledge.py first.")
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(REPO))
    with socketserver.TCPServer(("127.0.0.1", 0), handler) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = "http://127.0.0.1:%d/training/eval.html?page=%s" % (port, page)
        out = subprocess.run([browser(), "--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=120000", "--dump-dom", url],
                             capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300).stdout
        srv.shutdown()
    m = re.search(r"RESULT (\{.*?\})\s*</pre>", out, re.S)
    if not m:
        err = re.search(r"ERROR[^<]*", out)
        sys.exit("The scoring page didn't finish: " + (err.group(0)[:500] if err else out[-500:]))
    res = json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">"))
    learned = res.get("rules + learned", {})
    return {k: float(learned[k][2].rstrip("%")) for k in METRICS if k in learned}, res


def main():
    args = sys.argv[1:]
    page = args[args.index("--page") + 1] if "--page" in args else "apps.html"
    now, full = scores(page)
    base = json.loads(BASE.read_text(encoding="utf-8")) if BASE.exists() else {}
    worse = []
    print("%-15s %9s %9s %8s" % ("", "baseline", "now", "change"))
    for k in METRICS:
        b, n = base.get(k), now.get(k)
        if n is None:
            continue
        d = None if b is None else n - b
        print("%-15s %9s %8.1f%% %8s" % (k, "-" if b is None else "%.1f%%" % b, n, "" if d is None else "%+.1f" % d))
        if d is not None and d < -TOLERANCE:
            worse.append(k)
    if "--update" in args:
        BASE.write_text(json.dumps(now, indent=1) + "\n", encoding="utf-8")
        print("Saved as the new baseline (training/baseline.json).")
    if worse:
        print("\nREGRESSION: " + ", ".join(worse) + " dropped more than %.1f points. Top misses now:" % TOLERANCE)
        for line in full.get("rules + learned", {}).get("top_misses", [])[:6]:
            print("  " + line[:200])
        sys.exit(1)
    print("\nPASS" + ("" if base or "--update" in args else " (no baseline yet: run with --update to save one)"))


if __name__ == "__main__":
    main()
