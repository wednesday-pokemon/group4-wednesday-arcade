// Synthesised Web Audio only (no audio files). The context starts after the first user gesture;
// mute is persisted through settings.ts.
export type Sfx =
  | 'tick' | 'chime' | 'thud' | 'growl' | 'sting' | 'fanfare' | 'toll' | 'splash' | 'scrape'
  // v3 real-time cues
  | 'heartbeat' | 'whoosh' | 'rescue' | 'horn' | 'denied' | 'ready' | 'clean' | 'bump';

const AMBIENT_LEVEL = 0.05;
const SFX_LEVEL = 0.5;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private threat = 0;
  private nextBeatAt = 0;

  /** Call from a user-gesture handler; safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise(2);
    this.startAmbient();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  play(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'tick': return this.tone(1250, 'sine', t, 0.035, 0.12);
      case 'chime': return [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.tone(f, 'sine', t + i * 0.07, 1.2, 0.18));
      case 'thud': return this.thud(t);
      case 'growl': return this.growl(t);
      case 'sting': return [220, 233.1, 311.1].forEach((f) => this.tone(f, 'sawtooth', t, 0.9, 0.12, 1800));
      case 'fanfare': return [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.16, i === 3 ? 1.4 : 0.35, 0.3));
      case 'toll': return [110, 220 * 1.38, 110 * 5.4].forEach((f, i) => this.tone(f, 'sine', t, 3.2 - i * 0.8, 0.35 / (i + 1)));
      case 'splash': return this.noiseBurst(t, 'bandpass', 1100 + Math.random() * 500, 0.22, 0.32);
      case 'scrape': return this.noiseBurst(t, 'highpass', 2400, 0.18, 0.18);
      case 'heartbeat': return this.heartbeat(t);
      case 'whoosh': return this.whoosh(t);
      case 'rescue': return [146.8, 155.6, 207.7, 293.7].forEach((f, i) => this.tone(f, 'sawtooth', t + i * 0.03, 0.7, 0.14, 2400));
      case 'horn': return [55, 82.4].forEach((f) => this.tone(f, 'sawtooth', t, 1.4, 0.22, 380));
      case 'denied': return this.tone(140, 'square', t, 0.14, 0.12, 600);
      case 'ready': return [784, 1175].forEach((f, i) => this.tone(f, 'sine', t + i * 0.08, 0.5, 0.12));
      case 'clean': return [659.25, 987.8, 1318.5].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.09, 0.6, 0.22));
      case 'bump': return this.noiseBurst(t, 'lowpass', 500, 0.2, 0.5);
    }
  }

  /**
   * Threat-driven ambience (0 calm … 1 about to catch): a low drone that swells with the threat, and a heartbeat
   * whose rate follows the danger level (call every frame; level 0 = silent, 1 ≈ 1 Hz, 2 ≈ 2 Hz).
   */
  setThreat(threat: number, level: 0 | 1 | 2): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.threat = Math.max(0, Math.min(1, threat));
    if (!this.droneGain) this.startDrone();
    const t = ctx.currentTime;
    this.droneGain!.gain.setTargetAtTime(this.muted ? 0 : 0.015 + this.threat * 0.11, t, 0.4);
    this.droneFilter!.frequency.setTargetAtTime(160 + this.threat * 520, t, 0.4);
    if (level > 0 && !this.muted && t >= this.nextBeatAt) {
      this.heartbeat(t + 0.01);
      this.nextBeatAt = t + (level === 2 ? 0.5 : 1.0);
    }
  }

  /** Silences the threat layer (pause, menus, run end). */
  calm(): void {
    this.threat = 0;
    if (this.ctx && this.droneGain) this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }

  private startDrone(): void {
    const ctx = this.ctx!;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 200;
    this.droneFilter.connect(this.droneGain).connect(this.master!);
    for (const [f, type] of [[41.2, 'sawtooth'], [41.9, 'sawtooth'], [61.7, 'triangle']] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.connect(this.droneFilter);
      osc.start();
    }
  }

  private heartbeat(t: number): void {
    const ctx = this.ctx!;
    for (const [dt, peak] of [[0, 0.9], [0.17, 0.6]] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(70, t + dt);
      osc.frequency.exponentialRampToValueAtTime(40, t + dt + 0.14);
      osc.connect(this.envelope(t + dt, 0.18, peak));
      osc.start(t + dt);
      osc.stop(t + dt + 0.22);
    }
  }

  private whoosh(t: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 2;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.35);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.6);
    src.connect(f).connect(this.envelope(t, 0.6, 0.55));
    src.start(t, Math.random());
    src.stop(t + 0.65);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = brown * 3.5;
    }
    return buffer;
  }

  /** Low rumbling water plus a slow, swelling wind band. */
  private startAmbient(): void {
    const ctx = this.ctx!;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = AMBIENT_LEVEL;
    this.ambientGain.connect(this.master!);
    const layer = (type: BiquadFilterType, freq: number, lfoHz: number, lfoDepth: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const depth = ctx.createGain();
      depth.gain.value = lfoDepth;
      lfo.connect(depth).connect(filter.frequency);
      src.connect(filter).connect(this.ambientGain!);
      src.start();
      lfo.start();
    };
    layer('lowpass', 420, 0.13, 180);
    layer('bandpass', 900, 0.05, 500);
  }

  private envelope(t: number, dur: number, peak: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak * SFX_LEVEL, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master!);
    return g;
  }

  private tone(freq: number, type: OscillatorType, t: number, dur: number, peak: number, lowpassHz?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = this.envelope(t, dur, peak);
    if (lowpassHz) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpassHz;
      osc.connect(f).connect(env);
    } else {
      osc.connect(env);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private thud(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    osc.connect(this.envelope(t, 0.45, 0.9));
    osc.start(t);
    osc.stop(t + 0.5);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    src.connect(f).connect(this.envelope(t, 0.3, 0.8));
    src.start(t);
    src.stop(t + 0.35);
  }

  /** Filtered noise burst: oar splashes and hull scrapes. */
  private noiseBurst(t: number, type: BiquadFilterType, freq: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 0.8;
    src.connect(f).connect(this.envelope(t, dur, peak));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private growl(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(62, t);
    osc.frequency.linearRampToValueAtTime(48, t + 1);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 23;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 9;
    wobble.connect(wobbleDepth).connect(osc.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    osc.connect(f).connect(this.envelope(t, 1.1, 0.7));
    osc.start(t);
    wobble.start(t);
    osc.stop(t + 1.2);
    wobble.stop(t + 1.2);
  }
}

export const audio = new AudioEngine();
