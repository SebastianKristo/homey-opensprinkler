'use strict';

const Homey = require('homey');
const { parseZoneName } = require('../../lib/zoneName');

class StationDevice extends Homey.Device {

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

    // Quick-run buttons with fixed durations.
    for (const min of StationDevice.QUICK_RUN_MINUTES) {
      const cap = `button.run_${min}`;
      if (!this.hasCapability(cap)) {
        await this.addCapability(cap).catch(this.error);
        await this.setCapabilityOptions(cap, { title: { en: `Run ${min} min`, no: `Kjør ${min} min` } }).catch(this.error);
      }
      this.registerCapabilityListener(cap, () => this.run(min * 60));
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
    this._idleStatus = parsed.valve ? `Av · ${typeLabel} ${parsed.valve}` : `Av · ${typeLabel}`;
    if (z.disabled) this._idleStatus = 'Deaktivert';
    else if (z.waiting) this._idleStatus = 'Venter';
    this._program = z.program;
    // Remember when the run ends so the countdown can tick between polls.
    this._endsAt = z.running ? Date.now() + z.remaining * 1000 : null;
    const set = (cap, val) => (this.getCapabilityValue(cap) !== val ? this.setCapabilityValue(cap, val) : null);
    const wasRunning = this.getCapabilityValue('onoff') === true;
    await set('onoff', z.running);
    await this._tick();
    this.homey.clearInterval(this._ticker);
    if (z.running) this._ticker = this.homey.setInterval(() => this._tick().catch(this.error), 5000);
    if (z.running && !wasRunning) {
      // New run: restart the per-run consumption counter.
      await this.setStoreValue('water_last_run', 0);
      await this.setCapabilityValue('os_last_run', 0).catch(this.error);
    }
    if (z.running !== wasRunning && this.homey.app.water) this.homey.app.water.update();
  }

  static formatLeft(sec) {
    if (sec >= 3600) return `${Math.floor(sec / 3600)} t ${Math.floor((sec % 3600) / 60)} min`;
    if (sec >= 60) return `${Math.ceil(sec / 60)} min`;
    return `${Math.max(0, Math.round(sec))} s`;
  }

  /** Updates the status text and remaining time from the last known end time. */
  async _tick() {
    const left = this._endsAt ? Math.max(0, (this._endsAt - Date.now()) / 1000) : 0;
    let status = this._idleStatus || '';
    if (this._endsAt) {
      status = `Vanner · ${StationDevice.formatLeft(left)} igjen`;
      if (this._program && this._program !== 'Manual') status += ` (${this._program})`;
    }
    const remaining = Math.round((left / 60) * 10) / 10;
    if (this.getCapabilityValue('os_status') !== status) await this.setCapabilityValue('os_status', status);
    if (this.getCapabilityValue('os_remaining') !== remaining) await this.setCapabilityValue('os_remaining', remaining);
    if (this._endsAt && left <= 0) this.homey.clearInterval(this._ticker);
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
    this.homey.clearInterval(this._ticker);
    if (this.controller) {
      this.controller.off('state', this._onState);
      this.controller.off('unavailable', this._onUnavailable);
    }
  }

}

StationDevice.QUICK_RUN_MINUTES = [5, 10, 15, 30, 60];

module.exports = StationDevice;
