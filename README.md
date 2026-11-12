# Hive Boost Card for Home Assistant

A clean, interactive custom Lovelace card for Home Assistant that lets you cycle through Hive heating and hot water boost durations with a single tap, display live room temperatures, and cancel active boosts with a press-and-hold.

![Hive Boost Card Preview](preview.png)

## Features

- **Single-Tap Duration Cycling:** Tap any button to cycle through `30m` → `1h` → `1.5h` → `2h` → `Off`.
- **Press & Hold to Cancel:** Hold any button for ~0.65 seconds to immediately cancel an active boost (including boosts started externally from the Hive app or physical thermostat).
- **Live Room Temperatures:** Displays the current room temperature directly alongside the active boost stage for each heating zone.
- **External Boost Sync:** Automatically highlights buttons in deep orange and shows `Active` when a boost is triggered outside Home Assistant.
- **Built-In Visual Editor:** Pick your Hive climate zones, hot water entity, boost binary sensors, and target boost temperature using native dropdown menus—no YAML required.
- **Flexible Layout:** Unconfigured zones automatically hide themselves, making it seamless for 1-zone, 2-zone, or heating-only setups.

---

## Installation

### Option 1: HACS (Recommended)

1. Open **HACS** in your Home Assistant instance.
2. Go to **Frontend** (or **Dashboard**).
3. Click the **three dots** in the top right corner and select **Custom repositories**.
4. Paste the URL of this GitHub repository, select **Dashboard** (or **Lovelace**) as the category, and click **Add**.
5. Find **Hive Boost Card** in HACS and click **Download**.
6. Refresh your browser when prompted.

### Option 2: Manual Installation

1. Download `hive-boost-card.js` from the latest release.
2. Copy `hive-boost-card.js` into your Home Assistant `/config/www/` directory.
3. Go to **Settings** > **Dashboards** > **three dots** (top right) > **Resources**.
4. Click **Add Resource**, enter `/local/hive-boost-card.js` as the URL, select **JavaScript Module**, and click **Create**.
5. Refresh your browser.

---

## Setup & Configuration

1. Open any dashboard and click **Edit Dashboard** (pencil icon).
2. Click **Add Card** and search for **Hive Boost Card**.
3. Use the visual onboarding editor to configure your entities:
   - **Boost Target Temperature (°C):** Set the temperature applied when boosting heating (default: `21.0`).
   - **Zone 1 & Zone 2:** Choose a custom label, select your Hive `climate` entity, and optionally link its boost `binary_sensor` for external sync and auto-reset.
   - **Hot Water:** Choose a label, select your Hive `water_heater` entity, and optionally link its boost `binary_sensor`.
4. Click **Save**.

### Example YAML Configuration

If you prefer configuring cards via YAML, here is an example setup:

```yaml
type: custom:hive-boost-card
temperature: 21
up_name: Upstairs
up_climate: climate.heating_up
up_sensor: binary_sensor.heating_up_boost
down_name: Downstairs
down_climate: climate.heating_down
down_sensor: binary_sensor.heating_down_boost
water_name: Hot Water Boost
water_entity: water_heater.heating_down
water_sensor: binary_sensor.hotwater_boost
```

---

## Controls

| Action | Behavior |
| :--- | :--- |
| **Single Tap** | Advances boost duration: `30m` → `1h` → `1.5h` → `2h` → `Off` |
| **Press & Hold** | Immediately cancels any active internal or external boost and resets to `Off` |

