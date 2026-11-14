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
    this._state = {};
    this._endTimes = {};
    this._prevActive = {};
    this._holdTimers = {};
    this._holdTriggered = {};
    this._debounceTimers = {};
    this._pending = {};
    this._renderedSignature = null;
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
      include_water: true,
      include_cancel_all: true,
      zone_1_name: "",
      zone_1_climate: "",
      zone_1_sensor: "",
      zone_2_name: "",
      zone_2_climate: "",
      zone_2_sensor: "",
      water_name: "",
      water_entity: "",
      water_sensor: "",
      cancel_all_name: "",
    };
  }

  _normalizeConfig(raw) {
    const cfg = { ...raw };
    if (cfg.zone_count === undefined) {
      if (cfg.up_climate !== undefined || cfg.down_climate !== undefined) {
        cfg.zone_count = cfg.down_climate || cfg.down_name ? 2 : 1;
      } else {
        cfg.zone_count = 2;
      }
    }
    cfg.zone_count = Math.max(0, Math.min(4, Number(cfg.zone_count)));
    cfg.temperature = cfg.temperature !== undefined ? Number(cfg.temperature) : 21.0;
    cfg.include_water = cfg.include_water !== undefined ? Boolean(cfg.include_water) : true;
    cfg.include_cancel_all =
      cfg.include_cancel_all !== undefined ? Boolean(cfg.include_cancel_all) : true;

    if (cfg.zone_1_name === undefined && cfg.up_name !== undefined) cfg.zone_1_name = cfg.up_name;
    if (cfg.zone_1_climate === undefined && cfg.up_climate) cfg.zone_1_climate = cfg.up_climate;
    if (cfg.zone_1_sensor === undefined && cfg.up_sensor) cfg.zone_1_sensor = cfg.up_sensor;

    if (cfg.zone_2_name === undefined && cfg.down_name !== undefined) cfg.zone_2_name = cfg.down_name;
    if (cfg.zone_2_climate === undefined && cfg.down_climate) cfg.zone_2_climate = cfg.down_climate;
    if (cfg.zone_2_sensor === undefined && cfg.down_sensor) cfg.zone_2_sensor = cfg.down_sensor;

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

  _getZoneItems() {
    if (!this._config) return [];
    const items = [];
    for (let i = 1; i <= this._config.zone_count; i++) {
      const climate = this._config[`zone_${i}_climate`] || "";
      const customName = (this._config[`zone_${i}_name`] || "").trim();
      const friendlyName =
        climate && this._hass?.states[climate]?.attributes?.friendly_name
          ? this._hass.states[climate].attributes.friendly_name
          : "";
      items.push({
        key: `zone_${i}`,
        type: "heating",
        label: customName || friendlyName || `Zone ${i}`,
        entity: climate,
        sensor: this._config[`zone_${i}_sensor`] || "",
        onIcon: "mdi:fire",
        offIcon: "mdi:fire-off",
      });
    }
    if (this._config.include_water) {
      const waterEntity = this._config.water_entity || "";
      const customWater = (this._config.water_name || "").trim();
      const friendlyWater =
        waterEntity && this._hass?.states[waterEntity]?.attributes?.friendly_name
          ? this._hass.states[waterEntity].attributes.friendly_name
          : "";
      items.push({
        key: "water",
        type: "water",
        label: customWater || friendlyWater || "Hot Water Boost",
        entity: waterEntity,
        sensor: this._config.water_sensor || "",
        onIcon: "mdi:water-boiler",
        offIcon: "mdi:water-boiler-off",
      });
    }
    if (this._config.include_cancel_all) {
      const customCancel = (this._config.cancel_all_name || "").trim();
      items.push({
        key: "cancel_all",
        type: "cancel_all",
        label: customCancel || "Cancel All",
        entity: "all",
        sensor: "",
        onIcon: "mdi:cancel",
        offIcon: "mdi:cancel",
      });
    }
    return items;
  }

  _getSensorRemainingSeconds(sensorId) {
    if (!sensorId || !this._hass?.states[sensorId]) return null;
    const stateObj = this._hass.states[sensorId];
    if (stateObj.state !== "on") return null;
    const attrs = stateObj.attributes || {};
    const raw =
      attrs.boost_time_remaining ??
      attrs.time_remaining ??
      attrs.remaining_time ??
      attrs.minutes_remaining ??
      null;
    if (raw === null || raw === undefined) return null;

    if (typeof raw === "number") {
      return raw > 300 ? Math.round(raw) : Math.round(raw * 60);
    }
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (/^\d+:\d{2}(:\d{2})?$/.test(trimmed)) {
        const parts = trimmed.split(":").map(Number);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
      }
      const num = parseFloat(trimmed);
      if (!isNaN(num)) {
        return num > 300 ? Math.round(num) : Math.round(num * 60);
      }
    }
    return null;
  }

  _formatRemaining(totalSeconds) {
    if (totalSeconds <= 0) return "Off";
    if (totalSeconds < 60) return `${totalSeconds}s left`;
    const totalMins = Math.ceil(totalSeconds / 60);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs > 0) {
      return mins > 0 ? `${hrs}h ${mins}m left` : `${hrs}h left`;
    }
    return `${mins}m left`;
  }

  _syncExternalResets() {
    if (!this._hass || !this._config) return;
    this._getZoneItems().forEach((item) => {
      if (item.type === "cancel_all") return;
      if (!item.sensor || !this._hass.states[item.sensor]) return;
      const isActive = this._hass.states[item.sensor].state === "on";
      if (this._prevActive[item.key] && !isActive && !this._pending[item.key]) {
        this._state[item.key] = "Off";
        delete this._endTimes[item.key];
      }
      this._prevActive[item.key] = isActive;
    });
  }

  _cancelAllBoosts() {
    if (!this._hass || !this._config) return;
    this._getZoneItems().forEach((item) => {
      if (item.type === "cancel_all") return;
      clearTimeout(this._debounceTimers[item.key]);
      this._pending[item.key] = false;
      this._state[item.key] = "Off";
      delete this._endTimes[item.key];

      if (!item.entity) return;
      if (item.type === "water") {
        this._hass.callService("hive", "boost_hot_water_off", {
          entity_id: item.entity,
        });
      } else {
        this._hass.callService("hive", "boost_heating_off", {
          entity_id: item.entity,
        });
      }
    });
    this._updateUI();
  }

  _executeBoostService(item, stage) {
    if (!this._hass || !item.entity) return;
    if (stage === "Off") {
      delete this._endTimes[item.key];
      if (item.type === "water") {
        this._hass.callService("hive", "boost_hot_water_off", {
          entity_id: item.entity,
        });
      } else {
        this._hass.callService("hive", "boost_heating_off", {
          entity_id: item.entity,
        });
      }
    } else {
      const secs = this._durationSeconds[stage] || 1800;
      this._endTimes[item.key] = Date.now() + secs * 1000;
      if (item.type === "water") {
        this._hass.callService("hive", "boost_hot_water_on", {
          entity_id: item.entity,
          time_period: this._durations[stage],
          on_off: "on",
        });
      } else {
        this._hass.callService("hive", "boost_heating_on", {
          entity_id: item.entity,
          time_period: this._durations[stage],
          temperature: Number(this._config.temperature || 21.0),
        });
      }
    }
  }

  _handleTap(item) {
    if (!this._hass || !this._config) return;
    if (item.type === "cancel_all") {
      this._cancelAllBoosts();
      return;
    }

    const current = this._state[item.key] || "Off";
    const currentIdx = this._stages.indexOf(current);
    const nextStage = this._stages[(currentIdx + 1) % this._stages.length];
    this._state[item.key] = nextStage;
    this._pending[item.key] = true;
    this._updateUI();

    clearTimeout(this._debounceTimers[item.key]);
    this._debounceTimers[item.key] = setTimeout(() => {
      this._pending[item.key] = false;
      this._executeBoostService(item, nextStage);
      this._updateUI();
    }, 2000);
  }

  _handleHold(item) {
    if (!this._hass || !this._config) return;
    if (item.type === "cancel_all") {
      this._cancelAllBoosts();
      return;
    }

    clearTimeout(this._debounceTimers[item.key]);
    this._pending[item.key] = false;
    this._state[item.key] = "Off";
    delete this._endTimes[item.key];
    this._updateUI();

    if (!item.entity) return;
    if (item.type === "water") {
      this._hass.callService("hive", "boost_hot_water_off", {
        entity_id: item.entity,
      });
    } else {
      this._hass.callService("hive", "boost_heating_off", {
        entity_id: item.entity,
      });
    }
  }

  _bindEvents(el, item) {
    const start = () => {
      this._holdTriggered[item.key] = false;
      this._holdTimers[item.key] = setTimeout(() => {
        this._holdTriggered[item.key] = true;
        this._handleHold(item);
      }, 650);
    };
    const end = () => {
      clearTimeout(this._holdTimers[item.key]);
      if (!this._holdTriggered[item.key]) {
        this._handleTap(item);
      }
    };
    const cancel = () => clearTimeout(this._holdTimers[item.key]);

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointerleave", cancel);
  }

  _render() {
    const items = this._getZoneItems();
    const signature = items.map((i) => i.key).join("|");
    if (this._renderedSignature === signature) {
      this._updateUI();
      return;
    }
    this._renderedSignature = signature;

    const heatingItems = items.filter((i) => i.type === "heating");
    const bottomItems = items.filter((i) => i.type === "water" || i.type === "cancel_all");
    const heatingCols = heatingItems.length === 1 ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)";
    const bottomCols = bottomItems.length === 1 ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)";

    const renderCardHtml = (item) => `
      <ha-card id="card-${item.key}">
        <div class="icon-wrap" id="icon-${item.key}">
          <ha-icon icon="${item.offIcon}"></ha-icon>
        </div>
        <div class="info">
          <div class="primary" id="name-${item.key}">${item.label}</div>
          <div class="secondary" id="sub-${item.key}">Off</div>
        </div>
      </ha-card>
    `;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
        }
        .grid {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          box-sizing: border-box;
        }
        .heating-grid {
          display: grid;
          grid-template-columns: ${heatingCols};
          gap: 10px;
          width: 100%;
        }
        .bottom-grid {
          display: grid;
          grid-template-columns: ${bottomCols};
          gap: 10px;
          width: 100%;
        }
        ha-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          min-width: 0;
          box-sizing: border-box;
          cursor: pointer;
          user-select: none;
          transition: transform 0.1s ease;
        }
        ha-card:active {
          transform: scale(0.98);
        }
        .icon-wrap {
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(158, 158, 158, 0.15);
          color: var(--secondary-text-color);
          transition: background 0.2s, color 0.2s;
        }
        .icon-wrap.active {
          background: rgba(255, 87, 34, 0.2);
          color: #ff5722;
        }
        .icon-wrap.cancel-active {
          background: rgba(244, 67, 54, 0.18);
          color: #f44336;
        }
        .icon-wrap.pending {
          animation: pulse 0.9s infinite alternate;
        }
        @keyframes pulse {
          from { opacity: 0.55; }
          to { opacity: 1; }
        }
        .info {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
        }
        .primary {
          font-weight: 500;
          font-size: 14px;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .secondary {
          font-size: 12px;
          color: var(--secondary-text-color);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
      <div class="grid">
        ${
          heatingItems.length > 0
            ? `<div class="heating-grid">${heatingItems.map(renderCardHtml).join("")}</div>`
            : ""
        }
        ${
          bottomItems.length > 0
            ? `<div class="bottom-grid">${bottomItems.map(renderCardHtml).join("")}</div>`
            : ""
        }
      </div>
    `;

    items.forEach((item) => {
      const el = this.shadowRoot.getElementById(`card-${item.key}`);
      if (el) this._bindEvents(el, item);
    });

    this._updateUI();
  }

  _updateUI() {
    if (!this._config) return;
    const items = this._getZoneItems();
    const now = Date.now();
    let anyBoostRunning = false;

    items.forEach((item) => {
      if (item.type === "cancel_all") return;
      const nameEl = this.shadowRoot.getElementById(`name-${item.key}`);
      const subEl = this.shadowRoot.getElementById(`sub-${item.key}`);
      const iconWrap = this.shadowRoot.getElementById(`icon-${item.key}`);
      if (!nameEl || !subEl || !iconWrap) return;

      nameEl.textContent = item.label;

      const sensorActive =
        item.sensor &&
        this._hass?.states[item.sensor] &&
        this._hass.states[item.sensor].state === "on";
      const stage = this._state[item.key] || "Off";
      const isPending = Boolean(this._pending[item.key]);

      if (!isPending && this._endTimes[item.key] && this._endTimes[item.key] <= now) {
        delete this._endTimes[item.key];
        if (!sensorActive) {
          this._state[item.key] = "Off";
        }
      }

      const currentStage = this._state[item.key] || "Off";
      const isActive = currentStage !== "Off" || sensorActive;
      if (isActive) anyBoostRunning = true;

      iconWrap.classList.toggle("active", isActive);
      iconWrap.classList.toggle("pending", isPending);
      iconWrap
        .querySelector("ha-icon")
        .setAttribute("icon", isActive ? item.onIcon : item.offIcon);

      let statusText = "Off";
      if (!item.entity) {
        statusText = "Select entity";
      } else if (isPending) {
        statusText = `${currentStage}…`;
      } else {
        const sensorSecs = this._getSensorRemainingSeconds(item.sensor);
        const localSecs = this._endTimes[item.key]
          ? Math.max(0, Math.ceil((this._endTimes[item.key] - now) / 1000))
          : null;

        if (sensorSecs !== null && sensorSecs > 0) {
          statusText = this._formatRemaining(sensorSecs);
        } else if (localSecs !== null && localSecs > 0) {
          statusText = this._formatRemaining(localSecs);
        } else if (currentStage !== "Off") {
          statusText = currentStage;
        } else if (sensorActive) {
          statusText = "Active";
        }
      }

      if (item.type === "heating" && item.entity && this._hass?.states[item.entity]) {
        const temp = this._hass.states[item.entity].attributes.current_temperature;
        subEl.textContent = temp !== undefined ? `${temp}°C • ${statusText}` : statusText;
      } else {
        subEl.textContent = statusText;
      }
    });

    const cancelItem = items.find((i) => i.type === "cancel_all");
    if (cancelItem) {
      const nameEl = this.shadowRoot.getElementById(`name-${cancelItem.key}`);
      const subEl = this.shadowRoot.getElementById(`sub-${cancelItem.key}`);
      const iconWrap = this.shadowRoot.getElementById(`icon-${cancelItem.key}`);
      if (nameEl && subEl && iconWrap) {
        nameEl.textContent = cancelItem.label;
        iconWrap.classList.toggle("cancel-active", anyBoostRunning);
        subEl.textContent = anyBoostRunning ? "Stop all boosts" : "No active boosts";
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
    if (this._config.zone_count === undefined && (this._config.up_climate || this._config.down_climate)) {
      this._config.zone_count = this._config.down_climate ? 2 : 1;
    }
    if (this._config.zone_1_climate === undefined && this._config.up_climate) {
      this._config.zone_1_climate = this._config.up_climate;
      this._config.zone_1_name = this._config.up_name || "";
      this._config.zone_1_sensor = this._config.up_sensor || "";
    }
    if (this._config.zone_2_climate === undefined && this._config.down_climate) {
      this._config.zone_2_climate = this._config.down_climate;
      this._config.zone_2_name = this._config.down_name || "";
      this._config.zone_2_sensor = this._config.down_sensor || "";
    }
    this._render();
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

  _createTextField(labelText, key, placeholder) {
    const wrap = document.createElement("div");
    wrap.className = "text-field";

    const label = document.createElement("label");
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "text";
    input.value = this._config[key] || "";
    input.placeholder = placeholder;

    input.addEventListener("input", (ev) => {
      this._emitChange({ ...this._config, [key]: ev.target.value });
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  _createEntityForm(schema) {
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._config;
    form.schema = schema;
    form.computeLabel = (s) => s.label || s.name;
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._emitChange({ ...this._config, ...ev.detail.value });
    });
    return form;
  }

  _createSwitchRow(labelText, key) {
    const row = document.createElement("div");
    row.className = "switch-row";

    const label = document.createElement("span");
    label.textContent = labelText;

    const toggle = document.createElement("ha-switch");
    toggle.checked = Boolean(this._config[key]);
    toggle.addEventListener("change", (ev) => {
      const checked = ev.target.checked;
      this._emitChange({ ...this._config, [key]: checked });
      this._render();
    });

    row.appendChild(label);
    row.appendChild(toggle);
    return row;
  }

  _render() {
    if (!this._config) return;
    const count = Math.max(0, Math.min(4, Number(this._config.zone_count ?? 2)));
    const includeWater = this._config.include_water !== false;
    const includeCancelAll = this._config.include_cancel_all !== false;
    const structureKey = `${count}|${includeWater}|${includeCancelAll}`;

    if (this._lastStructureKey === structureKey) {
      this.querySelectorAll("ha-form").forEach((form) => {
        form.data = this._config;
      });
      return;
    }
    this._lastStructureKey = structureKey;

    this.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = `
      .editor-wrapper {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 4px 0;
      }
      .group-box {
        border: 1.5px solid var(--divider-color, rgba(150, 150, 150, 0.35));
        border-radius: 14px;
        padding: 14px;
        background: var(--card-background-color, transparent);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .group-title {
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--primary-color, #ff5722);
      }
      .switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 36px;
        font-size: 14px;
        color: var(--primary-text-color);
      }
      .text-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .text-field label {
        font-size: 12px;
        color: var(--secondary-text-color);
      }
      .text-field input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        font-size: 14px;
        font-family: inherit;
        color: var(--primary-text-color);
        background: var(--secondary-background-color, rgba(150, 150, 150, 0.12));
        border: 1px solid var(--divider-color, rgba(150, 150, 150, 0.35));
        border-radius: 8px;
        outline: none;
      }
      .text-field input:focus {
        border-color: var(--primary-color, #ff5722);
      }
    `;
    this.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = "editor-wrapper";

    // 1. General Settings
    const generalBox = document.createElement("div");
    generalBox.className = "group-box";
    generalBox.innerHTML = `<div class="group-title">General Settings</div>`;
    const generalForm = this._createEntityForm([
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
    ]);
    generalForm.addEventListener("value-changed", () => this._render());
    generalBox.appendChild(generalForm);
    wrapper.appendChild(generalBox);

    // 2. Heating Zones
    for (let i = 1; i <= count; i++) {
      const zoneBox = document.createElement("div");
      zoneBox.className = "group-box";
      zoneBox.innerHTML = `<div class="group-title">Heating Zone ${i}</div>`;

      zoneBox.appendChild(
        this._createTextField(
          `Zone ${i} Custom Label (Optional)`,
          `zone_${i}_name`,
          `Zone ${i}`
        )
      );

      zoneBox.appendChild(
        this._createEntityForm([
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
        ])
      );

      wrapper.appendChild(zoneBox);
    }

    // 3. Hot Water
    const waterBox = document.createElement("div");
    waterBox.className = "group-box";
    waterBox.innerHTML = `<div class="group-title">Hot Water</div>`;
    waterBox.appendChild(this._createSwitchRow("Include Hot Water Boost", "include_water"));

    if (includeWater) {
      waterBox.appendChild(
        this._createTextField(
          "Hot Water Custom Label (Optional)",
          "water_name",
          "Hot Water Boost"
        )
      );
      waterBox.appendChild(
        this._createEntityForm([
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
    wrapper.appendChild(waterBox);

    // 4. Cancel All Button
    const cancelBox = document.createElement("div");
    cancelBox.className = "group-box";
    cancelBox.innerHTML = `<div class="group-title">Cancel All Button</div>`;
    cancelBox.appendChild(this._createSwitchRow("Include Cancel All Button", "include_cancel_all"));

    if (includeCancelAll) {
      cancelBox.appendChild(
        this._createTextField(
          "Cancel All Custom Label (Optional)",
          "cancel_all_name",
          "Cancel All"
        )
      );
    }
    wrapper.appendChild(cancelBox);

    this.appendChild(wrapper);
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
