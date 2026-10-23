# Notes for Athom review

Paste the text below into the review notes when submitting the version at
https://tools.developer.homey.app.

---

**Why the app uses the `homey:manager:api` permission**

OpenSprinkler controllers do not have a water meter or master valve of their own, so many users add a separate Zigbee water meter and valve (for example Sonoff). The permission is used for two optional features, both disabled until the user picks a device in the app settings:

1. **Water metering**: the app reads `measure_water` (flow) and `meter_water` (volume) from the single water meter device the user selects. The readings are attributed to whichever OpenSprinkler zone is running, which gives each zone its own flow and consumption sensors.
2. **Master valve**: the app turns on (`onoff`) the single valve device the user selects whenever a zone starts. It turns it on again if the valve closes while a zone is still watering, because Sonoff valves close automatically after a period without flow. Optionally it turns the valve off when all zones are finished.

The app only lists devices in its settings page so the user can choose. It only subscribes to and writes the capabilities named above, and only on the devices the user selected. No other devices are read or controlled, and no data leaves the local network.

**Testing without hardware**

The app talks to an OpenSprinkler controller over its local HTTP API (firmware 2.1.x and newer). The water meter and master valve features can be tested with any virtual device that has `measure_water`/`meter_water` or `onoff`.

**Branding**

The app icon and images are original artwork. The app is not affiliated with OpenSprinkler / OpenThings, as stated in the description.
