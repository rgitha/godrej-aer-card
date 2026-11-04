/*
 * Card for Godrej Aer Smart Matic
 * A Home Assistant dashboard card for a Godrej Aer Smart Matic: its status,
 * Spray now, Auto spray and the spray schedules stored on the device,
 * through the godrej_aer integration.
 *
 * Copyright 2026 Rgitha. Licensed under the Apache License, Version 2.0.
 */

const CARD_VERSION = "0.3.0";
const MAX_SCHEDULES = 10;
// The device stores at most 144 sprays per schedule; a window is at most 24 h.
const MAX_SPRAYS = 144;
const DAY = 24 * 60;
const WEEK = 7 * DAY;
const INTERVALS = [10, 20, 40];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DAY_LETTER = { mon: "M", tue: "T", wed: "W", thu: "T", fri: "F", sat: "S", sun: "S" };
const DAY_PRESETS = [
  ["Weekdays", ["mon", "tue", "wed", "thu", "fri"]],
  ["Weekends", ["sat", "sun"]],
  ["Every day", DAYS],
];
const TIME_PRESETS = [
  ["Morning", "07:00", "10:00"],
  ["Afternoon", "12:00", "15:00"],
  ["Evening", "17:00", "20:00"],
];

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (minutes) => {
  const m = Math.min(Math.max(minutes, 0), 24 * 60 - 1);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const esc = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Sprays and the rounded end, as the device stores them (start + count x
 * interval). An end at or before the start is the next day (up to 24 h);
 * endMinutes then goes past 24:00.
 */
function rounded(start, end, interval) {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += DAY;
  const sprays = Math.min(Math.floor((e - s) / interval), MAX_SPRAYS);
  return { sprays, endMinutes: s + Math.max(sprays, 0) * interval };
}

/** The rounded end as HH:MM, with "+1" when it is the next day. */
function endLabel(s) {
  const end = rounded(s.start, s.end, s.interval).endMinutes;
  return end > DAY ? `${toHHMM(end - DAY)} (+1)` : toHHMM(end);
}

/** A schedule's windows as [start, end) minutes from Monday 00:00, wrapping round the week. */
function windows(s) {
  const { endMinutes } = rounded(s.start, s.end, s.interval);
  const length = endMinutes - toMinutes(s.start);
  const out = [];
  for (const d of s.days) {
    const start = DAYS.indexOf(d) * DAY + toMinutes(s.start);
    out.push([start, Math.min(start + length, WEEK)]);
    if (start + length > WEEK) out.push([0, start + length - WEEK]);
  }
  return out;
}

/** A schedule from the sensor's attributes, in the card's own form. */
function fromAttribute(item) {
  const days = (item.days || [])
    .map((d) => String(d).slice(0, 3).toLowerCase())
    .filter((d) => DAYS.includes(d));
  return { days, start: String(item.start).slice(0, 5), end: String(item.end).slice(0, 5), interval: Number(item.interval) };
}

/** What the integration's set_schedules action expects for one schedule. */
const forAction = (s) => ({ days: [...s.days], start: s.start, end: s.end, interval: s.interval });

/** Problems with one schedule against the rest of the list (index = its place, or -1 if new). */
function problems(schedule, list, index) {
  if (!schedule.days.length) return "Pick at least one day.";
  const { sprays } = rounded(schedule.start, schedule.end, schedule.interval);
  if (sprays < 1) return `The window is shorter than one ${schedule.interval}-minute interval.`;
  const others = list.filter((_, i) => i !== index);
  if (index < 0 && others.length >= MAX_SCHEDULES) return `The device holds at most ${MAX_SCHEDULES} schedules.`;
  // A window past midnight also counts against the next day's windows.
  const mine = windows(schedule);
  for (const other of others) {
    const clash = windows(other).some(([oS, oE]) => mine.some(([s, e]) => s < oE && oS < e));
    if (clash) return `This overlaps ${other.start} – ${endLabel(other)}.`;
  }
  return null;
}

function ago(iso) {
  if (!iso) return "never";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// --- the device's entities -----------------------------------------------------

const DOMAINS = ["godrej_aer", "godrej_aer_patched"];

/** The integration's entities on a device, by role. */
function deviceEntities(hass, deviceId) {
  const mine = Object.values(hass.entities || {}).filter(
    (e) => e.device_id === deviceId && DOMAINS.includes(e.platform)
  );
  const find = (domain, key, suffix) => {
    const hit =
      mine.find((e) => e.entity_id.startsWith(`${domain}.`) && e.translation_key === key) ||
      mine.find((e) => e.entity_id.startsWith(`${domain}.`) && suffix && e.entity_id.endsWith(suffix));
    return hit ? hit.entity_id : null;
  };
  const byState = (test) => {
    const hit = mine.find((e) => test(e.entity_id, hass.states[e.entity_id]));
    return hit ? hit.entity_id : null;
  };
  return {
    platform: mine.length ? mine[0].platform : "godrej_aer",
    status: find("sensor", "device_status", "_status"),
    battery: find("sensor", "battery_level", "_battery"),
    refill: find("sensor", "refill_level", "_refill_level"),
    updated: find("sensor", "updated_last", "_updated_last"),
    auto: find("select", "spray_mode", "_spray_auto"),
    spray: find("button", "spray_now", "_spray_now"),
    resetRefill: find("button", "reset_refill", "_reset_refill_level"),
    identify: byState((id, st) => id.startsWith("button.") && st && st.attributes.device_class === "identify"),
    schedules: byState((id, st) => id.startsWith("sensor.") && st && Array.isArray(st.attributes.schedules)),
  };
}

/** Devices that have the integration's entities. */
const smartMatics = (hass) => [
  ...new Set(
    Object.values(hass.entities || {})
      .filter((e) => DOMAINS.includes(e.platform) && e.device_id)
      .map((e) => e.device_id)
  ),
];

/** The next start of any schedule after now: { schedule, day }. */
function nextRun(list, now) {
  const nowMin = ((now.getDay() + 6) % 7) * DAY + now.getHours() * 60 + now.getMinutes();
  let best = null;
  for (const s of list) {
    for (const d of s.days) {
      let at = DAYS.indexOf(d) * DAY + toMinutes(s.start);
      if (at <= nowMin) at += WEEK;
      if (!best || at < best.at) best = { at, schedule: s };
    }
  }
  if (!best) return null;
  const ahead = Math.floor(best.at / DAY) - Math.floor(nowMin / DAY);
  const day = ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : DAY_LABEL[DAYS[Math.floor(best.at / DAY) % 7]];
  return { schedule: best.schedule, day, inMinutes: best.at - nowMin };
}

const ICON = {
  battery: "M16,20H8V6H16M16.67,4H15V2H9V4H7.33A1.33,1.33 0 0,0 6,5.33V20.67C6,21.4 6.6,22 7.33,22H16.67A1.33,1.33 0 0,0 18,20.67V5.33C18,4.6 17.4,4 16.67,4Z",
  refill: "M12,20A6,6 0 0,1 6,14C6,10 12,3.25 12,3.25C12,3.25 18,10 18,14A6,6 0 0,1 12,20Z",
  spray: "M3,15H5V21H3V15M7,13H13V21H7V13M8,9H12V12H8V9M15,11H17V13H15V11M19,9H21V11H19V9M19,13H21V15H19V13M17,7H19V9H17V7M17,15H19V17H17V15Z",
  refresh: "M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z",
  dots: "M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z",
};
const svg = (path, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${path}"/></svg>`;

const LOW_BATTERY = 20;

/** "just now", "5m ago", "2h 4m ago", "3d ago". */
function shortAgo(iso) {
  if (!iso) return "";
  const minutes = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""} ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

class GodrejAerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._layout = "device"; // "schedules" for the old schedule card
    this._list = null; // the schedules shown (edited copy while dirty)
    this._baseline = null; // the device's list the edits started from
    this._dirty = false;
    this._editing = null; // { index, schedule, error }
    this._conflict = false;
    this._busy = null; // "save" | "refresh" | "skip" | "spray" | "auto" | "menu-*"
    this._error = null;
    this._menu = false;
    this._dialog = null; // the schedules pop-up's host, on the page
    this._dialogOpen = false;
    this._confirmClose = false;
  }

  setConfig(config) {
    if (!config || !(config.device || config.entity)) {
      throw new Error("Pick a Smart Matic device ('device'), or a Schedules sensor ('entity').");
    }
    this._config = config;
    this._render();
  }

  static getConfigElement() {
    return document.createElement("godrej-aer-card-editor");
  }

  static getStubConfig(hass) {
    const device = smartMatics(hass)[0];
    return device ? { device } : { device: "" };
  }

  disconnectedCallback() {
    this._closeDialog(true);
  }

  /** Sections view: half a row by default, height as needed (it doesn't
   * change by itself: a schedule starting or ending keeps the same lines). */
  getGridOptions() {
    return { columns: 6, min_columns: 4, rows: "auto" };
  }

  getCardSize() {
    return this._layout === "schedules" ? 3 + (this._list ? this._list.length : 0) : 5;
  }

  get _deviceId() {
    if (this._config.device) return this._config.device;
    const entry = this._hass && this._hass.entities && this._hass.entities[this._config.entity];
    return entry ? entry.device_id : null;
  }

  set hass(hass) {
    this._hass = hass;
    const ents = deviceEntities(hass, this._deviceId);
    if (this._config.entity && !ents.schedules) ents.schedules = this._config.entity;
    // Redraw only when one of ours changed, so an open editor keeps its focus.
    const watched = Object.values(ents).filter((v) => typeof v === "string" && v.includes("."));
    const snapshot = watched.map((id) => hass.states[id]);
    const unchanged =
      this._snapshot &&
      snapshot.length === this._snapshot.length &&
      snapshot.every((s, i) => s === this._snapshot[i]);
    this._ents = ents;
    this._snapshot = snapshot;
    if (unchanged && !this._forceRender) return;
    this._forceRender = false;
    const st = this._sched;
    if (st && !this._dirty) {
      this._list = (st.attributes.schedules || []).map(fromAttribute);
      this._baseline = this._list.map((s) => ({ ...s, days: [...s.days] }));
    }
    this._render();
  }

  get _sched() {
    return this._ents && this._ents.schedules ? this._hass.states[this._ents.schedules] : null;
  }

  _state(role) {
    const id = this._ents && this._ents[role];
    return id ? this._hass.states[id] : null;
  }

  /** The device isn't heard: its readings and controls are unavailable. */
  get _unreachable() {
    const probe = this._state("battery") || this._sched;
    return !probe || probe.state === "unavailable";
  }

  /** The number of the schedule the device is running now, if any. */
  get _runningNow() {
    const state = this._sched;
    return (state && state.state !== "unavailable" && state.attributes.running) || null;
  }

  // --- device actions -------------------------------------------------------

  get _domain() {
    return (this._ents && this._ents.platform) || "godrej_aer";
  }

  get _target() {
    return this._deviceId ? { device_id: this._deviceId } : { entity_id: this._ents.schedules };
  }

  /**
   * How Refresh reads the device. Home Assistant's own update_entity always
   * exists, but it only reads the device once the integration supports it,
   * which it does when it no longer registers its own update_status action.
   * So: update_entity, unless the integration still has update_status.
   */
  get _refreshCall() {
    const services = this._hass.services && this._hass.services[this._domain];
    if (services && services.update_status) {
      return { domain: this._domain, service: "update_status", target: this._target };
    }
    return { domain: "homeassistant", service: "update_entity", target: { entity_id: this._ents.schedules } };
  }

  /** A schedule action: errors show in the card (not as a toast). */
  async _call(kind, service, data, domain = this._domain, target = this._target) {
    this._busy = kind;
    this._error = null;
    this._render();
    try {
      await this._hass.callService(domain, service, data, target, false);
      return true;
    } catch (err) {
      if (kind === "save" && /changed since they were read|schedules_changed/i.test(`${err.message} ${err.translation_key || ""}`)) {
        this._conflict = true;
      } else {
        this._error = err.message || String(err);
      }
      return false;
    } finally {
      this._busy = null;
      this._render();
    }
  }

  /** A control: Home Assistant shows any error as a toast, as on the device page. */
  async _control(kind, domain, service, data) {
    this._busy = kind;
    this._render();
    try {
      await this._hass.callService(domain, service, data);
    } catch (err) {
      /* shown by Home Assistant */
    } finally {
      this._busy = null;
      this._render();
    }
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  async _save(overwrite) {
    this._conflict = false;
    const data = { schedules: this._list.map(forAction) };
    if (!overwrite) data.expected = this._baseline.map(forAction);
    if (await this._call("save", "set_schedules", data)) {
      this._dirty = false; // the read-back updates the sensor and the list
      this._reload();
    }
  }

  _keepDevice() {
    this._conflict = false;
    this._dirty = false;
    this._reload();
  }

  /** Show the device's list again (from the sensor), dropping local edits. */
  _reload() {
    this._forceRender = true;
    this.hass = this._hass;
  }

  // --- rendering -------------------------------------------------------------

  _render() {
    if (!this._config || !this.shadowRoot) return;
    let html;
    if (!this._hass) {
      html = "";
    } else if (!this._deviceId && !this._sched) {
      html = `<div class="banner warn">Pick a Smart Matic device in the card's settings.</div>`;
    } else if (this._layout === "schedules") {
      html = this._renderSchedulesOnly();
    } else {
      html = this._renderDevice();
    }
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>${html}</ha-card>`;
    this._bind(this.shadowRoot);
    this._renderDialog();
  }

  _bind(root) {
    root.querySelectorAll("[data-act]").forEach((el) => {
      el.addEventListener(el.tagName === "INPUT" ? "change" : "click", (ev) => this._onAction(ev, el));
    });
  }

  _deviceName() {
    if (this._config.title) return this._config.title;
    const device = this._hass.devices && this._hass.devices[this._deviceId];
    return (device && (device.name_by_user || device.name)) || "Smart Matic";
  }

  _areaName() {
    const device = this._hass.devices && this._hass.devices[this._deviceId];
    const area = device && device.area_id && this._hass.areas && this._hass.areas[device.area_id];
    return area ? area.name : "";
  }

  _fmt(state) {
    if (!state) return "";
    return this._hass.formatEntityState ? this._hass.formatEntityState(state) : state.state;
  }

  _renderDevice() {
    const off = this._unreachable;
    const status = this._state("status");
    const battery = this._state("battery");
    const refill = this._state("refill");
    const updated = this._state("updated");
    const auto = this._state("auto");
    const mode = status ? status.state : "unknown";
    const sub = this._areaName();
    const read = updated && !["unknown", "unavailable"].includes(updated.state) ? updated.state : null;
    const pct = (s) => (s && !["unknown", "unavailable"].includes(s.state) ? `${Math.round(Number(s.state))}%` : "–");
    const low = battery && Number(battery.state) < LOW_BATTERY;
    const menu = this._menu
      ? `<div class="menu" role="menu">
          ${this._ents.resetRefill ? `<button role="menuitem" data-act="press" data-entity="${this._ents.resetRefill}" ${off ? "disabled" : ""}>Reset refill level</button>` : ""}
          ${this._ents.identify ? `<button role="menuitem" data-act="press" data-entity="${this._ents.identify}" ${off ? "disabled" : ""}>Identify</button>` : ""}
        </div>`
      : "";
    return `
      <div class="top">
        <div class="names"><div class="area">${esc(sub)}</div><div class="title">${esc(this._deviceName())}</div></div>
        <button class="icon" data-act="refresh" title="Read the device now" aria-label="Refresh" ${this._busy ? "disabled" : ""}>${this._busy === "refresh" ? "…" : svg(ICON.refresh)}</button>
        <button class="more" data-act="menu" aria-label="More" aria-haspopup="menu">${svg(ICON.dots)}</button>
        ${menu}
      </div>
      ${off ? `<div class="banner">The device can't be reached right now.</div>` : ""}
      ${this._error ? `<div class="banner warn">${esc(this._error)}</div>` : ""}
      <div class="strip ${off ? "dim" : ""}">
        <span class="mode m-${esc(mode)}"><i></i>${esc(this._fmt(status) || "Unknown")}</span>
        <button class="kv ${low ? "low" : ""}" data-act="info" data-entity="${esc(this._ents.battery || "")}" title="Battery">${svg(ICON.battery, 18)}${pct(battery)}</button>
        <button class="kv" data-act="info" data-entity="${esc(this._ents.refill || "")}" title="Refill level">${svg(ICON.refill, 18)}${pct(refill)}</button>
        ${read ? `<span class="ago" title="Status read ${esc(ago(read))}">${esc(shortAgo(read))}</span>` : ""}
      </div>
      <div class="ctrl ${off ? "dim" : ""}">
        <button class="sprayb" data-act="press" data-entity="${esc(this._ents.spray || "")}" ${this._busy === "spray" ? "disabled" : ""}>${svg(ICON.spray)}Spray now</button>
        <div class="autow"><div class="tiny">Auto · minutes</div>${this._renderAuto(auto, mode === "schedule")}</div>
      </div>
      ${this._sched ? this._renderSchedules() : ""}`;
  }

  _renderAuto(auto, held) {
    const options = (auto && auto.attributes.options) || ["Off", "Every 10 min", "Every 20 min", "Every 40 min"];
    const label = (o) => (/(\d+)/.exec(o) || [null, o])[1];
    return `<div class="seg4 ${held ? "held" : ""}" role="radiogroup" aria-label="Auto spray">${options
      .map((o) => `<button role="radio" aria-checked="${auto && auto.state === o}" class="${auto && auto.state === o ? "on" : ""}" data-act="auto" data-option="${esc(o)}">${esc(label(o))}</button>`)
      .join("")}</div>`;
  }

  _renderSchedulesOnly() {
    const state = this._sched;
    const name = this._config.title || (state && (state.attributes.friendly_name || "").replace(/\s*Schedules$/i, "")) || "Schedules";
    const usable = state && state.state !== "unavailable";
    return `
      <div class="head">
        <ha-icon class="hicon" icon="mdi:calendar-clock"></ha-icon>
        <div class="names">
          <div class="title">${esc(name)}</div>
          <div class="sub">${this._list && usable ? `${this._list.length} of ${MAX_SCHEDULES} used · ` : ""}read ${esc(ago(state && state.attributes.last_read))}</div>
        </div>
        <button class="icon" data-act="refresh" title="Read the schedules from the device" aria-label="Refresh" ${this._busy ? "disabled" : ""}>${this._busy === "refresh" ? "…" : "⟳"}</button>
      </div>
      ${this._error ? `<div class="banner warn">${esc(this._error)}</div>` : ""}
      ${!state ? `<div class="banner warn">Entity ${esc(this._config.entity)} not found.</div>`
        : state.state === "unavailable" ? `<div class="banner">The device can't be reached right now.</div>`
        : this._list === null || state.state === "unknown" ? `<div class="banner">The schedules haven't been read yet.</div>`
        : this._renderInline(state, false)}`;
  }

  _renderSchedules() {
    const state = this._sched;
    if (!state || state.state === "unavailable") return "";
    if (this._list === null || state.state === "unknown") {
      return `<div class="sect"><b>Schedules</b></div><div class="banner">The schedules haven't been read yet.</div>`;
    }
    if (this._config.show_schedules) return this._renderInline(state, true);
    // One line, always the same height: the running schedule, or the next.
    return `
      <div class="sect"><b>Schedules</b><button class="link" data-act="dialog">Show all</button></div>
      ${this._renderSlot(this._runningIndex(state))}`;
  }

  _renderSlot(runningAt) {
    if (runningAt >= 0) {
      const s = this._list[runningAt];
      return `<div class="slot"><span class="chipx">Running</span><b>${esc(s.start)} – ${esc(endLabel(s))}</b><span class="grow"></span>
        <button class="btn small" data-act="skip" ${this._busy ? "disabled" : ""}>${this._busy === "skip" ? "Skipping…" : "Skip"}</button></div>`;
    }
    const next = nextRun(this._list, new Date());
    if (!next) {
      return `<div class="slot"><span class="slabel">No schedules</span><span class="grow"></span>
        <button class="btn small" data-act="add-pop">+ Add</button></div>`;
    }
    return `<div class="slot"><span class="chipn">Next</span><b>${esc(next.schedule.start)} – ${esc(endLabel(next.schedule))}</b><span class="grow"></span><span class="slabel">${esc(next.day)}</span></div>`;
  }

  /** Every schedule, read-only; tap one (or Edit) to edit it in the pop-up. */
  _renderInline(state, heading) {
    const runningAt = this._runningIndex(state);
    const nextAt = this._nextIndex();
    const rows = this._list.map((s, i) => this._renderRow(s, i, runningAt === i, "edit-pop", "", nextAt === i)).join("");
    return `
      ${heading ? `<div class="sect"><b>Schedules</b><button class="link" data-act="dialog">Edit</button></div>` : ""}
      ${rows || `<div class="slot"><span class="slabel">No schedules</span><span class="grow"></span><button class="btn small" data-act="add-pop">+ Add</button></div>`}
      ${heading ? "" : `<div class="foot"><button class="btn" data-act="dialog">Edit schedules</button></div>`}`;
  }

  /** The list index of the running schedule: the device's running one, if
   * it is still in the list unchanged (local edits may move or change it). */
  _runningIndex(state) {
    const running = state.attributes.running;
    if (!running) return -1;
    if (!this._dirty) return running - 1;
    const same = (a, b) => a && b && JSON.stringify(forAction(a)) === JSON.stringify(forAction(b));
    const original = this._baseline[running - 1];
    return this._list.findIndex((s) => same(s, original));
  }

  /** One schedule, always the same height: running shows inside it. */
  /** The list index of the schedule starting next, if within 24 hours. */
  _nextIndex() {
    const next = this._list ? nextRun(this._list, new Date()) : null;
    return next && next.inMinutes <= DAY ? this._list.indexOf(next.schedule) : -1;
  }

  _renderRow(s, i, isRunning, act, dim = "", isNext = false) {
    const end = endLabel(s);
    return `
        <div class="row ${dim}" data-act="${act}" data-index="${i}" role="button" tabindex="0" aria-label="Edit ${esc(s.start)} to ${esc(end)}">
          <b class="t">${esc(s.start)} – ${esc(end)}</b>
          <div class="days">${DAYS.map((d) => `<span class="d ${s.days.includes(d) ? "on" : ""}" title="${DAY_LABEL[d]}">${DAY_LETTER[d]}</span>`).join("")}</div>
          <div class="every">${isRunning ? `<span class="chipx">Running</span>` : isNext ? `<span class="chipn">Next</span>` : ""}every ${s.interval} min</div>
          ${isRunning ? `<button class="skipl" data-act="skip" ${this._busy || this._editing ? "disabled" : ""}>${this._busy === "skip" ? "Skipping…" : "Skip"}</button>` : "<span></span>"}
        </div>`;
  }

  /** The pop-up's list: edit in place, add, save. */
  _renderDialogList(state) {
    const editing = this._editing;
    const runningAt = this._runningIndex(state);
    const dim = editing ? "dim" : "";
    // Next is worked out from the list as it stands, edits included.
    const nextAt = this._nextIndex();
    const rows = this._list
      .map((s, i) => (editing && editing.index === i ? this._renderEditor() : this._renderRow(s, i, runningAt === i, "edit", dim, nextAt === i)))
      .join("");
    const adding = editing && editing.index < 0 ? this._renderEditor() : "";
    const off = this._busy || editing;
    const saveOff = off || !this._dirty;
    return `
      ${rows || (adding ? "" : `<div class="empty">No schedules.</div>`)}
      ${adding}
      <div class="foot">
        <button class="btn" data-act="add" ${this._list.length >= MAX_SCHEDULES || off ? "disabled" : ""}>+ Add schedule</button>
      </div>
      <div class="savebar ${editing ? "dim" : ""}">
        <span class="${this._dirty ? "" : "quiet"}">${this._dirty ? "Changes not saved" : "No changes"}${this._dirty && this._runningNow ? `<small>Stops the running schedule</small>` : ""}</span>
        <button class="btn" data-act="discard" ${saveOff ? "disabled" : ""}>Discard</button>
        <button class="btn primary" data-act="save" ${saveOff ? "disabled" : ""}>${this._busy === "save" ? "Saving…" : "Save"}</button>
      </div>
      ${this._conflict ? this._renderConflict() : ""}`;
  }

  // --- the schedules pop-up -------------------------------------------------

  _openDialog() {
    this._dialogOpen = true;
    this._confirmClose = false;
    this._error = null;
  }

  /** Close, unless there are unsaved changes: then ask first. */
  _closeDialog(force = false) {
    if (!force && (this._dirty || this._editing)) {
      this._confirmClose = true;
      this._render();
      return;
    }
    this._dialogOpen = false;
    this._confirmClose = false;
    this._editing = null;
    this._conflict = false;
    if (this._dirty) {
      this._dirty = false;
      this._reload();
    }
    if (this._dialog) {
      this._dialog.remove();
      this._dialog = null;
    }
  }

  _renderDialog() {
    const state = this._sched;
    if (!this._dialogOpen || !state) {
      if (this._dialog) this._closeDialog(true);
      return;
    }
    if (!this._dialog) {
      // On the page, not in the card: nothing around the card can clip it.
      this._dialog = document.createElement("div");
      this._dialog.attachShadow({ mode: "open" });
      this._dialog.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") this._closeDialog();
      });
      document.body.appendChild(this._dialog);
    }
    const unreachable = state.state === "unavailable";
    const sub = [this._areaName(), this._layout === "schedules" ? "" : this._deviceName()].filter(Boolean).join(" · ");
    const body = unreachable
      ? `<div class="banner">The device can't be reached right now.</div>`
      : this._list === null
        ? `<div class="banner">The schedules haven't been read yet.</div>`
        : this._renderDialogList(state);
    this._dialog.shadowRoot.innerHTML = `
      <style>${STYLE}${DIALOG_STYLE}</style>
      <div class="ov" data-act="backdrop">
        <div class="dlg" role="dialog" aria-modal="true" aria-label="Schedules" tabindex="-1">
          <div class="dh">
            <button class="x" data-act="close-dialog" aria-label="Close">✕</button>
            <div class="dtl"><b>Schedules</b><span>${esc(sub)}</span></div>
            <button class="icon" data-act="refresh" title="Read the schedules from the device" aria-label="Refresh" ${this._busy ? "disabled" : ""}>${this._busy === "refresh" ? "…" : svg(ICON.refresh)}</button>
          </div>
          ${this._list && !unreachable ? `<div class="used">${this._list.length} of ${MAX_SCHEDULES} used</div>` : ""}
          ${this._confirmClose ? `
          <div class="banner warn confirm">Discard your unsaved changes?
            <span><button class="btn" data-act="confirm-keep">Keep editing</button><button class="btn danger" data-act="confirm-discard">Discard</button></span>
          </div>` : ""}
          ${this._error ? `<div class="banner warn">${esc(this._error)}</div>` : ""}
          ${body}
        </div>
      </div>`;
    this._bind(this._dialog.shadowRoot);
    const dlg = this._dialog.shadowRoot.querySelector(".dlg");
    if (dlg && !this._dialog.contains(document.activeElement)) dlg.focus({ preventScroll: true });
  }

  _renderEditor() {
    const { index, schedule: s, error } = this._editing;
    const warn = this._runningNow
      ? `<div class="banner warn">A schedule is running. Saving any change stops it until its next start.</div>`
      : "";
    const r = rounded(s.start, s.end, s.interval);
    const nextDay = r.endMinutes > DAY;
    const hint = r.sprays >= 1
      ? `Ends at ${toHHMM(nextDay ? r.endMinutes - DAY : r.endMinutes)}${nextDay ? " the next day" : ""} (${r.sprays} spray${r.sprays === 1 ? "" : "s"})`
      : "";
    return `
      <div class="editor inline" role="group" aria-label="${index < 0 ? "Add schedule" : "Edit schedule"}">
        ${warn}
        <div class="etitle">${index < 0 ? "Add schedule" : `Edit schedule<small>${index + 1} of ${this._list.length}</small>`}</div>
        <div class="lbl"><span>Days</span>${DAY_PRESETS.map(([label], i) => `<button class="chip" data-act="days" data-preset="${i}">${label}</button>`).join("")}</div>
        <div class="dayrow">${DAYS.map((d) => `<button class="dt ${s.days.includes(d) ? "on" : ""}" data-act="day" data-day="${d}" aria-pressed="${s.days.includes(d)}" title="${DAY_LABEL[d]}">${DAY_LETTER[d]}</button>`).join("")}</div>
        <div class="lbl"><span>Time</span>${TIME_PRESETS.map(([label], i) => `<button class="chip" data-act="time" data-preset="${i}">${label}</button>`).join("")}</div>
        <div class="two">
          <label>Start<input type="time" data-act="start" value="${esc(s.start)}"></label>
          <label>End<input type="time" data-act="end" value="${esc(s.end)}"></label>
        </div>
        <div class="lbl"><span>Interval</span></div>
        <div class="seg">${INTERVALS.map((n) => `<button class="${s.interval === n ? "on" : ""}" data-act="interval" data-value="${n}">${n} min</button>`).join("")}</div>
        <div class="hint">${esc(hint)}</div>
        ${error ? `<div class="banner warn">${esc(error)}</div>` : ""}
        <div class="acts">
          ${index >= 0 ? `<button class="btn danger" data-act="delete">Delete</button>` : "<span></span>"}
          <span>
            <button class="btn" data-act="cancel">Cancel</button>
            <button class="btn primary" data-act="done">Done</button>
          </span>
        </div>
      </div>`;
  }

  _renderConflict() {
    return `
      <div class="editor" role="dialog" aria-label="Device schedules changed">
        <div class="etitle">Device schedules changed</div>
        <div>The schedules on the device changed after they were last read.</div>
        <div class="acts">
          <span></span>
          <span>
            <button class="btn" data-act="keep">Keep device schedules</button>
            <button class="btn primary" data-act="overwrite">Overwrite</button>
          </span>
        </div>
      </div>`;
  }

  // --- events ----------------------------------------------------------------

  _onAction(ev, el) {
    const act = el.dataset.act;
    if (act !== "edit" && act !== "edit-pop" && act !== "backdrop") ev.stopPropagation();
    const e = this._editing;
    if (act !== "menu") this._menu = false;
    switch (act) {
      case "menu":
        this._menu = !this._menu;
        break;
      case "press": {
        const id = el.dataset.entity;
        if (id) this._control(id === this._ents.spray ? "spray" : "press", "button", "press", { entity_id: id });
        return;
      }
      case "auto":
        // Sent even while a schedule runs: the integration refuses it, and
        // Home Assistant's toast says why.
        if (this._ents.auto) this._control("auto", "select", "select_option", { entity_id: this._ents.auto, option: el.dataset.option });
        return;
      case "info":
        this._moreInfo(el.dataset.entity);
        return;
      case "dialog":
        this._openDialog();
        break;
      case "edit-pop":
      case "add-pop": {
        if (this._busy) return;
        this._openDialog();
        if (act === "add-pop") {
          this._editing = { index: -1, schedule: { days: ["mon", "tue", "wed", "thu", "fri"], start: "07:00", end: "10:00", interval: 20 }, error: null };
        } else {
          const i = Number(el.dataset.index);
          const s = this._list[i];
          this._editing = { index: i, schedule: { ...s, days: [...s.days] }, error: null };
        }
        break;
      }
      case "backdrop":
        if (ev.target !== el) return; // a click inside the dialog
        this._closeDialog();
        return;
      case "close-dialog":
        this._closeDialog();
        return;
      case "confirm-keep":
        this._confirmClose = false;
        break;
      case "confirm-discard":
        this._closeDialog(true);
        this._render();
        return;
      case "refresh":
        {
          const { domain, service, target } = this._refreshCall;
          this._call("refresh", service, {}, domain, target);
        }
        return;
      case "skip":
        this._call("skip", "stop_schedule", { schedule: "current" });
        return;
      case "add":
        this._editing = { index: -1, schedule: { days: ["mon", "tue", "wed", "thu", "fri"], start: "07:00", end: "10:00", interval: 20 }, error: null };
        break;
      case "edit": {
        if (this._busy || this._editing) return;
        const i = Number(el.dataset.index);
        const s = this._list[i];
        this._editing = { index: i, schedule: { ...s, days: [...s.days] }, error: null };
        break;
      }
      case "day": {
        const d = el.dataset.day;
        e.schedule.days = e.schedule.days.includes(d) ? e.schedule.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || e.schedule.days.includes(x));
        break;
      }
      case "days":
        e.schedule.days = [...DAY_PRESETS[Number(el.dataset.preset)][1]];
        break;
      case "time": {
        const [, start, end] = TIME_PRESETS[Number(el.dataset.preset)];
        Object.assign(e.schedule, { start, end });
        break;
      }
      case "start":
      case "end":
        if (el.value) e.schedule[act] = el.value.slice(0, 5);
        break;
      case "interval":
        e.schedule.interval = Number(el.dataset.value);
        break;
      case "cancel":
        this._editing = null;
        break;
      case "delete":
        this._list.splice(e.index, 1);
        this._dirty = true;
        this._editing = null;
        break;
      case "done": {
        const problem = problems(e.schedule, this._list, e.index);
        if (problem) {
          e.error = problem;
          break;
        }
        if (e.index < 0) this._list.push(e.schedule);
        else this._list[e.index] = e.schedule;
        this._dirty = true;
        this._editing = null;
        break;
      }
      case "discard":
        this._dirty = false;
        this._reload();
        return;
      case "save":
        this._save(false);
        return;
      case "overwrite":
        this._save(true);
        return;
      case "keep":
        this._keepDevice();
        return;
      default:
        return;
    }
    if (this._editing) this._editing.error = act === "done" ? this._editing.error : null;
    this._render();
  }
}



const DIALOG_STYLE = `
  .ov { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.55); }
  .dlg { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: 480px; max-width: calc(100vw - 32px); max-height: 88vh; overflow: auto;
         padding: 0 20px 20px; border-radius: 24px; outline: none; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
         background: var(--card-background-color, #fff); color: var(--primary-text-color); font-family: var(--ha-font-family-body, Roboto, sans-serif); }
  .dh { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 14px 0 4px; background: var(--card-background-color, #fff); }
  .dh .x { width: 40px; height: 40px; border-radius: 20px; border: none; background: none; color: var(--primary-text-color); font-size: 20px; }
  .dtl { flex-grow: 1; min-width: 0; }
  .dtl b { display: block; font-size: 20px; font-weight: 400; }
  .dtl span { display: block; font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .savebar { position: sticky; bottom: 0; }
  .confirm { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .confirm span { display: flex; gap: 8px; }
  @media (max-width: 600px) {
    .ov { align-items: stretch; }
    .dlg { width: 100%; max-width: none; max-height: none; height: 100%; border-radius: 0; padding: 0 16px 16px; }
  }
`;

const STYLE = `
  ha-card { padding: 16px; display: flex; flex-direction: column; gap: 10px; position: relative; container-type: inline-size; }
  .top { display: flex; align-items: flex-start; gap: 6px; position: relative; }
  .top .names { flex-grow: 1; min-width: 0; }
  .area { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .top .title { font-size: 20px; }
  .more { width: 36px; height: 36px; border-radius: 18px; border: none; background: none; color: var(--secondary-text-color); display: inline-flex; align-items: center; justify-content: center; }
  .icon { display: inline-flex; align-items: center; justify-content: center; }
  .menu { position: absolute; right: 0; top: 40px; z-index: 2; display: flex; flex-direction: column; min-width: 180px; padding: 6px 0;
          background: var(--card-background-color); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
  .menu button { text-align: left; padding: 10px 16px; border: none; background: none; color: var(--primary-text-color); font-size: 14px; }
  .menu button:hover { background: var(--secondary-background-color); }
  .strip { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 8px 12px; border-radius: 14px; background: var(--secondary-background-color); }
  .mode { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 14px; font-size: 13px; font-weight: 500;
          background: color-mix(in srgb, var(--primary-color) 22%, var(--card-background-color)); color: var(--primary-text-color); }
  .mode i { width: 7px; height: 7px; border-radius: 4px; background: var(--primary-color); display: inline-block; }
  .mode.m-idle i { background: var(--success-color, #43a047); }
  .mode.m-disconnected i { background: var(--error-color); }
  .kv { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: none; background: none; font-size: 15px; color: var(--primary-text-color); }
  .kv svg { color: var(--state-icon-color, var(--primary-color)); }
  .kv.low, .kv.low svg { color: var(--error-color); }
  .strip .ago { margin-left: auto; font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
  .ctrl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: end; }
  .sprayb { min-height: 44px; padding: 0 16px; border-radius: 22px; border: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; font-weight: 500;
            background: color-mix(in srgb, var(--primary-color) 22%, var(--card-background-color)); color: var(--primary-text-color); }
  .autow { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .tiny { font-size: 11px; color: var(--secondary-text-color); margin-left: 12px; }
  .seg4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--divider-color); border-radius: 22px; overflow: hidden; }
  .seg4 button { min-height: 44px; border: none; border-right: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); font-size: 15px; font-weight: 500; }
  .seg4 button:last-child { border-right: none; }
  .seg4 button.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .seg4.held button { opacity: 0.5; }
  .seg4.held button.on { opacity: 0.75; }
  @container (max-width: 340px) { .ctrl { grid-template-columns: 1fr; } }
  .sect { display: flex; align-items: baseline; gap: 8px; margin-top: 4px; }
  .sect b { flex-grow: 1; font-size: 15px; font-weight: 500; color: var(--primary-text-color); }
  .used { font-size: 13px; color: var(--secondary-text-color); }
  .row { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; gap: 4px 8px; align-items: center; min-height: 62px; box-sizing: border-box; }
  .row .t { font-size: 15px; font-weight: 500; color: var(--primary-text-color); }
  .row .every { display: flex; align-items: center; gap: 6px; height: 20px; font-size: 13px; color: var(--secondary-text-color); }
  .chipx { font-size: 11px; font-weight: 600; padding: 0 8px; border-radius: 10px; line-height: 18px; background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .chipn { font-size: 11px; font-weight: 600; padding: 0 7px; border-radius: 10px; line-height: 16px; border: 1px solid var(--primary-color); color: var(--primary-color); }
  .skipl { justify-self: end; height: 20px; padding: 0; border: none; background: none; color: var(--primary-color); font-size: 13px; font-weight: 500; }
  .slot { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 8px 0 12px; border-radius: 12px; background: var(--secondary-background-color); font-size: 14px; }
  .slot b { font-weight: 500; font-size: 15px; color: var(--primary-text-color); }
  .slot .grow { flex-grow: 1; }
  .slot .slabel { color: var(--secondary-text-color); }
  .slot .pill { font-size: 12px; padding: 3px 10px; }
  .btn.small { min-height: 32px; padding: 0 14px; font-size: 13px; }
  .link { border: none; background: none; padding: 6px 0; color: var(--primary-color); font-size: 14px; font-weight: 500; }

  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .title { font-size: 18px; font-weight: 500; color: var(--primary-text-color); }
  .sub { font-size: 13px; color: var(--secondary-text-color); }
  .note, .empty, .hint { font-size: 13px; color: var(--secondary-text-color); }
  .banner { font-size: 13px; padding: 8px 12px; border-radius: 10px; background: var(--secondary-background-color); color: var(--primary-text-color); }
  .banner.warn { border-left: 4px solid var(--error-color); }
  .row { padding: 10px 12px; border-radius: 12px;
         background: var(--secondary-background-color); cursor: pointer; }
  .dim { opacity: 0.45; pointer-events: none; }
  .editor.inline { border: 2px solid var(--primary-color); }
  .savebar .quiet { font-weight: 400; color: var(--secondary-text-color); }
  .hicon { color: var(--state-icon-color, var(--primary-color)); --mdc-icon-size: 24px; }
  .names { flex-grow: 1; display: flex; flex-direction: column; min-width: 0; }
  .days { display: flex; gap: 2px; }
  .d { width: 20px; height: 20px; border-radius: 10px; font-size: 11px; display: inline-flex; align-items: center; justify-content: center;
       border: 1px solid var(--divider-color); color: var(--secondary-text-color); }
  .d.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
  .pill { font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: 12px; background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .foot { display: flex; justify-content: flex-end; }
  .savebar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; background: var(--secondary-background-color); }
  .savebar span { flex-grow: 1; font-size: 14px; font-weight: 500; color: var(--primary-text-color); }
  .savebar small { display: block; font-size: 12px; font-weight: 400; color: var(--error-color); }
  button { font: inherit; cursor: pointer; }
  button[disabled] { opacity: 0.45; cursor: default; }
  .btn { min-height: 36px; padding: 0 14px; border-radius: 18px; border: 1px solid var(--divider-color); background: none; color: var(--primary-color); font-size: 14px; font-weight: 500; }
  .btn.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
  .btn.danger { color: var(--error-color); }
  .icon { width: 36px; height: 36px; border-radius: 18px; border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); font-size: 18px; }
  .editor { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; border: 1px solid var(--divider-color);
            background: var(--card-background-color); color: var(--primary-text-color); font-size: 14px; }
  .etitle { font-size: 17px; font-weight: 500; }
  .etitle small { font-size: 13px; font-weight: 400; color: var(--secondary-text-color); margin-left: 6px; }
  .lbl { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-weight: 500; }
  .lbl span { flex-grow: 1; }
  .chip { font-size: 12px; padding: 4px 10px; border-radius: 12px; border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); }
  .dayrow { display: flex; justify-content: space-between; gap: 4px; }
  .dt { width: 40px; height: 40px; border-radius: 20px; border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); font-weight: 500; }
  .dt.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
  .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .two label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--secondary-text-color); }
  .two input { min-height: 40px; border-radius: 10px; border: 1px solid var(--divider-color); padding: 0 10px; font: inherit; font-size: 16px;
               background: var(--card-background-color); color: var(--primary-text-color); }
  .seg { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--divider-color); border-radius: 18px; overflow: hidden; }
  .seg button { min-height: 40px; border: none; border-right: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); }
  .seg button:last-child { border-right: none; }
  .seg button.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .acts { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .acts span { display: flex; gap: 8px; }
`;

/** Schedules sensors: the godrej_aer sensors that carry a schedule list. */
const scheduleSensors = (hass) =>
  Object.keys(hass.states).filter(
    (id) => id.startsWith("sensor.") && Array.isArray(hass.states[id].attributes.schedules)
  );

/** The card's visual editor: pick the device's Schedules sensor, and a title. */
class GodrejAerScheduleCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  _update() {
    if (!this._config || !this._hass) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (field) =>
        ({ entity: "Schedules sensor", title: "Title (optional)" })[field.name] || field.name;
      this._form.computeHelper = (field) =>
        field.name === "entity" ? "The device's Schedules sensor, from the godrej_aer integration." : undefined;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { ...ev.detail.value };
        if (!config.title) delete config.title;
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = [
      { name: "entity", required: true, selector: { entity: { include_entities: scheduleSensors(this._hass) } } },
      { name: "title", selector: { text: {} } },
    ];
  }
}


/** The card's visual editor: pick the device, and an optional title. */
class GodrejAerCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  _update() {
    if (!this._config || !this._hass) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (field) => ({ device: "Device", title: "Title (optional)", show_schedules: "Show every schedule on the card" })[field.name] || field.name;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { ...ev.detail.value };
        if (!config.title) delete config.title;
        delete config.entity; // a device replaces the old Schedules-sensor setting
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = [
      { name: "device", required: true, selector: { device: { filter: DOMAINS.map((integration) => ({ integration })) } } },
      { name: "title", selector: { text: {} } },
      { name: "show_schedules", selector: { boolean: {} } },
    ];
  }
}

/** The old schedule card: the same card, schedules only. */
class GodrejAerScheduleCard extends GodrejAerCard {
  constructor() {
    super();
    this._layout = "schedules";
  }

  static getConfigElement() {
    return document.createElement("godrej-aer-schedule-card-editor");
  }

  static getStubConfig(hass) {
    return { entity: scheduleSensors(hass)[0] || "sensor.living_room_schedules" };
  }
}

customElements.define("godrej-aer-card", GodrejAerCard);
customElements.define("godrej-aer-card-editor", GodrejAerCardEditor);
// Dashboards set up with the old schedule card keep working.
customElements.define("godrej-aer-schedule-card", GodrejAerScheduleCard);
customElements.define("godrej-aer-schedule-card-editor", GodrejAerScheduleCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "godrej-aer-card",
  name: "Card for Godrej Aer Smart Matic",
  description: "Status, Spray now, Auto spray and the schedules of a Godrej Aer Smart Matic.",
  preview: true, // the card picker shows it live, with the first device
  documentationURL: "https://github.com/rgitha/godrej-aer-card",
  // HA 2026.6+: offered under "Community" when adding a card by entity.
  getEntitySuggestion: (hass, entityId) => {
    const entry = hass.entities && hass.entities[entityId];
    return entry && DOMAINS.includes(entry.platform) && entry.device_id
      ? { label: "Card for Godrej Aer Smart Matic", config: { type: "custom:godrej-aer-card", device: entry.device_id } }
      : null;
  },
});
console.info(`%c AER-CARD %c ${CARD_VERSION} `, "color: white; background: #0E6B5C", "");
