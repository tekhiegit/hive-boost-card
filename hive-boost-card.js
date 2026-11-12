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
      zone_count: "2",
      temperature: 21.0,
      zone_1_name: "Upstairs",
      zone_1_climate: "",
      zone_1_sensor: "",
      zone_2_name: "Downstairs",
      zone_2_climate: "",
      zone_2_sensor: "",
      zone_3_name: "Zone 3",
      zone_3_climate: "",
      zone_3_sensor: "",
      zone_4_name: "Zone 4",
      zone_4_climate: "",
      zone_4_sensor: "",
      include_water: true,
      water_name: "Hot Water Boost",
      water_entity: "",
      water_sensor: "",
    };
  }

  _normalizeConfig(rawConfig) {
    const cfg = { ...rawConfig };

    // Backward compatibility with v1 config keys
    if (cfg.up_climate !== undefined && cfg.zone_1_climate === undefined) {
      cfg.zone_1_climate = cfg.up_climate;
    }
    if (cfg.up_name !== undefined && cfg.zone_1_name === undefined) {
      cfg.zone_1_name = cfg.up_name;
    }
    if (cfg.up_sensor !== undefined && cfg.zone_1_sensor === undefined) {
      cfg.zone_1_sensor = cfg.up_sensor;
    }
    if (cfg.down_climate !== undefined && cfg.zone_2_climate === undefined) {
      cfg.zone_2_climate = cfg.down_climate;
    }
    if (cfg.down_name !== undefined && cfg.zone_2_name === undefined) {
      cfg.zone_2_name = cfg.down_name;
    }
    if (cfg.down_sensor !== undefined && cfg.zone_2_sensor === undefined) {
      cfg.zone_2_sensor = cfg.down_sensor;
    }

    if (cfg.zone_count === undefined) {
      let detected = 2;
      if (cfg.zone_4_climate) detected = 4;
      else if (cfg.zone_3_climate) detected = 3;
      else if (cfg.zone_2_climate) detected = 2;
      else if (cfg.zone_1_climate) detected = 1;
      cfg.zone_count = String(detected);
    } else {
      cfg.zone_count = String(cfg.zone_count);
    }

    if (cfg.include_water === undefined) {
      cfg.include_water = true;
    }

    return {
      temperature: 21.0,
      zone_1_name: "Upstairs",
      zone_2_name: "Downstairs",
      zone_3_name: "Zone 3",
      zone_4_name: "Zone 4",
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

  _getZoneList() {
    if (!this._config) return [];
    const count = parseInt(this._config.zone_count, 10);
    const numZones = isNaN(count) ? 2 : Math.max(0, Math.min(4, count));
    const list = [];

    for (let i = 1; i <= numZones; i++) {
      const key = `zone_${i}`;
      list.push({
        key,
        type: "heating",
        name: this._config[`${key}_name`] || `Zone ${i}`,
        entity: this._config[`${key}_climate`] || "",
        sensor: this._config[`${key}_sensor`] || "",
        onIcon: "mdi:fire",
        offIcon: "mdi:fire-off",
      });
    }

    if (this._config.include_water) {
      list.push({
        key: "water",
        type: "water",
        name: this._config.water_name || "Hot Water Boost",
        entity: this._config.water_entity || "",
        sensor: this._config.water_sensor || "",
        onIcon: "mdi:water-boiler",
        offIcon: "mdi:water-boiler-off",
      });
    }

    return list;
  }

  _syncExternalResets() {
    if (!this._hass || !this._config) return;
    const zones = this._getZoneList();

    zones.forEach((z) => {
      if (!z.sensor || !this._hass.states[z.sensor]) return;
      const isActive = this._hass.states[z.sensor].state === "on";
      if (this._prevActive[z.key] && !isActive && this._state[z.key] !== "Off") {
        this._state[z.key] = "Off";
      }
      this._prevActive[z.key] = isActive;
    });
  }

  _handleTap(zone) {
    if (!this._hass || !this._config || !zone.entity) return;
    const currentIdx = this._stages.indexOf(this._state[zone.key]);
    const nextStage = this._stages[(currentIdx + 1) % this._stages.length];
    this._state[zone.key] = nextStage;
    this._updateUI();

    if (zone.type === "water") {
      if (nextStage === "Off") {
        this._hass.callService("hive", "boost_hot_water_off", {
          entity_id: zone.entity,
        });
      } else {
        this._hass.callService("hive", "boost_hot_water_on", {
          entity_id: zone.entity,
          time_period: this._durations[nextStage],
          on_off: "on",
        });
      }
    } else {
      if (nextStage === "Off") {
        this._hass.callService("hive", "boost_heating_off", {
          entity_id: zone.entity,
        });
      } else {
        this._hass.callService("hive", "boost_heating_on", {
          entity_id: zone.entity,
          time_period: this._durations[nextStage],
          temperature: Number(this._config.temperature || 21.0),
        });
      }
    }
  }

  _handleHold(zone) {
    if (!this._hass || !this._config || !zone.entity) return;
    this._state[zone.key] = "Off";
    this._updateUI();

    if (zone.type === "water") {
      this._hass.callService("hive", "boost_hot_water_off", {
        entity_id: zone.entity,
      });
    } else {
      this._hass.callService("hive", "boost_heating_off", {
        entity_id: zone.entity,
      });
    }
  }

  _bindEvents(el, zone) {
    const start = () => {
      this._holdTriggered[zone.key] = false;
      this._holdTimers[zone.key] = setTimeout(() => {
        this._holdTriggered[zone.key] = true;
        this._handleHold(zone);
      }, 650);
    };
    const end = () => {
      clearTimeout(this._holdTimers[zone.key]);
      if (!this._holdTriggered[zone.key]) {
        this._handleTap(zone);
      }
    };
    const cancel = () => clearTimeout(this._holdTimers[zone.key]);

    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointerleave", cancel);
  }

  _render() {
    const zones = this._getZoneList();
    const heatingZones = zones.filter((z) => z.type === "heating");
    const waterZone = zones.find((z) => z.type === "water");
    const gridCols = heatingZones.length <= 1 ? "1fr" : "1fr 1fr";

    this.shadowRoot.innerHTML = `
      <style>
        .container { display: flex; flex-direction: column; gap: 10px; }
        .heating-grid { display: grid; grid-template-columns: ${gridCols}; gap: 10px; }
        ha-card {
          display: flex; align-items: center; gap: 12px;
          padding: 12px; cursor: pointer; user-select: none;
          transition: transform 0.1s ease;
        }
        ha-card:active { transform: scale(0.98); }
        ha-card.unconfigured { opacity: 0.65; }
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
        .primary {
          font-weight: 500; font-size: 14px; color: var(--primary-text-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .secondary {
          font-size: 12px; color: var(--secondary-text-color); margin-top: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
      </style>
      <div class="container">
        ${
          heatingZones.length > 0
            ? `<div class="heating-grid">
                ${heatingZones
                  .map(
                    (z) => `
                  <ha-card id="card-${z.key}" class="${z.entity ? "" : "unconfigured"}">
                    <div class="icon-wrap" id="icon-${z.key}">
                      <ha-icon icon="${z.offIcon}"></ha-icon>
                    </div>
                    <div class="info">
                      <div class="primary" id="name-${z.key}">${z.name}</div>
                      <div class="secondary" id="sub-${z.key}">Off</div>
                    </div>
                  </ha-card>`
                  )
                  .join("")}
              </div>`
            : ""
        }
        ${
          waterZone
            ? `<ha-card id="card-water" class="${waterZone.entity ? "" : "unconfigured"}">
                <div class="icon-wrap" id="icon-water">
                  <ha-icon icon="${waterZone.offIcon}"></ha-icon>
                </div>
                <div class="info">
                  <div class="primary" id="name-water">${waterZone.name}</div>
                  <div class="secondary" id="sub-water">Off</div>
                </div>
              </ha-card>`
            : ""
        }
      </div>
    `;

    zones.forEach((z) => {
      const card = this.shadowRoot.getElementById(`card-${z.key}`);
      if (card) this._bindEvents(card, z);
    });

    this._updateUI();
  }

  _updateUI() {
    if (!this._config) return;
    const zones = this._getZoneList();

    zones.forEach((z) => {
      const card = this.shadowRoot.getElementById(`card-${z.key}`);
      if (!card) return;

      this.shadowRoot.getElementById(`name-${z.key}`).textContent = z.name;

      if (!z.entity) {
        this.shadowRoot.getElementById(`sub-${z.key}`).textContent = "Select entity in editor";
        return;
      }

      const sensorActive =
        z.sensor &&
        this._hass?.states[z.sensor] &&
        this._hass.states[z.sensor].state === "on";
      const stage = this._state[z.key];
      const isActive = stage !== "Off" || sensorActive;

      const iconWrap = this.shadowRoot.getElementById(`icon-${z.key}`);
      iconWrap.classList.toggle("active", isActive);
      iconWrap.querySelector("ha-icon").setAttribute("icon", isActive ? z.onIcon : z.offIcon);

      const statusText = stage !== "Off" ? stage : sensorActive ? "Active" : "Off";
      if (z.type === "heating" && this._hass?.states[z.entity]) {
        const temp = this._hass.states[z.entity].attributes.current_temperature;
        this.shadowRoot.getElementById(`sub-${z.key}`).textContent =
          temp !== undefined ? `${temp}°C • ${statusText}` : statusText;
      } else {
        this.shadowRoot.getElementById(`sub-${z.key}`).textContent = statusText;
      }
    });
  }
}

class HiveBoostCardEditor extends HTMLElement {
  constructor() {
    super();
    this._forms = {};
    this._groups = {};
    this._lastStructureKey = "";
  }

  setConfig(config) {
    const normalized = {
      zone_count: "2",
      temperature: 21.0,
      zone_1_name: "Upstairs",
      zone_2_name: "Downstairs",
      zone_3_name: "Zone 3",
      zone_4_name: "Zone 4",
      include_water: true,
      water_name: "Hot Water Boost",
      ...config,
    };
    if (normalized.up_climate !== undefined && normalized.zone_1_climate === undefined) {
      normalized.zone_1_climate = normalized.up_climate;
    }
    if (normalized.up_name !== undefined && normalized.zone_1_name === "Upstairs") {
      normalized.zone_1_name = normalized.up_name;
    }
    if (normalized.up_sensor !== undefined && normalized.zone_1_sensor === undefined) {
      normalized.zone_1_sensor = normalized.up_sensor;
    }
    if (normalized.down_climate !== undefined && normalized.zone_2_climate === undefined) {
      normalized.zone_2_climate = normalized.down_climate;
    }
    if (normalized.down_name !== undefined && normalized.zone_2_name === "Downstairs") {
      normalized.zone_2_name = normalized.down_name;
    }
    if (normalized.down_sensor !== undefined && normalized.zone_2_sensor === undefined) {
      normalized.zone_2_sensor = normalized.down_sensor;
    }
    normalized.zone_count = String(normalized.zone_count);

    this._config = normalized;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    Object.values(this._forms).forEach((form) => {
      form.hass = hass;
    });
  }

  _buildGroups() {
    const count = parseInt(this._config.zone_count, 10);
    const numZones = isNaN(count) ? 2 : Math.max(0, Math.min(4, count));
    const includeWater = Boolean(this._config.include_water);

    const groups = [
      {
        id: "general",
        title: "General Settings",
        schema: [
          {
            name: "zone_count",
            label: "Number of Heating Zones",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "0", label: "0 Zones (Hot Water Only)" },
                  { value: "1", label: "1 Zone" },
                  { value: "2", label: "2 Zones" },
                  { value: "3", label: "3 Zones" },
                  { value: "4", label: "4 Zones" },
                ],
              },
            },
          },
          ...(numZones > 0
            ? [
                {
                  name: "temperature",
                  label: "Boost Target Temperature (°C)",
                  selector: { number: { min: 10, max: 30, step: 0.5, mode: "box" } },
                },
              ]
            : []),
        ],
      },
    ];

    for (let i = 1; i <= numZones; i++) {
      groups.push({
        id: `zone_${i}`,
        title: `Heating Zone ${i}`,
        schema: [
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
        ],
      });
    }

    groups.push({
      id: "water",
      title: "Hot Water",
      schema: [
        {
          name: "include_water",
          label: "Include Hot Water Boost",
          selector: { boolean: {} },
        },
        ...(includeWater
          ? [
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
              },
            ]
          : []),
      ],
    });

    return groups;
  }

  _render() {
    if (!this._config) return;

    const count = parseInt(this._config.zone_count, 10);
    const numZones = isNaN(count) ? 2 : Math.max(0, Math.min(4, count));
    const includeWater = Boolean(this._config.include_water);
    const structureKey = `${numZones}_${includeWater}`;

    if (this._lastStructureKey === structureKey && Object.keys(this._forms).length > 0) {
      Object.values(this._forms).forEach((form) => {
        form.data = this._config;
      });
      return;
    }

    this._lastStructureKey = structureKey;
    this._forms = {};
    this.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = `
      .editor-sections {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 4px 0;
      }
      .group-box {
        border: 1.5px solid var(--divider-color, #e0e0e0);
        border-radius: 14px;
        padding: 14px;
        background: var(--card-background-color, transparent);
      }
      .group-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--primary-color, #03a9f4);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 12px;
      }
    `;
    this.appendChild(style);

    const container = document.createElement("div");
    container.className = "editor-sections";

    const groups = this._buildGroups();
    groups.forEach((group) => {
      const box = document.createElement("div");
      box.className = "group-box";

      const title = document.createElement("div");
      title.className = "group-title";
      title.textContent = group.title;
      box.appendChild(title);

      const form = document.createElement("ha-form");
      form.hass = this._hass;
      form.data = this._config;
      form.schema = group.schema;
      form.computeLabel = (schema) => schema.label || schema.name;

      form.addEventListener("value-changed", (ev) => {
        const merged = { ...this._config, ...ev.detail.value };
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: merged },
            bubbles: true,
            composed: true,
          })
        );
      });

      this._forms[group.id] = form;
      box.appendChild(form);
      container.appendChild(box);
    });

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
