#!/usr/bin/env python3
"""extract_theme.py -- pull a motion theme out of any project's CSS.

Usage: extract_theme.py [CSS] --out DIR [--map role=--var ...]

Writes DIR/theme.css (the CSS variables the template uses) and DIR/theme.json
(the same, colours normalised to #rrggbb so springs can interpolate them).
Reads the first :root block (the light theme) and body/html font-family (or font shorthand).
Optional roles pos/neg (success/danger colours) are included only when found.
Without CSS, writes the house theme: warm gray, black and white, Geist.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HOUSE = {"canvas": "#eceae6", "surface": "#ffffff", "ink": "#0b0b0b", "muted": "#8c8883",
         "accent": "#0b0b0b", "font": "Geist, system-ui, sans-serif"}
ROLES = {
    "canvas": ["--bg", "--background", "--canvas", "--color-bg", "--bg-color", "--page"],
    "surface": ["--panel", "--surface", "--card", "--paper", "--bg-elevated", "--color-surface"],
    "ink": ["--ink", "--text", "--fg", "--foreground", "--color-text", "--text-color"],
    "muted": ["--muted", "--text-muted", "--subtle", "--color-muted"],
    "accent": ["--accent", "--primary", "--brand", "--color-primary", "--color-accent"],
}
OPTIONAL_ROLES = {
    "pos": ["--pos", "--success", "--positive", "--color-success", "--green"],
    "neg": ["--neg", "--danger", "--error", "--negative", "--color-danger", "--red"],
}
FONT_VARS = ["--font", "--font-sans", "--font-family", "--font-body"]
NAMED = {"white": "#ffffff", "black": "#000000"}


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def root_vars(css):
    m = re.search(r"(?<![\w-]):root\s*\{([^}]*)\}", css)
    if not m:
        return {}
    return {k.strip(): v.strip() for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+)", m.group(1))}


def resolve(value, env, depth=0):
    if depth > 8:
        return value
    def sub(m):
        name, fallback = m.group(1), m.group(2)
        if name in env:
            return resolve(env[name], env, depth + 1)
        return fallback.strip() if fallback else m.group(0)
    return re.sub(r"var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)", sub, value)


def to_hex(c):
    c = c.strip().lower()
    if c in NAMED:
        return NAMED[c]
    m = re.fullmatch(r"#([0-9a-f]{3,8})", c)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h[:3])
        return "#" + h[:6] if len(h) in (6, 8) else None
    m = re.fullmatch(r"rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+[\d.]+%?)?\s*\)", c)
    if m:
        return "#" + "".join(f"{min(255, int(x)):02x}" for x in m.groups())
    return None


_BODY = r"(?:^|[}\s,])(?:html|body)\s*(?:,[^{]*)?\{[^}]*?"
_SIZE = r"\d*\.?\d+(?:px|pt|em|rem|%)(?:\s*/\s*[\d.]+(?:px|pt|em|rem|%)?)?"


def body_font(css):
    """font-family on html/body, else the family list of a `font:` shorthand (after size[/line-height])."""
    m = re.search(_BODY + r"font-family\s*:\s*([^;}]+)", css)
    if not m:
        m = re.search(_BODY + r"(?<![\w-])font\s*:\s*(?:[a-z0-9-]+\s+)*?" + _SIZE + r"\s+([^;}]+)", css)
    return m.group(1).strip() if m else None


def extract(css, overrides=None):
    css = strip_comments(css)
    env = root_vars(css)
    theme, warnings = dict(HOUSE), []
    for role, names in ROLES.items():
        names = [overrides[role]] if overrides and role in overrides else names
        found = next((n for n in names if n in env), None)
        if not found:
            warnings.append(f"no {role} colour found (looked for {', '.join(names)}); using the house {role}")
            continue
        hexed = to_hex(resolve(env[found], env))
        if hexed is None:
            warnings.append(f"{found} is not a plain colour ({env[found]}); using the house {role}")
            continue
        theme[role] = hexed
    for role, names in OPTIONAL_ROLES.items():
        names = [overrides[role]] if overrides and role in overrides else names
        found = next((n for n in names if n in env), None)
        hexed = to_hex(resolve(env[found], env)) if found else None
        if hexed:
            theme[role] = hexed
    font = None
    if overrides and "font" in overrides and overrides["font"] in env:
        font = resolve(env[overrides["font"]], env)
    font = font or next((resolve(env[n], env) for n in FONT_VARS if n in env), None) or body_font(css)
    if font:
        theme["font"] = font
    else:
        warnings.append("no font-family found; using the house font (Geist)")
    return theme, warnings


def write(theme, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "theme.json").write_text(json.dumps(theme, indent=2))
    (out / "theme.css").write_text(":root{" + "".join(f"--{k}:{v};" for k, v in theme.items()) + "}\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("css", nargs="?")
    ap.add_argument("--out", required=True)
    ap.add_argument("--map", action="append", default=[], help="role=--css-var, e.g. accent=--pos")
    a = ap.parse_args(argv)
    bad = [m for m in a.map if "=" not in m]
    if bad:
        print(f"error: --map needs role=--var, got {bad[0]!r}", file=sys.stderr)
        return 2
    overrides = dict(m.split("=", 1) for m in a.map)
    if a.css is None:
        theme, warnings = dict(HOUSE), []
    else:
        p = Path(a.css)
        if not p.is_file():
            print(f"error: no such file: {p}", file=sys.stderr)
            return 2
        theme, warnings = extract(p.read_text(errors="replace"), overrides)
    write(theme, a.out)
    print("theme: " + ", ".join(f"{k} {v}" for k, v in theme.items()))
    for w in warnings:
        print(f"warning: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
