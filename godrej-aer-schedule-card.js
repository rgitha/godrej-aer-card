/*
 * Schedule card for Godrej Aer Smart Matic
 * A Home Assistant dashboard card to view and edit the spray schedules stored
 * on a Godrej Aer Smart Matic, through the godrej_aer integration.
 *
 * Copyright 2026 Rgitha. Licensed under the Apache License, Version 2.0.
 */

const CARD_VERSION = "0.2.3";
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

class GodrejAerScheduleCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._list = null; // the list shown (edited copy while dirty)
    this._baseline = null; // the device's list the edits started from
    this._dirty = false;
    this._editing = null; // { index, schedule, error }
    this._conflict = false;
    this._busy = null; // "save" | "refresh" | "skip"
    this._error = null;
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Set 'entity' to a device's Schedules sensor, e.g. sensor.living_room_schedules");
    }
    this._config = config;
    this._render();
  }

  static getConfigElement() {
    return document.createElement("godrej-aer-schedule-card-editor");
  }

  static getStubConfig(hass) {
    return { entity: scheduleSensors(hass)[0] || "sensor.living_room_schedules" };
  }

  getCardSize() {
    return 3 + (this._list ? this._list.length : 0);
  }

  set hass(hass) {
    const state = hass.states[this._config.entity];
    // HA sets hass on every state change anywhere; redraw only for ours, so
    // an open editor keeps its focus.
    const unchanged = this._hass && state === this._state;
    this._hass = hass;
    if (unchanged && !this._forceRender) return;
    this._forceRender = false;
    this._state = state;
    if (state && !this._dirty) {
      this._list = (state.attributes.schedules || []).map(fromAttribute);
      this._baseline = this._list.map((s) => ({ ...s, days: [...s.days] }));
    }
    this._render();
  }

  /** The number of the schedule the device is running now, if any. */
  get _runningNow() {
    const state = this._state;
    return (state && state.state !== "unavailable" && state.attributes.running) || null;
  }

  // --- device actions -------------------------------------------------------

  get _domain() {
    const entry = this._hass.entities && this._hass.entities[this._config.entity];
    return (entry && entry.platform) || "godrej_aer";
  }

  get _target() {
    const entry = this._hass.entities && this._hass.entities[this._config.entity];
    return entry && entry.device_id ? { device_id: entry.device_id } : { entity_id: this._config.entity };
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
    return { domain: "homeassistant", service: "update_entity", target: { entity_id: this._config.entity } };
  }

  async _call(kind, service, data, domain = this._domain, target = this._target) {
    this._busy = kind;
    this._error = null;
    this._render();
    try {
      await this._hass.callService(domain, service, data, target);
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
    const state = this._state;
    const name = this._config.title || (state && (state.attributes.friendly_name || "").replace(/\s*Schedules$/i, "")) || "Schedules";
    let body;
    if (!this._hass) {
      body = "";
    } else if (!state) {
      body = `<div class="banner warn">Entity ${esc(this._config.entity)} not found.</div>`;
    } else if (state.state === "unavailable") {
      body = `<div class="banner">The device can't be reached right now.</div>`;
    } else if (this._list === null || state.state === "unknown") {
      body = `<div class="banner">The schedules haven't been read yet.</div>`;
    } else {
      body = this._renderList(state);
    }
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="head">
          <ha-icon class="hicon" icon="mdi:calendar-clock"></ha-icon>
          <div class="names">
            <div class="title">${esc(name)}</div>
            <div class="sub">${this._list && state && state.state !== "unavailable" ? `${this._list.length} of ${MAX_SCHEDULES} used · ` : ""}read ${esc(ago(state && state.attributes.last_read))}</div>
          </div>
          <button class="icon" data-act="refresh" title="Read the schedules from the device" aria-label="Refresh" ${this._busy ? "disabled" : ""}>${this._busy === "refresh" ? "…" : "⟳"}</button>
        </div>
        ${this._error ? `<div class="banner warn">${esc(this._error)}</div>` : ""}
        ${body}
        ${this._editing && state && state.state !== "unavailable" ? this._renderEditor() : ""}
        ${this._conflict ? this._renderConflict() : ""}
      </ha-card>`;
    this.shadowRoot.querySelectorAll("[data-act]").forEach((el) => {
      el.addEventListener(el.tagName === "INPUT" ? "change" : "click", (ev) => this._onAction(ev, el));
    });
  }

  _renderList(state) {
    const running = this._dirty ? null : state.attributes.running;
    const rows = this._list
      .map((s, i) => {
        const isRunning = running === i + 1;
        const isEditing = this._editing && this._editing.index === i;
        const end = endLabel(s);
        return `
        <div class="row ${isRunning ? "running" : ""} ${isEditing ? "editing" : ""}" data-act="edit" data-index="${i}" role="button" tabindex="0" aria-label="Edit ${esc(s.start)} to ${esc(end)}">
          <div class="when"><b>${esc(s.start)} – ${esc(end)}</b><span>every ${s.interval} min</span></div>
          <div class="days">${DAYS.map((d) => `<span class="d ${s.days.includes(d) ? "on" : ""}" title="${DAY_LABEL[d]}">${DAY_LETTER[d]}</span>`).join("")}</div>
          ${isRunning ? `<div class="runline"><span class="pill">Running now</span><button class="btn" data-act="skip" ${this._busy ? "disabled" : ""}>${this._busy === "skip" ? "Skipping…" : "Skip this run"}</button></div>` : ""}
        </div>`;
      })
      .join("");
    return `
      ${rows || `<div class="empty">No schedules.</div>`}
      <div class="foot">
        <button class="btn" data-act="add" ${this._list.length >= MAX_SCHEDULES || this._busy ? "disabled" : ""}>+ Add schedule</button>
      </div>
      ${this._dirty ? `
      <div class="savebar">
        <span>Not saved to device${this._runningNow ? `<small>Stops the running schedule</small>` : ""}</span>
        <button class="btn" data-act="discard" ${this._busy ? "disabled" : ""}>Discard</button>
        <button class="btn primary" data-act="save" ${this._busy ? "disabled" : ""}>${this._busy === "save" ? "Saving…" : "Save"}</button>
      </div>` : ""}`;
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
      <div class="editor" role="dialog" aria-label="${index < 0 ? "Add schedule" : "Edit schedule"}">
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
    if (act !== "edit") ev.stopPropagation();
    const e = this._editing;
    switch (act) {
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
        if (this._busy) return;
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

const STYLE = `
  ha-card { padding: 16px; display: flex; flex-direction: column; gap: 10px; position: relative; }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .title { font-size: 18px; font-weight: 500; color: var(--primary-text-color); }
  .sub { font-size: 13px; color: var(--secondary-text-color); }
  .note, .empty, .hint { font-size: 13px; color: var(--secondary-text-color); }
  .banner { font-size: 13px; padding: 8px 12px; border-radius: 10px; background: var(--secondary-background-color); color: var(--primary-text-color); }
  .banner.warn { border-left: 4px solid var(--error-color); }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 12px;
         background: var(--secondary-background-color); cursor: pointer; }
  .row.editing { outline: 2px solid var(--primary-color); }
  .hicon { color: var(--state-icon-color, var(--primary-color)); --mdc-icon-size: 24px; }
  .names { flex-grow: 1; display: flex; flex-direction: column; min-width: 0; }
  .when b { display: block; font-size: 15px; font-weight: 500; color: var(--primary-text-color); }
  .when span { font-size: 13px; color: var(--secondary-text-color); }
  .days { display: flex; gap: 2px; }
  .d { width: 20px; height: 20px; border-radius: 10px; font-size: 11px; display: inline-flex; align-items: center; justify-content: center;
       border: 1px solid var(--divider-color); color: var(--secondary-text-color); }
  .d.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
  .runline { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
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

customElements.define("godrej-aer-schedule-card", GodrejAerScheduleCard);
customElements.define("godrej-aer-schedule-card-editor", GodrejAerScheduleCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "godrej-aer-schedule-card",
  name: "Schedule card for Godrej Aer Smart Matic",
  description: "View and edit the spray schedules stored on a Godrej Aer Smart Matic.",
  preview: true, // the card picker shows it live, with the first Schedules sensor
  documentationURL: "https://github.com/rgitha/godrej-aer-schedule-card",
  // HA 2026.6+: offered under "Community" when adding a card by entity, for
  // Schedules sensors only.
  getEntitySuggestion: (hass, entityId) =>
    scheduleSensors(hass).includes(entityId)
      ? { label: "Schedule card for Godrej Aer Smart Matic", config: { type: "custom:godrej-aer-schedule-card", entity: entityId } }
      : null,
});
console.info(`%c AER-SCHEDULE-CARD %c ${CARD_VERSION} `, "color: white; background: #0E6B5C", "");
