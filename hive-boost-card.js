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
    this._state = {
      zone_1: "Off",
      zone_2: "Off",
      zone_3: "Off",
      zone_4: "Off",
      water: "Off",
    };
    this._endTime = {
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
    this._holdTimers = {};
    this._holdTriggered = {};
    this._debounceTimers = {};
    this._pendingKeys = {};
    this._tickInterval = null;
  }

  connectedCallback() {
    if (!this._tickInterval) {
      this._tickInterval = setInterval(() => this._onTick(), 1000);
    }
  }

  disconnectedCallback() {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
    Object.values(this._debounceTimers).forEach((t) => clearTimeout(t));
    Object.values(this._holdTimers).forEach((t) => clearTimeout(t));
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
      water_name: "Hot Water Boost",
      water_entity: "",
      water_sensor: "",
      water_temp_sensor: "",
    };
  }

  setConfig(config) {
    const normalized = { ...config };

    if (normalized.zone_count === undefined) {
      if (normalized.up_climate || normalized.down_climate) {
        normalized.zone_count = 2;
        normalized.zone_1_name = normalized.zone_1_name ?? normalized.up_name ?? "";
        normalized.zone_1_climate = normalized.zone_1_climate ?? normalized.up_climate ?? "";
        normalized.zone_1_sensor = normalized.zone_1_sensor ?? normalized.up_sensor ?? "";
        normalized.zone_2_name = normalized.zone_2_name ?? normalized.down_name ?? "";
        normalized.zone_2_climate = normalized.zone_2_climate ?? normalized.down_climate ?? "";
        normalized.zone_2_sensor = normalized.zone_2_sensor ?? normalized.down_sensor ?? "";
      } else {
        normalized.zone_count = 2;
      }
    }

    if (normalized.include_water === undefined) {
      normalized.include_water = true;
    }

    if (normalized.include_cancel_all === undefined) {
      normalized.include_cancel_all = true;
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
      ...normalized,
    };

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._syncExternalResets();
    this._updateUI();
  }

  _onTick() {
    const now = Date.now();
    let changed = false;
    Object.keys(this._endTime).forEach((key) => {
      if (this._endTime[key] && !this._pendingKeys[key]) {
        if (now >= this._endTime[key]) {
          this._endTime[key] = null;
          if (this._state[key] !== "Off") {
            this._state[key] = "Off";
          }
          changed = true;
        } else {
          changed = true;
        }
      }
    });
    if (changed) {
      this._updateUI();
    }
  }

  _getZoneMeta() {
    const count = Math.min(4, Math.max(0, Number(this._config.zone_count ?? 2)));
    const zones = [];
    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      const climate = this._config[`${key}_climate`];
      const customName = (this._config[`${key}_name`] || "").trim();
      const friendlyName =
        climate && this._hass?.states[climate]?.attributes?.friendly_name
          ? this._hass.states[climate].attributes.friendly_name
          : "";
      zones.push({
        key,
        index: i,
        name: customName || friendlyName || `Zone ${i}`,
        climate,
        sensor: this._config[`${key}_sensor`],
        onIcon: "mdi:fire",
        offIcon: "mdi:fire-off",
      });
    }
    return zones;
  }

  _syncExternalResets() {
    if (!this._hass || !this._config) return;
    const zones = this._getZoneMeta();
    zones.forEach((z) => {
      if (!z.sensor || !this._hass.states[z.sensor]) return;
      const isActive = this._hass.states[z.sensor].state === "on";
      if (this._prevActive[z.key] && !isActive) {
        this._state[z.key] = "Off";
        this._endTime[z.key] = null;
      }
      this._prevActive[z.key] = isActive;
    });

    if (this._config.include_water && this._config.water_sensor) {
      const ws = this._config.water_sensor;
      if (this._hass.states[ws]) {
        const isActive = this._hass.states[ws].state === "on";
        if (this._prevActive.water && !isActive) {
          this._state.water = "Off";
          this._endTime.water = null;
        }
        this._prevActive.water = isActive;
      }
    }
  }

  _getRemainingText(key, sensorId) {
    if (sensorId && this._hass?.states[sensorId]) {
      const stateObj = this._hass.states[sensorId];
      if (stateObj.state === "on") {
        const attrs = stateObj.attributes || {};
        const rawRemaining =
          attrs.boost_time_remaining ??
          attrs.time_remaining ??
          attrs.remaining_time;

        if (rawRemaining !== undefined && rawRemaining !== null) {
          if (typeof rawRemaining === "number" && rawRemaining > 0) {
            const mins = Math.ceil(rawRemaining);
            if (mins >= 60) {
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
            }
            return `${mins}m left`;
          }
          if (typeof rawRemaining === "string" && rawRemaining.includes(":")) {
            const parts = rawRemaining.split(":").map(Number);
            if (parts.length >= 2 && !parts.some(isNaN)) {
              const totalMins = parts[0] * 60 + parts[1];
              if (totalMins > 0) {
                if (totalMins >= 60) {
                  const h = Math.floor(totalMins / 60);
                  const m = totalMins % 60;
                  return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
                }
                return `${totalMins}m left`;
              }
            }
          }
        }
      }
    }

    if (this._endTime[key]) {
      const diffSec = Math.max(0, Math.ceil((this._endTime[key] - Date.now()) / 1000));
      if (diffSec > 0) {
        if (diffSec < 60) {
          return `${diffSec}s left`;
        }
        const totalMins = Math.ceil(diffSec / 60);
        if (totalMins >= 60) {
          const h = Math.floor(totalMins / 60);
          const m = totalMins % 60;
          return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
        }
        return `${totalMins}m left`;
      }
    }

    return null;
  }

  _sendServiceForKey(key, stage) {
    if (!this._hass || !this._config) return;

    if (stage === "Off") {
      this._endTime[key] = null;
    } else if (this._durationSeconds[stage]) {
      this._endTime[key] = Date.now() + this._durationSeconds[stage] * 1000;
    }

    if (key === "water") {
      const entity = this._config.water_entity;
      if (!entity) return;
      if (stage === "Off") {
        this._hass.callService("hive", "boost_hot_water", {
          entity_id: entity,
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

    if (this._debounceTimers[key]) {
      clearTimeout(this._debounceTimers[key]);
    }
    this._pendingKeys[key] = true;
    this._updateUI();

    this._debounceTimers[key] = setTimeout(() => {
      delete this._debounceTimers[key];
      this._pendingKeys[key] = false;
      this._sendServiceForKey(key, this._state[key]);
      this._updateUI();
    }, 2000);
  }

  _handleHold(key) {
    if (!this._hass || !this._config) return;
    if (this._debounceTimers[key]) {
      clearTimeout(this._debounceTimers[key]);
      delete this._debounceTimers[key];
    }
    this._pendingKeys[key] = false;
    this._state[key] = "Off";
    this._endTime[key] = null;
    this._sendServiceForKey(key, "Off");
    this._updateUI();
  }

  _handleCancelAll() {
    if (!this._hass || !this._config) return;
    const zones = this._getZoneMeta();
    zones.forEach((z) => {
      if (this._debounceTimers[z.key]) {
        clearTimeout(this._debounceTimers[z.key]);
        delete this._debounceTimers[z.key];
      }
      this._pendingKeys[z.key] = false;
      this._state[z.key] = "Off";
      this._endTime[z.key] = null;
      if (z.climate) {
        this._hass.callService("hive", "boost_heating_off", {
          entity_id: z.climate,
        });
      }
    });

    if (this._config.include_water) {
      if (this._debounceTimers.water) {
        clearTimeout(this._debounceTimers.water);
        delete this._debounceTimers.water;
      }
      this._pendingKeys.water = false;
      this._state.water = "Off";
      this._endTime.water = null;
      if (this._config.water_entity) {
        this._hass.callService("hive", "boost_hot_water", {
          entity_id: this._config.water_entity,
          on_off: "off",
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
    if (!this._config) return;
    const zones = this._getZoneMeta();
    const showWater = Boolean(this._config.include_water);
    const showCancelAll = Boolean(this._config.include_cancel_all);
    const gridCols = zones.length === 1 ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))";
    const bottomCols =
      showWater && showCancelAll ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)";

    const zoneCardsHtml = zones
      .map(
        (z) => `
        <ha-card id="card-${z.key}">
          <div class="icon-wrap" id="icon-${z.key}">
            <ha-icon icon="mdi:fire-off"></ha-icon>
          </div>
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
          <div class="icon-wrap" id="icon-water">
            <ha-icon icon="mdi:water-boiler-off"></ha-icon>
          </div>
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
          <div class="icon-wrap" id="icon-cancel-all">
            <ha-icon icon="mdi:cancel"></ha-icon>
          </div>
          <div class="info">
            <div class="primary" id="name-cancel-all"></div>
            <div class="secondary" id="sub-cancel-all">Idle</div>
          </div>
        </ha-card>
      `
      : "";

    const bottomRowHtml =
      showWater || showCancelAll
        ? `<div class="bottom-row" style="grid-template-columns: ${bottomCols};">
            ${waterCardHtml}
            ${cancelAllHtml}
          </div>`
        : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .grid {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .zones-grid,
        .bottom-row {
          display: grid;
          grid-template-columns: ${gridCols};
          gap: 10px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        ha-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          cursor: pointer;
          user-select: none;
          min-width: 0;
          max-width: 100%;
          box-sizing: border-box;
          transition: transform 0.1s ease;
        }
        ha-card:active {
          transform: scale(0.98);
        }
        .icon-wrap {
          width: 40px;
          height: 40px;
          min-width: 40px;
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
        @keyframes pulse-queued {
          0% { opacity: 1; }
          50% { opacity: 0.45; }
          100% { opacity: 1; }
        }
        .icon-wrap.pending {
          animation: pulse-queued 0.8s infinite ease-in-out;
        }
        .info {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
          overflow: hidden;
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
        ${zones.length > 0 ? `<div class="zones-grid">${zoneCardsHtml}</div>` : ""}
        ${bottomRowHtml}
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
    const zones = this._getZoneMeta();
    let anyActive = false;

    zones.forEach((z) => {
      const nameEl = this.shadowRoot.getElementById(`name-${z.key}`);
      const subEl = this.shadowRoot.getElementById(`sub-${z.key}`);
      const iconWrap = this.shadowRoot.getElementById(`icon-${z.key}`);
      if (!nameEl || !subEl || !iconWrap) return;

      nameEl.textContent = z.name;

      if (!z.climate) {
        iconWrap.classList.remove("active", "pending");
        iconWrap.querySelector("ha-icon").setAttribute("icon", z.offIcon);
        subEl.textContent = "Select entity";
        return;
      }

      const sensorActive =
        z.sensor &&
        this._hass?.states[z.sensor] &&
        this._hass.states[z.sensor].state === "on";
      const stage = this._state[z.key] || "Off";
      const isPending = Boolean(this._pendingKeys[z.key]);
      const isActive = stage !== "Off" || sensorActive;
      if (isActive) anyActive = true;

      iconWrap.classList.toggle("active", isActive);
      iconWrap.classList.toggle("pending", isPending);
      iconWrap.querySelector("ha-icon").setAttribute("icon", isActive ? z.onIcon : z.offIcon);

      let statusText = "Off";
      if (isPending) {
        statusText = stage !== "Off" ? `${stage}…` : "Off…";
      } else {
        const remaining = isActive ? this._getRemainingText(z.key, z.sensor) : null;
        if (remaining) {
          statusText = remaining;
        } else if (stage !== "Off") {
          statusText = stage;
        } else if (sensorActive) {
          statusText = "Active";
        }
      }

      const temp = this._hass?.states[z.climate]?.attributes?.current_temperature;
      subEl.textContent = temp !== undefined ? `${temp}°C • ${statusText}` : statusText;
    });

    if (this._config.include_water) {
      const nameEl = this.shadowRoot.getElementById("name-water");
      const subEl = this.shadowRoot.getElementById("sub-water");
      const iconWrap = this.shadowRoot.getElementById("icon-water");
      if (nameEl && subEl && iconWrap) {
        const customWaterName = (this._config.water_name || "").trim();
        nameEl.textContent = customWaterName || "Hot Water Boost";

        if (!this._config.water_entity) {
          iconWrap.classList.remove("active", "pending");
          iconWrap.querySelector("ha-icon").setAttribute("icon", "mdi:water-boiler-off");
          subEl.textContent = "Select entity";
        } else {
          const sensorActive =
            this._config.water_sensor &&
            this._hass?.states[this._config.water_sensor] &&
            this._hass.states[this._config.water_sensor].state === "on";
          const stage = this._state.water || "Off";
          const isPending = Boolean(this._pendingKeys.water);
          const isActive = stage !== "Off" || sensorActive;
          if (isActive) anyActive = true;

          iconWrap.classList.toggle("active", isActive);
          iconWrap.classList.toggle("pending", isPending);
          iconWrap
            .querySelector("ha-icon")
            .setAttribute("icon", isActive ? "mdi:water-boiler" : "mdi:water-boiler-off");

          let statusText = "Off";
          if (isPending) {
            statusText = stage !== "Off" ? `${stage}…` : "Off…";
          } else {
            const remaining = isActive
              ? this._getRemainingText("water", this._config.water_sensor)
              : null;
            if (remaining) {
              statusText = remaining;
            } else if (stage !== "Off") {
              statusText = stage;
            } else if (sensorActive) {
              statusText = "Active";
            }
          }

          let tempPrefix = "";
          const tempEntity = (this._config.water_temp_sensor || "").trim();
          if (tempEntity && this._hass?.states[tempEntity]) {
            const rawState = this._hass.states[tempEntity].state;
            const unit =
              this._hass.states[tempEntity].attributes?.unit_of_measurement || "°C";
            if (rawState !== "unknown" && rawState !== "unavailable" && !isNaN(Number(rawState))) {
              tempPrefix = `${rawState}${unit} • `;
            }
          }

          subEl.textContent = `${tempPrefix}${statusText}`;
        }
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
        subEl.textContent = anyActive ? "Tap to stop" : "Idle";
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
    const normalized = { ...config };
    if (normalized.zone_count === undefined) {
      normalized.zone_count =
        normalized.up_climate || normalized.down_climate ? 2 : 2;
    }
    if (normalized.include_water === undefined) {
      normalized.include_water = true;
    }
    if (normalized.include_cancel_all === undefined) {
      normalized.include_cancel_all = true;
    }
    this._config = normalized;

    const structureKey = `${this._config.zone_count}_${this._config.include_water}_${this._config.include_cancel_all}`;
    if (structureKey !== this._lastStructureKey) {
      this._lastStructureKey = structureKey;
      this._render();
    } else {
      this._syncValues();
    }
  }

  set hass(hass) {
    this._hass = hass;
    this.querySelectorAll("ha-form").forEach((f) => {
      f.hass = hass;
    });
  }

  _emitChange(updated) {
    this._config = updated;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: updated },
        bubbles: true,
        composed: true,
      })
    );
  }

  _syncValues() {
    this.querySelectorAll("input[data-field]").forEach((input) => {
      const key = input.getAttribute("data-field");
      if (document.activeElement !== input) {
        const val = this._config[key] ?? "";
        if (input.value !== String(val)) {
          input.value = val;
        }
      }
    });

    this.querySelectorAll("ha-switch[data-field]").forEach((sw) => {
      const key = sw.getAttribute("data-field");
      sw.checked = Boolean(this._config[key]);
    });

    this.querySelectorAll("ha-form[data-section]").forEach((form) => {
      form.data = { ...this._config };
    });
  }

  _createTextField(key, label, placeholder) {
    const wrap = document.createElement("div");
    wrap.className = "text-field";

    const lbl = document.createElement("label");
    lbl.textContent = label;

    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-field", key);
    input.value = this._config[key] ?? "";
    input.placeholder = placeholder || "";

    input.addEventListener("input", (ev) => {
      this._emitChange({
        ...this._config,
        [key]: ev.target.value,
      });
    });

    wrap.appendChild(lbl);
    wrap.appendChild(input);
    return wrap;
  }

  _createSwitchRow(key, label) {
    const row = document.createElement("div");
    row.className = "switch-row";

    const lbl = document.createElement("span");
    lbl.textContent = label;

    const sw = document.createElement("ha-switch");
    sw.setAttribute("data-field", key);
    sw.checked = Boolean(this._config[key]);

    sw.addEventListener("change", (ev) => {
      this._emitChange({
        ...this._config,
        [key]: ev.target.checked,
      });
    });

    row.appendChild(lbl);
    row.appendChild(sw);
    return row;
  }

  _createHaForm(sectionId, schema) {
    const form = document.createElement("ha-form");
    form.setAttribute("data-section", sectionId);
    form.hass = this._hass;
    form.data = { ...this._config };
    form.schema = schema;
    form.computeLabel = (s) => s.label || s.name;

    form.addEventListener("value-changed", (ev) => {
      const updated = { ...this._config, ...ev.detail.value };
      this._emitChange(updated);
    });

    return form;
  }

  _render() {
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
        border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
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
        color: var(--primary-text-color);
        letter-spacing: 0.2px;
      }
      .text-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
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
        background: var(--secondary-background-color, rgba(127, 127, 127, 0.08));
        border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
        border-radius: 8px;
        outline: none;
      }
      .text-field input:focus {
        border-color: var(--primary-color, #03a9f4);
      }
      .switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px 0;
        font-size: 14px;
        color: var(--primary-text-color);
      }
    `;
    this.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = "editor-wrapper";

    // 1. General Settings Group
    const generalBox = document.createElement("div");
    generalBox.className = "group-box";
    generalBox.innerHTML = `<div class="group-title">General Settings</div>`;
    generalBox.appendChild(
      this._createHaForm("general", [
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
    wrapper.appendChild(generalBox);

    // 2. Heating Zone Groups
    const count = Math.min(4, Math.max(0, Number(this._config.zone_count ?? 2)));
    for (let i = 1; i <= count; i++) {
      const zoneBox = document.createElement("div");
      zoneBox.className = "group-box";
      zoneBox.innerHTML = `<div class="group-title">Heating Zone ${i}</div>`;
      zoneBox.appendChild(
        this._createTextField(
          `zone_${i}_name`,
          `Zone ${i} Custom Label (Optional)`,
          `Defaults to entity name or Zone ${i}`
        )
      );
      zoneBox.appendChild(
        this._createHaForm(`zone_${i}`, [
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

    // 3. Hot Water Group
    const waterBox = document.createElement("div");
    waterBox.className = "group-box";
    waterBox.innerHTML = `<div class="group-title">Hot Water</div>`;
    waterBox.appendChild(
      this._createSwitchRow("include_water", "Include Hot Water Boost")
    );

    if (this._config.include_water) {
      waterBox.appendChild(
        this._createTextField(
          "water_name",
          "Hot Water Label",
          "Hot Water Boost"
        )
      );
      waterBox.appendChild(
        this._createHaForm("water", [
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
            selector: {
              entity: {
                domain: "sensor",
                device_class: "temperature",
              },
            },
          },
        ])
      );
    }
    wrapper.appendChild(waterBox);

    // 4. Cancel All Button Group
    const cancelBox = document.createElement("div");
    cancelBox.className = "group-box";
    cancelBox.innerHTML = `<div class="group-title">Cancel All Button</div>`;
    cancelBox.appendChild(
      this._createSwitchRow("include_cancel_all", "Include Cancel All Button")
    );

    if (this._config.include_cancel_all) {
      cancelBox.appendChild(
        this._createTextField(
          "cancel_all_name",
          "Cancel All Label",
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
