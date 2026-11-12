# Hive Boost Card for Home Assistant

A clean, interactive custom Lovelace card for Home Assistant that lets you cycle through Hive heating and hot water boost durations with a single tap, display live room temperatures, and cancel active boosts with a press-and-hold.

![Hive Boost Card Preview](image_bf28645e.jpg)

## Features

- **Single-Tap Duration Cycling:** Tap any button to cycle through `30m` → `1h` → `1.5h` → `2h` → `Off`.
- **Built-In 1.5-Second API Debounce:** Rapidly tapping through boost durations updates the card UI immediately while waiting **1.5 seconds** after your last tap before sending the command to Hive. This prevents hitting Hive's cloud API rate limits with unnecessary intermediate requests while selecting longer boost times.
- **Press & Hold to Cancel:** Hold any button for ~0.65 seconds to immediately cancel an active boost (including boosts started externally from the Hive app or physical thermostat) with no delay.
- **Live Room Temperatures:** Displays the current room temperature directly alongside the active boost stage for each heating zone.
- **External Boost Sync:** Automatically highlights buttons in deep orange and shows `Active` when a boost is triggered outside Home Assistant.
- **Built-In Visual Onboarding Editor:** Choose how many heating zones you want to control (`0` to `4`), toggle Hot Water Boost on or off, and pick your Hive entities using grouped visual dropdown menus—no YAML required.

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
   - **Number of Heating Zones:** Select `0` to `4` zones depending on your Hive setup.
   - **Boost Target Temperature (°C):** Set the temperature applied when boosting heating (default: `21.0`).
   - **Heating Zones:** Optionally enter a custom label (or leave blank to automatically use your entity's friendly name), select your Hive `climate` entity, and optionally link its boost `binary_sensor` for external sync and auto-reset.
   - **Hot Water:** Toggle **Include Hot Water Boost** on or off, choose a label, select your Hive `water_heater` entity, and optionally link its boost `binary_sensor`.
4. Click **Save**.

### Example YAML Configuration

If you prefer configuring cards via YAML, here is an example 2-zone + hot water setup:

```yaml
type: custom:hive-boost-card
zone_count: 2
temperature: 21
zone_1_name: Upstairs
zone_1_climate: climate.heating_up
zone_1_sensor: binary_sensor.heating_up_boost
zone_2_name: Downstairs
zone_2_climate: climate.heating_down
zone_2_sensor: binary_sensor.heating_down_boost
include_water: true
water_name: Hot Water Boost
water_entity: water_heater.heating_down
water_sensor: binary_sensor.hotwater_boost
```

---

## Controls

| Action | Behavior |
| :--- | :--- |
| **Single Tap** | Advances boost duration (`30m` → `1h` → `1.5h` → `2h` → `Off`) and sends the final selection after a **1.5-second pause** to protect Hive API rate limits |
| **Press & Hold** | Immediately cancels any active internal or external boost and resets to `Off` |

---

## Credits & Notes

Built and tested on a multi-zone Hive setup with AI coding assistance. Feel free to open an issue on GitHub if you spot a bug or have a suggestion!
