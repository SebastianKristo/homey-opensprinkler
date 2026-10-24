'use strict';

function controller(homey, id) {
  const ctrl = homey.app.getController(id);
  if (!ctrl) throw new Error(homey.__('device.controller_missing'));
  return ctrl;
}

async function programState(ctrl) {
  // Programs are refreshed by a full fetch; make sure they are current.
  ctrl.api.invalidate();
  const state = await ctrl.refresh();
  if (!state) throw new Error('Controller unavailable');
  return {
    controller: ctrl.getData().id,
    now: state.now,
    programs: state.programs,
    zones: state.zones.map(z => ({ sid: z.sid, name: z.name, disabled: z.disabled, isMaster: z.isMaster })),
  };
}

module.exports = {
  async getControllers({ homey }) {
    return homey.app.getControllers().map(c => ({ id: c.getData().id, name: c.getName() }));
  },
  async getPrograms({ homey, query }) { return programState(controller(homey, query.controller)); },
  async saveProgram({ homey, body }) {
    const ctrl = controller(homey, body.controller);
    const today = Math.floor(((ctrl.state && ctrl.state.now) || Date.now() / 1000) / 86400);
    await ctrl.api.saveProgram(body.program, today);
    return programState(ctrl);
  },
  async deleteProgram({ homey, body }) {
    const ctrl = controller(homey, body.controller);
    await ctrl.api.deleteProgram(Number(body.pid));
    return programState(ctrl);
  },
  async runProgram({ homey, body }) {
    const ctrl = controller(homey, body.controller);
    await homey.app.valve.beforeRun();
    await ctrl.api.runProgram(Number(body.pid), !!body.useWeather);
    return programState(ctrl);
  },
  async getMeters({ homey }) { return homey.app.water.listMeters(); },
  async getStatus({ homey }) { return { ...homey.app.water.status(), valve: homey.app.valve.status() }; },
  async getValves({ homey }) { return homey.app.valve.listValves(); },
  async testValve({ homey }) { await homey.app.valve.turnOn(); return true; },
  async reset({ homey }) { await homey.app.water.reset(); return homey.app.water.status(); },
};
