'use strict';

const Homey = require('homey');
const OpenSprinklerApi = require('../../lib/OpenSprinklerApi');

module.exports = class ControllerDevice extends Homey.Device {

  async onInit() {
    this.state = null;
    this.setMaxListeners(100);
    this.reconnect();

    this.registerCapabilityListener('onoff', async value => {
      await this.api.setEnabled(value);
      this.refresh();
    });
    this.registerCapabilityListener('os_water_level', async value => {
      await this.api.setWaterLevel(value);
      this.refresh();
    });
  }

  reconnect() {
    this.api = new OpenSprinklerApi({
      host: this.getSetting('host'),
      password: this.getStoreValue('pwHash'),
      passwordIsHash: true,
    });
    this._schedule(0);
  }

  _schedule(ms) {
    this.homey.clearTimeout(this._timer);
    this._timer = this.homey.setTimeout(() => this.refresh(), ms);
  }

  async refresh() {
    try {
      const state = await this.api.getState();
      this.state = state;
      await this._updateCapabilities(state);
      if (!this.getAvailable()) await this.setAvailable();
      this.emit('state', state);
    } catch (err) {
      this.error('Refresh failed:', err.message);
      await this.setUnavailable(err.message).catch(this.error);
      this.emit('unavailable', err.message);
    }
    this._schedule((this.getSetting('poll_interval') || 10) * 1000);
    return this.state;
  }

  async _updateCapabilities(s) {
    const set = (cap, val) => (this.getCapabilityValue(cap) !== val ? this.setCapabilityValue(cap, val).catch(this.error) : null);
    const end = s.rainDelay && s.rainDelayEnd
      ? new Date(s.rainDelayEnd * 1000).toISOString().replace('T', ' ').slice(0, 16)
      : '-';
    await Promise.all([
      set('onoff', s.enabled),
      set('os_running', s.zones.filter(z => z.running && !z.isMaster).length),
      set('os_water_level', s.waterLevel),
      set('os_rain_delay', s.rainDelay),
      set('os_rain_delay_end', end),
      set('alarm_water', s.sensor1),
    ]);
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('password') && newSettings.password) {
      await this.setStoreValue('pwHash', OpenSprinklerApi.hash(newSettings.password));
      this.homey.setTimeout(() => this.setSettings({ password: '' }).catch(this.error), 500);
    }
    this.homey.setTimeout(() => this.reconnect(), 100);
  }

  onDeleted() {
    this.homey.clearTimeout(this._timer);
  }

  onUninit() {
    this.homey.clearTimeout(this._timer);
  }

};
