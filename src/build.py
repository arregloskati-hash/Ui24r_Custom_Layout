#!/usr/bin/env python3
"""Build script: assembles dist/ from the source .js files + the HTML template."""
import re, os

# Resolve paths relative to this script, so it works from any checkout location -
# run it as `python3 src/build.py` (or `cd src && python3 build.py`) from the repo.
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "src")
DIST = os.path.join(REPO, "dist")

custom_js = open(f"{SRC}/custom.js", encoding="utf-8").read()
hotkeys_js = open(f"{SRC}/hotkeys.js", encoding="utf-8").read()
inject = custom_js + "\n" + hotkeys_js
assert "</script" not in inject.lower()

open(f"{DIST}/ui24r-custom-inject.js", "w", encoding="utf-8").write(inject)

# ---- Tampermonkey userscript ----
header = '''// ==UserScript==
// @name         Ui24R Custom Layout (Player Tab + Hotkeys)
// @namespace    ui24r-custom.skati
// @version      1.0.0
// @description  Adds the fixed "Player" tab under Edit View and a fully rebindable Hotkeys system (incl. Tap Tempo on Space bar) to the Soundcraft Ui24R web control interface. Runs automatically every time you open the mixer's page.
// @author       Skati
// @match        http://10.10.2.1/*
// @match        http://ui24r.local/*
// @match        http://ui24r/*
// -- Add one more @match line for your mixer's own IP on your regular Wi-Fi network,
// -- e.g.  // @match  http://192.168.1.50/*
// -- (Tampermonkey's dashboard -> this script -> Edit lets you add it any time.)
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  function mixerReady() {
    return typeof window.Widget !== "undefined" &&
           typeof window.Class !== "undefined" &&
           typeof window.guiReady !== "undefined";
  }

  function run() {
'''
footer = '''
  }

  var tries = 0;
  (function poll() {
    if (mixerReady()) { run(); return; }
    if (++tries > 150) { console.error("[Ui24R Custom] Mixer app never became ready - giving up."); return; }
    setTimeout(poll, 200);
  })();
})();
'''
indented = "\n".join(("    " + line if line.strip() else line) for line in inject.split("\n"))
open(f"{DIST}/ui24r-custom.user.js", "w", encoding="utf-8").write(header + indented + footer)

# ---- Embed into the HTML's inert <script type="text/plain"> block ----
html_path = f"{DIST}/Ui24R-Custom.html"
html = open(html_path, encoding="utf-8").read()
new_block = re.sub(
    r'(<script type="text/plain" id="u24-inject-source">\n).*?(\n</script>)',
    lambda m: m.group(1) + inject + m.group(2),
    html, flags=re.S
)
assert re.search(r'<script type="text/plain" id="u24-inject-source">', html), "embed block not found"
open(html_path, "w", encoding="utf-8").write(new_block)

print("Build OK:")
print(" inject bytes:", len(inject))
print(" userscript bytes:", os.path.getsize(f"{DIST}/ui24r-custom.user.js"))
print(" html bytes:", os.path.getsize(html_path))
