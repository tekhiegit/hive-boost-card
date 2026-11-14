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
    this._state = {
      zone_1: "Off",
      zone_2: "Off",
      zone_3: "Off",
      zone_4: "Off",
      water: "Off",
    };
    this._endTimes = {
      zone_1: null,
      zone_2: null,
      zone_3: null,
      zone_4: null,
      water: null,
    };
    this._prevActive = {
      zone_1: false,
      zone_2: false,
      zone_3: false,
      zone_4: false,
      water: false,
    };
    this._debounceTimers = {};
    this._pendingKeys = {};
    this._holdTimers = {};
    this._holdTriggered = {};
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
    Object.values(this._debounceTimers).forEach((t) => clearTimeout(t));
  }

  static getConfigElement() {
    return document.createElement("hive-boost-card-editor");
  }

  static getStubConfig() {
    return {
      zone_count: 2,
      temperature: 21.0,
      include_water: true,
      include_cancel_all: true,
      cancel_all_name: "Cancel All",
      zone_1_name: "",
      zone_1_climate: "",
      zone_1_sensor: "",
      zone_2_name: "",
      zone_2_climate: "",
      zone_2_sensor: "",
      zone_3_name: "",
      zone_3_climate: "",
      zone_3_sensor: "",
      zone_4_name: "",
      zone_4_climate: "",
      zone_4_sensor: "",
      water_name: "Hot Water Boost",
      water_entity: "",
      water_sensor: "",
      water_temp_sensor: "",
    };
  }

  setConfig(config) {
    const migrated = { ...config };

    if (migrated.up_climate && !migrated.zone_1_climate) {
      migrated.zone_1_climate = migrated.up_climate;
      migrated.zone_1_name = migrated.up_name || "";
      migrated.zone_1_sensor = migrated.up_sensor || "";
    }
    if (migrated.down_climate && !migrated.zone_2_climate) {
      migrated.zone_2_climate = migrated.down_climate;
      migrated.zone_2_name = migrated.down_name || "";
      migrated.zone_2_sensor = migrated.down_sensor || "";
    }

    if (migrated.zone_count === undefined) {
      let detected = 0;
      for (let i = 1; i <= 4; i++) {
        if (migrated[`zone_${i}_climate`]) detected = i;
      }
      migrated.zone_count = detected > 0 ? detected : 2;
    }

    if (migrated.include_water === undefined) {
      migrated.include_water =
        migrated.water_entity !== undefined ? Boolean(migrated.water_entity) : true;
    }

    if (migrated.include_cancel_all === undefined) {
      migrated.include_cancel_all = true;
    }

    this._config = {
      zone_count: 2,
      temperature: 21.0,
      include_water: true,
      include_cancel_all: true,
      cancel_all_name: "Cancel All",
      zone_1_name: "",
      zone_2_name: "",
      zone_3_name: "",
      zone_4_name: "",
      water_name: "Hot Water Boost",
      water_temp_sensor: "",
      ...migrated,
    };

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._syncExternalResets();
    this._updateUI();
  }

  _getZoneLabel(idx) {
    const customName = (this._config[`zone_${idx}_name`] || "").trim();
    if (customName) return customName;

    const climateId = this._config[`zone_${idx}_climate`];
    if (climateId && this._hass?.states[climateId]?.attributes?.friendly_name) {
      return this._hass.states[climateId].attributes.friendly_name;
    }

    return `Zone ${idx}`;
  }

  _durationToMs(stage) {
    const map = {
      "30m": 30 * 60 * 1000,
      "1h": 60 * 60 * 1000,
      "1.5h": 90 * 60 * 1000,
      "2h": 120 * 60 * 1000,
    };
    return map[stage] || 0;
  }

  _formatRemaining(ms) {
    if (ms <= 0) return "Off";
    const totalSec = Math.ceil(ms / 1000);
    if (totalSec < 60) {
      return `${totalSec}s left`;
    }
    const totalMin = Math.ceil(totalSec / 60);
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hrs > 0) {
      return mins > 0 ? `${hrs}h ${mins}m left` : `${hrs}h left`;
    }
    return `${mins}m left`;
  }

  _getSensorRemainingText(sensorId) {
    if (!sensorId || !this._hass?.states[sensorId]) return null;
    const attrs = this._hass.states[sensorId].attributes || {};
    const raw =
      attrs.boost_time_remaining ??
      attrs.time_remaining ??
      attrs.remaining_time ??
      attrs.minutes_remaining;

    if (raw === undefined || raw === null) return null;

    if (typeof raw === "number") {
      if (raw <= 0) return null;
      return this._formatRemaining(raw * 60 * 1000);
    }

    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === "0" || trimmed === "00:00:00") return null;
      if (trimmed.includes(":")) {
        const parts = trimmed.split(":").map(Number);
        if (parts.length === 3 && !parts.some(isNaN)) {
          const ms = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
          return ms > 0 ? this._formatRemaining(ms) : null;
        }
        if (parts.length === 2 && !parts.some(isNaN)) {
          const ms = (parts[0] * 60 + parts[1]) * 1000;
          return ms > 0 ? this._formatRemaining(ms) : null;
        }
      }
      const num = parseFloat(trimmed);
      if (!isNaN(num) && num > 0) {
        return this._formatRemaining(num * 60 * 1000);
      }
    }

    return null;
  }

  _syncExternalResets() {
    if (!this._hass || !this._config) return;
    const map = {
      zone_1: this._config.zone_1_sensor,
      zone_2: this._config.zone_2_sensor,
      zone_3: this._config.zone_3_sensor,
      zone_4: this._config.zone_4_sensor,
      water: this._config.water_sensor,
    };

    Object.entries(map).forEach(([key, sensorId]) => {
      if (!sensorId || !this._hass.states[sensorId]) return;
      const isActive = this._hass.states[sensorId].state === "on";
      if (
        this._prevActive[key] &&
        !isActive &&
        !this._pendingKeys[key] &&
        this._state[key] !== "Off"
      ) {
        this._state[key] = "Off";
        this._endTimes[key] = null;
      }
      this._prevActive[key] = isActive;
    });
  }

  _sendBoostCommand(key, stage) {
    if (!this._hass || !this._config) return;

    if (stage === "Off") {
      this._endTimes[key] = null;
    } else {
      this._endTimes[key] = Date.now() + this._durationToMs(stage);
    }

    if (key === "water") {
      const entity = this._config.water_entity;
      if (!entity) return;
      if (stage === "Off") {
        this._hass.callService("hive", "boost_hot_water", {
          entity_id: entity,
          time_period: "00:00:00",
          on_off: "off",
        });
      } else {
        this._hass.callService("hive", "boost_hot_water", {
          entity_id: entity,
          time_period: this._durations[stage],
          on_off: "on",
        });
      }
    } else {
      const entity = this._config[`${key}_climate`];
      if (!entity) return;
      if (stage === "Off") {
        this._hass.callService("hive", "boost_heating_off", {
          entity_id: entity,
        });
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
    this._pendingKeys[key] = true;

    if (this._debounceTimers[key]) {
      clearTimeout(this._debounceTimers[key]);
    }

    this._updateUI();

    this._debounceTimers[key] = setTimeout(() => {
      delete this._debounceTimers[key];
      delete this._pendingKeys[key];
      this._sendBoostCommand(key, this._state[key]);
      this._updateUI();
    }, 2000);
  }

  _handleHold(key) {
    if (!this._hass || !this._config) return;

    if (this._debounceTimers[key]) {
      clearTimeout(this._debounceTimers[key]);
      delete this._debounceTimers[key];
    }
    delete this._pendingKeys[key];

    this._state[key] = "Off";
    this._endTimes[key] = null;
    this._updateUI();
    this._sendBoostCommand(key, "Off");
  }

  _handleCancelAll() {
    if (!this._hass || !this._config) return;

    const count = Number(this._config.zone_count ?? 2);
    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      if (this._debounceTimers[key]) {
        clearTimeout(this._debounceTimers[key]);
        delete this._debounceTimers[key];
      }
      delete this._pendingKeys[key];
      this._state[key] = "Off";
      this._endTimes[key] = null;
      if (this._config[`zone_${i}_climate`]) {
        this._sendBoostCommand(key, "Off");
      }
    }

    if (this._debounceTimers["water"]) {
      clearTimeout(this._debounceTimers["water"]);
      delete this._debounceTimers["water"];
    }
    delete this._pendingKeys["water"];
    this._state["water"] = "Off";
    this._endTimes["water"] = null;
    if (this._config.include_water && this._config.water_entity) {
      this._sendBoostCommand("water", "Off");
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
    const count = Number(this._config.zone_count ?? 2);
    const includeWater = Boolean(this._config.include_water);
    const includeCancelAll = Boolean(this._config.include_cancel_all);

    let zoneCardsHtml = "";
    for (let i = 1; i <= count; i++) {
      zoneCardsHtml += `
        <ha-card id="card-zone_${i}">
          <div class="icon-wrap" id="icon-zone_${i}"><ha-icon icon="mdi:fire-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-zone_${i}"></div>
            <div class="secondary" id="sub-zone_${i}">Off</div>
          </div>
        </ha-card>
      `;
    }

    const rowClass = count === 1 ? "row single" : "row";

    let bottomCardsHtml = "";
    if (includeWater) {
      bottomCardsHtml += `
        <ha-card id="card-water">
          <div class="icon-wrap" id="icon-water"><ha-icon icon="mdi:water-boiler-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-water"></div>
            <div class="secondary" id="sub-water">Off</div>
          </div>
        </ha-card>
      `;
    }
    if (includeCancelAll) {
      bottomCardsHtml += `
        <ha-card id="card-cancel-all">
          <div class="icon-wrap" id="icon-cancel-all"><ha-icon icon="mdi:cancel"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-cancel-all"></div>
            <div class="secondary" id="sub-cancel-all">Idle</div>
          </div>
        </ha-card>
      `;
    }

    const bottomCount = (includeWater ? 1 : 0) + (includeCancelAll ? 1 : 0);
    const bottomRowClass = bottomCount === 1 ? "row single" : "row";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; max-width: 100%; box-sizing: border-box; }
        .grid { display: flex; flex-direction: column; gap: 10px; width: 100%; }
        .row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; width: 100%; }
        .row.single { grid-template-columns: minmax(0, 1fr); }
        ha-card {
          display: flex; align-items: center; gap: 10px;
          padding: 12px; cursor: pointer; user-select: none;
          min-width: 0; overflow: hidden; box-sizing: border-box;
          transition: transform 0.1s ease;
        }
        ha-card:active { transform: scale(0.98); }
        .icon-wrap {
          width: 38px; height: 38px; min-width: 38px; border-radius: 50%;
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
          animation: pulse 0.9s infinite alternate;
        }
        @keyframes pulse {
          from { opacity: 0.55; }
          to { opacity: 1; }
        }
        .info {
          display: flex; flex-direction: column;
          min-width: 0; flex: 1; overflow: hidden;
        }
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
        ${count > 0 ? `<div class="${rowClass}">${zoneCardsHtml}</div>` : ""}
        ${bottomCount > 0 ? `<div class="${bottomRowClass}">${bottomCardsHtml}</div>` : ""}
      </div>
    `;

    for (let i = 1; i <= count; i++) {
      this._bindEvents(this.shadowRoot.getElementById(`card-zone_${i}`), `zone_${i}`);
    }
    if (includeWater) {
      this._bindEvents(this.shadowRoot.getElementById("card-water"), "water");
    }
    if (includeCancelAll) {
      const cancelEl = this.shadowRoot.getElementById("card-cancel-all");
      if (cancelEl) {
        cancelEl.addEventListener("click", () => this._handleCancelAll());
      }
    }

    this._updateUI();
  }

  _getDisplayStatus(key, stage, sensorId, isPending) {
    if (isPending) {
      return `${stage}…`;
    }

    const sensorState =
      sensorId && this._hass?.states[sensorId] ? this._hass.states[sensorId].state : null;
    const sensorActive = sensorState === "on";

    if (this._endTimes[key]) {
      const remainingMs = this._endTimes[key] - Date.now();
      if (remainingMs <= 0) {
        this._endTimes[key] = null;
        if (!sensorActive) {
          this._state[key] = "Off";
          return "Off";
        }
      } else {
        const sensorText = this._getSensorRemainingText(sensorId);
        return sensorText || this._formatRemaining(remainingMs);
      }
    }

    if (sensorActive) {
      const sensorText = this._getSensorRemainingText(sensorId);
      return sensorText || (stage !== "Off" ? stage : "Active");
    }

    return stage !== "Off" ? stage : "Off";
  }

  _getWaterTempText() {
    const tempSensor = this._config.water_temp_sensor;
    if (!tempSensor || !this._hass?.states[tempSensor]) return null;
    const stateObj = this._hass.states[tempSensor];
    const val = parseFloat(stateObj.state);
    if (isNaN(val)) return null;
    const rounded = val.toFixed(1);
    const unit = stateObj.attributes?.unit_of_measurement || "°C";
    return `${rounded}${unit}`;
  }

  _updateUI() {
    if (!this._config) return;
    const count = Number(this._config.zone_count ?? 2);
    let anyActive = false;

    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      const card = this.shadowRoot.getElementById(`card-${key}`);
      if (!card) continue;

      const climate = this._config[`zone_${i}_climate`];
      const sensor = this._config[`zone_${i}_sensor`];

      this.shadowRoot.getElementById(`name-${key}`).textContent = this._getZoneLabel(i);

      const sensorActive =
        sensor &&
        this._hass?.states[sensor] &&
        this._hass.states[sensor].state === "on";
      const stage = this._state[key];
      const isPending = Boolean(this._pendingKeys[key]);
      const isActive = stage !== "Off" || sensorActive;
      if (isActive) anyActive = true;

      const iconWrap = this.shadowRoot.getElementById(`icon-${key}`);
      iconWrap.classList.toggle("active", isActive);
      iconWrap.classList.toggle("pending", isPending);
      iconWrap.querySelector("ha-icon").setAttribute("icon", isActive ? "mdi:fire" : "mdi:fire-off");

      const statusText = this._getDisplayStatus(key, stage, sensor, isPending);

      if (!climate) {
        this.shadowRoot.getElementById(`sub-${key}`).textContent = "Select entity";
      } else if (this._hass?.states[climate]) {
        const temp = this._hass.states[climate].attributes.current_temperature;
        this.shadowRoot.getElementById(`sub-${key}`).textContent =
          temp !== undefined ? `${temp}°C • ${statusText}` : statusText;
      } else {
        this.shadowRoot.getElementById(`sub-${key}`).textContent = statusText;
      }
    }

    if (this._config.include_water && this.shadowRoot.getElementById("card-water")) {
      const waterEntity = this._config.water_entity;
      const waterSensor = this._config.water_sensor;
      this.shadowRoot.getElementById("name-water").textContent =
        (this._config.water_name || "").trim() || "Hot Water Boost";

      const sensorActive =
        waterSensor &&
        this._hass?.states[waterSensor] &&
        this._hass.states[waterSensor].state === "on";
      const stage = this._state.water;
      const isPending = Boolean(this._pendingKeys.water);
      const isActive = stage !== "Off" || sensorActive;
      if (isActive) anyActive = true;

      const iconWrap = this.shadowRoot.getElementById("icon-water");
      iconWrap.classList.toggle("active", isActive);
      iconWrap.classList.toggle("pending", isPending);
      iconWrap
        .querySelector("ha-icon")
        .setAttribute("icon", isActive ? "mdi:water-boiler" : "mdi:water-boiler-off");

      const statusText = this._getDisplayStatus("water", stage, waterSensor, isPending);
      const waterTemp = this._getWaterTempText();

      if (!waterEntity) {
        this.shadowRoot.getElementById("sub-water").textContent = "Select entity";
      } else {
        this.shadowRoot.getElementById("sub-water").textContent = waterTemp
          ? `${waterTemp} • ${statusText}`
          : statusText;
      }
    }

    if (this._config.include_cancel_all && this.shadowRoot.getElementById("card-cancel-all")) {
      this.shadowRoot.getElementById("name-cancel-all").textContent =
        (this._config.cancel_all_name || "").trim() || "Cancel All";
      const cancelWrap = this.shadowRoot.getElementById("icon-cancel-all");
      cancelWrap.classList.toggle("cancel-active", anyActive);
      this.shadowRoot.getElementById("sub-cancel-all").textContent = anyActive
        ? "Tap to stop all"
        : "No active boosts";
    }
  }
}

class HiveBoostCardEditor extends HTMLElement {
  constructor() {
    super();
    this._forms = {};
    this._renderedStructureKey = null;
  }

  setConfig(config) {
    const migrated = { ...config };
    if (migrated.up_climate && !migrated.zone_1_climate) {
      migrated.zone_1_climate = migrated.up_climate;
      migrated.zone_1_name = migrated.up_name || "";
      migrated.zone_1_sensor = migrated.up_sensor || "";
    }
    if (migrated.down_climate && !migrated.zone_2_climate) {
      migrated.zone_2_climate = migrated.down_climate;
      migrated.zone_2_name = migrated.down_name || "";
      migrated.zone_2_sensor = migrated.down_sensor || "";
    }
    if (migrated.zone_count === undefined) {
      let detected = 0;
      for (let i = 1; i <= 4; i++) {
        if (migrated[`zone_${i}_climate`]) detected = i;
      }
      migrated.zone_count = detected > 0 ? detected : 2;
    }
    if (migrated.include_water === undefined) {
      migrated.include_water =
        migrated.water_entity !== undefined ? Boolean(migrated.water_entity) : true;
    }
    if (migrated.include_cancel_all === undefined) {
      migrated.include_cancel_all = true;
    }

    this._config = {
      zone_count: 2,
      temperature: 21.0,
      include_water: true,
      include_cancel_all: true,
      cancel_all_name: "Cancel All",
      zone_1_name: "",
      zone_2_name: "",
      zone_3_name: "",
      zone_4_name: "",
      water_name: "Hot Water Boost",
      water_temp_sensor: "",
      ...migrated,
    };

    const structureKey = `${this._config.zone_count}_${this._config.include_water}_${this._config.include_cancel_all}`;
    if (this._renderedStructureKey !== structureKey) {
      this._renderedStructureKey = structureKey;
      this._render();
    } else {
      this._syncValues();
    }
  }

  set hass(hass) {
    this._hass = hass;
    Object.values(this._forms).forEach((f) => {
      f.hass = hass;
    });
  }

  _emitChange(updatedConfig) {
    this._config = updatedConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _syncValues() {
    Object.values(this._forms).forEach((f) => {
      f.data = this._config;
    });
  }

  _createSection(title, id, schema, extraElements = []) {
    const box = document.createElement("div");
    box.className = "group-box";

    const header = document.createElement("div");
    header.className = "group-title";
    header.textContent = title;
    box.appendChild(header);

    extraElements.forEach((el) => box.appendChild(el));

    if (schema && schema.length > 0) {
      const form = document.createElement("ha-form");
      form.hass = this._hass;
      form.data = this._config;
      form.schema = schema;
      form.computeLabel = (s) => s.label || s.name;
      form.addEventListener("value-changed", (ev) => {
        this._emitChange({ ...this._config, ...ev.detail.value });
      });
      this._forms[id] = form;
      box.appendChild(form);
    }

    return box;
  }

  _createTextField(label, key, placeholder) {
    const wrap = document.createElement("div");
    wrap.className = "text-field-wrap";

    const lbl = document.createElement("label");
    lbl.className = "field-label";
    lbl.textContent = label;
    wrap.appendChild(lbl);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "native-input";
    input.placeholder = placeholder;
    input.value = this._config[key] || "";

    input.addEventListener("input", (e) => {
      this._emitChange({ ...this._config, [key]: e.target.value });
    });

    wrap.appendChild(input);
    return wrap;
  }

  _createSwitchRow(label, key, checked) {
    const row = document.createElement("div");
    row.className = "switch-row";

    const lbl = document.createElement("span");
    lbl.className = "switch-label";
    lbl.textContent = label;
    row.appendChild(lbl);

    const sw = document.createElement("ha-switch");
    sw.checked = Boolean(checked);
    sw.addEventListener("change", (e) => {
      this._emitChange({ ...this._config, [key]: e.target.checked });
    });
    row.appendChild(sw);

    return row;
  }

  _render() {
    this._forms = {};
    this.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = `
      .editor-wrap {
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
      }
      .group-title {
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--primary-color);
        margin-bottom: 10px;
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
      .text-field-wrap {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 10px;
        margin-bottom: 14px;
      }
      .field-label {
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      .native-input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        font-size: 14px;
        font-family: inherit;
        color: var(--primary-text-color);
        background: var(--secondary-background-color, rgba(127, 127, 127, 0.1));
        border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
        border-radius: 8px;
        outline: none;
        transition: border-color 0.15s ease;
      }
      .native-input:focus {
        border-color: var(--primary-color);
      }
    `;
    this.appendChild(style);

    const container = document.createElement("div");
    container.className = "editor-wrap";

    container.appendChild(
      this._createSection("General Settings", "general", [
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
      ])
    );

    const count = Number(this._config.zone_count ?? 2);
    for (let i = 1; i <= count; i++) {
      const nameInput = this._createTextField(
        `Zone ${i} Custom Label (Optional)`,
        `zone_${i}_name`,
        `e.g. Zone ${i} (defaults to device name)`
      );

      container.appendChild(
        this._createSection(
          `Heating Zone ${i}`,
          `zone_${i}`,
          [
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
          ],
          [nameInput]
        )
      );
    }

    const waterSwitch = this._createSwitchRow(
      "Include Hot Water Boost",
      "include_water",
      this._config.include_water
    );

    if (this._config.include_water) {
      const waterNameInput = this._createTextField(
        "Hot Water Label",
        "water_name",
        "Hot Water Boost"
      );

      container.appendChild(
        this._createSection(
          "Hot Water",
          "water",
          [
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
            {
              name: "water_temp_sensor",
              label: "Hot Water Tank Temp Sensor (Optional)",
              selector: { entity: { domain: "sensor", device_class: "temperature" } },
            },
          ],
          [waterSwitch, waterNameInput]
        )
      );
    } else {
      container.appendChild(this._createSection("Hot Water", "water", [], [waterSwitch]));
    }

    const cancelSwitch = this._createSwitchRow(
      "Include Cancel All Button",
      "include_cancel_all",
      this._config.include_cancel_all
    );

    if (this._config.include_cancel_all) {
      const cancelNameInput = this._createTextField(
        "Cancel All Button Label",
        "cancel_all_name",
        "Cancel All"
      );
      container.appendChild(
        this._createSection("Global Controls", "cancel_all", [], [cancelSwitch, cancelNameInput])
      );
    } else {
      container.appendChild(
        this._createSection("Global Controls", "cancel_all", [], [cancelSwitch])
      );
    }

    this.appendChild(container);
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
