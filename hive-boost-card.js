class HiveBoostCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._stages = ["Off", "30m", "1h", "1.5h", "2h"];
    this._durations = {
      "30m": "00:30:00",
      "1h": "01:00:00",
      "1.5h": "01:30:00",
      "2h": "02:00:00",
    };
    this._durationSeconds = {
      "30m": 30 * 60,
      "1h": 60 * 60,
      "1.5h": 90 * 60,
      "2h": 120 * 60,
    };
    this._state = { z1: "Off", z2: "Off", z3: "Off", z4: "Off", water: "Off" };
    this._endTimes = { z1: null, z2: null, z3: null, z4: null, water: null };
    this._prevActive = { z1: false, z2: false, z3: false, z4: false, water: false };
    this._holdTimers = {};
    this._holdTriggered = {};
    this._debounceTimers = {};
    this._pending = {};
    this._tickInterval = null;
  }

  connectedCallback() {
    if (!this._tickInterval) {
      this._tickInterval = setInterval(() => this._updateUI(), 1000);
    }
  }

  disconnectedCallback() {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  static getConfigElement() {
    return document.createElement("hive-boost-card-editor");
  }

  static getStubConfig() {
    return {
      zone_count: 2,
      temperature: 21.0,
      zone_1_name: "",
      zone_1_climate: "",
      zone_1_sensor: "",
      zone_2_name: "",
      zone_2_climate: "",
      zone_2_sensor: "",
      include_water: true,
      water_name: "",
      water_entity: "",
      water_sensor: "",
      include_cancel_all: true,
      cancel_all_name: "",
    };
  }

  _normalizeConfig(raw) {
    const cfg = { ...raw };

    if (cfg.zone_count === undefined) {
      const hasLegacy = cfg.up_climate || cfg.down_climate || cfg.up_name || cfg.down_name;
      cfg.zone_count = hasLegacy ? 2 : 2;
    }
    if (!cfg.zone_1_climate && cfg.up_climate) cfg.zone_1_climate = cfg.up_climate;
    if (!cfg.zone_1_sensor && cfg.up_sensor) cfg.zone_1_sensor = cfg.up_sensor;
    if (!cfg.zone_1_name && cfg.up_name) cfg.zone_1_name = cfg.up_name;

    if (!cfg.zone_2_climate && cfg.down_climate) cfg.zone_2_climate = cfg.down_climate;
    if (!cfg.zone_2_sensor && cfg.down_sensor) cfg.zone_2_sensor = cfg.down_sensor;
    if (!cfg.zone_2_name && cfg.down_name) cfg.zone_2_name = cfg.down_name;

    if (cfg.include_water === undefined) cfg.include_water = true;
    if (cfg.include_cancel_all === undefined) cfg.include_cancel_all = true;
    if (cfg.temperature === undefined) cfg.temperature = 21.0;

    return cfg;
  }

  setConfig(config) {
    this._config = this._normalizeConfig(config);
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._syncExternalResets();
    this._updateUI();
  }

  _getZoneList() {
    if (!this._config) return [];
    const count = Number(this._config.zone_count ?? 2);
    const list = [];
    for (let i = 1; i <= count; i++) {
      const key = `z${i}`;
      const climate = this._config[`zone_${i}_climate`];
      const customName = (this._config[`zone_${i}_name`] || "").trim();
      const friendlyName = climate && this._hass?.states[climate]?.attributes?.friendly_name;
      list.push({
        key,
        index: i,
        name: customName || friendlyName || `Zone ${i}`,
        climate,
        sensor: this._config[`zone_${i}_sensor`],
        onIcon: "mdi:fire",
        offIcon: "mdi:fire-off",
      });
    }
    return list;
  }

  _getWaterConfig() {
    const entity = this._config.water_entity;
    const customName = (this._config.water_name || "").trim();
    const friendlyName = entity && this._hass?.states[entity]?.attributes?.friendly_name;
    return {
      key: "water",
      name: customName || friendlyName || "Hot Water Boost",
      entity,
      sensor: this._config.water_sensor,
      onIcon: "mdi:water-boiler",
      offIcon: "mdi:water-boiler-off",
    };
  }

  _syncExternalResets() {
    if (!this._hass || !this._config) return;
    const items = [
      ...this._getZoneList().map((z) => ({ key: z.key, sensor: z.sensor })),
      { key: "water", sensor: this._config.water_sensor },
    ];

    items.forEach(({ key, sensor }) => {
      if (!sensor || !this._hass.states[sensor]) return;
      const isActive = this._hass.states[sensor].state === "on";
      if (this._prevActive[key] && !isActive && !this._pending[key]) {
        this._state[key] = "Off";
        this._endTimes[key] = null;
      }
      this._prevActive[key] = isActive;
    });
  }

  _parseRemainingSeconds(sensorId, key) {
    if (sensorId && this._hass?.states[sensorId]) {
      const st = this._hass.states[sensorId];
      if (st.state === "on") {
        const attrs = st.attributes || {};
        const raw =
          attrs.boost_time_remaining ??
          attrs.time_remaining ??
          attrs.remaining_time ??
          attrs.minutes_remaining;
        if (raw !== undefined && raw !== null) {
          if (typeof raw === "number") {
            return Math.max(0, Math.round(raw * 60));
          }
          if (typeof raw === "string") {
            if (raw.includes(":")) {
              const parts = raw.split(":").map(Number);
              if (parts.length === 3 && !parts.some(isNaN)) {
                return parts[0] * 3600 + parts[1] * 60 + parts[2];
              }
              if (parts.length === 2 && !parts.some(isNaN)) {
                return parts[0] * 60 + parts[1];
              }
            }
            const num = parseFloat(raw);
            if (!isNaN(num)) {
              return Math.max(0, Math.round(num * 60));
            }
          }
        }
        const endsAt = attrs.ends_at ?? attrs.boost_end ?? attrs.end_time;
        if (endsAt) {
          const ts = Date.parse(endsAt);
          if (!isNaN(ts)) {
            return Math.max(0, Math.round((ts - Date.now()) / 1000));
          }
        }
      }
    }

    if (this._endTimes[key]) {
      const diff = Math.round((this._endTimes[key] - Date.now()) / 1000);
      if (diff <= 0) {
        this._endTimes[key] = null;
        this._state[key] = "Off";
        return 0;
      }
      return diff;
    }
    return null;
  }

  _formatCountdown(totalSeconds) {
    if (totalSeconds === null || totalSeconds <= 0) return null;
    if (totalSeconds < 60) {
      return `${totalSeconds}s left`;
    }
    const totalMinutes = Math.ceil(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
    }
    return `${mins}m left`;
  }

  _executeStageService(key, stage) {
    if (!this._hass || !this._config) return;

    if (stage === "Off") {
      this._endTimes[key] = null;
    } else if (this._durationSeconds[stage]) {
      this._endTimes[key] = Date.now() + this._durationSeconds[stage] * 1000;
    }

    if (key === "water") {
      const entity = this._config.water_entity;
      if (!entity) return;
      if (stage === "Off") {
        this._hass.callService("hive", "boost_hot_water_off", { entity_id: entity });
      } else {
        this._hass.callService("hive", "boost_hot_water_on", {
          entity_id: entity,
          time_period: this._durations[stage],
          on_off: "on",
        });
      }
    } else {
      const idx = Number(key.replace("z", ""));
      const entity = this._config[`zone_${idx}_climate`];
      if (!entity) return;
      if (stage === "Off") {
        this._hass.callService("hive", "boost_heating_off", { entity_id: entity });
      } else {
        this._hass.callService("hive", "boost_heating_on", {
          entity_id: entity,
          time_period: this._durations[stage],
          temperature: Number(this._config.temperature || 21.0),
        });
      }
    }
  }

  _handleTap(key) {
    if (!this._hass || !this._config) return;
    const currentIdx = this._stages.indexOf(this._state[key]);
    const nextStage = this._stages[(currentIdx + 1) % this._stages.length];
    this._state[key] = nextStage;
    this._pending[key] = true;
    this._updateUI();

    if (this._debounceTimers[key]) {
      clearTimeout(this._debounceTimers[key]);
    }
    this._debounceTimers[key] = setTimeout(() => {
      this._pending[key] = false;
      this._executeStageService(key, this._state[key]);
      this._updateUI();
    }, 1500);
  }

  _handleHold(key) {
    if (!this._hass || !this._config) return;
    if (this._debounceTimers[key]) {
      clearTimeout(this._debounceTimers[key]);
      this._debounceTimers[key] = null;
    }
    this._pending[key] = false;
    this._state[key] = "Off";
    this._endTimes[key] = null;
    this._updateUI();
    this._executeStageService(key, "Off");
  }

  _handleCancelAll() {
    if (!this._hass || !this._config) return;
    const zones = this._getZoneList();
    zones.forEach((z) => {
      if (this._debounceTimers[z.key]) {
        clearTimeout(this._debounceTimers[z.key]);
        this._debounceTimers[z.key] = null;
      }
      this._pending[z.key] = false;
      this._state[z.key] = "Off";
      this._endTimes[z.key] = null;
      if (z.climate) {
        this._hass.callService("hive", "boost_heating_off", { entity_id: z.climate });
      }
    });

    if (this._config.include_water) {
      if (this._debounceTimers.water) {
        clearTimeout(this._debounceTimers.water);
        this._debounceTimers.water = null;
      }
      this._pending.water = false;
      this._state.water = "Off";
      this._endTimes.water = null;
      if (this._config.water_entity) {
        this._hass.callService("hive", "boost_hot_water_off", {
          entity_id: this._config.water_entity,
        });
      }
    }
    this._updateUI();
  }

  _bindEvents(el, key) {
    const start = () => {
      this._holdTriggered[key] = false;
      this._holdTimers[key] = setTimeout(() => {
        this._holdTriggered[key] = true;
        this._handleHold(key);
      }, 650);
    };
    const end = () => {
      clearTimeout(this._holdTimers[key]);
      if (!this._holdTriggered[key]) {
        this._handleTap(key);
      }
    };
    const cancel = () => clearTimeout(this._holdTimers[key]);

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointerleave", cancel);
  }

  _render() {
    const zones = this._getZoneList();
    const showWater = Boolean(this._config.include_water);
    const showCancelAll = Boolean(this._config.include_cancel_all);
    const gridCols = zones.length <= 1 ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)";
    const bottomCols =
      showWater && showCancelAll ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)";

    const zoneCardsHtml = zones
      .map(
        (z) => `
        <ha-card id="card-${z.key}">
          <div class="icon-wrap" id="icon-${z.key}"><ha-icon icon="mdi:fire-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-${z.key}"></div>
            <div class="secondary" id="sub-${z.key}">Off</div>
          </div>
        </ha-card>
      `
      )
      .join("");

    const waterCardHtml = showWater
      ? `
        <ha-card id="card-water">
          <div class="icon-wrap" id="icon-water"><ha-icon icon="mdi:water-boiler-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-water"></div>
            <div class="secondary" id="sub-water">Off</div>
          </div>
        </ha-card>
      `
      : "";

    const cancelAllHtml = showCancelAll
      ? `
        <ha-card id="card-cancel-all">
          <div class="icon-wrap" id="icon-cancel-all"><ha-icon icon="mdi:close-circle-outline"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-cancel-all"></div>
            <div class="secondary" id="sub-cancel-all">No active boosts</div>
          </div>
        </ha-card>
      `
      : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; min-width: 0; max-width: 100%; }
        .grid { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
        .row { display: grid; grid-template-columns: ${gridCols}; gap: 10px; min-width: 0; }
        .bottom-row { display: grid; grid-template-columns: ${bottomCols}; gap: 10px; min-width: 0; }
        ha-card {
          display: flex; align-items: center; gap: 12px;
          padding: 12px; cursor: pointer; user-select: none;
          min-width: 0; overflow: hidden; box-sizing: border-box;
          transition: transform 0.1s ease;
        }
        ha-card:active { transform: scale(0.98); }
        .icon-wrap {
          width: 40px; height: 40px; min-width: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: rgba(158, 158, 158, 0.15); color: var(--secondary-text-color);
          transition: background 0.2s, color 0.2s;
        }
        .icon-wrap.active {
          background: rgba(255, 87, 34, 0.2); color: #ff5722;
        }
        .icon-wrap.cancel-active {
          background: rgba(244, 67, 54, 0.18); color: #f44336;
        }
        .icon-wrap.pending {
          animation: pulse 0.9s infinite ease-in-out;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        .info { display: flex; flex-direction: column; min-width: 0; flex: 1; overflow: hidden; }
        .primary {
          font-weight: 500; font-size: 14px; color: var(--primary-text-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .secondary {
          font-size: 12px; color: var(--secondary-text-color); margin-top: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
      </style>
      <div class="grid">
        ${zones.length > 0 ? `<div class="row">${zoneCardsHtml}</div>` : ""}
        ${showWater || showCancelAll ? `<div class="bottom-row">${waterCardHtml}${cancelAllHtml}</div>` : ""}
      </div>
    `;

    zones.forEach((z) => {
      const el = this.shadowRoot.getElementById(`card-${z.key}`);
      if (el) this._bindEvents(el, z.key);
    });
    if (showWater) {
      const waterEl = this.shadowRoot.getElementById("card-water");
      if (waterEl) this._bindEvents(waterEl, "water");
    }
    if (showCancelAll) {
      const cancelEl = this.shadowRoot.getElementById("card-cancel-all");
      if (cancelEl) {
        cancelEl.addEventListener("click", () => this._handleCancelAll());
      }
    }
    this._updateUI();
  }

  _updateUI() {
    if (!this._config) return;
    let anyActive = false;

    const zones = this._getZoneList();
    zones.forEach((z) => {
      const nameEl = this.shadowRoot.getElementById(`name-${z.key}`);
      const subEl = this.shadowRoot.getElementById(`sub-${z.key}`);
      const iconWrap = this.shadowRoot.getElementById(`icon-${z.key}`);
      if (!nameEl || !subEl || !iconWrap) return;

      nameEl.textContent = z.name;

      const sensorActive =
        z.sensor &&
        this._hass?.states[z.sensor] &&
        this._hass.states[z.sensor].state === "on";
      const stage = this._state[z.key];
      const isPending = Boolean(this._pending[z.key]);
      const isActive = stage !== "Off" || sensorActive;
      if (isActive) anyActive = true;

      iconWrap.classList.toggle("active", isActive);
      iconWrap.classList.toggle("pending", isPending);
      iconWrap.querySelector("ha-icon").setAttribute("icon", isActive ? z.onIcon : z.offIcon);

      let statusText = "Off";
      if (!z.climate) {
        statusText = "Select entity";
      } else if (isPending) {
        statusText = stage === "Off" ? "Cancelling…" : `${stage}…`;
      } else if (isActive) {
        const remSec = this._parseRemainingSeconds(z.sensor, z.key);
        const countdown = this._formatCountdown(remSec);
        statusText = countdown || (stage !== "Off" ? stage : "Active");
      }

      if (z.climate && this._hass?.states[z.climate]) {
        const temp = this._hass.states[z.climate].attributes.current_temperature;
        subEl.textContent = temp !== undefined ? `${temp}°C • ${statusText}` : statusText;
      } else {
        subEl.textContent = statusText;
      }
    });

    if (this._config.include_water) {
      const w = this._getWaterConfig();
      const nameEl = this.shadowRoot.getElementById("name-water");
      const subEl = this.shadowRoot.getElementById("sub-water");
      const iconWrap = this.shadowRoot.getElementById("icon-water");
      if (nameEl && subEl && iconWrap) {
        nameEl.textContent = w.name;
        const sensorActive =
          w.sensor &&
          this._hass?.states[w.sensor] &&
          this._hass.states[w.sensor].state === "on";
        const stage = this._state.water;
        const isPending = Boolean(this._pending.water);
        const isActive = stage !== "Off" || sensorActive;
        if (isActive) anyActive = true;

        iconWrap.classList.toggle("active", isActive);
        iconWrap.classList.toggle("pending", isPending);
        iconWrap.querySelector("ha-icon").setAttribute("icon", isActive ? w.onIcon : w.offIcon);

        let statusText = "Off";
        if (!w.entity) {
          statusText = "Select entity";
        } else if (isPending) {
          statusText = stage === "Off" ? "Cancelling…" : `${stage}…`;
        } else if (isActive) {
          const remSec = this._parseRemainingSeconds(w.sensor, "water");
          const countdown = this._formatCountdown(remSec);
          statusText = countdown || (stage !== "Off" ? stage : "Active");
        }
        subEl.textContent = statusText;
      }
    }

    if (this._config.include_cancel_all) {
      const nameEl = this.shadowRoot.getElementById("name-cancel-all");
      const subEl = this.shadowRoot.getElementById("sub-cancel-all");
      const iconWrap = this.shadowRoot.getElementById("icon-cancel-all");
      if (nameEl && subEl && iconWrap) {
        const customCancelName = (this._config.cancel_all_name || "").trim();
        nameEl.textContent = customCancelName || "Cancel All";
        iconWrap.classList.toggle("cancel-active", anyActive);
        subEl.textContent = anyActive ? "Tap to stop all" : "No active boosts";
      }
    }
  }
}

class HiveBoostCardEditor extends HTMLElement {
  constructor() {
    super();
    this._lastStructureKey = null;
  }

  setConfig(config) {
    this._config = {
      zone_count: 2,
      temperature: 21.0,
      include_water: true,
      include_cancel_all: true,
      ...config,
    };
    const count = Number(this._config.zone_count ?? 2);
    const water = Boolean(this._config.include_water);
    const cancelAll = Boolean(this._config.include_cancel_all);
    const structureKey = `${count}-${water}-${cancelAll}`;

    if (this._lastStructureKey !== structureKey) {
      this._lastStructureKey = structureKey;
      this._render();
    } else {
      this._syncValues();
    }
  }

  set hass(hass) {
    this._hass = hass;
    this.querySelectorAll("ha-form").forEach((form) => {
      form.hass = hass;
    });
  }

  _emitChange(updated) {
    this._config = updated;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _syncValues() {
    this.querySelectorAll("ha-form").forEach((form) => {
      form.data = this._config;
    });
    this.querySelectorAll("input[data-field]").forEach((input) => {
      const field = input.getAttribute("data-field");
      if (document.activeElement !== input) {
        input.value = this._config[field] || "";
      }
    });
    const waterSwitch = this.querySelector("#water-toggle");
    if (waterSwitch) {
      waterSwitch.checked = Boolean(this._config.include_water);
    }
    const cancelSwitch = this.querySelector("#cancel-all-toggle");
    if (cancelSwitch) {
      cancelSwitch.checked = Boolean(this._config.include_cancel_all);
    }
  }

  _createTextField(labelText, placeholderText, fieldName) {
    const wrap = document.createElement("div");
    wrap.className = "field-wrap";

    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "field-input";
    input.placeholder = placeholderText;
    input.value = this._config[fieldName] || "";
    input.setAttribute("data-field", fieldName);

    input.addEventListener("input", (ev) => {
      this._emitChange({ ...this._config, [fieldName]: ev.target.value });
    });
    input.addEventListener("change", (ev) => {
      this._emitChange({ ...this._config, [fieldName]: ev.target.value });
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  _createForm(schema) {
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._config;
    form.schema = schema;
    form.computeLabel = (s) => s.label || s.name;
    form.addEventListener("value-changed", (ev) => {
      this._emitChange(ev.detail.value);
    });
    return form;
  }

  _createSwitchRow(labelText, switchId, configKey) {
    const row = document.createElement("div");
    row.className = "switch-row";

    const label = document.createElement("span");
    label.className = "switch-label";
    label.textContent = labelText;

    const sw = document.createElement("ha-switch");
    sw.id = switchId;
    sw.checked = Boolean(this._config[configKey]);
    sw.addEventListener("change", (ev) => {
      this._emitChange({ ...this._config, [configKey]: ev.target.checked });
    });

    row.appendChild(label);
    row.appendChild(sw);
    return row;
  }

  _createGroupBox(title, elements) {
    const box = document.createElement("div");
    box.className = "group-box";

    const header = document.createElement("div");
    header.className = "group-title";
    header.textContent = title;
    box.appendChild(header);

    elements.forEach((el) => box.appendChild(el));
    return box;
  }

  _render() {
    this.innerHTML = `
      <style>
        .editor-container {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 4px 0;
        }
        .group-box {
          border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
          border-radius: 14px;
          padding: 14px;
          background: var(--card-background-color, transparent);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .group-title {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          color: var(--primary-color);
          margin-bottom: 2px;
        }
        .field-wrap {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .field-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--secondary-text-color);
        }
        .field-input {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          font-size: 14px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.4));
          background: var(--secondary-background-color, rgba(127, 127, 127, 0.08));
          color: var(--primary-text-color);
          outline: none;
          font-family: inherit;
        }
        .field-input:focus {
          border-color: var(--primary-color);
        }
        .switch-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 36px;
        }
        .switch-label {
          font-size: 14px;
          color: var(--primary-text-color);
        }
      </style>
      <div class="editor-container" id="editor-root"></div>
    `;

    const root = this.querySelector("#editor-root");

    root.appendChild(
      this._createGroupBox("General Settings", [
        this._createForm([
          {
            name: "zone_count",
            label: "Number of Heating Zones",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: 0, label: "0 Zones (Hot Water Only)" },
                  { value: 1, label: "1 Heating Zone" },
                  { value: 2, label: "2 Heating Zones" },
                  { value: 3, label: "3 Heating Zones" },
                  { value: 4, label: "4 Heating Zones" },
                ],
              },
            },
          },
          {
            name: "temperature",
            label: "Boost Target Temperature (°C)",
            selector: { number: { min: 10, max: 30, step: 0.5, mode: "box" } },
          },
        ]),
      ])
    );

    const count = Number(this._config.zone_count ?? 2);
    for (let i = 1; i <= count; i++) {
      root.appendChild(
        this._createGroupBox(`Heating Zone ${i}`, [
          this._createTextField(
            `Zone ${i} Custom Label (Optional)`,
            `Zone ${i}`,
            `zone_${i}_name`
          ),
          this._createForm([
            {
              name: `zone_${i}_climate`,
              label: `Zone ${i} Climate Entity`,
              selector: { entity: { domain: "climate" } },
            },
            {
              name: `zone_${i}_sensor`,
              label: `Zone ${i} Boost Sensor (Optional)`,
              selector: { entity: { domain: "binary_sensor" } },
            },
          ]),
        ])
      );
    }

    const waterElements = [
      this._createSwitchRow("Include Hot Water Boost", "water-toggle", "include_water"),
    ];
    if (this._config.include_water) {
      waterElements.push(
        this._createTextField("Hot Water Custom Label (Optional)", "Hot Water Boost", "water_name"),
        this._createForm([
          {
            name: "water_entity",
            label: "Hot Water Entity",
            selector: { entity: { domain: "water_heater" } },
          },
          {
            name: "water_sensor",
            label: "Hot Water Boost Sensor (Optional)",
            selector: { entity: { domain: "binary_sensor" } },
          },
        ])
      );
    }
    root.appendChild(this._createGroupBox("Hot Water", waterElements));

    const cancelElements = [
      this._createSwitchRow("Include Cancel All Button", "cancel-all-toggle", "include_cancel_all"),
    ];
    if (this._config.include_cancel_all) {
      cancelElements.push(
        this._createTextField("Cancel All Custom Label (Optional)", "Cancel All", "cancel_all_name")
      );
    }
    root.appendChild(this._createGroupBox("Global Controls", cancelElements));
  }
}

customElements.define("hive-boost-card", HiveBoostCard);
customElements.define("hive-boost-card-editor", HiveBoostCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "hive-boost-card",
  name: "Hive Boost Card",
  description: "Multi-zone Hive heating and hot water cycle boost buttons",
  preview: true,
});
