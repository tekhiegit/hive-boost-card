# Hive Boost Card for Home Assistant

A standalone, interactive custom Lovelace card for Home Assistant that lets you cycle through Hive heating and hot water boost durations with a single tap, monitor live temperatures and countdown timers, and cancel active boosts with a press-and-hold or a dedicated **Cancel All** button.

![Hive Boost Card Preview](card.jpg)

## Features

- **Single-Tap Duration Cycling:** Tap any button to cycle through `30m` → `1h` → `1.5h` → `2h` → `Off`.
- **2-Second Smart API Debounce:** Waits 2 seconds after you stop tapping before sending the request to Hive, preventing cloud API rate limits when tapping quickly through longer boost durations.
- **Live Boost Countdown Timers:** Displays real-time remaining boost duration (e.g., `18.6°C • 42m left` or `1h 15m left`) directly on active buttons, syncing with both Hive sensor attributes and internal timers.
- **Press & Hold + Cancel All:** Hold any individual button for ~0.65 seconds to cancel that zone immediately, or tap the **Cancel All** button to stop all active heating and hot water boosts at once.
- **Live Room & Tank Temperatures:** Displays current room temperatures for each heating zone, plus optional support for an external hot water tank temperature sensor (`52.5°C • Off`).
- **External Boost Sync:** Automatically highlights buttons in deep orange and displays active status when a boost is started from the Hive app or physical thermostat.
- **Grouped Visual Onboarding Editor:** Choose `0` to `4` heating zones, toggle Hot Water Boost or Cancel All on/off, and pick your entities using native dropdown menus—no YAML or extra frontend cards required.

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
3. Use the visual onboarding editor to configure your setup:
   - **General Settings:** Choose the **Number of Heating Zones** (`0`–`4`), set your **Boost Target Temperature (°C)** (default: `21.0`), and toggle the **Cancel All** button.
   - **Heating Zones:** Give each zone an optional custom label (defaults to the entity's friendly name if left blank), select your Hive `climate` entity, and optionally link its boost `binary_sensor` for external sync.
   - **Hot Water:** Toggle **Include Hot Water Boost** on or off, set a custom label, select your Hive `water_heater` entity, optionally link its boost `binary_sensor`, and optionally pick an external **Hot Water Tank Temp Sensor** to display your cylinder temperature.
4. Click **Save**.

![Hive Boost Card Configuration](configuration.jpg)

### Example YAML Configuration

If you prefer configuring cards via YAML, here is an example 2-zone + hot water setup:

```yaml
type: custom:hive-boost-card
zone_count: 2
temperature: 21
include_cancel_all: true
cancel_all_name: Cancel All
zone_1_name: Downstairs
zone_1_climate: climate.heating_down
zone_1_sensor: binary_sensor.heating_down_boost
zone_2_name: Upstairs
zone_2_climate: climate.heating_up
zone_2_sensor: binary_sensor.heating_up_boost
include_water: true
water_name: Hot Water Boost
water_entity: water_heater.heating_down
water_sensor: binary_sensor.hotwater_boost
water_temp_sensor: sensor.hot_water_tank_temperature
```

---

## Controls

| Action | Behavior |
| :--- | :--- |
| **Single Tap** | Cycles boost duration: `30m` → `1h` → `1.5h` → `2h` → `Off` |
| **2s Pause After Tapping** | Sends a single boost request to Hive for your final selected duration (prevents API rate limits) |
| **Press & Hold (~0.65s)** | Immediately cancels any active internal or external boost on that button and resets to `Off` |
| **Tap Cancel All** | Immediately cancels all active heating and hot water boosts across every configured zone |

---

## Credits & Notes

Built and tested on a multi-zone Hive setup with AI coding assistance. Feel free to open an issue on GitHub if you spot a bug or have a suggestion!
