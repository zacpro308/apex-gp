/* Synthesised sound: a screaming V8 for the player's car (plus the nearest rival),
   overrun crackles and downshift blips, kerb rumble, tyre squeal, wind, rain and impacts. */
export class Sound {
  constructor() { this.ctx = null; this.muted = false; this.prevGear = 0; this.popT = 0; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext, ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(ctx.destination);
      // shared white-noise buffer
      const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = nb;
      this.engine = this.makeEngine(0.9);
      this.rival = this.makeEngine(0.35);
      this.rumble = this.makeNoise('lowpass', 160, 1.5); this.rumbleLfo = ctx.createOscillator(); this.rumbleLfo.type = 'square';
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5; this.rumbleLfo.connect(lfoGain); lfoGain.connect(this.rumble.g.gain); this.rumbleLfo.start();
      this.squeal = this.makeNoise('bandpass', 1900, 9);
      this.wind = this.makeNoise('lowpass', 700, 0.7);
      this.rain = this.makeNoise('highpass', 2600, 0.5);
    } catch (e) { this.ctx = null; }
  }
  makeNoise(type, freq, q) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return { f, g };
  }
  makeEngine(level) {
    // High-revving V8 (up to 18,000 rpm, 4 firing pulses per revolution). Each voice runs at half the
    // firing frequency with a custom harmonic spectrum: the firing order (2nd harmonic) dominates, with
    // its overtones for the scream and a little half-order content for growl. Two voices are detuned
    // slightly against each other (banks of cylinders), then shaped by a high-pass, a presence peak and
    // a gentle saturation — no square waves, so no buzzy "two-stroke" sound.
    const ctx = this.ctx;
    const amps = [0, 0.12, 1.0, 0.22, 0.62, 0.1, 0.4, 0.05, 0.26, 0.03, 0.14, 0.02, 0.08];
    const real = new Float32Array(amps.length), imag = new Float32Array(amps);
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    const mk = () => { const o = ctx.createOscillator(); o.setPeriodicWave(wave); return o; };
    const o1 = mk(), o2 = mk();
    const g1 = ctx.createGain(), g2 = ctx.createGain(); g1.gain.value = 0.55; g2.gain.value = 0.45;
    // subtle vibrato from uneven combustion
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 23; lfoG.gain.value = 3; lfo.connect(lfoG); lfoG.connect(o1.frequency); lfoG.connect(o2.frequency); lfo.start();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140; hp.Q.value = 0.7;
    const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 2200; pres.Q.value = 0.9; pres.gain.value = 6;
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4); }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.5;
    const out = ctx.createGain(); out.gain.value = 0;
    o1.connect(g1); o2.connect(g2); g1.connect(hp); g2.connect(hp);
    hp.connect(pres); pres.connect(shaper); shaper.connect(lp); lp.connect(out); out.connect(this.master);
    o1.start(); o2.start();
    // "scream" layer: the firing frequency and its 2nd/3rd orders through a bright resonant band.
    // This is what makes a high-revving V8 sound like a V8 rather than a hum.
    const sc = ctx.createOscillator(); sc.type = 'sawtooth';
    const sc2 = ctx.createOscillator(); sc2.type = 'sawtooth';
    const scBand = ctx.createBiquadFilter(); scBand.type = 'bandpass'; scBand.frequency.value = 3000; scBand.Q.value = 1.6;
    const scG = ctx.createGain(); scG.gain.value = 0;
    const sc2G = ctx.createGain(); sc2G.gain.value = 0.5;
    sc.connect(scBand); sc2.connect(sc2G); sc2G.connect(scBand); scBand.connect(scG); scG.connect(out);
    sc.start(); sc2.start();
    // exhaust rasp: noise chopped at the firing frequency (each combustion pulse is a burst of noise)
    const nz = ctx.createBufferSource(); nz.buffer = this.noiseBuf; nz.loop = true;
    const nzBand = ctx.createBiquadFilter(); nzBand.type = 'bandpass'; nzBand.frequency.value = 1800; nzBand.Q.value = 0.8;
    const chop = ctx.createGain(); chop.gain.value = 0;
    const pulse = ctx.createOscillator(); pulse.type = 'square';
    const pulseDepth = ctx.createGain(); pulseDepth.gain.value = 0.5;
    const pulseBias = ctx.createConstantSource(); pulseBias.offset.value = 0.5;
    pulse.connect(pulseDepth); pulseDepth.connect(chop.gain); pulseBias.connect(chop.gain);
    const rasp = ctx.createGain(); rasp.gain.value = 0;
    nz.connect(nzBand); nzBand.connect(chop); chop.connect(rasp); rasp.connect(out);
    nz.start(); pulse.start(); pulseBias.start();
    return { o1, o2, f1: pres, f2: lp, out, level, srpm: 7000, sc, sc2, scBand, scG, pulse, rasp, nzBand };
  }
  setEngine(e, rpm, thr, gain) {
    // the game's rev range (4k-12.5k) is mapped onto a real high-revving V8 range (7k-18k)
    const t = this.ctx.currentTime, target = 7000 + Math.min(1, Math.max(0, (rpm - 4000) / 8500)) * 11000;
    e.srpm += (target - e.srpm) * 0.35;
    const fire = e.srpm / 60 * 4, base = fire / 2;
    e.o1.frequency.setTargetAtTime(base, t, 0.015); e.o2.frequency.setTargetAtTime(base * 1.0035, t, 0.015);
    e.f1.frequency.setTargetAtTime(1600 + e.srpm * 0.08, t, 0.05);
    e.f2.frequency.setTargetAtTime(2500 + thr * 4500 + e.srpm * 0.15, t, 0.05);
    // scream gets stronger with revs and throttle; rasp is strongest on throttle
    const hi = Math.min(1, Math.max(0, (e.srpm - 9000) / 9000));
    e.sc.frequency.setTargetAtTime(fire, t, 0.015); e.sc2.frequency.setTargetAtTime(fire * 1.5, t, 0.015);
    e.scBand.frequency.setTargetAtTime(1800 + e.srpm * 0.18, t, 0.05);
    e.scG.gain.setTargetAtTime(0.25 + 0.75 * hi * (0.4 + 0.6 * thr), t, 0.04);
    e.pulse.frequency.setTargetAtTime(fire, t, 0.015);
    e.nzBand.frequency.setTargetAtTime(1200 + e.srpm * 0.08, t, 0.05);
    e.rasp.gain.setTargetAtTime(0.15 + 0.45 * thr, t, 0.04);
    e.out.gain.setTargetAtTime(this.muted ? 0 : gain * e.level * (0.07 + 0.13 * thr), t, 0.04);
  }
  burst(gain, dur, freq = 1500, q = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(), t = ctx.currentTime; g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  /* called every frame */
  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, on = s.on && !this.muted;
    if (!on) { [this.engine.out, this.rival.out, this.rumble.g, this.squeal.g, this.wind.g, this.rain.g].forEach(g => g.gain.setTargetAtTime(0, t, 0.05)); return; }
    let rpm = s.rpm;
    // downshift blip: rpm flares when a lower gear is selected
    if (s.gear > 0 && this.prevGear > 0 && s.gear < this.prevGear) { this.blip = 0.12; this.burst(0.05, 0.08, 2600, 2); }
    this.prevGear = s.gear;
    if (this.blip > 0) { this.blip -= dt; rpm = Math.min(12500, rpm + 1600); }
    this.setEngine(this.engine, rpm, Math.max(s.throttle, this.blip > 0 ? 0.6 : 0), 1);
    // overrun crackles when lifting at high revs
    if (s.throttle < 0.1 && s.rpm > 7500 && s.speed > 20) { this.popT -= dt; if (this.popT <= 0) { this.popT = 0.04 + Math.random() * 0.12; this.burst(0.06 + Math.random() * 0.08, 0.05 + Math.random() * 0.05, 600 + Math.random() * 1400, 0.8); } }
    // nearest rival
    if (s.rival) this.setEngine(this.rival, s.rival.rpm, s.rival.thr, s.rival.gain); else this.rival.out.gain.setTargetAtTime(0, t, 0.1);
    // kerbs: rumble pulses at the stripe frequency
    this.rumbleLfo.frequency.setTargetAtTime(Math.max(2, s.speed / 2), t, 0.05);
    this.rumble.g.gain.setTargetAtTime(s.kerb && s.speed > 5 ? 0.35 : 0, t, 0.03);
    this.squeal.g.gain.setTargetAtTime(Math.min(0.12, s.slide * 0.18), t, 0.05);
    this.wind.g.gain.setTargetAtTime(Math.min(0.16, (s.speed / 90) ** 2 * 0.16), t, 0.1);
    this.rain.g.gain.setTargetAtTime(s.rain * 0.12, t, 0.3);
    if (s.impact > 0.05) this.burst(0.5 * s.impact, 0.35, 220, 0.7), this.burst(0.25 * s.impact, 0.2, 2500, 1);
  }
}
