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
    this._prevActive = {
      zone_1: false,
      zone_2: false,
      zone_3: false,
      zone_4: false,
      water: false,
    };
    this._holdTimers = {};
    this._holdTriggered = {};
  }

  static getConfigElement() {
    return document.createElement("hive-boost-card-editor");
  }

  static getStubConfig() {
    return {
      zone_count: 2,
      include_water: true,
      temperature: 21.0,
      zone_1_name: "",
      zone_1_climate: "",
      zone_1_sensor: "",
      zone_2_name: "",
      zone_2_climate: "",
      zone_2_sensor: "",
      water_name: "Hot Water Boost",
      water_entity: "",
      water_sensor: "",
    };
  }

  _normalizeConfig(raw) {
    const cfg = { ...raw };

    if (cfg.up_climate !== undefined && cfg.zone_1_climate === undefined) {
      cfg.zone_1_name = cfg.up_name ?? "";
      cfg.zone_1_climate = cfg.up_climate;
      cfg.zone_1_sensor = cfg.up_sensor || "";
    }
    if (cfg.down_climate !== undefined && cfg.zone_2_climate === undefined) {
      cfg.zone_2_name = cfg.down_name ?? "";
      cfg.zone_2_climate = cfg.down_climate;
      cfg.zone_2_sensor = cfg.down_sensor || "";
    }

    if (cfg.zone_count === undefined) {
      let count = 0;
      for (let i = 1; i <= 4; i++) {
        if (cfg[`zone_${i}_climate`]) count = i;
      }
      cfg.zone_count = count > 0 ? count : 2;
    } else {
      cfg.zone_count = Number(cfg.zone_count);
    }

    if (cfg.include_water === undefined) {
      cfg.include_water =
        cfg.water_entity !== undefined ? Boolean(cfg.water_entity) : true;
    }

    cfg.temperature = cfg.temperature !== undefined ? Number(cfg.temperature) : 21.0;
    cfg.water_name = cfg.water_name || "Hot Water Boost";

    for (let i = 1; i <= 4; i++) {
      if (cfg[`zone_${i}_name`] === undefined) {
        cfg[`zone_${i}_name`] = "";
      }
    }

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

  _syncExternalResets() {
    if (!this._hass || !this._config) return;

    for (let i = 1; i <= 4; i++) {
      const key = `zone_${i}`;
      const sensorId = this._config[`zone_${i}_sensor`];
      if (!sensorId || !this._hass.states[sensorId]) continue;
      const isActive = this._hass.states[sensorId].state === "on";
      if (this._prevActive[key] && !isActive && this._state[key] !== "Off") {
        this._state[key] = "Off";
      }
      this._prevActive[key] = isActive;
    }

    const waterSensor = this._config.water_sensor;
    if (waterSensor && this._hass.states[waterSensor]) {
      const isActive = this._hass.states[waterSensor].state === "on";
      if (this._prevActive.water && !isActive && this._state.water !== "Off") {
        this._state.water = "Off";
      }
      this._prevActive.water = isActive;
    }
  }

  _handleTap(key) {
    if (!this._hass || !this._config) return;
    const currentIdx = this._stages.indexOf(this._state[key]);
    const nextStage = this._stages[(currentIdx + 1) % this._stages.length];
    this._state[key] = nextStage;
    this._updateUI();

    if (key === "water") {
      const entity = this._config.water_entity;
      if (!entity) return;
      if (nextStage === "Off") {
        this._hass.callService("hive", "boost_hot_water_off", {
          entity_id: entity,
        });
      } else {
        this._hass.callService("hive", "boost_hot_water_on", {
          entity_id: entity,
          time_period: this._durations[nextStage],
          on_off: "on",
        });
      }
    } else {
      const entity = this._config[`${key}_climate`];
      if (!entity) return;
      if (nextStage === "Off") {
        this._hass.callService("hive", "boost_heating_off", {
          entity_id: entity,
        });
      } else {
        this._hass.callService("hive", "boost_heating_on", {
          entity_id: entity,
          time_period: this._durations[nextStage],
          temperature: Number(this._config.temperature || 21.0),
        });
      }
    }
  }

  _handleHold(key) {
    if (!this._hass || !this._config) return;
    this._state[key] = "Off";
    this._updateUI();

    if (key === "water") {
      if (this._config.water_entity) {
        this._hass.callService("hive", "boost_hot_water_off", {
          entity_id: this._config.water_entity,
        });
      }
    } else {
      const entity = this._config[`${key}_climate`];
      if (entity) {
        this._hass.callService("hive", "boost_heating_off", {
          entity_id: entity,
        });
      }
    }
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
    el.addEventListener("pointercancel", cancel);
  }

  _render() {
    if (!this._config) return;
    const count = Math.max(0, Math.min(4, Number(this._config.zone_count ?? 2)));
    const showWater = Boolean(this._config.include_water);

    let zoneCardsHtml = "";
    for (let i = 1; i <= count; i++) {
      zoneCardsHtml += `
        <ha-card id="card-zone_${i}">
          <div class="icon-wrap" id="icon-zone_${i}"><ha-icon icon="mdi:fire-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-zone_${i}">Zone ${i}</div>
            <div class="secondary" id="sub-zone_${i}">Off</div>
          </div>
        </ha-card>
      `;
    }

    const gridClass = count === 1 ? "zone-grid single" : "zone-grid multi";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
        }
        * {
          box-sizing: border-box;
        }
        .stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
        }
        .zone-grid {
          display: grid;
          gap: 10px;
          width: 100%;
        }
        .zone-grid.single {
          grid-template-columns: minmax(0, 1fr);
        }
        .zone-grid.multi {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        ha-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          min-width: 0;
          width: 100%;
          overflow: hidden;
          cursor: pointer;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.1s ease;
        }
        ha-card:active {
          transform: scale(0.98);
        }
        .icon-wrap {
          width: 38px;
          height: 38px;
          min-width: 38px;
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
          line-height: 1.25;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .secondary {
          font-size: 12px;
          line-height: 1.25;
          color: var(--secondary-text-color);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hidden {
          display: none !important;
        }
      </style>
      <div class="stack">
        ${count > 0 ? `<div class="${gridClass}">${zoneCardsHtml}</div>` : ""}
        ${
          showWater
            ? `<ha-card id="card-water">
                <div class="icon-wrap" id="icon-water"><ha-icon icon="mdi:water-boiler-off"></ha-icon></div>
                <div class="info">
                  <div class="primary" id="name-water"></div>
                  <div class="secondary" id="sub-water">Off</div>
                </div>
              </ha-card>`
            : ""
        }
        ${
          count === 0 && !showWater
            ? `<ha-card style="cursor: default;">
                <div class="info">
                  <div class="primary">Hive Boost Card</div>
                  <div class="secondary">Enable at least one heating zone or hot water in card settings.</div>
                </div>
              </ha-card>`
            : ""
        }
      </div>
    `;

    for (let i = 1; i <= count; i++) {
      const el = this.shadowRoot.getElementById(`card-zone_${i}`);
      if (el) this._bindEvents(el, `zone_${i}`);
    }
    if (showWater) {
      const waterEl = this.shadowRoot.getElementById("card-water");
      if (waterEl) this._bindEvents(waterEl, "water");
    }

    this._updateUI();
  }

  _updateUI() {
    if (!this._config) return;
    const count = Math.max(0, Math.min(4, Number(this._config.zone_count ?? 2)));

    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      const card = this.shadowRoot.getElementById(`card-${key}`);
      if (!card) continue;

      const climateId = this._config[`zone_${i}_climate`];
      const sensorId = this._config[`zone_${i}_sensor`];
      const customLabel = (this._config[`zone_${i}_name`] || "").trim();

      let displayName = customLabel;
      if (!displayName) {
        if (climateId && this._hass?.states[climateId]?.attributes?.friendly_name) {
          displayName = this._hass.states[climateId].attributes.friendly_name;
        } else {
          displayName = `Zone ${i}`;
        }
      }

      this.shadowRoot.getElementById(`name-${key}`).textContent = displayName;

      const sensorActive =
        sensorId &&
        this._hass?.states[sensorId] &&
        this._hass.states[sensorId].state === "on";
      const stage = this._state[key];
      const isActive = stage !== "Off" || sensorActive;

      const iconWrap = this.shadowRoot.getElementById(`icon-${key}`);
      iconWrap.classList.toggle("active", isActive);
      iconWrap
        .querySelector("ha-icon")
        .setAttribute("icon", isActive ? "mdi:fire" : "mdi:fire-off");

      const statusText = stage !== "Off" ? stage : sensorActive ? "Active" : "Off";

      if (!climateId) {
        this.shadowRoot.getElementById(`sub-${key}`).textContent = "Select entity";
      } else if (this._hass?.states[climateId]) {
        const temp = this._hass.states[climateId].attributes.current_temperature;
        this.shadowRoot.getElementById(`sub-${key}`).textContent =
          temp !== undefined ? `${temp}°C • ${statusText}` : statusText;
      } else {
        this.shadowRoot.getElementById(`sub-${key}`).textContent = statusText;
      }
    }

    if (this._config.include_water) {
      const waterCard = this.shadowRoot.getElementById("card-water");
      if (waterCard) {
        this.shadowRoot.getElementById("name-water").textContent =
          this._config.water_name || "Hot Water Boost";

        const sensorId = this._config.water_sensor;
        const sensorActive =
          sensorId &&
          this._hass?.states[sensorId] &&
          this._hass.states[sensorId].state === "on";
        const stage = this._state.water;
        const isActive = stage !== "Off" || sensorActive;

        const iconWrap = this.shadowRoot.getElementById("icon-water");
        iconWrap.classList.toggle("active", isActive);
        iconWrap
          .querySelector("ha-icon")
          .setAttribute(
            "icon",
            isActive ? "mdi:water-boiler" : "mdi:water-boiler-off"
          );

        const statusText =
          stage !== "Off" ? stage : sensorActive ? "Active" : "Off";
        this.shadowRoot.getElementById("sub-water").textContent = this._config
          .water_entity
          ? statusText
          : "Select entity";
      }
    }
  }
}

class HiveBoostCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._renderedStructureKey = "";
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._config.zone_count === undefined) {
      let count = 0;
      for (let i = 1; i <= 4; i++) {
        if (this._config[`zone_${i}_climate`] || (i === 1 && this._config.up_climate) || (i === 2 && this._config.down_climate)) {
          count = i;
        }
      }
      this._config.zone_count = count > 0 ? count : 2;
    } else {
      this._config.zone_count = Number(this._config.zone_count);
    }

    if (this._config.include_water === undefined) {
      this._config.include_water =
        this._config.water_entity !== undefined
          ? Boolean(this._config.water_entity)
          : true;
    }
    if (this._config.temperature === undefined) {
      this._config.temperature = 21.0;
    }
    if (this._config.water_name === undefined) {
      this._config.water_name = "Hot Water Boost";
    }

    for (let i = 1; i <= 4; i++) {
      if (this._config[`zone_${i}_name`] === undefined) {
        this._config[`zone_${i}_name`] = "";
      }
    }

    if (this._config.up_climate && !this._config.zone_1_climate) {
      this._config.zone_1_name = this._config.up_name ?? "";
      this._config.zone_1_climate = this._config.up_climate;
      this._config.zone_1_sensor = this._config.up_sensor || "";
    }
    if (this._config.down_climate && !this._config.zone_2_climate) {
      this._config.zone_2_name = this._config.down_name ?? "";
      this._config.zone_2_climate = this._config.down_climate;
      this._config.zone_2_sensor = this._config.down_sensor || "";
    }

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this.shadowRoot.querySelectorAll("ha-form").forEach((form) => {
      form.hass = hass;
    });
  }

  _emitConfig(newConfig) {
    this._config = newConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: newConfig },
        bubbles: true,
        composed: true,
      })
    );
  }

  _updateField(key, value) {
    const updated = { ...this._config, [key]: value };
    this._emitConfig(updated);
  }

  _createHaForm(schema, data) {
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = data;
    form.schema = schema;
    form.computeLabel = (s) => s.label || s.name;
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      const updated = { ...this._config, ...ev.detail.value };
      this._emitConfig(updated);
    });
    return form;
  }

  _render() {
    if (!this._config) return;
    const count = Math.max(0, Math.min(4, Number(this._config.zone_count ?? 2)));
    const showWater = Boolean(this._config.include_water);
    const structureKey = `${count}_${showWater}`;

    // Only rebuild the DOM when the number of zones or hot water toggle changes.
    // This prevents input focus loss and mobile keyboard dismissal while typing!
    if (this._renderedStructureKey === structureKey) {
      this._syncValues();
      return;
    }

    this._renderedStructureKey = structureKey;
    this.shadowRoot.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = `
      .editor-container {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding-bottom: 8px;
      }
      .section-box {
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 14px;
        padding: 14px;
        background: var(--card-background-color, transparent);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 28px;
      }
      .section-title {
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--primary-color, #03a9f4);
      }
      .section-subtitle {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: -6px;
        margin-bottom: 2px;
      }
      .switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px 0;
      }
      .switch-label {
        font-size: 14px;
        color: var(--primary-text-color);
      }
      .field-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .field-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--secondary-text-color);
      }
      input[type="text"] {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        font-size: 14px;
        font-family: inherit;
        color: var(--primary-text-color);
        background: var(--secondary-background-color, rgba(0, 0, 0, 0.05));
        border: 1px solid var(--divider-color, #ccc);
        border-radius: 8px;
        outline: none;
        transition: border-color 0.2s;
      }
      input[type="text"]:focus {
        border-color: var(--primary-color, #03a9f4);
      }
      .water-fields {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 2px;
      }
    `;
    this.shadowRoot.appendChild(style);

    const container = document.createElement("div");
    container.className = "editor-container";

    // 1. General Settings Section
    const generalBox = document.createElement("div");
    generalBox.className = "section-box";
    generalBox.innerHTML = `<div class="section-title">General Settings</div>`;
    const generalForm = this._createHaForm(
      [
        {
          name: "zone_count",
          label: "Number of Heating Zones",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: 0, label: "0 Zones (Hot Water Only)" },
                { value: 1, label: "1 Zone" },
                { value: 2, label: "2 Zones" },
                { value: 3, label: "3 Zones" },
                { value: 4, label: "4 Zones" },
              ],
            },
          },
        },
        {
          name: "temperature",
          label: "Boost Target Temperature (°C)",
          selector: { number: { min: 10, max: 30, step: 0.5, mode: "box" } },
        },
      ],
      this._config
    );
    generalForm.id = "form-general";
    generalBox.appendChild(generalForm);
    container.appendChild(generalBox);

    // 2. Heating Zone Sections
    for (let i = 1; i <= count; i++) {
      const zoneBox = document.createElement("div");
      zoneBox.className = "section-box";
      zoneBox.innerHTML = `
        <div class="section-title">Heating Zone ${i}</div>
        <div class="section-subtitle">Leave label blank to use the climate entity name</div>
      `;

      // Native input prevents ha-form re-render focus loss while typing
      const labelGroup = document.createElement("div");
      labelGroup.className = "field-group";
      labelGroup.innerHTML = `<label class="field-label" for="input-zone_${i}_name">Zone ${i} Custom Label (Optional)</label>`;
      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.id = `input-zone_${i}_name`;
      textInput.placeholder = `e.g. Upstairs or Zone ${i}`;
      textInput.value = this._config[`zone_${i}_name`] || "";
      textInput.addEventListener("input", (e) => {
        this._updateField(`zone_${i}_name`, e.target.value);
      });
      labelGroup.appendChild(textInput);
      zoneBox.appendChild(labelGroup);

      const zoneForm = this._createHaForm(
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
        this._config
      );
      zoneForm.id = `form-zone_${i}`;
      zoneBox.appendChild(zoneForm);
      container.appendChild(zoneBox);
    }

    // 3. Hot Water Section (compact switch + fields, zero extra whitespace)
    const waterBox = document.createElement("div");
    waterBox.className = "section-box";

    const waterHeader = document.createElement("div");
    waterHeader.className = "section-header";
    waterHeader.innerHTML = `<div class="section-title">Hot Water</div>`;
    waterBox.appendChild(waterHeader);

    const switchRow = document.createElement("div");
    switchRow.className = "switch-row";
    switchRow.innerHTML = `<span class="switch-label">Include Hot Water Boost</span>`;

    const haSwitch = document.createElement("ha-switch");
    haSwitch.id = "switch-include_water";
    haSwitch.checked = showWater;
    haSwitch.addEventListener("change", (e) => {
      this._updateField("include_water", e.target.checked);
    });
    switchRow.appendChild(haSwitch);
    waterBox.appendChild(switchRow);

    if (showWater) {
      const waterFields = document.createElement("div");
      waterFields.className = "water-fields";

      const waterLabelGroup = document.createElement("div");
      waterLabelGroup.className = "field-group";
      waterLabelGroup.innerHTML = `<label class="field-label" for="input-water_name">Hot Water Label</label>`;
      const waterInput = document.createElement("input");
      waterInput.type = "text";
      waterInput.id = "input-water_name";
      waterInput.placeholder = "Hot Water Boost";
      waterInput.value = this._config.water_name || "";
      waterInput.addEventListener("input", (e) => {
        this._updateField("water_name", e.target.value);
      });
      waterLabelGroup.appendChild(waterInput);
      waterFields.appendChild(waterLabelGroup);

      const waterForm = this._createHaForm(
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
        ],
        this._config
      );
      waterForm.id = "form-water";
      waterFields.appendChild(waterForm);
      waterBox.appendChild(waterFields);
    }

    container.appendChild(waterBox);
    this.shadowRoot.appendChild(container);
  }

  _syncValues() {
    const generalForm = this.shadowRoot.getElementById("form-general");
    if (generalForm) generalForm.data = this._config;

    const count = Math.max(0, Math.min(4, Number(this._config.zone_count ?? 2)));
    for (let i = 1; i <= count; i++) {
      const input = this.shadowRoot.getElementById(`input-zone_${i}_name`);
      if (input && this.shadowRoot.activeElement !== input) {
        input.value = this._config[`zone_${i}_name`] || "";
      }
      const zForm = this.shadowRoot.getElementById(`form-zone_${i}`);
      if (zForm) zForm.data = this._config;
    }

    const sw = this.shadowRoot.getElementById("switch-include_water");
    if (sw) sw.checked = Boolean(this._config.include_water);

    const wInput = this.shadowRoot.getElementById("input-water_name");
    if (wInput && this.shadowRoot.activeElement !== wInput) {
      wInput.value = this._config.water_name || "";
    }
    const wForm = this.shadowRoot.getElementById("form-water");
    if (wForm) wForm.data = this._config;
  }
}

customElements.define("hive-boost-card", HiveBoostCard);
customElements.define("hive-boost-card-editor", HiveBoostCardEditor);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "hive-boost-card")) {
  window.customCards.push({
    type: "hive-boost-card",
    name: "Hive Boost Card",
    description: "Multi-zone Hive heating and hot water cycle boost buttons",
    preview: true,
  });
}
