'use strict';

const DEFAULTS = {
  deviceId: null,
  keepOn: true, // turn the valve back on if it switches off while a zone is watering
  offWhenDone: false, // turn the valve off when no zones are running any more
};

/**
 * Controls an external master valve (e.g. a Sonoff Zigbee water valve that
 * closes itself after a period without flow) alongside OpenSprinkler zones.
 */
class MasterValve {

  constructor(app, getApi) {
    this.app = app;
    this.homey = app.homey;
    this.getApi = getApi;
    this.wasRunning = new Set();
    this.instance = null;
    this.homey.settings.on('set', key => { if (key === 'valve') this.start().catch(err => this.app.error(err)); });
  }

  get config() {
    return { ...DEFAULTS, ...(this.homey.settings.get('valve') || {}) };
  }

  async listValves() {
    const api = await this.getApi();
    const devices = await api.devices.getDevices();
    return Object.values(devices)
      .filter(d => (d.capabilities || []).includes('onoff') && d.driverId && !String(d.driverId).includes(this.homey.manifest.id))
      .map(d => ({ id: d.id, name: d.name, on: d.capabilitiesObj && d.capabilitiesObj.onoff ? d.capabilitiesObj.onoff.value : null }));
  }

  async start() {
    if (this.instance) { try { this.instance.destroy(); } catch (e) { /* ignore */ } this.instance = null; }
    this.device = null;
    const cfg = this.config;
    if (!cfg.deviceId) return;
    const api = await this.getApi();
    this.device = await api.devices.getDevice({ id: cfg.deviceId });
    this.instance = this.device.makeCapabilityInstance('onoff', value => {
      if (value === false && this.config.keepOn && this._anyRunning()) {
        this.app.log('Master valve closed while watering – reopening');
        this.turnOn().catch(err => this.app.error('Master valve:', err.message));
      }
    });
    this.app.log(`Master valve: "${this.device.name}"`);
  }

  _anyRunning() {
    return this.app.getControllers().some(c => c.state && c.state.zones.some(z => z.running && !z.isMaster));
  }

  async _set(value) {
    if (!this.config.deviceId) return;
    if (!this.device) await this.start();
    if (!this.device) return;
    await this.device.setCapabilityValue({ capabilityId: 'onoff', value });
  }

  turnOn() { return this._set(true); }

  /** Call before starting a zone from Homey. Never blocks the zone if the valve fails. */
  async beforeRun() {
    try { await this.turnOn(); } catch (err) { this.app.error('Master valve:', err.message); }
  }

  /** Called after every controller poll; catches zones started by programs or the OpenSprinkler app. */
  onState(controllerId, state) {
    const key = sid => `${controllerId}:${sid}`;
    const running = state.zones.filter(z => z.running && !z.isMaster).map(z => key(z.sid));
    const started = running.some(k => !this.wasRunning.has(k));
    for (const k of [...this.wasRunning]) if (k.startsWith(`${controllerId}:`)) this.wasRunning.delete(k);
    for (const k of running) this.wasRunning.add(k);

    if (started) this.turnOn().catch(err => this.app.error('Master valve:', err.message));
    else if (!this._anyRunning() && this.config.offWhenDone && this._hadRunning) {
      this._set(false).catch(err => this.app.error('Master valve:', err.message));
    }
    this._hadRunning = this._anyRunning();
  }

  status() {
    return { config: this.config, name: this.device ? this.device.name : null };
  }

}

module.exports = MasterValve;
