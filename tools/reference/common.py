"""Shared helpers for the reference-data builders in tools/reference/.

- load_legacy(): reads the generated legacy modules (data/legacy/*.ts) through
  Node's type stripping, so Python sees exactly what the game sees.
- WikiClient: a polite, cached, serial client for the official Wikipedia API
  (https://en.wikipedia.org/w/api.php). Every response is cached on disk in
  tools/reference/cache/ (gitignored) so reruns never refetch.

Python 3.11 standard library only.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "tools" / "reference" / "cache"
AUGMENT_DIR = ROOT / "data" / "augment"

API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "BeatTheBeasts-DataBuilder/0.1 (https://github.com/jackbloomfield22/BEATTHEBEASTS)"
MIN_INTERVAL_S = 1.2  # serial requests, at most ~1 per second (Wikimedia API etiquette)

POS_GROUP = {
    "QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "OL": "OL",
    "DE": "DL", "DT": "DL", "LB": "LB", "CB": "DB", "S": "DB",
}

# Tokens in OL_UNITS key lists that are not a person.
NON_PERSON_TOKENS = {"The Hogs"}
# Legacy spellings that name the same person as another spelling (nickname vs
# formal name, accent variant, typo, stray punctuation). Maps alias -> canonical.
# Applied to PLAYERS, DEFENSE and OL key-list names alike.
NAME_ALIASES = {
    "Jim Covert": "Jimbo Covert",  # CHI 1980s OL key lists both; one person (James Covert)
    "Anthony Munoz": "Anthony Muñoz",  # CIN 1990s OL key, no tilde
    "Anthony Munoz... ": "Anthony Muñoz",  # PLAYERS TE row CIN 1980s (legacy name has a trailing '... ')
    "Garett Bolton": "Garett Bolles",  # DEN 2020s OL key; no NFL lineman named Garett Bolton exists
}
OL_ALIASES = NAME_ALIASES  # backwards name


def load_legacy() -> dict:
    """Return {'players': [...], 'defense': [...], 'ol': [...]} from data/legacy."""
    code = (
        "const m = await import(" + json.dumps(str(ROOT / "data" / "legacy" / "index.ts")) + ");"
        "process.stdout.write(JSON.stringify({players: m.PLAYERS, defense: m.DEFENSE, ol: m.OL_UNITS}));"
    )
    out = subprocess.run(
        ["node", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def page_url(title: str) -> str:
    return "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"), safe="()_,'-.")


class WikiClient:
    """Serial, cached, polite Wikipedia API client.

    Cache entries are {params, retrieved, response}. `offline=True` never touches
    the network and returns None on a cache miss.
    """

    def __init__(self, offline: bool = False, log=sys.stderr):
        self.offline = offline
        self.log = log
        self.last = 0.0
        self.network_requests = 0
        self.cache_hits = 0
        self.wait_s = 0.0
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _key(params: dict) -> str:
        blob = json.dumps(sorted(params.items()), ensure_ascii=False)
        return hashlib.sha1(blob.encode("utf-8")).hexdigest()

    def cached(self, params: dict):
        p = CACHE_DIR / (self._key(params) + ".json")
        if p.exists():
            return json.loads(p.read_text("utf-8"))
        return None

    def get(self, params: dict):
        """Return (response_json, retrieved_iso) or (None, None) offline on a miss."""
        params = dict(params, format="json", formatversion="2")
        hit = self.cached(params)
        if hit is not None:
            self.cache_hits += 1
            return hit["response"], hit["retrieved"]
        if self.offline:
            return None, None
        url = API + "?" + urllib.parse.urlencode(dict(params, maxlag="5"))
        backoff = 5.0
        for attempt in range(1, 40):
            gap = time.monotonic() - self.last
            if gap < MIN_INTERVAL_S:
                time.sleep(MIN_INTERVAL_S - gap)
            self.last = time.monotonic()
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
            retry_after = None
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    body = r.read().decode("utf-8")
                self.network_requests += 1
                data = json.loads(body)
                err = data.get("error") if isinstance(data, dict) else None
                if err and err.get("code") == "maxlag":
                    retry_after = 5.0
                    raise RuntimeError("maxlag")
                if err:
                    raise RuntimeError(f"API error {err}")
                retrieved = now_iso()
                (CACHE_DIR / (self._key(params) + ".json")).write_text(
                    json.dumps({"params": params, "retrieved": retrieved, "response": data}, ensure_ascii=False),
                    "utf-8",
                )
                return data, retrieved
            except urllib.error.HTTPError as e:
                ra = e.headers.get("Retry-After") if e.headers else None
                if e.code in (429, 500, 502, 503, 504):
                    retry_after = float(ra) if ra and ra.isdigit() else None
                else:
                    raise
                why = f"HTTP {e.code}"
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError, RuntimeError) as e:
                if isinstance(e, RuntimeError) and not str(e) == "maxlag":
                    raise
                why = type(e).__name__ + ": " + str(e)[:80]
            wait = max(backoff, retry_after or 0.0)
            wait = min(wait, 600.0)
            print(f"  [wiki] {why}; attempt {attempt}, sleeping {wait:.0f}s", file=self.log, flush=True)
            self.wait_s += wait
            time.sleep(wait)
            backoff = min(backoff * 2, 600.0)
        raise RuntimeError("giving up after repeated failures: " + url)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", "utf-8")


if __name__ == "__main__":
    leg = load_legacy()
    print({k: len(v) for k, v in leg.items()})
    os.sys.exit(0)
