# homey-opensprinkler

Homey Pro app (SDK v3) for the [OpenSprinkler](https://opensprinkler.com) irrigation controller, inspired by [hass-opensprinkler](https://github.com/vinteo/hass-opensprinkler).

## Features

- **Controller device**: enable/disable, running zones, water level (settable), rain delay + end time, rain sensor
- **Zone devices**: on/off with configurable default run time, status, remaining time
- **Flow cards**: run/stop zone, stop all, set rain delay, set water level, run program (with/without weather adjustment), enable/disable program; conditions for zone watering and rain delay
- **Dashboard widgets**: *Zones* (live countdown, start/stop per zone) and *Controller* (enable, rain delay, water level, stop all)

## Install

```bash
npm i -g homey
homey login
homey app install   # or: homey app run
```

Add the *OpenSprinkler controller* device first (IP + device password), then add zones.
Requires Homey firmware >= 12.1.0 (widgets).
