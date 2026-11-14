# Hive Boost Card for Home Assistant

A clean, interactive custom Lovelace card for Home Assistant that lets you cycle through Hive heating and hot water boost durations with a single tap, view live remaining boost countdowns and room temperatures, and cancel active boosts with a press-and-hold or a dedicated Cancel All button.

![Hive Boost Card Preview](card.jpg)

## Features

- **Single-Tap Duration Cycling:** Tap any button to cycle through `30m` → `1h` → `1.5h` → `2h` → `Off`.
- **2-Second Smart API Debounce:** Waits 2 seconds after your final tap before sending the boost command to Hive. This lets you tap quickly to select longer boost durations (such as `1.5h` or `2h`) without firing intermediate requests that could hit Hive's cloud API rate limits.
- **Live Boost Countdown Timers:** Displays the real-time remaining duration (e.g., `18.6°C • 42m left` or `1h 15m left`) directly on each active button.
- **Cancel All Boosts Button:** Optional quick-stop button alongside Hot Water Boost that immediately cancels all active heating and hot water boosts in one tap.
- **Press & Hold to Cancel:** Hold any individual button for ~0.65 seconds to immediately cancel its active boost (including boosts started externally from the Hive app or physical thermostat).
- **Live Room Temperatures & External Sync:** Displays live room temperatures and automatically highlights buttons in deep orange when a boost is triggered outside Home Assistant.
- **Built-In Visual Onboarding Editor:** Grouped configuration interface lets you choose how many heating zones you have (`0` to `4`), toggle Hot Water Boost or Cancel All on/off, and pick your entities from dropdown menus—no YAML required.

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
3. Use the grouped visual editor to configure your setup:
   - **General Settings:** Pick your **Number of Heating Zones** (`0` to `4`) and set your **Boost Target Temperature (°C)** (default: `21.0`).
   - **Heating Zones (1–4):** Enter an optional custom label (or leave blank to automatically use the entity's friendly name), select your Hive `climate` entity, and optionally link its boost `binary_sensor` for external sync and live countdowns.
   - **Hot Water:** Toggle **Include Hot Water Boost** on or off, set an optional custom label, select your Hive `water_heater` entity, and optionally link its boost `binary_sensor`.
   - **Cancel All Button:** Toggle **Include Cancel All Button** on or off and set an optional custom label.
4. Click **Save**.

![Hive Boost Card Configuration](configuration.jpg)

### Example YAML Configuration

If you prefer configuring cards via YAML, here is an example 2-zone + hot water setup:

```yaml
type: custom:hive-boost-card
zone_count: 2
temperature: 21
include_water: true
include_cancel_all: true
zone_1_name: Downstairs
zone_1_climate: climate.heating_down
zone_1_sensor: binary_sensor.heating_down_boost
zone_2_name: Upstairs
zone_2_climate: climate.heating_up
zone_2_sensor: binary_sensor.heating_up_boost
water_name: Hot Water Boost
water_entity: water_heater.heating_down
water_sensor: binary_sensor.hotwater_boost
cancel_all_name: Cancel All
```

---

## Controls

| Action | Behavior |
| :--- | :--- |
| **Single Tap** | Advances boost duration (`30m` → `1h` → `1.5h` → `2h` → `Off`) and sends the command after a 2-second debounce delay |
| **Press & Hold** | Immediately cancels any active internal or external boost on that zone and resets to `Off` |
| **Cancel All Tap** | Immediately stops all active heating and hot water boosts across every configured zone |

---

## Credits & Notes

Built and tested on a multi-zone Hive setup with AI coding assistance. Feel free to open an issue on GitHub if you spot a bug or have a suggestion!
