"""Mine Google Autocomplete for real queries in the online-clipboard space.

Trends' interest-over-time endpoint is rate limited from here, but Suggest is
not. Suggest returns live queries ordered by popularity, which is the same
signal Trends' "related queries" panel is built from — it just gives ordering
rather than an index number.

Scoring: a suggestion earns (10 - rank) each time it appears, so something that
surfaces near the top across several different seeds outranks something that
appears once at position 9. Appearing under many seeds is itself evidence the
phrase sits central to the topic.
"""
import concurrent.futures as cf
import json
import string
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")

SEEDS = [
    "online clipboard", "clipboard sync", "clipboard online", "shared clipboard",
    "share clipboard between", "copy paste between devices", "clipboard between devices",
    "sync clipboard", "clipboard sharing", "web clipboard", "cloud clipboard",
    "clipboard manager online", "send text to another device", "transfer text between devices",
    "share text between devices", "copy from phone to pc", "copy text from pc to phone",
    "clipboard android to pc", "universal clipboard", "clipboard sync windows android",
    "snapdrop alternative", "pairdrop", "localsend alternative", "airdrop for windows",
    "share clipboard without app", "clipboard no login", "realtime clipboard",
    "live clipboard", "clipboard paste online", "online notepad share",
]


def suggest(q, gl):
    url = ("https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl="
           + gl + "&q=" + urllib.parse.quote(q))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=12) as r:
            return json.loads(r.read().decode("utf-8", "replace"))[1]
    except Exception:
        return []


def main():
    gl = sys.argv[1] if len(sys.argv) > 1 else "us"
    # Alphabet expansion pulls the long tail out from under each seed.
    queries = list(SEEDS) + [f"{s} {c}" for s in SEEDS[:14] for c in string.ascii_lowercase]

    score = defaultdict(float)
    seen_under = defaultdict(set)
    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        futs = {ex.submit(suggest, q, gl): q for q in queries}
        for f in cf.as_completed(futs):
            seed = futs[f]
            for rank, s in enumerate(f.result()):
                s = s.strip().lower()
                score[s] += max(1, 10 - rank)
                seen_under[s].add(seed.rstrip(string.ascii_lowercase).strip())

    rows = sorted(score.items(), key=lambda kv: -kv[1])
    print(f"# geo={gl}  unique queries discovered: {len(rows)}\n")
    print(f"{'score':>6}  {'seeds':>5}  query")
    for q, sc in rows[:70]:
        print(f"{sc:>6.0f}  {len(seen_under[q]):>5}  {q}")


if __name__ == "__main__":
    main()
