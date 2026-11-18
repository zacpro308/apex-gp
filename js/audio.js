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
    // V8 cross-plane: 4 firing pulses per revolution. Layer the firing frequency and its half-order
    // through a soft clipper and two resonant formants for the raspy scream.
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sawtooth';
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain(); g1.gain.value = 0.5; g2.gain.value = 0.28; g3.gain.value = 0.22;
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.6); }
    shaper.curve = curve;
    const f1 = ctx.createBiquadFilter(); f1.type = 'peaking'; f1.frequency.value = 900; f1.Q.value = 1.2; f1.gain.value = 9;
    const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 2400; f2.Q.value = 0.8;
    const out = ctx.createGain(); out.gain.value = 0;
    o1.connect(g1); o2.connect(g2); o3.connect(g3); g1.connect(shaper); g2.connect(shaper); g3.connect(shaper);
    shaper.connect(f1); f1.connect(f2); f2.connect(out); out.connect(this.master);
    o1.start(); o2.start(); o3.start();
    return { o1, o2, o3, f1, f2, out, level };
  }
  setEngine(e, rpm, thr, gain) {
    const t = this.ctx.currentTime, fire = rpm / 60 * 4;
    e.o1.frequency.setTargetAtTime(fire * 0.5, t, 0.02); e.o2.frequency.setTargetAtTime(fire * 0.25, t, 0.02); e.o3.frequency.setTargetAtTime(fire, t, 0.02);
    e.f1.frequency.setTargetAtTime(500 + rpm * 0.09, t, 0.05); e.f2.frequency.setTargetAtTime(900 + thr * 2600 + rpm * 0.1, t, 0.05);
    e.out.gain.setTargetAtTime(this.muted ? 0 : gain * e.level * (0.035 + 0.075 * thr), t, 0.04);
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
