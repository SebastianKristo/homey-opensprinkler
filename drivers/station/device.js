'use strict';

const Homey = require('homey');
const { parseZoneName } = require('../../lib/zoneName');

module.exports = class StationDevice extends Homey.Device {

  async onInit() {
    this.sid = this.getStoreValue('sid');
    this._onState = state => this._update(state).catch(this.error);
    this._onUnavailable = msg => this.setUnavailable(msg).catch(this.error);

    this.registerCapabilityListener('onoff', async value => {
      if (value) await this.run((this.getSetting('duration') || 10) * 60);
      else await this.stop();
    });

    for (const cap of ['measure_water', 'meter_water', 'os_last_run']) {
      if (!this.hasCapability(cap)) await this.addCapability(cap).catch(this.error);
    }

    this._attach();
  }

  async setWaterFlow(lpm) {
    const v = Math.round(lpm * 10) / 10;
    if (this.getCapabilityValue('measure_water') !== v) await this.setCapabilityValue('measure_water', v);
  }

  async addWaterConsumption(litres) {
    const total = (this.getStoreValue('water_total') || 0) + litres;
    const last = (this.getStoreValue('water_last_run') || 0) + litres;
    await this.setStoreValue('water_total', total);
    await this.setStoreValue('water_last_run', last);
    await this.setCapabilityValue('meter_water', Math.round(total) / 1000);
    await this.setCapabilityValue('os_last_run', Math.round(last));
  }

  async resetWater() {
    await this.setStoreValue('water_total', 0);
    await this.setStoreValue('water_last_run', 0);
    await this.setCapabilityValue('meter_water', 0);
    await this.setCapabilityValue('os_last_run', 0);
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
    const parsed = parseZoneName(z.name, this.sid);
    const typeLabel = this.getSetting('sprinkler_type') === 'spray' ? 'Spreder' : 'Drypp';
    let status = parsed.valve ? `Av · ${typeLabel} ${parsed.valve}` : `Av · ${typeLabel}`;
    if (z.disabled) status = 'Deaktivert';
    else if (z.running) status = z.program ? `Vanner (${z.program})` : 'Vanner';
    else if (z.waiting) status = 'Venter';
    const remaining = Math.round((z.remaining / 60) * 10) / 10;
    const set = (cap, val) => (this.getCapabilityValue(cap) !== val ? this.setCapabilityValue(cap, val) : null);
    const wasRunning = this.getCapabilityValue('onoff') === true;
    await Promise.all([set('onoff', z.running), set('os_status', status), set('os_remaining', remaining)]);
    if (z.running && !wasRunning) {
      // New run: restart the per-run consumption counter.
      await this.setStoreValue('water_last_run', 0);
      await this.setCapabilityValue('os_last_run', 0).catch(this.error);
    }
    if (z.running !== wasRunning && this.homey.app.water) this.homey.app.water.update();
  }

  async run(seconds) {
    const ctrl = this._getController();
    await ctrl.runStation(this.sid, seconds);
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
