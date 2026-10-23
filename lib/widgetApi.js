'use strict';

const { parseZoneName, guessType } = require('./zoneName');

// Shared handlers for the dashboard widgets.
function controller(homey, id) {
  const ctrl = homey.app.getController(id);
  if (!ctrl) throw new Error('OpenSprinkler controller not found');
  return ctrl;
}

function stationsOf(homey, ctrlId) {
  const map = {};
  try {
    for (const s of homey.drivers.getDriver('station').getDevices()) {
      if (s.getStoreValue('controllerId') === ctrlId) map[s.getStoreValue('sid')] = s;
    }
  } catch (e) { /* driver not ready */ }
  return map;
}

function stateOf(homey, ctrl) {
  const s = ctrl.state;
  const base = {
    name: ctrl.getName(),
    host: ctrl.getSetting('host'),
    online: ctrl.getAvailable() && !!s,
  };
  if (!s) return { ...base, zones: [] };

  const water = homey.app.water;
  const waterConfigured = !!(water && water.config.deviceId);
  const stations = stationsOf(homey, ctrl.getData().id);

  const zones = s.zones.map(z => {
    const p = parseZoneName(z.name, z.sid);
    const dev = stations[z.sid];
    const type = (dev && dev.getSetting('sprinkler_type')) || p.typeHint || guessType(z.name);
    const zone = { ...z, id: p.id, label: p.name, type, valve: p.valve, paired: !!dev };
    if (waterConfigured && dev) {
      zone.water = {
        flow: dev.getCapabilityValue('measure_water') || 0,
        lastRun: dev.getStoreValue('water_last_run') || 0,
        total: dev.getStoreValue('water_total') || 0,
      };
    }
    return zone;
  });

  return {
    ...base,
    ...s,
    zones,
    water: waterConfigured ? {
      flow: water.flow || 0,
      total: zones.reduce((sum, z) => sum + (z.water ? z.water.total : 0), 0),
      unassigned: water.unassigned || 0,
    } : null,
  };
}

module.exports = {
  async getStatus({ homey, query }) {
    return stateOf(homey, controller(homey, query.controller));
  },
  async runZone({ homey, body }) {
    const ctrl = controller(homey, body.controller);
    await ctrl.runStation(Number(body.sid), Number(body.minutes) * 60);
    return stateOf(homey, ctrl);
  },
  async stopZone({ homey, body }) {
    const ctrl = controller(homey, body.controller);
    await ctrl.api.stopStation(Number(body.sid));
    await ctrl.refresh();
    return stateOf(homey, ctrl);
  },
  async command({ homey, body }) {
    const ctrl = controller(homey, body.controller);
    const { action, value } = body;
    if (action === 'stopAll') await ctrl.api.stopAll();
    else if (action === 'enable') await ctrl.api.setEnabled(!!value);
    else if (action === 'rainDelay') await ctrl.api.setRainDelay(Number(value));
    else if (action === 'waterLevel') await ctrl.api.setWaterLevel(Number(value));
    else if (action === 'runProgram') { await homey.app.valve.beforeRun(); await ctrl.api.runProgram(Number(value), false); }
    else throw new Error(`Unknown action ${action}`);
    await ctrl.refresh();
    return stateOf(homey, ctrl);
  },
};
