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
    this._state = {};
    this._prevActive = {};
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
      zone_1_name: "Upstairs",
      zone_1_climate: "",
      zone_1_sensor: "",
      zone_2_name: "Downstairs",
      zone_2_climate: "",
      zone_2_sensor: "",
      water_enabled: true,
      water_name: "Hot Water Boost",
      water_entity: "",
      water_sensor: "",
    };
  }

  setConfig(config) {
    // Support legacy up_/down_ keys seamlessly if migrating
    const migrated = { ...config };
    if (migrated.up_climate && !migrated.zone_1_climate) {
      migrated.zone_1_climate = migrated.up_climate;
      migrated.zone_1_name = migrated.up_name || "Upstairs";
      migrated.zone_1_sensor = migrated.up_sensor || "";
    }
    if (migrated.down_climate && !migrated.zone_2_climate) {
      migrated.zone_2_climate = migrated.down_climate;
      migrated.zone_2_name = migrated.down_name || "Downstairs";
      migrated.zone_2_sensor = migrated.down_sensor || "";
    }

    this._config = {
      zone_count: 2,
      temperature: 21.0,
      water_enabled: true,
      water_name: "Hot Water Boost",
      ...migrated,
    };

    const count = Number(this._config.zone_count) || 0;
    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      if (!this._state[key]) this._state[key] = "Off";
    }
    if (!this._state.water) this._state.water = "Off";

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._syncExternalResets();
    this._updateUI();
  }

  _syncExternalResets() {
    if (!this._hass || !this._config) return;
    const count = Number(this._config.zone_count) || 0;

    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      const sensorId = this._config[`${key}_sensor`];
      this._checkSensorReset(key, sensorId);
    }

    if (this._config.water_enabled) {
      this._checkSensorReset("water", this._config.water_sensor);
    }
  }

  _checkSensorReset(key, sensorId) {
    if (!sensorId || !this._hass.states[sensorId]) return;
    const isActive = this._hass.states[sensorId].state === "on";
    if (this._prevActive[key] && !isActive && this._state[key] !== "Off") {
      this._state[key] = "Off";
    }
    this._prevActive[key] = isActive;
  }

  _handleTap(key) {
    if (!this._hass || !this._config) return;
    const currentIdx = this._stages.indexOf(this._state[key] || "Off");
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

    if (key === "water" && this._config.water_entity) {
      this._hass.callService("hive", "boost_hot_water_off", {
        entity_id: this._config.water_entity,
      });
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
  }

  _render() {
    if (!this._config) return;
    const count = Number(this._config.zone_count) || 0;
    const showWater = this._config.water_enabled !== false;

    let zoneCardsHtml = "";
    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      zoneCardsHtml += `
        <ha-card id="card-${key}">
          <div class="icon-wrap" id="icon-${key}"><ha-icon icon="mdi:fire-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-${key}">Zone ${i}</div>
            <div class="secondary" id="sub-${key}">Off</div>
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

    const gridCols = count === 1 ? "1fr" : "1fr 1fr";

    this.shadowRoot.innerHTML = `
      <style>
        .grid { display: flex; flex-direction: column; gap: 10px; }
        .zones-grid { display: grid; grid-template-columns: ${gridCols}; gap: 10px; }
        ha-card {
          display: flex; align-items: center; gap: 12px;
          padding: 12px; cursor: pointer; user-select: none;
          transition: transform 0.1s ease;
        }
        ha-card:active { transform: scale(0.98); }
        .icon-wrap {
          width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          background: rgba(158, 158, 158, 0.15); color: var(--secondary-text-color);
          transition: background 0.2s, color 0.2s;
        }
        .icon-wrap.active {
          background: rgba(255, 87, 34, 0.2); color: #ff5722;
        }
        .info { display: flex; flex-direction: column; overflow: hidden; }
        .primary { font-weight: 500; font-size: 14px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .secondary { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
      </style>
      <div class="grid">
        ${count > 0 ? `<div class="zones-grid">${zoneCardsHtml}</div>` : ""}
        ${waterCardHtml}
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
    const count = Number(this._config.zone_count) || 0;

    for (let i = 1; i <= count; i++) {
      const key = `zone_${i}`;
      const card = this.shadowRoot.getElementById(`card-${key}`);
      if (!card) continue;

      const name = this._config[`${key}_name`] || `Zone ${i}`;
      const climateId = this._config[`${key}_climate`];
      const sensorId = this._config[`${key}_sensor`];

      this.shadowRoot.getElementById(`name-${key}`).textContent = name;

      const sensorActive =
        sensorId &&
        this._hass?.states[sensorId] &&
        this._hass.states[sensorId].state === "on";
      const stage = this._state[key] || "Off";
      const isActive = stage !== "Off" || sensorActive;

      const iconWrap = this.shadowRoot.getElementById(`icon-${key}`);
      iconWrap.classList.toggle("active", isActive);
      iconWrap
        .querySelector("ha-icon")
        .setAttribute("icon", isActive ? "mdi:fire" : "mdi:fire-off");

      const statusText =
        stage !== "Off" ? stage : sensorActive ? "Active" : "Off";
      if (climateId && this._hass?.states[climateId]) {
        const temp = this._hass.states[climateId].attributes.current_temperature;
        this.shadowRoot.getElementById(`sub-${key}`).textContent =
          temp !== undefined ? `${temp}°C • ${statusText}` : statusText;
      } else {
        this.shadowRoot.getElementById(`sub-${key}`).textContent = statusText;
      }
    }

    if (this._config.water_enabled !== false) {
      const waterCard = this.shadowRoot.getElementById("card-water");
      if (!waterCard) return;

      const name = this._config.water_name || "Hot Water Boost";
      const sensorId = this._config.water_sensor;

      this.shadowRoot.getElementById("name-water").textContent = name;

      const sensorActive =
        sensorId &&
        this._hass?.states[sensorId] &&
        this._hass.states[sensorId].state === "on";
      const stage = this._state.water || "Off";
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
      this.shadowRoot.getElementById("sub-water").textContent = statusText;
    }
  }
}

class HiveBoostCardEditor extends HTMLElement {
  setConfig(config) {
    const prevCount = this._config ? Number(this._config.zone_count) : null;
    const prevWater = this._config ? this._config.water_enabled : null;

    this._config = {
      zone_count: 2,
      temperature: 21.0,
      water_enabled: true,
      ...config,
    };

    const countChanged = prevCount !== Number(this._config.zone_count);
    const waterChanged = prevWater !== this._config.water_enabled;

    if (!this._form || countChanged || waterChanged) {
      this._buildForm();
    } else {
      this._form.data = this._config;
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _buildSchema() {
    const count = Number(this._config.zone_count) ?? 2;
    const schema = [
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
    ];

    for (let i = 1; i <= count; i++) {
      schema.push(
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
        }
      );
    }

    schema.push({
      name: "water_enabled",
      label: "Include Hot Water Boost",
      selector: { boolean: {} },
    });

    if (this._config.water_enabled !== false) {
      schema.push(
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

    return schema;
  }

  _buildForm() {
    this.innerHTML = "";
    this._form = document.createElement("ha-form");
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = this._buildSchema();
    this._form.computeLabel = (schema) => schema.label || schema.name;

    this._form.addEventListener("value-changed", (ev) => {
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: ev.detail.value },
          bubbles: true,
          composed: true,
        })
      );
    });

    this.appendChild(this._form);
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
