'use strict';

const DEFAULTS = {
  deviceId: null,
  flowCapability: 'measure_water', // L/min
  meterCapability: 'meter_water', // cumulative volume, '' = integrate flow instead
  meterUnit: 'm3', // 'm3' | 'L'
  graceSeconds: 60,
};

/**
 * Attributes flow and consumption from an external water meter (e.g. a Sonoff
 * Zigbee water meter) to whichever OpenSprinkler zone(s) are currently running.
 */
class WaterTracker {

  constructor(app) {
    this.app = app;
    this.homey = app.homey;
    this.instances = [];
    this.flow = 0;
    this.lastMeter = null;
    this.lastFlowAt = null;
    this.recent = new Map(); // station device -> timestamp it was last running
    this.unassigned = this.homey.settings.get('water_unassigned') || 0;

    this.homey.settings.on('set', key => { if (key === 'water') this.start().catch(err => this.app.error(err)); });
  }

  get config() {
    return { ...DEFAULTS, ...(this.homey.settings.get('water') || {}) };
  }

  async _api() {
    if (!this.api) {
      // Loaded lazily: homey-api costs ~30 MB and is only needed for meter/valve features.
      const { HomeyAPI } = require('homey-api'); // eslint-disable-line global-require
      this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
    }
    return this.api;
  }

  async listMeters() {
    const api = await this._api();
    const devices = await api.devices.getDevices();
    return Object.values(devices)
      .filter(d => (d.capabilities || []).some(c => /water/.test(c)))
      .map(d => ({
        id: d.id,
        name: d.name,
        capabilities: (d.capabilities || []).filter(c => /water|flow|meter|measure/.test(c)).map(c => ({
          id: c,
          title: (d.capabilitiesObj && d.capabilitiesObj[c] && d.capabilitiesObj[c].title) || c,
          units: (d.capabilitiesObj && d.capabilitiesObj[c] && d.capabilitiesObj[c].units) || '',
          value: d.capabilitiesObj && d.capabilitiesObj[c] ? d.capabilitiesObj[c].value : null,
        })),
      }));
  }

  async start() {
    this.stop();
    const cfg = this.config;
    this.lastMeter = null;
    this.lastFlowAt = null;
    if (!cfg.deviceId) return;

    const api = await this._api();
    const device = await api.devices.getDevice({ id: cfg.deviceId });
    this.meterName = device.name;

    if (cfg.flowCapability && device.capabilities.includes(cfg.flowCapability)) {
      this.flow = Number(device.capabilitiesObj[cfg.flowCapability].value) || 0;
      this.lastFlowAt = Date.now();
      this.instances.push(device.makeCapabilityInstance(cfg.flowCapability, v => this.onFlow(v)));
    }
    if (cfg.meterCapability && device.capabilities.includes(cfg.meterCapability)) {
      const v = device.capabilitiesObj[cfg.meterCapability].value;
      this.lastMeter = v == null ? null : this._toLitres(v);
      this.instances.push(device.makeCapabilityInstance(cfg.meterCapability, v => this.onMeter(v)));
    }
    if (!cfg.meterCapability) this._integrator = this.homey.setInterval(() => this._integrate(), 10000);
    this.app.log(`Water tracking via "${device.name}" (flow: ${cfg.flowCapability || '-'}, meter: ${cfg.meterCapability || '-'})`);
    this.update();
  }

  stop() {
    this.homey.clearInterval(this._integrator);
    this._integrator = null;
    for (const i of this.instances) { try { i.destroy(); } catch (e) { /* ignore */ } }
    this.instances = [];
  }

  _toLitres(v) {
    return Number(v) * (this.config.meterUnit === 'L' ? 1 : 1000);
  }

  _stations() {
    try { return this.homey.drivers.getDriver('station').getDevices(); } catch (e) { return []; }
  }

  /** Zones to attribute water to: running now, else the last one(s) that stopped within the grace period. */
  _targets() {
    const now = Date.now();
    const running = this._stations().filter(s => s.getCapabilityValue('onoff') === true);
    for (const s of running) this.recent.set(s, now);
    if (running.length) return running;
    const grace = this.config.graceSeconds * 1000;
    const stations = this._stations();
    const recent = [...this.recent.entries()].filter(([s, t]) => now - t <= grace && stations.includes(s));
    if (!recent.length) return [];
    // Only the zone(s) that stopped last – earlier zones' water has already been counted.
    const latest = Math.max(...recent.map(([, t]) => t));
    return recent.filter(([, t]) => latest - t < 2000).map(([s]) => s);
  }

  /** Called on flow updates and whenever a zone starts/stops. */
  update() {
    if (!this.config.deviceId) return;
    const running = this._stations().filter(s => s.getCapabilityValue('onoff') === true);
    const now = Date.now();
    for (const s of running) this.recent.set(s, now);
    const share = running.length ? this.flow / running.length : 0;
    for (const s of this._stations()) {
      s.setWaterFlow(running.includes(s) ? share : 0).catch(err => this.app.error(err));
    }
  }

  onFlow(value) {
    this._integrate();
    this.flow = Math.max(0, Number(value) || 0);
    this.update();
  }

  onMeter(value) {
    if (value == null) return;
    const litres = this._toLitres(value);
    const prev = this.lastMeter;
    this.lastMeter = litres;
    if (prev == null) return;
    const delta = litres - prev;
    if (delta <= 0 || delta > 100000) return; // meter reset / glitch
    this._distribute(delta);
  }

  /** Without a cumulative meter, integrate flow (L/min) over time. */
  _integrate() {
    const now = Date.now();
    const cfg = this.config;
    if (!cfg.deviceId || cfg.meterCapability || this.lastFlowAt == null) { this.lastFlowAt = now; return; }
    const litres = (this.flow * (now - this.lastFlowAt)) / 60000;
    this.lastFlowAt = now;
    if (litres > 0) this._distribute(litres);
  }

  _distribute(litres) {
    const targets = this._targets();
    if (!targets.length) {
      this.unassigned += litres;
      this.homey.settings.set('water_unassigned', this.unassigned);
      return;
    }
    for (const s of targets) s.addWaterConsumption(litres / targets.length).catch(err => this.app.error(err));
  }

  status() {
    return {
      config: this.config,
      meterName: this.meterName || null,
      flow: this.flow,
      lastMeter: this.lastMeter,
      unassigned: this.unassigned,
      zones: this._stations().map(s => ({
        name: s.getName(),
        running: s.getCapabilityValue('onoff') === true,
        flow: s.getCapabilityValue('measure_water'),
        total: s.getStoreValue('water_total') || 0,
        lastRun: s.getStoreValue('water_last_run') || 0,
      })),
    };
  }

  async reset() {
    this.unassigned = 0;
    this.homey.settings.set('water_unassigned', 0);
    await Promise.all(this._stations().map(s => s.resetWater()));
  }

}

module.exports = WaterTracker;
