'use strict';

const Homey = require('homey');

module.exports = class StationDriver extends Homey.Driver {

  async onPairListDevices() {
    const controllers = this.homey.app.getControllers();
    if (!controllers.length) throw new Error(this.homey.__('pair.no_controller'));

    const devices = [];
    for (const ctrl of controllers) {
      const state = ctrl.state || await ctrl.refresh();
      if (!state) continue;
      const ctrlId = ctrl.getData().id;
      for (const z of state.zones) {
        if (z.disabled) continue;
        devices.push({
          name: controllers.length > 1 ? `${z.name} (${ctrl.getName()})` : z.name,
          data: { id: `${ctrlId}:${z.sid}` },
          store: { controllerId: ctrlId, sid: z.sid },
        });
      }
    }
    return devices;
  }

};
