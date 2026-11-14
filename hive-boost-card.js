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
      "30m": 1800,
      "1h": 3600,
      "1.5h": 5400,
      "2h": 7200,
    };
    this._state = { z1: "Off", z2: "Off", z3: "Off", z4: "Off", water: "Off" };
    this._endTime = { z1: null, z2: null, z3: null, z4: null, water: null };
    this._prevActive = { z1: false, z2: false, z3: false, z4: false, water: false };
    this._holdTimers = {};
    this._holdTriggered = {};
    this._debounceTimers = {};
    this._pendingSend = {};
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

  setConfig(config) {
    const migrated = { ...config };

    if (migrated.up_climate && !migrated.zone_1_climate) {
      migrated.zone_1_name = migrated.up_name || "";
      migrated.zone_1_climate = migrated.up_climate;
      migrated.zone_1_sensor = migrated.up_sensor || "";
    }
    if (migrated.down_climate && !migrated.zone_2_climate) {
      migrated.zone_2_name = migrated.down_name || "";
      migrated.zone_2_climate = migrated.down_climate;
      migrated.zone_2_sensor = migrated.down_sensor || "";
    }

    if (migrated.zone_count === undefined) {
      let count = 2;
      if (migrated.zone_4_climate) count = 4;
      else if (migrated.zone_3_climate) count = 3;
      else if (migrated.zone_2_climate) count = 2;
      else if (migrated.zone_1_climate) count = 1;
      migrated.zone_count = count;
    }

    if (migrated.include_water === undefined) {
      migrated.include_water = true;
    }

    if (migrated.include_cancel_all === undefined) {
      migrated.include_cancel_all = true;
    }

    this._config = {
      temperature: 21.0,
      zone_1_name: "",
      zone_2_name: "",
      zone_3_name: "",
      zone_4_name: "",
      water_name: "",
      cancel_all_name: "",
      ...migrated,
    };

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._syncExternalResets();
    this._updateUI();
  }

  _getZoneList() {
    const count = Number(this._config.zone_count ?? 2);
    const list = [];
    for (let i = 1; i <= count; i++) {
      list.push({
        key: `z${i}`,
        index: i,
        customName: (this._config[`zone_${i}_name`] || "").trim(),
        climate: this._config[`zone_${i}_climate`] || "",
        sensor: this._config[`zone_${i}_sensor`] || "",
      });
    }
    return list;
  }

  _resolveLabel(key, customName, entityId, fallback) {
    if (customName) return customName;
    if (entityId && this._hass?.states[entityId]?.attributes?.friendly_name) {
      return this._hass.states[entityId].attributes.friendly_name;
    }
    return fallback;
  }

  _syncExternalResets() {
    if (!this._hass || !this._config) return;

    this._getZoneList().forEach((z) => {
      if (!z.sensor || !this._hass.states[z.sensor]) return;
      const isActive = this._hass.states[z.sensor].state === "on";
      if (this._prevActive[z.key] && !isActive && !this._pendingSend[z.key]) {
        this._state[z.key] = "Off";
        this._endTime[z.key] = null;
      }
      this._prevActive[z.key] = isActive;
    });

    if (this._config.include_water && this._config.water_sensor) {
      const sensorObj = this._hass.states[this._config.water_sensor];
      if (sensorObj) {
        const isActive = sensorObj.state === "on";
        if (this._prevActive.water && !isActive && !this._pendingSend.water) {
          this._state.water = "Off";
          this._endTime.water = null;
        }
        this._prevActive.water = isActive;
      }
    }
  }

  _parseRemainingSeconds(sensorId) {
    if (!sensorId || !this._hass?.states[sensorId]) return null;
    const stateObj = this._hass.states[sensorId];
    if (stateObj.state !== "on") return null;

    const attrs = stateObj.attributes || {};
    const candidates = [
      attrs.boost_time_remaining,
      attrs.time_remaining,
      attrs.remaining_time,
      attrs.duration_remaining,
    ];

    for (const val of candidates) {
      if (val === undefined || val === null || val === "") continue;
      if (typeof val === "number" && val > 0) {
        return val > 300 ? val : val * 60;
      }
      if (typeof val === "string") {
        const parts = val.trim().split(":").map(Number);
        if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
          const secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
          if (secs > 0) return secs;
        }
        if (parts.length === 2 && parts.every((n) => !isNaN(n))) {
          const secs = parts[0] * 60 + parts[1];
          if (secs > 0) return secs;
        }
        const minsMatch = val.match(/(\d+)\s*m/i);
        const hrsMatch = val.match(/(\d+)\s*h/i);
        if (minsMatch || hrsMatch) {
          const secs = (hrsMatch ? Number(hrsMatch[1]) * 3600 : 0) + (minsMatch ? Number(minsMatch[1]) * 60 : 0);
          if (secs > 0) return secs;
        }
      }
    }
    return null;
  }

  _formatCountdown(totalSeconds) {
    if (totalSeconds <= 0) return "Off";
    if (totalSeconds < 60) return `${Math.ceil(totalSeconds)}s left`;
    const totalMins = Math.ceil(totalSeconds / 60);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs > 0) {
      return mins > 0 ? `${hrs}h ${mins}m left` : `${hrs}h left`;
    }
    return `${totalMins}m left`;
  }

  _sendBoostCommand(key, stage) {
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
          time_period: "00:00:00",
        });
      } else {
        this._hass.callService("hive", "boost_hot_water", {
          entity_id: entity,
          on_off: "on",
          time_period: this._durations[stage],
        });
      }
    } else {
      const idx = Number(key.replace("z", ""));
      const entity = this._config[`zone_${idx}_climate`];
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

    if (nextStage === "Off") {
      this._endTime[key] = null;
    } else if (this._durationSeconds[nextStage]) {
      this._endTime[key] = Date.now() + this._durationSeconds[nextStage] * 1000;
    }

    clearTimeout(this._debounceTimers[key]);
    this._pendingSend[key] = true;
    this._updateUI();

    this._debounceTimers[key] = setTimeout(() => {
      this._pendingSend[key] = false;
      this._sendBoostCommand(key, this._state[key]);
      this._updateUI();
    }, 2000);
  }

  _handleHold(key) {
    if (!this._hass || !this._config) return;
    clearTimeout(this._debounceTimers[key]);
    this._pendingSend[key] = false;
    this._state[key] = "Off";
    this._endTime[key] = null;
    this._sendBoostCommand(key, "Off");
    this._updateUI();
  }

  _handleCancelAll() {
    if (!this._hass || !this._config) return;

    this._getZoneList().forEach((z) => {
      clearTimeout(this._debounceTimers[z.key]);
      this._pendingSend[z.key] = false;
      this._state[z.key] = "Off";
      this._endTime[z.key] = null;
      if (z.climate) {
        this._hass.callService("hive", "boost_heating_off", {
          entity_id: z.climate,
        });
      }
    });

    if (this._config.include_water) {
      clearTimeout(this._debounceTimers.water);
      this._pendingSend.water = false;
      this._state.water = "Off";
      this._endTime.water = null;
      if (this._config.water_entity) {
        this._hass.callService("hive", "boost_hot_water", {
          entity_id: this._config.water_entity,
          on_off: "off",
          time_period: "00:00:00",
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

    const heatingCardsHtml = zones
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

    const cancelAllCardHtml = showCancelAll
      ? `
        <ha-card id="card-cancel-all">
          <div class="icon-wrap" id="icon-cancel-all"><ha-icon icon="mdi:cancel"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-cancel-all">Cancel All</div>
            <div class="secondary" id="sub-cancel-all">No boosts active</div>
          </div>
        </ha-card>
      `
      : "";

    const bottomRowCols = showWater && showCancelAll ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)";
    const bottomRowHtml =
      showWater || showCancelAll
        ? `<div class="bottom-row" style="grid-template-columns: ${bottomRowCols};">${waterCardHtml}${cancelAllCardHtml}</div>`
        : "";

    const heatingCols = zones.length === 1 ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; box-sizing: border-box; }
        .grid { display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; }
        .row, .bottom-row {
          display: grid;
          grid-template-columns: ${heatingCols};
          gap: 10px;
          width: 100%;
          box-sizing: border-box;
        }
        ha-card {
          display: flex; align-items: center; gap: 10px;
          padding: 12px; cursor: pointer; user-select: none;
          min-width: 0; width: 100%; box-sizing: border-box;
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
          animation: pulse 0.8s infinite alternate;
        }
        @keyframes pulse {
          from { opacity: 1; }
          to { opacity: 0.45; }
        }
        .info { display: flex; flex-direction: column; overflow: hidden; min-width: 0; flex: 1; }
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
        ${zones.length > 0 ? `<div class="row">${heatingCardsHtml}</div>` : ""}
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
    const now = Date.now();
    let anyActive = false;

    this._getZoneList().forEach((z) => {
      const nameEl = this.shadowRoot.getElementById(`name-${z.key}`);
      const subEl = this.shadowRoot.getElementById(`sub-${z.key}`);
      const iconWrap = this.shadowRoot.getElementById(`icon-${z.key}`);
      if (!nameEl || !subEl || !iconWrap) return;

      nameEl.textContent = this._resolveLabel(
        z.key,
        z.customName,
        z.climate,
        `Zone ${z.index}`
      );

      if (!z.climate) {
        iconWrap.classList.remove("active", "pending");
        iconWrap.querySelector("ha-icon").setAttribute("icon", "mdi:fire-off");
        subEl.textContent = "Select entity";
        return;
      }

      if (this._endTime[z.key] && now >= this._endTime[z.key] && !this._pendingSend[z.key]) {
        this._endTime[z.key] = null;
        this._state[z.key] = "Off";
      }

      const sensorActive =
        z.sensor &&
        this._hass?.states[z.sensor] &&
        this._hass.states[z.sensor].state === "on";
      const stage = this._state[z.key];
      const isPending = Boolean(this._pendingSend[z.key]);
      const isActive = stage !== "Off" || sensorActive;

      if (isActive) anyActive = true;

      iconWrap.classList.toggle("active", isActive);
      iconWrap.classList.toggle("pending", isPending);
      iconWrap
        .querySelector("ha-icon")
        .setAttribute("icon", isActive ? "mdi:fire" : "mdi:fire-off");

      let statusText = "Off";
      if (isPending) {
        statusText = `${stage}…`;
      } else {
        const attrSecs = this._parseRemainingSeconds(z.sensor);
        const localSecs = this._endTime[z.key] ? Math.max(0, (this._endTime[z.key] - now) / 1000) : null;
        const remainingSecs = attrSecs !== null ? attrSecs : localSecs;

        if (remainingSecs !== null && remainingSecs > 0 && isActive) {
          statusText = this._formatCountdown(remainingSecs);
        } else if (stage !== "Off") {
          statusText = stage;
        } else if (sensorActive) {
          statusText = "Active";
        }
      }

      const temp = this._hass?.states[z.climate]?.attributes?.current_temperature;
      subEl.textContent =
        temp !== undefined ? `${temp}°C • ${statusText}` : statusText;
    });

    if (this._config.include_water) {
      const nameEl = this.shadowRoot.getElementById("name-water");
      const subEl = this.shadowRoot.getElementById("sub-water");
      const iconWrap = this.shadowRoot.getElementById("icon-water");
      if (nameEl && subEl && iconWrap) {
        nameEl.textContent = this._resolveLabel(
          "water",
          (this._config.water_name || "").trim(),
          this._config.water_entity,
          "Hot Water Boost"
        );

        if (!this._config.water_entity) {
          iconWrap.classList.remove("active", "pending");
          iconWrap
            .querySelector("ha-icon")
            .setAttribute("icon", "mdi:water-boiler-off");
          subEl.textContent = "Select entity";
        } else {
          if (this._endTime.water && now >= this._endTime.water && !this._pendingSend.water) {
            this._endTime.water = null;
            this._state.water = "Off";
          }

          const sensorActive =
            this._config.water_sensor &&
            this._hass?.states[this._config.water_sensor] &&
            this._hass.states[this._config.water_sensor].state === "on";
          const stage = this._state.water;
          const isPending = Boolean(this._pendingSend.water);
          const isActive = stage !== "Off" || sensorActive;

          if (isActive) anyActive = true;

          iconWrap.classList.toggle("active", isActive);
          iconWrap.classList.toggle("pending", isPending);
          iconWrap
            .querySelector("ha-icon")
            .setAttribute(
              "icon",
              isActive ? "mdi:water-boiler" : "mdi:water-boiler-off"
            );

          let statusText = "Off";
          if (isPending) {
            statusText = `${stage}…`;
          } else {
            const attrSecs = this._parseRemainingSeconds(this._config.water_sensor);
            const localSecs = this._endTime.water ? Math.max(0, (this._endTime.water - now) / 1000) : null;
            const remainingSecs = attrSecs !== null ? attrSecs : localSecs;

            if (remainingSecs !== null && remainingSecs > 0 && isActive) {
              statusText = this._formatCountdown(remainingSecs);
            } else if (stage !== "Off") {
              statusText = stage;
            } else if (sensorActive) {
              statusText = "Active";
            }
          }

          subEl.textContent = statusText;
        }
      }
    }

    if (this._config.include_cancel_all) {
      const cancelNameEl = this.shadowRoot.getElementById("name-cancel-all");
      const cancelSubEl = this.shadowRoot.getElementById("sub-cancel-all");
      const cancelIconWrap = this.shadowRoot.getElementById("icon-cancel-all");
      if (cancelNameEl && cancelSubEl && cancelIconWrap) {
        const customCancelLabel = (this._config.cancel_all_name || "").trim();
        cancelNameEl.textContent = customCancelLabel || "Cancel All";
        cancelIconWrap.classList.toggle("cancel-active", anyActive);
        cancelSubEl.textContent = anyActive ? "Tap to stop all" : "No boosts active";
      }
    }
  }
}

class HiveBoostCardEditor extends HTMLElement {
  constructor() {
    super();
    this._lastStructureKey = "";
  }

  setConfig(config) {
    const updated = { ...config };
    if (updated.up_climate && !updated.zone_1_climate) {
      updated.zone_1_name = updated.up_name || "";
      updated.zone_1_climate = updated.up_climate;
      updated.zone_1_sensor = updated.up_sensor || "";
    }
    if (updated.down_climate && !updated.zone_2_climate) {
      updated.zone_2_name = updated.down_name || "";
      updated.zone_2_climate = updated.down_climate;
      updated.zone_2_sensor = updated.down_sensor || "";
    }
    if (updated.zone_count === undefined) updated.zone_count = 2;
    if (updated.include_water === undefined) updated.include_water = true;
    if (updated.include_cancel_all === undefined) updated.include_cancel_all = true;
    if (updated.temperature === undefined) updated.temperature = 21.0;

    this._config = updated;
    const structureKey = `${updated.zone_count}_${updated.include_water}_${updated.include_cancel_all}`;

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

  _emitChange(newConfig) {
    this._config = newConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: newConfig },
        bubbles: true,
        composed: true,
      })
    );
  }

  _syncValues() {
    this.querySelectorAll("ha-form").forEach((f) => {
      f.data = this._config;
    });
    this.querySelectorAll("input[data-key]").forEach((inp) => {
      const key = inp.getAttribute("data-key");
      const val = this._config[key] || "";
      if (document.activeElement !== inp && inp.value !== val) {
        inp.value = val;
      }
    });
    const waterSwitch = this.querySelector("#toggle-water");
    if (waterSwitch) {
      waterSwitch.checked = Boolean(this._config.include_water);
    }
    const cancelSwitch = this.querySelector("#toggle-cancel-all");
    if (cancelSwitch) {
      cancelSwitch.checked = Boolean(this._config.include_cancel_all);
    }
  }

  _createTextField(label, configKey, placeholder) {
    const wrap = document.createElement("div");
    wrap.className = "field-box";

    const lbl = document.createElement("label");
    lbl.textContent = label;
    wrap.appendChild(lbl);

    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-key", configKey);
    input.placeholder = placeholder;
    input.value = this._config[configKey] || "";

    input.addEventListener("input", (e) => {
      this._emitChange({ ...this._config, [configKey]: e.target.value });
    });

    wrap.appendChild(input);
    return wrap;
  }

  _createFormBlock(schema) {
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

  _createSection(title) {
    const box = document.createElement("div");
    box.className = "section-box";
    const header = document.createElement("div");
    header.className = "section-title";
    header.textContent = title;
    box.appendChild(header);
    return box;
  }

  _render() {
    const count = Number(this._config.zone_count ?? 2);
    const includeWater = Boolean(this._config.include_water);
    const includeCancelAll = Boolean(this._config.include_cancel_all);

    this.innerHTML = `
      <style>
        .editor-wrap {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 4px 0;
        }
        .section-box {
          border: 1.5px solid var(--divider-color, #e0e0e0);
          border-radius: 14px;
          padding: 14px;
          background: var(--card-background-color, transparent);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .section-title {
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--primary-color, #03a9f4);
          margin-bottom: 2px;
        }
        .field-box {
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: var(--secondary-background-color, rgba(127,127,127,0.08));
          padding: 8px 12px;
          border-radius: 8px;
          border-bottom: 1px solid var(--secondary-text-color, #888);
        }
        .field-box label {
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .field-box input {
          border: none;
          background: transparent;
          color: var(--primary-text-color);
          font-size: 15px;
          outline: none;
          padding: 2px 0;
          width: 100%;
          font-family: inherit;
        }
        .switch-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 2px 0;
          font-size: 14px;
          color: var(--primary-text-color);
        }
      </style>
      <div class="editor-wrap" id="editor-container"></div>
    `;

    const container = this.querySelector("#editor-container");

    // 1. General Settings
    const generalSection = this._createSection("General Settings");
    generalSection.appendChild(
      this._createFormBlock([
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
    container.appendChild(generalSection);

    // 2. Heating Zones
    for (let i = 1; i <= count; i++) {
      const zoneSection = this._createSection(`Heating Zone ${i}`);
      zoneSection.appendChild(
        this._createTextField(
          `Zone ${i} Custom Label (Optional)`,
          `zone_${i}_name`,
          "Leave blank to use Hive device name"
        )
      );
      zoneSection.appendChild(
        this._createFormBlock([
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
      container.appendChild(zoneSection);
    }

    // 3. Hot Water
    const waterSection = this._createSection("Hot Water");
    const waterToggleRow = document.createElement("div");
    waterToggleRow.className = "switch-row";
    waterToggleRow.innerHTML = `<span>Include Hot Water Boost</span>`;

    const sw = document.createElement("ha-switch");
    sw.id = "toggle-water";
    sw.checked = includeWater;
    sw.addEventListener("change", (e) => {
      this._emitChange({ ...this._config, include_water: e.target.checked });
    });
    waterToggleRow.appendChild(sw);
    waterSection.appendChild(waterToggleRow);

    if (includeWater) {
      waterSection.appendChild(
        this._createTextField(
          "Hot Water Custom Label (Optional)",
          "water_name",
          "Leave blank to use Hive device name"
        )
      );
      waterSection.appendChild(
        this._createFormBlock([
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
    container.appendChild(waterSection);

    // 4. Cancel All Button
    const cancelSection = this._createSection("Cancel All Boosts");
    const cancelToggleRow = document.createElement("div");
    cancelToggleRow.className = "switch-row";
    cancelToggleRow.innerHTML = `<span>Include Cancel All Button</span>`;

    const csw = document.createElement("ha-switch");
    csw.id = "toggle-cancel-all";
    csw.checked = includeCancelAll;
    csw.addEventListener("change", (e) => {
      this._emitChange({ ...this._config, include_cancel_all: e.target.checked });
    });
    cancelToggleRow.appendChild(csw);
    cancelSection.appendChild(cancelToggleRow);

    if (includeCancelAll) {
      cancelSection.appendChild(
        this._createTextField(
          "Cancel All Custom Label (Optional)",
          "cancel_all_name",
          "Leave blank for 'Cancel All'"
        )
      );
    }
    container.appendChild(cancelSection);
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
