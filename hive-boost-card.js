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
  }

  static getConfigElement() {
    return document.createElement("hive-boost-card-editor");
  }

  static getStubConfig() {
    return {
      zone_count: "2",
      temperature: 21.0,
      include_water: true,
      z1_name: "",
      z1_climate: "",
      z1_sensor: "",
      z2_name: "",
      z2_climate: "",
      z2_sensor: "",
      z3_name: "",
      z3_climate: "",
      z3_sensor: "",
      z4_name: "",
      z4_climate: "",
      z4_sensor: "",
      water_name: "Hot Water Boost",
      water_entity: "",
      water_sensor: "",
    };
  }

  _normalizeConfig(config) {
    const cfg = { ...config };
    // Backward compatibility with v1 up_/down_ keys
    if (cfg.up_climate !== undefined && cfg.z1_climate === undefined) {
      cfg.z1_name = cfg.up_name || "";
      cfg.z1_climate = cfg.up_climate;
      cfg.z1_sensor = cfg.up_sensor || "";
    }
    if (cfg.down_climate !== undefined && cfg.z2_climate === undefined) {
      cfg.z2_name = cfg.down_name || "";
      cfg.z2_climate = cfg.down_climate;
      cfg.z2_sensor = cfg.down_sensor || "";
    }
    if (cfg.zone_count === undefined) {
      let count = 0;
      if (cfg.z1_climate) count = 1;
      if (cfg.z2_climate) count = 2;
      if (cfg.z3_climate) count = 3;
      if (cfg.z4_climate) count = 4;
      cfg.zone_count = String(count || 2);
    } else {
      cfg.zone_count = String(cfg.zone_count);
    }
    if (cfg.include_water === undefined) {
      cfg.include_water = true;
    }
    return {
      temperature: 21.0,
      z1_name: "",
      z2_name: "",
      z3_name: "",
      z4_name: "",
      water_name: "Hot Water Boost",
      ...cfg,
    };
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
    const keys = ["z1", "z2", "z3", "z4", "water"];
    keys.forEach((key) => {
      const sensorId = this._config[`${key}_sensor`];
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
  }

  _render() {
    const count = Number(this._config.zone_count || 0);
    const showWater = this._config.include_water !== false;
    const cols = count === 1 ? "1fr" : "repeat(2, minmax(0, 1fr))";

    let zoneCardsHtml = "";
    for (let i = 1; i <= count; i++) {
      const key = `z${i}`;
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
      const key = `z${i}`;
      const el = this.shadowRoot.getElementById(`card-${key}`);
      if (el) this._bindEvents(el, key);
    }
    if (showWater) {
      const wEl = this.shadowRoot.getElementById("card-water");
      if (wEl) this._bindEvents(wEl, "water");
    }

    this._updateUI();
  }

  _updateUI() {
    if (!this._config) return;
    const count = Number(this._config.zone_count || 0);

    for (let i = 1; i <= count; i++) {
      const key = `z${i}`;
      const card = this.shadowRoot.getElementById(`card-${key}`);
      if (!card) continue;

      const climateId = this._config[`${key}_climate`];
      const sensorId = this._config[`${key}_sensor`];
      const customName = (this._config[`${key}_name`] || "").trim();
      const friendlyName = climateId && this._hass?.states[climateId]?.attributes?.friendly_name;
      const name = customName || friendlyName || `Zone ${i}`;

      this.shadowRoot.getElementById(`name-${key}`).textContent = name;

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

    const wCard = this.shadowRoot.getElementById("card-water");
    if (wCard) {
      const waterId = this._config.water_entity;
      const sensorId = this._config.water_sensor;
      const customWaterName = (this._config.water_name || "").trim();
      this.shadowRoot.getElementById(`name-water`).textContent =
        customWaterName || "Hot Water Boost";

      const sensorActive =
        sensorId &&
        this._hass?.states[sensorId] &&
        this._hass.states[sensorId].state === "on";
      const stage = this._state.water;
      const isActive = stage !== "Off" || sensorActive;

      const iconWrap = this.shadowRoot.getElementById(`icon-water`);
      iconWrap.classList.toggle("active", isActive);
      iconWrap
        .querySelector("ha-icon")
        .setAttribute(
          "icon",
          isActive ? "mdi:water-boiler" : "mdi:water-boiler-off"
        );

      const statusText = stage !== "Off" ? stage : sensorActive ? "Active" : "Off";
      this.shadowRoot.getElementById(`sub-water`).textContent = !waterId
        ? "Select entity"
        : statusText;
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
    this._config = {
      zone_count: "2",
      temperature: 21.0,
      include_water: true,
      z1_name: "",
      z2_name: "",
      z3_name: "",
      z4_name: "",
      water_name: "Hot Water Boost",
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    Object.values(this._forms).forEach((form) => {
      if (form) form.hass = hass;
    });
  }

  _emitChange(updated) {
    this._config = { ...this._config, ...updated };
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _createSectionForm(id, title, schema, note = "") {
    const box = document.createElement("div");
    box.className = "section-box";

    const header = document.createElement("div");
    header.className = "section-title";
    header.textContent = title;
    box.appendChild(header);

    if (note) {
      const sub = document.createElement("div");
      sub.className = "section-note";
      sub.textContent = note;
      box.appendChild(sub);
    }

    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._config;
    form.schema = schema;
    form.computeLabel = (s) => s.label || s.name;
    form.addEventListener("value-changed", (ev) => {
      const prevCount = this._config.zone_count;
      const prevWater = this._config.include_water;
      this._emitChange(ev.detail.value);
      if (
        ev.detail.value.zone_count !== prevCount ||
        ev.detail.value.include_water !== prevWater
      ) {
        this._render();
      } else {
        Object.values(this._forms).forEach((f) => {
          if (f && f !== form) f.data = this._config;
        });
      }
    });

    this._forms[id] = form;
    box.appendChild(form);
    return box;
  }

  _render() {
    if (!this._config) return;
    const count = Number(this._config.zone_count ?? 2);
    const showWater = this._config.include_water !== false;

    this._forms = {};
    this.shadowRoot.innerHTML = `
      <style>
        .editor-wrap {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 4px 0;
        }
        .section-box {
          border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
          border-radius: 14px;
          padding: 14px;
          background: var(--card-background-color, transparent);
        }
        .section-title {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          color: var(--primary-color);
          margin-bottom: 10px;
        }
        .section-note {
          font-size: 12px;
          color: var(--secondary-text-color);
          margin: -6px 0 10px 0;
        }
      </style>
      <div class="editor-wrap" id="container"></div>
    `;

    const container = this.shadowRoot.getElementById("container");

    // 1. General Settings Group
    container.appendChild(
      this._createSectionForm("general", "General Settings", [
        {
          name: "zone_count",
          label: "Number of Heating Zones",
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "0", label: "0 Zones (Hot Water Only)" },
                { value: "1", label: "1 Heating Zone" },
                { value: "2", label: "2 Heating Zones" },
                { value: "3", label: "3 Heating Zones" },
                { value: "4", label: "4 Heating Zones" },
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

    // 2. Individual Heating Zone Groups
    for (let i = 1; i <= count; i++) {
      container.appendChild(
        this._createSectionForm(
          `zone_${i}`,
          `Heating Zone ${i}`,
          [
            {
              name: `z${i}_name`,
              label: `Zone ${i} Custom Label (Optional)`,
              selector: { text: {} },
            },
            {
              name: `z${i}_climate`,
              label: `Zone ${i} Climate Entity`,
              selector: { entity: { domain: "climate" } },
            },
            {
              name: `z${i}_sensor`,
              label: `Zone ${i} Boost Sensor (Optional)`,
              selector: { entity: { domain: "binary_sensor" } },
            },
          ],
          "Leave label blank to automatically use the climate entity name"
        )
      );
    }

    // 3. Hot Water Group
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
      this._createSectionForm("water", "Hot Water", waterSchema)
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
