'use strict';

const Homey = require('homey');

module.exports = class StationDevice extends Homey.Device {

  async onInit() {
    this.sid = this.getStoreValue('sid');
    this._onState = state => this._update(state).catch(this.error);
    this._onUnavailable = msg => this.setUnavailable(msg).catch(this.error);

    this.registerCapabilityListener('onoff', async value => {
      if (value) await this.run((this.getSetting('duration') || 10) * 60);
      else await this.stop();
    });

    this._attach();
  }

  _attach() {
    const ctrl = this.homey.app.getController(this.getStoreValue('controllerId'));
    if (!ctrl) {
      this.setUnavailable(this.homey.__('device.controller_missing')).catch(this.error);
      // Controller may initialise after us; retry.
      this._retry = this.homey.setTimeout(() => this._attach(), 5000);
      return;
    }
    this.controller = ctrl;
    ctrl.on('state', this._onState);
    ctrl.on('unavailable', this._onUnavailable);
    if (ctrl.state) this._onState(ctrl.state);
  }

  _getController() {
    if (!this.controller) throw new Error(this.homey.__('device.controller_missing'));
    return this.controller;
  }

  async _update(state) {
    const z = state.zones[this.sid];
    if (!z) return;
    if (!this.getAvailable()) await this.setAvailable();
    let status = 'Idle';
    if (z.disabled) status = 'Disabled';
    else if (z.running) status = z.program ? `Running (${z.program})` : 'Running';
    else if (z.waiting) status = 'Waiting';
    const remaining = Math.round((z.remaining / 60) * 10) / 10;
    const set = (cap, val) => (this.getCapabilityValue(cap) !== val ? this.setCapabilityValue(cap, val) : null);
    await Promise.all([set('onoff', z.running), set('os_status', status), set('os_remaining', remaining)]);
  }

  async run(seconds) {
    const ctrl = this._getController();
    await ctrl.api.runStation(this.sid, seconds);
    await ctrl.refresh();
  }

  async stop() {
    const ctrl = this._getController();
    await ctrl.api.stopStation(this.sid);
    await ctrl.refresh();
  }

  onUninit() { this._detach(); }

  onDeleted() { this._detach(); }

  _detach() {
    this.homey.clearTimeout(this._retry);
    if (this.controller) {
      this.controller.off('state', this._onState);
      this.controller.off('unavailable', this._onUnavailable);
    }
  }

};
