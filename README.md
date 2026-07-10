# Claude Pixel Bar

**Claude Code usage limits — cream pixel-art, right in your GNOME top bar.**

[![GNOME](https://img.shields.io/badge/GNOME-45%20%7C%2046%20%7C%2047-4A86CF?style=flat-square)](#requirements)
[![License: MIT](https://img.shields.io/badge/License-MIT-d97757?style=flat-square)](LICENSE)

<p align="center">
  <img src="screenshot/banner.png" alt="Claude Pixel Bar banner" width="920" />
</p>

<p align="center">
  <img src="screenshot/popup.png" alt="Claude Pixel Bar popup" width="420" />
</p>

Session · Weekly · model-scoped limits · Extra · local Today stats — with pacing badges, elapsed markers, and a one-click hide.

---

## Install

```bash
git clone https://github.com/Evan715823/Claude-bar-for-linux.git
cd Claude-bar-for-linux
chmod +x install.sh
./install.sh
```

Reload GNOME Shell:

| Session | How to reload |
|---------|----------------|
| **X11** | `Alt+F2` → type `r` → Enter *(English input method)* |
| **Wayland** | Log out and log back in |

Look for the pixel dog in the top bar. Click it for the full card.

```bash
# later
gnome-extensions enable  claude-pixel-bar@local
gnome-extensions disable claude-pixel-bar@local
```

---

## What you see

| Surface | Content |
|---------|---------|
| **Top bar** | Pixel dog · mini usage bar · session % (falls back to weekly) |
| **Popup** | Session / Weekly / model (e.g. Fable) / Sonnet / Extra / Today |
| **Pacing** | ↑ ahead · ↓ under · colored pills + elapsed marker on the bar |
| **Health** | Critical / High / Busy / Healthy badge |
| **Actions** | Refresh · Settings · Open usage · Hide widget |

<p align="center">
  <img src="screenshot/settings.png" alt="Settings panel" width="360" />
</p>

**Settings** (`~/.config/claude-pixel-bar/config.json`):

- Toggle any row on/off  
- Refresh every **1m / 2m / 5m**

---

## Requirements

- Linux + **GNOME Shell 45 / 46 / 47**
- Claude Code logged in (`claude` works) — Pro / Max
- `curl`, `jq`, GNU `date`
- Python 3 *(Today local stats)*
- Optional fonts: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P), [Manrope](https://fonts.google.com/specimen/Manrope)

---

## How it works

1. Reads OAuth credentials from `~/.claude/.credentials.json` (created by Claude Code)
2. Refreshes the access token when needed
3. Fetches live usage from Anthropic (cached ~60s)
4. Renders the GNOME top-bar widget + popup

Everything ships in this repo — no separate usage helper to install.

---

## Privacy

- Uses your local Claude Code login only
- Usage requests go to Anthropic; responses are cached under `~/.cache/`
- **Today** reads local `~/.claude/projects/*.jsonl` — nothing is uploaded
- Settings are local JSON. No telemetry

---

## Uninstall

```bash
gnome-extensions disable claude-pixel-bar@local
rm -rf ~/.local/share/gnome-shell/extensions/claude-pixel-bar@local
# optional:
# rm -rf ~/.config/claude-pixel-bar
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Nothing in the top bar | `gnome-extensions enable claude-pixel-bar@local` then reload Shell |
| Auth / empty data | Run `claude` once to log in |
| Extra shows **OFF** | Account/org has Extra disabled — not a UI bug |
| Sonnet shows **N/A** | Plan has no Sonnet-only weekly window |
| Stale / cached | Click **Refresh**, or wait for the next interval |

```bash
gnome-extensions info claude-pixel-bar@local
~/.local/share/gnome-shell/extensions/claude-pixel-bar@local/bin/claudebar \
  --format '{plan}|{session_pct}|{weekly_pct}'
```

---

## Disclaimer

**Unofficial community project.** Not affiliated with, endorsed by, or maintained by Anthropic.  
“Claude” and “Claude Code” are trademarks of Anthropic.  
The usage API is undocumented and rate-limited — keep refresh ≥ 60s.

## License

[MIT](LICENSE) © 2026 Evan715823
