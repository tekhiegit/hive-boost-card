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
    this._state = { up: "Off", down: "Off", water: "Off" };
    this._prevActive = { up: false, down: false, water: false };
    this._holdTimers = {};
    this._holdTriggered = {};
  }

  static getConfigElement() {
    return document.createElement("hive-boost-card-editor");
  }

  static getStubConfig() {
    return {
      temperature: 21.0,
      up_name: "Upstairs",
      up_climate: "",
      up_sensor: "",
      down_name: "Downstairs",
      down_climate: "",
      down_sensor: "",
      water_name: "Hot Water Boost",
      water_entity: "",
      water_sensor: "",
    };
  }

  setConfig(config) {
    this._config = {
      temperature: 21.0,
      up_name: "Upstairs",
      down_name: "Downstairs",
      water_name: "Hot Water Boost",
      ...config,
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
    const map = {
      up: this._config.up_sensor,
      down: this._config.down_sensor,
      water: this._config.water_sensor,
    };

    Object.entries(map).forEach(([key, sensorId]) => {
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
      const entity =
        key === "up" ? this._config.up_climate : this._config.down_climate;
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
    } else if (key === "up" && this._config.up_climate) {
      this._hass.callService("hive", "boost_heating_off", {
        entity_id: this._config.up_climate,
      });
    } else if (key === "down" && this._config.down_climate) {
      this._hass.callService("hive", "boost_heating_off", {
        entity_id: this._config.down_climate,
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
    this.shadowRoot.innerHTML = `
      <style>
        .grid { display: flex; flex-direction: column; gap: 10px; }
        .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        ha-card {
          display: flex; align-items: center; gap: 12px;
          padding: 12px; cursor: pointer; user-select: none;
          transition: transform 0.1s ease;
        }
        ha-card:active { transform: scale(0.98); }
        .icon-wrap {
          width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: rgba(158, 158, 158, 0.15); color: var(--secondary-text-color);
          transition: background 0.2s, color 0.2s;
        }
        .icon-wrap.active {
          background: rgba(255, 87, 34, 0.2); color: #ff5722;
        }
        .info { display: flex; flex-direction: column; overflow: hidden; }
        .primary { font-weight: 500; font-size: 14px; color: var(--primary-text-color); }
        .secondary { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
        .hidden { display: none !important; }
      </style>
      <div class="grid">
        <div class="row" id="heating-row">
          <ha-card id="card-up">
            <div class="icon-wrap" id="icon-up"><ha-icon icon="mdi:fire-off"></ha-icon></div>
            <div class="info">
              <div class="primary" id="name-up"></div>
              <div class="secondary" id="sub-up">Off</div>
            </div>
          </ha-card>
          <ha-card id="card-down">
            <div class="icon-wrap" id="icon-down"><ha-icon icon="mdi:fire-off"></ha-icon></div>
            <div class="info">
              <div class="primary" id="name-down"></div>
              <div class="secondary" id="sub-down">Off</div>
            </div>
          </ha-card>
        </div>
        <ha-card id="card-water">
          <div class="icon-wrap" id="icon-water"><ha-icon icon="mdi:water-boiler-off"></ha-icon></div>
          <div class="info">
            <div class="primary" id="name-water"></div>
            <div class="secondary" id="sub-water">Off</div>
          </div>
        </ha-card>
      </div>
    `;

    this._bindEvents(this.shadowRoot.getElementById("card-up"), "up");
    this._bindEvents(this.shadowRoot.getElementById("card-down"), "down");
    this._bindEvents(this.shadowRoot.getElementById("card-water"), "water");
    this._updateUI();
  }

  _updateUI() {
    if (!this._config || !this.shadowRoot.getElementById("card-up")) return;

    const zones = [
      {
        key: "up",
        name: this._config.up_name,
        climate: this._config.up_climate,
        sensor: this._config.up_sensor,
        onIcon: "mdi:fire",
        offIcon: "mdi:fire-off",
      },
      {
        key: "down",
        name: this._config.down_name,
        climate: this._config.down_climate,
        sensor: this._config.down_sensor,
        onIcon: "mdi:fire",
        offIcon: "mdi:fire-off",
      },
      {
        key: "water",
        name: this._config.water_name,
        entity: this._config.water_entity,
        sensor: this._config.water_sensor,
        onIcon: "mdi:water-boiler",
        offIcon: "mdi:water-boiler-off",
      },
    ];

    zones.forEach((z) => {
      const card = this.shadowRoot.getElementById(`card-${z.key}`);
      const configured = z.key === "water" ? z.entity : z.climate;
      card.classList.toggle("hidden", !configured);
      if (!configured) return;

      this.shadowRoot.getElementById(`name-${z.key}`).textContent = z.name;

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
      if (z.key !== "water" && this._hass?.states[z.climate]) {
        const temp = this._hass.states[z.climate].attributes.current_temperature;
        this.shadowRoot.getElementById(`sub-${z.key}`).textContent =
          temp !== undefined ? `${temp}°C • ${statusText}` : statusText;
      } else {
        this.shadowRoot.getElementById(`sub-${z.key}`).textContent = statusText;
      }
    });
  }
}

class HiveBoostCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (this._form) {
      this._form.data = this._config;
      return;
    }

    this._form = document.createElement("ha-form");
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = [
      {
        name: "temperature",
        label: "Boost Target Temperature (°C)",
        selector: { number: { min: 10, max: 30, step: 0.5, mode: "box" } },
      },
      { name: "up_name", label: "Zone 1 Label", selector: { text: {} } },
      {
        name: "up_climate",
        label: "Zone 1 Climate Entity",
        selector: { entity: { domain: "climate" } },
      },
      {
        name: "up_sensor",
        label: "Zone 1 Boost Sensor (Optional)",
        selector: { entity: { domain: "binary_sensor" } },
      },
      { name: "down_name", label: "Zone 2 Label", selector: { text: {} } },
      {
        name: "down_climate",
        label: "Zone 2 Climate Entity",
        selector: { entity: { domain: "climate" } },
      },
      {
        name: "down_sensor",
        label: "Zone 2 Boost Sensor (Optional)",
        selector: { entity: { domain: "binary_sensor" } },
      },
      { name: "water_name", label: "Hot Water Label", selector: { text: {} } },
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
    ];

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
