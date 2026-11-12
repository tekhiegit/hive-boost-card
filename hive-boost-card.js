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
    this._state = { zone_1: "Off", zone_2: "Off", zone_3: "Off", zone_4: "Off", water: "Off" };
    this._prevActive = { zone_1: false, zone_2: false, zone_3: false, zone_4: false, water: false };
    this._holdTimers = {};
    this._holdTriggered = {};
  }

  static getConfigElement() {
    return document.createElement("hive-boost-card-editor");
  }

  static getStubConfig() {
    return {
      zone_count: 2,
      temperature: 21.0,
      include_water: true,
      zone_1_name: "Upstairs",
      zone_1_climate: "",
      zone_1_sensor: "",
      zone_2_name: "Downstairs",
      zone_2_climate: "",
      zone_2_sensor: "",
      water_name: "Hot Water Boost",
      water_entity: "",
      water_sensor: "",
    };
  }

  setConfig(config) {
    // Support legacy up_*/down_* keys seamlessly
    const normalized = { ...config };
    if (normalized.zone_count === undefined) {
      normalized.zone_count = 2;
    }
    if (normalized.include_water === undefined) {
      normalized.include_water = true;
    }
    if (normalized.up_climate && !normalized.zone_1_climate) {
      normalized.zone_1_name = normalized.up_name || "Upstairs";
      normalized.zone_1_climate = normalized.up_climate;
      normalized.zone_1_sensor = normalized.up_sensor || "";
    }
    if (normalized.down_climate && !normalized.zone_2_climate) {
      normalized.zone_2_name = normalized.down_name || "Downstairs";
      normalized.zone_2_climate = normalized.down_climate;
      normalized.zone_2_sensor = normalized.down_sensor || "";
    }

    this._config = {
      temperature: 21.0,
      zone_1_name: "Zone 1",
      zone_2_name: "Zone 2",
      zone_3_name: "Zone 3",
      zone_4_name: "Zone 4",
      water_name: "Hot Water Boost",
      ...normalized,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._syncExternalResets();
    this._updateUI();
  }

  _syncExternalResets() {
    if (!this._hass || !this._config) return;
    const keys = ["zone_1", "zone_2", "zone_3", "zone_4", "water"];
    keys.forEach((key) => {
      const sensorId = key === "water" ? this._config.water_sensor : this._config[`${key}_sensor`];
      if (!sensorId || !this._hass.states[sensorId]) return;
      const isActive = this._hass.states[sensorId].state === "on";
      if (this._prevActive[key] && !isActive && this._state[key] !== "Off") {
        this._state[key] = "Off";
      }
      this._prevActive[key] = isActive;
    });
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
        this._hass.callService("hive", "boost_hot_water_off", { entity_id: entity });
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
        this._hass.callService("hive", "boost_heating_off", { entity_id: entity });
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

    if (key === "water" && this._config.water_entity) {
      this._hass.callService("hive", "boost_hot_water_off", {
        entity_id: this._config.water_entity,
      });
    } else if (this._config[`${key}_climate`]) {
      this._hass.callService("hive", "boost_heating_off", {
        entity_id: this._config[`${key}_climate`],
      });
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
  }

  _render() {
    const count = Number(this._config.zone_count ?? 2);
    const showWater = this._config.include_water !== false;
    const cols = count === 1 ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))";

    let zoneCardsHtml = "";
    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      zoneCardsHtml += `
        <ha-card id="card-${key}">
          <div class="icon-wrap" id="icon-${key}"><ha-icon icon="mdi:fire-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-${key}"></div>
            <div class="secondary" id="sub-${key}">Off</div>
          </div>
        </ha-card>
      `;
    }

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
        ${
          showWater
            ? `
          <ha-card id="card-water">
            <div class="icon-wrap" id="icon-water"><ha-icon icon="mdi:water-boiler-off"></ha-icon></div>
            <div class="info">
              <div class="primary" id="name-water"></div>
              <div class="secondary" id="sub-water">Off</div>
            </div>
          </ha-card>
        `
            : ""
        }
      </div>
    `;

    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      const el = this.shadowRoot.getElementById(`card-${key}`);
      if (el) this._bindEvents(el, key);
    }
    if (showWater) {
      const waterEl = this.shadowRoot.getElementById("card-water");
      if (waterEl) this._bindEvents(waterEl, "water");
    }

    this._updateUI();
  }

  _updateUI() {
    if (!this._config) return;
    const count = Number(this._config.zone_count ?? 2);
    const showWater = this._config.include_water !== false;

    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      const card = this.shadowRoot.getElementById(`card-${key}`);
      if (!card) continue;

      const name = this._config[`${key}_name`] || `Zone ${i}`;
      const climate = this._config[`${key}_climate`];
      const sensor = this._config[`${key}_sensor`];

      this.shadowRoot.getElementById(`name-${key}`).textContent = name;

      const sensorActive =
        sensor &&
        this._hass?.states[sensor] &&
        this._hass.states[sensor].state === "on";
      const stage = this._state[key];
      const isActive = stage !== "Off" || sensorActive;

      const iconWrap = this.shadowRoot.getElementById(`icon-${key}`);
      iconWrap.classList.toggle("active", isActive);
      iconWrap
        .querySelector("ha-icon")
        .setAttribute("icon", isActive ? "mdi:fire" : "mdi:fire-off");

      const statusText = stage !== "Off" ? stage : sensorActive ? "Active" : "Off";
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

    if (showWater) {
      const waterCard = this.shadowRoot.getElementById("card-water");
      if (waterCard) {
        this.shadowRoot.getElementById("name-water").textContent =
          this._config.water_name || "Hot Water Boost";

        const sensor = this._config.water_sensor;
        const sensorActive =
          sensor &&
          this._hass?.states[sensor] &&
          this._hass.states[sensor].state === "on";
        const stage = this._state.water;
        const isActive = stage !== "Off" || sensorActive;

        const iconWrap = this.shadowRoot.getElementById("icon-water");
        iconWrap.classList.toggle("active", isActive);
        iconWrap
          .querySelector("ha-icon")
          .setAttribute("icon", isActive ? "mdi:water-boiler" : "mdi:water-boiler-off");

        const statusText = stage !== "Off" ? stage : sensorActive ? "Active" : "Off";
        this.shadowRoot.getElementById("sub-water").textContent = !this._config.water_entity
          ? "Select entity in editor"
          : statusText;
      }
    }
  }
}

class HiveBoostCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._forms = {};
  }

  setConfig(config) {
    const normalized = { ...config };
    if (normalized.zone_count === undefined) normalized.zone_count = 2;
    if (normalized.include_water === undefined) normalized.include_water = true;
    if (normalized.temperature === undefined) normalized.temperature = 21.0;

    if (normalized.up_climate && !normalized.zone_1_climate) {
      normalized.zone_1_name = normalized.up_name || "Upstairs";
      normalized.zone_1_climate = normalized.up_climate;
      normalized.zone_1_sensor = normalized.up_sensor || "";
    }
    if (normalized.down_climate && !normalized.zone_2_climate) {
      normalized.zone_2_name = normalized.down_name || "Downstairs";
      normalized.zone_2_climate = normalized.down_climate;
      normalized.zone_2_sensor = normalized.down_sensor || "";
    }

    const prevCount = this._config?.zone_count;
    const prevWater = this._config?.include_water;
    this._config = normalized;

    if (!this._rendered || prevCount !== normalized.zone_count || prevWater !== normalized.include_water) {
      this._render();
    } else {
      Object.values(this._forms).forEach((form) => {
        form.data = this._config;
      });
    }
  }

  set hass(hass) {
    this._hass = hass;
    Object.values(this._forms).forEach((form) => {
      form.hass = hass;
    });
  }

  _emitChange(newData) {
    this._config = { ...this._config, ...newData };
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _createFormSection(id, title, schema) {
    const box = document.createElement("div");
    box.className = "section-box";

    const header = document.createElement("div");
    header.className = "section-title";
    header.textContent = title;
    box.appendChild(header);

    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._config;
    form.schema = schema;
    form.computeLabel = (s) => s.label || s.name;
    form.addEventListener("value-changed", (ev) => {
      this._emitChange(ev.detail.value);
    });

    this._forms[id] = form;
    box.appendChild(form);
    return box;
  }

  _render() {
    this._rendered = true;
    this._forms = {};
    const count = Number(this._config.zone_count ?? 2);
    const showWater = this._config.include_water !== false;

    this.shadowRoot.innerHTML = `
      <style>
        .editor-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 4px 0;
        }
        .section-box {
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 14px;
          padding: 14px 16px;
          background: var(--card-background-color, transparent);
        }
        .section-title {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--primary-color, #03a9f4);
          margin-bottom: 12px;
        }
      </style>
      <div class="editor-container" id="container"></div>
    `;

    const container = this.shadowRoot.getElementById("container");

    // 1. General Settings
    container.appendChild(
      this._createFormSection("general", "General Settings", [
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
      ])
    );

    // 2. Heating Zones
    for (let i = 1; i <= count; i++) {
      container.appendChild(
        this._createFormSection(`zone_${i}`, `Heating Zone ${i}`, [
          {
            name: `zone_${i}_name`,
            label: `Zone ${i} Label`,
            selector: { text: {} },
          },
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
    }

    // 3. Hot Water
    const waterSchema = [
      {
        name: "include_water",
        label: "Include Hot Water Boost",
        selector: { boolean: {} },
      },
    ];
    if (showWater) {
      waterSchema.push(
        {
          name: "water_name",
          label: "Hot Water Label",
          selector: { text: {} },
        },
        {
          name: "water_entity",
          label: "Hot Water Entity",
          selector: { entity: { domain: "water_heater" } },
        },
        {
          name: "water_sensor",
          label: "Hot Water Boost Sensor (Optional)",
          selector: { entity: { domain: "binary_sensor" } },
        }
      );
    }
    container.appendChild(
      this._createFormSection("water", "Hot Water", waterSchema)
    );
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
