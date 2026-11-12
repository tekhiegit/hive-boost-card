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
    this._state = { z1: "Off", z2: "Off", z3: "Off", z4: "Off", water: "Off" };
    this._prevActive = { z1: false, z2: false, z3: false, z4: false, water: false };
    this._holdTimers = {};
    this._holdTriggered = {};
    this._debounceTimers = {};
    this._pendingSend = {};
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
      water_name: "",
      water_entity: "",
      water_sensor: "",
    };
  }

  _normalizeConfig(config) {
    const cfg = { ...config };
    if (cfg.zone_count === undefined) {
      let count = 0;
      if (cfg.zone_1_climate || cfg.up_climate) count = 1;
      if (cfg.zone_2_climate || cfg.down_climate) count = 2;
      if (cfg.zone_3_climate) count = 3;
      if (cfg.zone_4_climate) count = 4;
      cfg.zone_count = count || 2;
    }
    if (cfg.include_water === undefined) {
      cfg.include_water = true;
    }
    if (cfg.temperature === undefined) {
      cfg.temperature = 21.0;
    }
    if (cfg.up_name !== undefined && cfg.zone_1_name === undefined) cfg.zone_1_name = cfg.up_name;
    if (cfg.up_climate !== undefined && cfg.zone_1_climate === undefined) cfg.zone_1_climate = cfg.up_climate;
    if (cfg.up_sensor !== undefined && cfg.zone_1_sensor === undefined) cfg.zone_1_sensor = cfg.up_sensor;
    if (cfg.down_name !== undefined && cfg.zone_2_name === undefined) cfg.zone_2_name = cfg.down_name;
    if (cfg.down_climate !== undefined && cfg.zone_2_climate === undefined) cfg.zone_2_climate = cfg.down_climate;
    if (cfg.down_sensor !== undefined && cfg.zone_2_sensor === undefined) cfg.zone_2_sensor = cfg.down_sensor;
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
    const map = {
      z1: this._config.zone_1_sensor,
      z2: this._config.zone_2_sensor,
      z3: this._config.zone_3_sensor,
      z4: this._config.zone_4_sensor,
      water: this._config.water_sensor,
    };

    Object.entries(map).forEach(([key, sensorId]) => {
      if (!sensorId || !this._hass.states[sensorId]) return;
      const isActive = this._hass.states[sensorId].state === "on";
      if (!this._pendingSend[key] && this._prevActive[key] && !isActive && this._state[key] !== "Off") {
        this._state[key] = "Off";
      }
      this._prevActive[key] = isActive;
    });
  }

  _dispatchBoostCommand(key, targetStage) {
    if (!this._hass || !this._config) return;

    if (key === "water") {
      const entity = this._config.water_entity;
      if (!entity) return;
      if (targetStage === "Off") {
        this._hass.callService("hive", "boost_hot_water_off", {
          entity_id: entity,
        });
      } else {
        this._hass.callService("hive", "boost_hot_water_on", {
          entity_id: entity,
          time_period: this._durations[targetStage],
          on_off: "on",
        });
      }
    } else {
      const idx = key.replace("z", "");
      const entity = this._config[`zone_${idx}_climate`];
      if (!entity) return;
      if (targetStage === "Off") {
        this._hass.callService("hive", "boost_heating_off", {
          entity_id: entity,
        });
      } else {
        this._hass.callService("hive", "boost_heating_on", {
          entity_id: entity,
          time_period: this._durations[targetStage],
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

    this._pendingSend[key] = true;
    this._updateUI();

    this._debounceTimers[key] = setTimeout(() => {
      this._pendingSend[key] = false;
      delete this._debounceTimers[key];
      this._dispatchBoostCommand(key, this._state[key]);
      this._updateUI();
    }, 1500);
  }

  _handleHold(key) {
    if (!this._hass || !this._config) return;

    if (this._debounceTimers[key]) {
      clearTimeout(this._debounceTimers[key]);
      delete this._debounceTimers[key];
    }
    this._pendingSend[key] = false;
    this._state[key] = "Off";
    this._updateUI();

    this._dispatchBoostCommand(key, "Off");
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
    const count = Number(this._config.zone_count ?? 2);
    const showWater = Boolean(this._config.include_water);

    let zoneCardsHtml = "";
    for (let i = 1; i <= count; i++) {
      zoneCardsHtml += `
        <ha-card id="card-z${i}">
          <div class="icon-wrap" id="icon-z${i}"><ha-icon icon="mdi:fire-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-z${i}">Zone ${i}</div>
            <div class="secondary" id="sub-z${i}">Off</div>
          </div>
        </ha-card>
      `;
    }

    const waterCardHtml = showWater
      ? `
        <ha-card id="card-water">
          <div class="icon-wrap" id="icon-water"><ha-icon icon="mdi:water-boiler-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-water">Hot Water Boost</div>
            <div class="secondary" id="sub-water">Off</div>
          </div>
        </ha-card>
      `
      : "";

    const cols = count === 1 ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))";

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
          box-sizing: border-box;
        }
        .zones-grid {
          display: grid;
          grid-template-columns: ${cols};
          gap: 10px;
          width: 100%;
          box-sizing: border-box;
        }
        ha-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          cursor: pointer;
          user-select: none;
          min-width: 0;
          width: 100%;
          box-sizing: border-box;
          overflow: hidden;
          transition: transform 0.1s ease;
        }
        ha-card:active { transform: scale(0.98); }
        .icon-wrap {
          width: 38px;
          height: 38px;
          min-width: 38px;
          border-radius: 50%;
          flex-shrink: 0;
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
        .icon-wrap.pending {
          animation: pulse 0.9s infinite alternate;
        }
        @keyframes pulse {
          from { opacity: 1; }
          to { opacity: 0.45; }
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
        .hidden { display: none !important; }
      </style>
      <div class="grid">
        ${count > 0 ? `<div class="zones-grid">${zoneCardsHtml}</div>` : ""}
        ${waterCardHtml}
      </div>
    `;

    for (let i = 1; i <= count; i++) {
      this._bindEvents(this.shadowRoot.getElementById(`card-z${i}`), `z${i}`);
    }
    if (showWater) {
      this._bindEvents(this.shadowRoot.getElementById("card-water"), "water");
    }
    this._updateUI();
  }

  _resolveLabel(customLabel, entityId, fallback) {
    if (customLabel && customLabel.trim() !== "") {
      return customLabel.trim();
    }
    if (entityId && this._hass?.states[entityId]?.attributes?.friendly_name) {
      return this._hass.states[entityId].attributes.friendly_name;
    }
    return fallback;
  }

  _updateUI() {
    if (!this._config) return;
    const count = Number(this._config.zone_count ?? 2);

    for (let i = 1; i <= count; i++) {
      const key = `z${i}`;
      const card = this.shadowRoot.getElementById(`card-${key}`);
      if (!card) continue;

      const climate = this._config[`zone_${i}_climate`];
      const sensor = this._config[`zone_${i}_sensor`];
      const label = this._resolveLabel(this._config[`zone_${i}_name`], climate, `Zone ${i}`);

      this.shadowRoot.getElementById(`name-${key}`).textContent = label;

      const sensorActive =
        sensor &&
        this._hass?.states[sensor] &&
        this._hass.states[sensor].state === "on";
      const stage = this._state[key];
      const isPending = Boolean(this._pendingSend[key]);
      const isActive = stage !== "Off" || sensorActive;

      const iconWrap = this.shadowRoot.getElementById(`icon-${key}`);
      iconWrap.classList.toggle("active", isActive);
      iconWrap.classList.toggle("pending", isPending);
      iconWrap.querySelector("ha-icon").setAttribute("icon", isActive ? "mdi:fire" : "mdi:fire-off");

      const baseStatus = stage !== "Off" ? stage : sensorActive ? "Active" : "Off";
      const statusText = isPending ? `${baseStatus}…` : baseStatus;

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

    if (this._config.include_water) {
      const card = this.shadowRoot.getElementById("card-water");
      if (!card) return;

      const entity = this._config.water_entity;
      const sensor = this._config.water_sensor;
      const label = this._resolveLabel(this._config.water_name, entity, "Hot Water Boost");

      this.shadowRoot.getElementById("name-water").textContent = label;

      const sensorActive =
        sensor &&
        this._hass?.states[sensor] &&
        this._hass.states[sensor].state === "on";
      const stage = this._state.water;
      const isPending = Boolean(this._pendingSend.water);
      const isActive = stage !== "Off" || sensorActive;

      const iconWrap = this.shadowRoot.getElementById("icon-water");
      iconWrap.classList.toggle("active", isActive);
      iconWrap.classList.toggle("pending", isPending);
      iconWrap.querySelector("ha-icon").setAttribute("icon", isActive ? "mdi:water-boiler" : "mdi:water-boiler-off");

      const baseStatus = stage !== "Off" ? stage : sensorActive ? "Active" : "Off";
      const statusText = isPending ? `${baseStatus}…` : baseStatus;

      this.shadowRoot.getElementById("sub-water").textContent = entity ? statusText : "Select entity";
    }
  }
}

class HiveBoostCardEditor extends HTMLElement {
  constructor() {
    super();
    this._renderedSignature = null;
    this._forms = {};
    this._inputs = {};
  }

  setConfig(config) {
    this._config = {
      zone_count: 2,
      include_water: true,
      temperature: 21.0,
      ...config,
    };
    const count = Number(this._config.zone_count ?? 2);
    const showWater = Boolean(this._config.include_water);
    const signature = `${count}-${showWater}`;

    if (this._renderedSignature !== signature) {
      this._renderedSignature = signature;
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

  _emitChange(updatedFields) {
    const newConfig = { ...this._config, ...updatedFields };
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
    if (this._forms.general) {
      this._forms.general.data = {
        zone_count: Number(this._config.zone_count ?? 2),
        temperature: Number(this._config.temperature ?? 21.0),
      };
    }
    const count = Number(this._config.zone_count ?? 2);
    for (let i = 1; i <= count; i++) {
      if (this._forms[`zone_${i}`]) {
        this._forms[`zone_${i}`].data = {
          [`zone_${i}_climate`]: this._config[`zone_${i}_climate`] || "",
          [`zone_${i}_sensor`]: this._config[`zone_${i}_sensor`] || "",
        };
      }
      const inp = this._inputs[`zone_${i}_name`];
      if (inp && document.activeElement !== inp) {
        inp.value = this._config[`zone_${i}_name`] || "";
      }
    }
    if (this._waterSwitch) {
      this._waterSwitch.checked = Boolean(this._config.include_water);
    }
    if (this._forms.water) {
      this._forms.water.data = {
        water_entity: this._config.water_entity || "",
        water_sensor: this._config.water_sensor || "",
      };
    }
    const wInp = this._inputs.water_name;
    if (wInp && document.activeElement !== wInp) {
      wInp.value = this._config.water_name || "";
    }
  }

  _createTextField(key, labelText, placeholderText) {
    const wrap = document.createElement("div");
    wrap.className = "text-field";

    const label = document.createElement("label");
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholderText;
    input.value = this._config[key] || "";

    input.addEventListener("input", (e) => {
      this._emitChange({ [key]: e.target.value });
    });
    input.addEventListener("change", (e) => {
      this._emitChange({ [key]: e.target.value });
    });

    this._inputs[key] = input;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  _createHaForm(id, schema, data) {
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.schema = schema;
    form.data = data;
    form.computeLabel = (s) => s.label || s.name;
    form.addEventListener("value-changed", (ev) => {
      this._emitChange(ev.detail.value);
    });
    this._forms[id] = form;
    return form;
  }

  _createBox(titleText) {
    const box = document.createElement("div");
    box.className = "group-box";
    if (titleText) {
      const title = document.createElement("div");
      title.className = "group-title";
      title.textContent = titleText;
      box.appendChild(title);
    }
    return box;
  }

  _render() {
    this.innerHTML = "";
    this._forms = {};
    this._inputs = {};

    const style = document.createElement("style");
    style.textContent = `
      .editor-wrapper {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 4px 0;
        width: 100%;
        box-sizing: border-box;
      }
      .group-box {
        border: 1.5px solid var(--divider-color, rgba(127, 127, 127, 0.35));
        border-radius: 14px;
        padding: 14px;
        background: var(--card-background-color, transparent);
        box-sizing: border-box;
      }
      .group-title {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: var(--secondary-text-color);
        margin-bottom: 10px;
      }
      .text-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
      }
      .text-field label {
        font-size: 12px;
        font-weight: 500;
        color: var(--secondary-text-color);
      }
      .text-field input {
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
      }
      .text-field input:focus {
        border-color: var(--primary-color, #ff5722);
      }
      .switch-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 36px;
        margin-bottom: 0;
      }
      .switch-row.has-fields {
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2));
      }
      .switch-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
      }
    `;
    this.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = "editor-wrapper";

    const count = Number(this._config.zone_count ?? 2);
    const showWater = Boolean(this._config.include_water);

    const generalBox = this._createBox("General Settings");
    generalBox.appendChild(
      this._createHaForm(
        "general",
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
        {
          zone_count: count,
          temperature: Number(this._config.temperature ?? 21.0),
        }
      )
    );
    wrapper.appendChild(generalBox);

    for (let i = 1; i <= count; i++) {
      const zoneBox = this._createBox(`Heating Zone ${i}`);
      zoneBox.appendChild(
        this._createTextField(
          `zone_${i}_name`,
          `Zone ${i} Custom Label (Optional)`,
          `Defaults to entity name or Zone ${i}`
        )
      );
      zoneBox.appendChild(
        this._createHaForm(
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
          {
            [`zone_${i}_climate`]: this._config[`zone_${i}_climate`] || "",
            [`zone_${i}_sensor`]: this._config[`zone_${i}_sensor`] || "",
          }
        )
      );
      wrapper.appendChild(zoneBox);
    }

    const waterBox = this._createBox("Hot Water");
    const switchRow = document.createElement("div");
    switchRow.className = showWater ? "switch-row has-fields" : "switch-row";

    const switchLabel = document.createElement("span");
    switchLabel.className = "switch-label";
    switchLabel.textContent = "Include Hot Water Boost";

    const sw = document.createElement("ha-switch");
    sw.checked = showWater;
    sw.addEventListener("change", (e) => {
      this._emitChange({ include_water: e.target.checked });
    });
    this._waterSwitch = sw;

    switchRow.appendChild(switchLabel);
    switchRow.appendChild(sw);
    waterBox.appendChild(switchRow);

    if (showWater) {
      waterBox.appendChild(
        this._createTextField(
          "water_name",
          "Hot Water Custom Label (Optional)",
          "Defaults to entity name or Hot Water Boost"
        )
      );
      waterBox.appendChild(
        this._createHaForm(
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
          ],
          {
            water_entity: this._config.water_entity || "",
            water_sensor: this._config.water_sensor || "",
          }
        )
      );
    }
    wrapper.appendChild(waterBox);

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
