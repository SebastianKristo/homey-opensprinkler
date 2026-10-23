'use strict';

// Shared handlers for the dashboard widgets.
function controller(homey, id) {
  const ctrl = homey.app.getController(id);
  if (!ctrl) throw new Error('OpenSprinkler controller not found');
  return ctrl;
}

async function stateOf(ctrl) {
  const state = ctrl.state || await ctrl.refresh();
  if (!state) throw new Error('Controller unavailable');
  return { name: ctrl.getName(), ...state };
}

module.exports = {
  async getStatus({ homey, query }) {
    return stateOf(controller(homey, query.controller));
  },
  async runZone({ homey, body }) {
    const ctrl = controller(homey, body.controller);
    await ctrl.api.runStation(Number(body.sid), Number(body.minutes) * 60);
    await ctrl.refresh();
    return stateOf(ctrl);
  },
  async stopZone({ homey, body }) {
    const ctrl = controller(homey, body.controller);
    await ctrl.api.stopStation(Number(body.sid));
    await ctrl.refresh();
    return stateOf(ctrl);
  },
  async command({ homey, body }) {
    const ctrl = controller(homey, body.controller);
    const { action, value } = body;
    if (action === 'stopAll') await ctrl.api.stopAll();
    else if (action === 'enable') await ctrl.api.setEnabled(!!value);
    else if (action === 'rainDelay') await ctrl.api.setRainDelay(Number(value));
    else if (action === 'waterLevel') await ctrl.api.setWaterLevel(Number(value));
    else if (action === 'runProgram') await ctrl.api.runProgram(Number(value), false);
    else throw new Error(`Unknown action ${action}`);
    await ctrl.refresh();
    return stateOf(ctrl);
  },
};
