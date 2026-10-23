'use strict';

const Homey = require('homey');
const OpenSprinklerApi = require('../../lib/OpenSprinklerApi');

module.exports = class ControllerDriver extends Homey.Driver {

  async _connect({ host, password }) {
    if (!host) throw new Error(this.homey.__('pair.no_host'));
    const hash = OpenSprinklerApi.hash(password || 'opendoor');
    const api = new OpenSprinklerApi({ host, password: hash, passwordIsHash: true });
    const state = await api.getState();
    return { host, hash, state };
  }

  async onPair(session) {
    session.setHandler('connect', async data => {
      const { host, hash, state } = await this._connect(data);
      return {
        name: `OpenSprinkler (${host})`,
        data: { id: state.mac || host },
        store: { pwHash: hash },
        settings: { host },
      };
    });
  }

  async onRepair(session, device) {
    session.setHandler('connect', async data => {
      const { host, hash } = await this._connect(data);
      await device.setStoreValue('pwHash', hash);
      await device.setSettings({ host });
      device.reconnect();
      return null;
    });
  }

};
