import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const HOME = GLib.get_home_dir();
const USAGE_CACHE = GLib.build_filenamev([HOME, '.cache', 'claudebar', 'usage.json']);
const CONFIG_DIR = GLib.build_filenamev([HOME, '.config', 'claude-pixel-bar']);
const CONFIG_PATH = GLib.build_filenamev([CONFIG_DIR, 'config.json']);

function findClaudebar(extPath) {
    const candidates = [];
    if (extPath)
        candidates.push(GLib.build_filenamev([extPath, 'bin', 'claudebar']));
    const fromPath = GLib.find_program_in_path('claudebar');
    if (fromPath)
        candidates.push(fromPath);
    candidates.push(GLib.build_filenamev([HOME, '.local', 'bin', 'claudebar']));
    candidates.push('/usr/local/bin/claudebar');
    for (const p of candidates) {
        if (p && Gio.File.new_for_path(p).query_exists(null))
            return p;
    }
    return candidates[0] || null;
}

const FMT = [
    '{plan}',
    '{session_pct}', '{session_remaining_pct}', '{session_reset}', '{session_elapsed}',
    '{session_pace}', '{session_pace_pct}',
    '{weekly_pct}', '{weekly_remaining_pct}', '{weekly_reset}', '{weekly_elapsed}',
    '{weekly_pace}', '{weekly_pace_pct}',
    '{model_name}', '{model_pct}', '{model_remaining_pct}', '{model_reset}', '{model_elapsed}',
    '{model_pace}', '{model_pace_pct}',
    '{sonnet_pct}', '{sonnet_remaining_pct}', '{sonnet_reset}', '{sonnet_elapsed}',
    '{sonnet_pace}', '{sonnet_pace_pct}',
    '{extra_spent}', '{extra_limit}', '{extra_pct}',
].join('|');

const DEFAULT_CONFIG = {
    refresh_seconds: 60,
    show_session: true,
    show_weekly: true,
    show_model: true,
    show_sonnet: true,
    show_extra: true,
    show_today: true,
};

const ACCENT = '#d97757';
const DOG_DARK = '#5a3a2c';
const EMPTY_TOP = '#3d3a36';
const EMPTY_CELL = '#e6e1d4';
const MARKER = '#8a8478';

const DOG = [
    '2000000000002',
    '2200000000022',
    '1210000000121',
    '1211111111121',
    '1111111111111',
    '1121111112111',
    '1111111111111',
    '1133333333311',
    '1133333333311',
    '1133332333311',
    '1133344433311',
    '0113333333110',
    '0011111111100',
];

function hexRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lighten(hex, amt) {
    const [r, g, b] = hexRgb(hex);
    const L = c => Math.round(c + (255 - c) * amt).toString(16).padStart(2, '0');
    return `#${L(r)}${L(g)}${L(b)}`;
}

function createDog(scale) {
    const palette = {'1': ACCENT, '2': DOG_DARK, '3': '#f5ede3', '4': '#e0817f'};
    const cols = DOG[0].length;
    const rowsN = DOG.length;
    const area = new St.DrawingArea({y_align: Clutter.ActorAlign.CENTER});
    area.set_width(cols * scale);
    area.set_height(rowsN * scale);
    area.connect('repaint', a => {
        const cr = a.get_context();
        for (const key of Object.keys(palette)) {
            const [r, g, b] = hexRgb(palette[key]);
            cr.setSourceRGBA(r / 255, g / 255, b / 255, 1);
            for (let y = 0; y < rowsN; y++) {
                for (let x = 0; x < cols; x++) {
                    if (DOG[y][x] === key)
                        cr.rectangle(x * scale, y * scale, scale, scale);
                }
            }
            cr.fill();
        }
        cr.$dispose();
    });
    return area;
}

function levelColor(pct) {
    if (pct >= 90) return '#c45c4a';
    if (pct >= 75) return '#d97757';
    if (pct >= 50) return '#e0a070';
    return '#c4a574';
}

function healthInfo(pct) {
    if (pct >= 90) return ['Critical', '#c45c4a', '#f6e4df'];
    if (pct >= 75) return ['High', '#d97757', '#f4e2d9'];
    if (pct >= 50) return ['Busy', '#9a7d2e', '#efe9d2'];
    return ['Healthy', '#5f7d3f', '#e7efdb'];
}

function clean(v) {
    return (v || '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s*\u23F8\s*/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function paceArrow(pace) {
    const p = clean(pace);
    if (p === '\u2191' || p === '↑') return '↑';
    if (p === '\u2193' || p === '↓') return '↓';
    if (p === '\u2192' || p === '→') return '→';
    return '';
}

function paceTone(pacePct) {
    const label = clean(pacePct).toLowerCase();
    if (label.includes('ahead'))
        return {fg: '#b85440', bg: '#f4e2d9'};
    if (label.includes('under'))
        return {fg: '#5f7d3f', bg: '#e7efdb'};
    return {fg: '#8a857c', bg: '#ebe9df'};
}

function buildSub(reset, remaining, elapsed, pacePct) {
    const parts = [];
    const r = clean(reset);
    if (!r || r === '\u2014' || r === '-')
        parts.push('resetting…');
    else
        parts.push(`resets ${r}`);

    const rem = parseInt(remaining, 10);
    if (!Number.isNaN(rem))
        parts.push(`${rem}% left`);

    const el = parseInt(elapsed, 10);
    if (!Number.isNaN(el))
        parts.push(`${el}% elapsed`);

    const pace = clean(pacePct);
    if (pace && pace !== 'on track')
        parts.push(pace);

    return parts.join('  ·  ');
}

function formatTokens(n) {
    const v = Number(n) || 0;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
    return `${v}`;
}

function formatMoney(minor, exponent = 2, currency = 'USD') {
    const exp = Number.isFinite(exponent) ? exponent : 2;
    const abs = Math.abs(Number(minor) || 0);
    const whole = Math.floor(abs / (10 ** exp));
    const frac = String(Math.floor(abs % (10 ** exp))).padStart(exp, '0');
    const sign = (Number(minor) || 0) < 0 ? '-' : '';
    const symbol = currency === 'USD' ? '$' : `${currency} `;
    return `${sign}${symbol}${whole}.${frac}`;
}

function reasonLabel(reason) {
    const r = clean(reason);
    if (!r) return '';
    if (r === 'org_level_disabled_until')
        return 'disabled by org (temporarily)';
    if (r === 'org_level_disabled')
        return 'disabled by org';
    if (r === 'user_disabled')
        return 'turned off in settings';
    return r.replace(/_/g, ' ');
}

/** Read Extra details from usage cache (placeholders are empty when disabled). */
function loadExtraDetails() {
    try {
        const file = Gio.File.new_for_path(USAGE_CACHE);
        if (!file.query_exists(null))
            return null;
        const [, bytes] = file.load_contents(null);
        const raw = JSON.parse(new TextDecoder().decode(bytes));
        const extra = raw.extra_usage || null;
        const spend = raw.spend || null;
        if (!extra && !spend)
            return null;

        let enabled = false;
        let spent = '';
        let limit = '';
        let pct = 0;
        let reason = '';

        if (spend) {
            enabled = !!spend.enabled;
            reason = spend.disabled_reason || '';
            if (spend.used)
                spent = formatMoney(spend.used.amount_minor, spend.used.exponent, spend.used.currency);
            if (spend.limit)
                limit = formatMoney(spend.limit.amount_minor, spend.limit.exponent, spend.limit.currency);
            pct = Math.round(Number(spend.percent) || 0);
        }

        if (extra) {
            if (!spend)
                enabled = !!extra.is_enabled;
            reason = reason || extra.disabled_reason || '';
            if (!spent && extra.used_credits != null) {
                // API often stores credits in minor units (cents)
                const used = Number(extra.used_credits) || 0;
                spent = formatMoney(Math.round(used), extra.decimal_places ?? 2, extra.currency || 'USD');
            }
            if (!limit && extra.monthly_limit != null) {
                const lim = Number(extra.monthly_limit) || 0;
                limit = formatMoney(Math.round(lim), extra.decimal_places ?? 2, extra.currency || 'USD');
            }
            if (!pct)
                pct = Math.round(Number(extra.utilization) || 0);
        }

        return {enabled, spent, limit, pct, reason};
    } catch (_e) {
        return null;
    }
}

/** Whether API currently reports a Sonnet-only weekly window. */
function loadSonnetAvailable() {
    try {
        const file = Gio.File.new_for_path(USAGE_CACHE);
        if (!file.query_exists(null))
            return false;
        const [, bytes] = file.load_contents(null);
        const raw = JSON.parse(new TextDecoder().decode(bytes));
        return raw.seven_day_sonnet != null;
    } catch (_e) {
        return false;
    }
}

function loadConfig() {
    try {
        const file = Gio.File.new_for_path(CONFIG_PATH);
        if (!file.query_exists(null))
            return {...DEFAULT_CONFIG};
        const [, bytes] = file.load_contents(null);
        const text = new TextDecoder().decode(bytes);
        const raw = JSON.parse(text);
        const cfg = {...DEFAULT_CONFIG};
        for (const key of Object.keys(DEFAULT_CONFIG)) {
            if (!(key in raw))
                continue;
            if (typeof DEFAULT_CONFIG[key] === 'boolean')
                cfg[key] = raw[key] === true || raw[key] === 'true' || raw[key] === 1;
            else if (key === 'refresh_seconds') {
                const n = parseInt(raw[key], 10);
                cfg[key] = [60, 120, 300].includes(n) ? n : 60;
            }
        }
        return cfg;
    } catch (_e) {
        return {...DEFAULT_CONFIG};
    }
}

function saveConfig(cfg) {
    try {
        GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
        const file = Gio.File.new_for_path(CONFIG_PATH);
        const body = JSON.stringify(cfg, null, 2);
        file.replace_contents(body, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (_e) { /* ignore */ }
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Claude Pixel Bar');
        this._extension = extension;
        this._uuid = extension.uuid;
        this._extPath = extension.path;
        this._todayScript = GLib.build_filenamev([extension.path, 'today_stats.py']);
        this._claudebar = findClaudebar(this._extPath);
        this._config = loadConfig();
        this._lastGood = null;
        this._today = null;
        this._extraInfo = null;
        this._sonnetAvailable = false;
        this._confirmHide = false;
        this._view = 'main'; // main | settings
        this._refreshing = false;
        this._pending = {usage: false, today: false};
        this._requestId = 0;
        this._disposed = false;

        this._panelBox = new St.BoxLayout({style_class: 'cpb-panel'});
        this._panelBox.add_child(createDog(2));
        this._miniBar = new St.BoxLayout({style_class: 'cpb-minibar', y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({text: '··', y_align: Clutter.ActorAlign.CENTER, style_class: 'cpb-label'});
        this._panelBox.add_child(this._miniBar);
        this._panelBox.add_child(this._label);
        this.add_child(this._panelBox);

        this._menuItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'cpb-menuitem',
        });
        this._card = new St.BoxLayout({vertical: true, style_class: 'cpb-card'});
        this._menuItem.add_child(this._card);
        this.menu.addMenuItem(this._menuItem);
        this.menu.actor.add_style_class_name('cpb-popup');

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                this._confirmHide = false;
                if (this._view === 'main')
                    this._refresh();
            }
        });

        this._armTimer();
        this._refresh();
    }

    _armTimer() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        const sec = Math.max(30, parseInt(this._config.refresh_seconds, 10) || 60);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, sec, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _fillMini(pct) {
        this._miniBar.destroy_all_children();
        const cells = 8;
        const filled = Math.max(0, Math.min(cells, Math.round(pct / 100 * cells)));
        const col = levelColor(pct);
        for (let i = 0; i < cells; i++) {
            const c = new St.Widget({style_class: 'cpb-minicell'});
            c.set_style(`background-color: ${i < filled ? col : EMPTY_TOP};`);
            this._miniBar.add_child(c);
        }
    }

    _bar(pct, elapsed) {
        const cells = 18;
        const wrap = new St.BoxLayout({style_class: 'cpb-bar', x_expand: true});
        const filled = Math.max(0, Math.min(cells, Math.round(pct / 100 * cells)));
        const mark = Math.max(0, Math.min(cells - 1, Math.round((parseInt(elapsed, 10) || 0) / 100 * cells)));
        const base = levelColor(pct);
        const light = lighten(base, 0.28);

        for (let i = 0; i < cells; i++) {
            const cell = new St.Widget({style_class: 'cpb-cell', x_expand: true});
            if (i < filled) {
                cell.set_style(
                    `background-gradient-direction: vertical;` +
                    `background-gradient-start: ${light};` +
                    `background-gradient-end: ${base};`
                );
            } else if (i === mark && elapsed) {
                cell.set_style(`background-color: ${MARKER};`);
            } else {
                cell.set_style(`background-color: ${EMPTY_CELL};`);
            }
            wrap.add_child(cell);
        }
        return wrap;
    }

    _pill(text, fg, bg, cls = 'cpb-pill') {
        const p = new St.Label({text, style_class: cls, y_align: Clutter.ActorAlign.CENTER});
        p.set_style(`color: ${fg}; background-color: ${bg};`);
        return p;
    }

    _row(title, pct, remaining, reset, elapsed, pace, pacePct, opts = {}) {
        const row = new St.BoxLayout({vertical: true, style_class: 'cpb-row'});
        const head = new St.BoxLayout({style_class: 'cpb-rowhead'});
        const left = new St.BoxLayout({style_class: 'cpb-rowleft'});
        left.add_child(new St.Label({
            text: title,
            style_class: 'cpb-title',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        if (opts.unavailable) {
            left.add_child(this._pill('N/A', '#8a857c', '#ebe9df', 'cpb-pacepill'));
            head.add_child(left);
            head.add_child(new St.Widget({x_expand: true}));
            head.add_child(new St.Label({
                text: '—',
                style_class: 'cpb-pct',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            row.add_child(head);
            row.add_child(new St.Label({
                text: opts.unavailableText || 'not available on this plan',
                style_class: 'cpb-sub',
            }));
            return row;
        }

        const arrow = paceArrow(pace);
        const paceLabel = clean(pacePct);
        if (arrow || paceLabel) {
            const tone = paceTone(pacePct);
            const text = [arrow, paceLabel && paceLabel !== 'on track' ? paceLabel : null]
                .filter(Boolean).join(' ');
            if (text)
                left.add_child(this._pill(text, tone.fg, tone.bg, 'cpb-pacepill'));
        }

        head.add_child(left);
        head.add_child(new St.Widget({x_expand: true}));
        const pctLabel = new St.Label({
            text: `${pct}%`,
            style_class: 'cpb-pct',
            y_align: Clutter.ActorAlign.CENTER,
        });
        pctLabel.set_style(`color: ${levelColor(pct)};`);
        head.add_child(pctLabel);
        row.add_child(head);
        row.add_child(this._bar(pct, elapsed));
        row.add_child(new St.Label({
            text: buildSub(reset, remaining, elapsed, pacePct),
            style_class: 'cpb-sub',
        }));
        return row;
    }

    _extraRow(spent, limit, pct, extraInfo) {
        const info = extraInfo || {};
        const enabled = info.enabled === true;
        const s = clean(info.spent || spent);
        const l = clean(info.limit || limit);
        const p = Number.isFinite(info.pct) ? info.pct : (parseInt(pct, 10) || 0);
        const reason = reasonLabel(info.reason);

        const row = new St.BoxLayout({vertical: true, style_class: 'cpb-row'});
        const head = new St.BoxLayout({style_class: 'cpb-rowhead'});
        head.add_child(new St.Label({
            text: 'Extra',
            style_class: 'cpb-title',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (!enabled)
            head.add_child(this._pill('OFF', '#8a857c', '#ebe9df', 'cpb-pacepill'));
        head.add_child(new St.Widget({x_expand: true}));

        let right = '—';
        if (s && l)
            right = `${s} / ${l}`;
        else if (enabled)
            right = `${p}%`;
        else
            right = 'Off';
        head.add_child(new St.Label({
            text: right,
            style_class: 'cpb-pct-sm',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        row.add_child(head);

        if (s && l)
            row.add_child(this._bar(Math.min(100, Math.max(0, p)), 0));

        if (enabled) {
            row.add_child(new St.Label({
                text: `${Math.max(0, 100 - p)}% of extra budget left`,
                style_class: 'cpb-sub',
            }));
        } else {
            row.add_child(new St.Label({
                text: reason || 'extra usage not enabled on this account',
                style_class: 'cpb-sub',
            }));
        }
        return row;
    }

    _todayRow(today) {
        const row = new St.BoxLayout({vertical: true, style_class: 'cpb-row'});
        const head = new St.BoxLayout({style_class: 'cpb-rowhead'});
        head.add_child(new St.Label({
            text: 'Today',
            style_class: 'cpb-title',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        head.add_child(new St.Widget({x_expand: true}));

        if (!today) {
            head.add_child(new St.Label({
                text: '…',
                style_class: 'cpb-pct-sm',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            row.add_child(head);
            row.add_child(new St.Label({text: 'scanning local logs…', style_class: 'cpb-sub'}));
            return row;
        }

        head.add_child(new St.Label({
            text: `${today.messages || 0} msgs`,
            style_class: 'cpb-pct-sm',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        row.add_child(head);

        const model = (today.top_model || '').replace(/^claude-/, '');
        const parts = [
            `${today.sessions || 0} sessions`,
            `${formatTokens(today.output_tokens)} out`,
            `${formatTokens(today.input_tokens)} in`,
        ];
        if (model)
            parts.push(model);
        row.add_child(new St.Label({
            text: parts.join('  ·  '),
            style_class: 'cpb-sub',
        }));
        row.add_child(new St.Label({
            text: `local · ${formatTokens(today.total_tokens)} total tokens`,
            style_class: 'cpb-sub',
        }));
        return row;
    }

    _setError(msg) {
        if (this._disposed)
            return;
        if (this._lastGood) {
            this._renderMain(this._lastGood, true);
            return;
        }
        this._label.set_text('×');
        this._label.set_style('color: #c45c4a;');
        this._miniBar.destroy_all_children();
        this._card.destroy_all_children();
        this._buildHeader('—', false, -1);
        this._card.add_child(new St.Label({text: msg || 'error', style_class: 'cpb-sub'}));
        this._buildActions(false);
    }

    _buildHeader(plan, stale, overall) {
        const header = new St.BoxLayout({style_class: 'cpb-header'});
        header.add_child(createDog(3));
        const titles = new St.BoxLayout({vertical: true, style_class: 'cpb-headtext', x_expand: true});
        titles.add_child(new St.Label({text: 'Claude', style_class: 'cpb-brand'}));
        titles.add_child(new St.Label({
            text: stale ? `${plan} · cached` : plan,
            style_class: 'cpb-plan',
        }));
        header.add_child(titles);
        if (overall >= 0) {
            const [txt, fg, bg] = healthInfo(overall);
            header.add_child(this._pill(txt, fg, bg, 'cpb-health'));
        }
        this._card.add_child(header);
    }

    _hideWidget() {
        this.menu.close();
        try {
            if (Main.extensionManager?.disableExtension)
                Main.extensionManager.disableExtension(this._uuid);
            else
                Gio.Subprocess.new(['gnome-extensions', 'disable', this._uuid], Gio.SubprocessFlags.NONE);
        } catch (_e) {
            try {
                Gio.Subprocess.new(['gnome-extensions', 'disable', this._uuid], Gio.SubprocessFlags.NONE);
            } catch (_e2) { /* ignore */ }
        }
    }

    _toggleSetting(key) {
        this._config[key] = !this._config[key];
        saveConfig(this._config);
        this._renderSettings();
    }

    _setRefreshSeconds(sec) {
        this._config.refresh_seconds = sec;
        saveConfig(this._config);
        this._armTimer();
        this._renderSettings();
    }

    _settingsToggle(label, key) {
        const row = new St.BoxLayout({style_class: 'cpb-setrow'});
        row.add_child(new St.Label({
            text: label,
            style_class: 'cpb-setlabel',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));
        const on = !!this._config[key];
        const btn = new St.Button({
            label: on ? 'ON' : 'OFF',
            style_class: on ? 'cpb-toggle cpb-toggle-on' : 'cpb-toggle cpb-toggle-off',
        });
        btn.connect('clicked', () => this._toggleSetting(key));
        row.add_child(btn);
        return row;
    }

    _renderSettings() {
        this._view = 'settings';
        this._card.destroy_all_children();

        const header = new St.BoxLayout({style_class: 'cpb-header'});
        header.add_child(createDog(3));
        const titles = new St.BoxLayout({vertical: true, style_class: 'cpb-headtext', x_expand: true});
        titles.add_child(new St.Label({text: 'Settings', style_class: 'cpb-brand'}));
        titles.add_child(new St.Label({text: 'Claude Pixel Bar', style_class: 'cpb-plan'}));
        header.add_child(titles);
        this._card.add_child(header);
        this._card.add_child(new St.Widget({style_class: 'cpb-sep', x_expand: true}));

        this._card.add_child(new St.Label({text: 'Visible rows', style_class: 'cpb-section'}));
        this._card.add_child(this._settingsToggle('Session', 'show_session'));
        this._card.add_child(this._settingsToggle('Weekly', 'show_weekly'));
        this._card.add_child(this._settingsToggle('Model (Fable…)', 'show_model'));
        this._card.add_child(this._settingsToggle('Sonnet', 'show_sonnet'));
        this._card.add_child(this._settingsToggle('Extra', 'show_extra'));
        this._card.add_child(this._settingsToggle('Today (local)', 'show_today'));

        this._card.add_child(new St.Widget({style_class: 'cpb-sep', x_expand: true}));
        this._card.add_child(new St.Label({text: 'Refresh interval', style_class: 'cpb-section'}));

        const intervals = new St.BoxLayout({style_class: 'cpb-actions'});
        for (const sec of [60, 120, 300]) {
            const active = (parseInt(this._config.refresh_seconds, 10) || 60) === sec;
            const label = sec < 60 ? `${sec}s` : `${sec / 60}m`;
            const btn = new St.Button({
                label,
                style_class: active ? 'cpb-btn cpb-btn-primary' : 'cpb-btn cpb-btn-ghost',
                x_expand: true,
            });
            btn.connect('clicked', () => this._setRefreshSeconds(sec));
            intervals.add_child(btn);
        }
        this._card.add_child(intervals);

        this._card.add_child(new St.Widget({style_class: 'cpb-sep', x_expand: true}));
        const back = new St.Button({
            label: '← Back',
            style_class: 'cpb-btn cpb-btn-ghost',
            x_expand: true,
        });
        back.connect('clicked', () => {
            this._view = 'main';
            if (this._lastGood)
                this._renderMain(this._lastGood, false);
            else
                this._refresh();
        });
        this._card.add_child(back);
        this._card.add_child(new St.Label({
            text: 'Saved to ~/.config/claude-pixel-bar/config.json',
            style_class: 'cpb-hint',
        }));
    }

    _buildActions(stale) {
        this._card.add_child(new St.Widget({style_class: 'cpb-sep', x_expand: true}));

        const foot = new St.BoxLayout({style_class: 'cpb-foot'});
        const now = GLib.DateTime.new_now_local().format('%H:%M');
        let status = stale ? 'showing cached data' : `updated ${now}`;
        if (this._refreshing)
            status = 'refreshing…';
        foot.add_child(new St.Label({
            text: status,
            style_class: 'cpb-footer',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));
        this._card.add_child(foot);

        const row1 = new St.BoxLayout({style_class: 'cpb-actions'});
        const refreshBtn = new St.Button({
            label: this._refreshing ? 'Refreshing…' : 'Refresh',
            style_class: 'cpb-btn cpb-btn-ghost',
            x_expand: true,
            reactive: !this._refreshing,
        });
        refreshBtn.connect('clicked', () => this._refresh(true));
        row1.add_child(refreshBtn);

        const settingsBtn = new St.Button({
            label: 'Settings',
            style_class: 'cpb-btn cpb-btn-ghost',
            x_expand: true,
        });
        settingsBtn.connect('clicked', () => this._renderSettings());
        row1.add_child(settingsBtn);
        this._card.add_child(row1);

        const row2 = new St.BoxLayout({style_class: 'cpb-actions'});
        const usageBtn = new St.Button({
            label: 'Open usage',
            style_class: 'cpb-btn cpb-btn-primary',
            x_expand: true,
        });
        usageBtn.connect('clicked', () => {
            try {
                Gio.AppInfo.launch_default_for_uri('https://claude.ai/settings/usage', null);
            } catch (_e) { /* ignore */ }
            this.menu.close();
        });
        row2.add_child(usageBtn);

        if (this._confirmHide) {
            const cancelBtn = new St.Button({
                label: 'Cancel',
                style_class: 'cpb-btn cpb-btn-ghost',
                x_expand: true,
            });
            cancelBtn.connect('clicked', () => {
                this._confirmHide = false;
                if (this._lastGood)
                    this._renderMain(this._lastGood, false);
            });
            row2.add_child(cancelBtn);

            const confirmBtn = new St.Button({
                label: 'Hide now',
                style_class: 'cpb-btn cpb-btn-danger',
                x_expand: true,
            });
            confirmBtn.connect('clicked', () => this._hideWidget());
            row2.add_child(confirmBtn);
        } else {
            const hideBtn = new St.Button({
                label: 'Hide',
                style_class: 'cpb-btn cpb-btn-ghost',
                x_expand: true,
            });
            hideBtn.connect('clicked', () => {
                this._confirmHide = true;
                if (this._lastGood)
                    this._renderMain(this._lastGood, false);
            });
            row2.add_child(hideBtn);
        }
        this._card.add_child(row2);

        if (this._confirmHide) {
            this._card.add_child(new St.Label({
                text: 'Hides from the top bar. Re-enable later in Extensions.',
                style_class: 'cpb-hint',
            }));
        }
    }

    _renderMain(data, stale) {
        if (this._disposed)
            return;
        this._view = 'main';
        const cfg = this._config;
        const {
            plan, sPct, sRem, sReset, sElapsed, sPace, sPacePct,
            wPct, wRem, wReset, wElapsed, wPace, wPacePct,
            mName, mPct, mRem, mReset, mElapsed, mPace, mPacePct,
            nPct, nRem, nReset, nElapsed, nPace, nPacePct,
            eSpent, eLimit, ePct,
        } = data;

        const topPct = sPct > 0 ? sPct : wPct;
        const topTag = sPct > 0 ? '' : 'W ';
        this._label.set_text(`${topTag}${topPct}%`);
        this._label.set_style(`color: ${levelColor(topPct)};`);
        this._fillMini(topPct);

        const overall = Math.max(sPct, wPct, mPct || 0, nPct || 0);
        this._card.destroy_all_children();
        if (overall >= 90)
            this._card.add_style_class_name('cpb-card-critical');
        else
            this._card.remove_style_class_name('cpb-card-critical');

        this._buildHeader(plan, stale, overall);
        this._card.add_child(new St.Widget({style_class: 'cpb-sep', x_expand: true}));

        if (cfg.show_session)
            this._card.add_child(this._row('Session', sPct, sRem, sReset, sElapsed, sPace, sPacePct));
        if (cfg.show_weekly)
            this._card.add_child(this._row('Weekly', wPct, wRem, wReset, wElapsed, wPace, wPacePct));
        if (cfg.show_model && mName)
            this._card.add_child(this._row(mName, mPct, mRem, mReset, mElapsed, mPace, mPacePct));
        if (cfg.show_sonnet) {
            if (this._sonnetAvailable) {
                this._card.add_child(this._row('Sonnet', nPct, nRem, nReset, nElapsed, nPace, nPacePct));
            } else {
                this._card.add_child(this._row('Sonnet', 0, '', '', '', '', '', {
                    unavailable: true,
                    unavailableText: 'no Sonnet-only limit on this plan',
                }));
            }
        }
        if (cfg.show_extra)
            this._card.add_child(this._extraRow(eSpent, eLimit, ePct, this._extraInfo));
        if (cfg.show_today)
            this._card.add_child(this._todayRow(this._today));

        this._buildActions(stale);
    }

    _parseUsage(stdout) {
        let raw = '';
        try {
            raw = JSON.parse(stdout).text || '';
        } catch (_e) {
            return null;
        }
        const stale = raw.includes('\u23F8');
        const text = clean(raw);
        const f = text.split('|');
        if (f.length < 20)
            return null;
        return {
            stale,
            data: {
                plan: f[0] || 'Claude',
                sPct: parseInt(f[1], 10) || 0,
                sRem: f[2],
                sReset: f[3],
                sElapsed: f[4],
                sPace: f[5],
                sPacePct: f[6],
                wPct: parseInt(f[7], 10) || 0,
                wRem: f[8],
                wReset: f[9],
                wElapsed: f[10],
                wPace: f[11],
                wPacePct: f[12],
                mName: f[13] || '',
                mPct: parseInt(f[14], 10) || 0,
                mRem: f[15],
                mReset: f[16],
                mElapsed: f[17],
                mPace: f[18],
                mPacePct: f[19],
                nPct: parseInt(f[20], 10) || 0,
                nRem: f[21],
                nReset: f[22],
                nElapsed: f[23],
                nPace: f[24],
                nPacePct: f[25],
                eSpent: f[26] || '',
                eLimit: f[27] || '',
                ePct: f[28] || '0',
            },
        };
    }

    _maybeFinishRefresh(requestId, staleHint) {
        if (this._disposed || requestId !== this._requestId)
            return;
        if (this._pending.usage || this._pending.today)
            return;
        this._refreshing = false;
        if (this._view !== 'main')
            return;
        if (this._lastGood)
            this._renderMain(this._lastGood, !!staleHint);
    }

    _refresh(manual = false) {
        if (this._disposed)
            return;
        if (this._refreshing && !manual)
            return;

        const requestId = ++this._requestId;
        this._refreshing = true;
        this._pending = {usage: true, today: !!this._config.show_today};
        this._extraInfo = loadExtraDetails();
        this._sonnetAvailable = loadSonnetAvailable();
        this._claudebar = findClaudebar(this._extPath);
        if (this._view === 'main' && this._lastGood)
            this._renderMain(this._lastGood, false);

        let staleHint = false;

        // usage helper
        try {
            if (!this._claudebar || !Gio.File.new_for_path(this._claudebar).query_exists(null))
                throw new Error('usage helper missing');
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            const proc = launcher.spawnv([this._claudebar, '--format', FMT]);
            proc.communicate_utf8_async(null, null, (p, res) => {
                if (this._disposed || requestId !== this._requestId)
                    return;
                this._pending.usage = false;
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    const parsed = this._parseUsage(stdout);
                    if (parsed) {
                        this._lastGood = parsed.data;
                        staleHint = parsed.stale;
                        this._extraInfo = loadExtraDetails() || this._extraInfo;
                        this._sonnetAvailable = loadSonnetAvailable();
                    } else if (!this._lastGood) {
                        this._setError('syncing…');
                    }
                } catch (_e) {
                    if (!this._lastGood)
                        this._setError('spawn error');
                }
                this._maybeFinishRefresh(requestId, staleHint);
            });
        } catch (_e) {
            this._pending.usage = false;
            if (!this._lastGood)
                this._setError('usage helper missing');
            this._maybeFinishRefresh(requestId, staleHint);
        }

        // today local stats
        if (this._config.show_today) {
            try {
                const launcher = new Gio.SubprocessLauncher({
                    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
                });
                const py = GLib.find_program_in_path('python3') || '/usr/bin/python3';
                const script = this._todayScript;
                if (!Gio.File.new_for_path(script).query_exists(null))
                    throw new Error('today script missing');
                const proc = launcher.spawnv([py, script]);
                proc.communicate_utf8_async(null, null, (p, res) => {
                    if (this._disposed || requestId !== this._requestId)
                        return;
                    this._pending.today = false;
                    try {
                        const [, stdout] = p.communicate_utf8_finish(res);
                        this._today = JSON.parse(stdout.trim());
                    } catch (_e) {
                        // keep previous today
                    }
                    this._maybeFinishRefresh(requestId, staleHint);
                });
            } catch (_e) {
                this._pending.today = false;
                this._maybeFinishRefresh(requestId, staleHint);
            }
        } else {
            this._pending.today = false;
        }
    }

    destroy() {
        this._disposed = true;
        this._requestId++;
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        super.destroy();
    }
});

export default class ClaudePixelBarExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
