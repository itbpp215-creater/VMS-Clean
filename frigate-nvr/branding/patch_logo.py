#!/usr/bin/env python3
"""Rebrand Frigate's UI: swap the built-in inline-SVG logo (the cat) for our
custom image, and inject CSS so it shows at a proper size (real size on the
login page, header-fitted in the app).

Runs inside the Docker build against the already-built web bundle. The JS swap
is anchored on the logo's SVG path data (not on hashed filenames or minified
identifiers), so it re-applies automatically when rebuilt on a new Frigate
version -- as long as the logo artwork is unchanged.
"""
import glob
import os
import re
import sys

WEB = "/opt/frigate/web"
LOGO_PREFIX = "M130 446.5"          # unique start of the Frigate cat logo path
IMG = "/images/custom-logo.png"
BRAND_CLASS = "frigate-brand-logo"

ID = r"[A-Za-z_$][A-Za-z0-9_$]{0,4}"        # minified identifier (e.g. Oe, t)
CN = r"[A-Za-z_$][A-Za-z0-9_$.]{0,6}"        # class-merge helper (may be dotted)

# Match the whole logo:
#   <ID1>.jsx("svg",{viewBox:"0 0 512 512",className:<CN>("fill-current",<ID3>),
#             children:<ID1>.jsx("path",{d:"M130 446.5 ... Z"})})
SVG_PAT = re.compile(
    r'(' + ID + r')\.jsx\("svg",\{viewBox:"0 0 512 512",'
    r'className:(' + CN + r')\("fill-current",(' + ID + r')\),'
    r'children:\1\.jsx\("path",\{d:"' + re.escape(LOGO_PREFIX) + r'[^"]*?"\}\)\}\)'
)
# -> <ID1>.jsx("img",{src:IMG,alt:"Frigate",className:<CN>("frigate-brand-logo",<ID3>)})
SVG_REPL = (
    r'\1.jsx("img",{src:"' + IMG + r'",alt:"Frigate",'
    r'className:\2("' + BRAND_CLASS + r'",\3)})'
)

# Different sizing per page (separate HTML files):
CSS_LOGIN = (
    "." + BRAND_CLASS + "{width:355px!important;height:auto!important;"
    "max-width:85vw!important;object-fit:contain!important}"
)
CSS_APP = (
    "." + BRAND_CLASS + "{height:2.5rem!important;width:auto!important;"
    "max-width:none!important;object-fit:contain!important}"
)


def patch_js():
    total = 0
    for path in glob.glob(WEB + "/assets/*.js"):
        with open(path, encoding="utf-8") as fh:
            s = fh.read()
        if LOGO_PREFIX not in s:
            continue
        s2, n = SVG_PAT.subn(SVG_REPL, s)
        if n:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(s2)
            total += n
            print(f"[patch_logo] JS: patched {n} occurrence(s) in {path}")
    return total


def inject_css(html_name, css):
    path = os.path.join(WEB, html_name)
    if not os.path.exists(path):
        print(f"[patch_logo] CSS: {path} not found, skipped")
        return
    with open(path, encoding="utf-8") as fh:
        s = fh.read()
    if BRAND_CLASS in s:
        return
    style = "<style>" + css + "</style>"
    s = s.replace("</head>", style + "</head>", 1) if "</head>" in s else style + s
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(s)
    print(f"[patch_logo] CSS injected into {path}")


def main():
    n = patch_js()
    if n == 0:
        print("[patch_logo] WARNING: logo SVG not found - in-app logo NOT changed "
              "(Frigate logo artwork may have changed). Favicons unaffected.",
              file=sys.stderr)
    inject_css("login.html", CSS_LOGIN)
    inject_css("index.html", CSS_APP)
    sys.exit(0)


if __name__ == "__main__":
    main()
