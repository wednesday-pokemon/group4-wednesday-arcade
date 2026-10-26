// Synthesised Web Audio cues plus an optional looping music track (an <audio> element routed through the same master
// gain, so mute covers it). The context starts after the first user gesture; mute is persisted through settings.ts.
export type Sfx =
  | 'tick' | 'chime' | 'thud' | 'growl' | 'sting' | 'fanfare' | 'toll' | 'splash' | 'scrape'
  // v3 real-time cues
  | 'heartbeat' | 'whoosh' | 'rescue' | 'horn' | 'denied' | 'ready' | 'clean' | 'bump'
  // case-file reveal: a paper slide, a riffle of shuffled files, the ASSIGNED stamp
  | 'paper' | 'shuffle' | 'stamp'
  // overhaul HUD (UX_OVERHAUL §5–§7): odds glass tick (−24 dB), Thing's double knock (ADVICE, −20 dB), POWER STATUS soft
  // rise (−22 dB), INVESTIGATION page flip (−24 dB), a hidden passage grinding open
  | 'glass' | 'knock' | 'rise' | 'page' | 'grind'
  // Joseph Crackstone (UX_ENEMIES §7): a high single bell when he spots you (distinct from the low DNF toll), the scan
  // chant (bandpass sweep over the warning) + its pulse, the curse cast / hit / fizzle
  | 'knell' | 'chant' | 'pulse' | 'curseCast' | 'curseHit' | 'curseFizzle';

/** Which enemy drives the drone: the Hyde's growl drone or Crackstone's organ fifth (crossfade 0.6 s). */
export type ThreatSource = 'hyde' | 'crackstone';

const AMBIENT_LEVEL = 0.05;
const SFX_LEVEL = 0.5;
const MUSIC_LEVEL = 0.35;
const MUSIC_DUCK = 0.65; // at full threat the music drops to 35 % of its level so the Hyde's cues read
const PAD_LEVEL = 0.06;
const PAD_FADE_TC = 0.8; // setTargetAtTime constant: ~2.5 s to silence, so the prologue pad melts into the island
const VOICE_DUCK = 0.45; // music level while a narration clip plays
const CHANT_DUCK = 0.7; // the scan chant ducks the music a further 30 %
const SOURCE_FADE_TC = 0.2; // setTargetAtTime constant: ≈ 0.6 s crossfade between the two drones

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private organGain: GainNode | null = null;
  private source: ThreatSource = 'hyde';
  private chantUntil = 0;
  private threat = 0;
  private nextBeatAt = 0;
  private musicSrc: string | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private musicGain: GainNode | null = null;
  private padGain: GainNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private padStopTimer: ReturnType<typeof setTimeout> | null = null;

  /** Call from a user-gesture handler; safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.startMusic();
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
    this.startMusic();
  }

  /** Looping background music (null stops it). Plays once the context is unlocked by a user gesture. */
  setMusic(src: string | null): void {
    if (src === this.musicSrc) return;
    this.musicSrc = src;
    if (this.musicEl) {
      this.musicEl.pause();
      if (src) {
        this.musicEl.src = src;
        this.startMusic();
      }
    } else this.startMusic();
  }

  private startMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.musicSrc) return;
    if (!this.musicEl) {
      const el = new Audio(this.musicSrc);
      el.loop = true;
      el.preload = 'auto';
      try {
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = MUSIC_LEVEL;
        ctx.createMediaElementSource(el).connect(this.musicGain);
        this.musicGain.connect(this.master);
      } catch {
        return; // no Web Audio routing → stay silent rather than bypass the mute
      }
      this.musicEl = el;
    }
    if (this.musicEl.paused) void this.musicEl.play().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** `durS`: length of the sweeping cues (`chant` = the scan warning, `curseCast` = the curse wind-up). */
  play(name: Sfx, o: { durS?: number } = {}): void {
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
      case 'paper': return this.noiseBurst(t, 'bandpass', 3200 + Math.random() * 900, 0.16, 0.22);
      case 'shuffle': return [0, 0.06, 0.13, 0.19, 0.27].forEach((d) => this.noiseBurst(t + d, 'bandpass', 2600 + Math.random() * 1400, 0.09, 0.16));
      case 'stamp': {
        this.thud(t);
        return this.noiseBurst(t, 'highpass', 1800, 0.08, 0.3);
      }
      // dB levels relative to the SFX bus: −20 dB ≈ 0.1, −22 dB ≈ 0.08, −24 dB ≈ 0.063
      case 'glass': return this.tone(2637, 'sine', t, 0.25, 0.063);
      case 'knock': return [0, 0.13].forEach((d) => this.noiseBurst(t + d, 'lowpass', 900, 0.07, 0.1));
      case 'rise': return [523.25, 784].forEach((f, i) => this.tone(f, 'sine', t + i * 0.09, 0.35, 0.08));
      case 'page': return this.noiseBurst(t, 'bandpass', 2800, 0.14, 0.063);
      case 'grind': return [0, 0.25, 0.5].forEach((d) => this.noiseBurst(t + d, 'lowpass', 260 + d * 120, 0.32, 0.35));
      // Crackstone (−14 dB ≈ 0.2, −16 dB ≈ 0.16, −12 dB ≈ 0.25, −10 dB ≈ 0.32, −24 dB ≈ 0.063)
      case 'knell': return [1, 2, 2.76, 5.4].forEach((k, i) => this.tone(523.25 * k, 'sine', t, 1.6 - i * 0.3, 0.2 / (i + 1)));
      case 'chant': return this.chant(t, Math.max(0.5, o.durS ?? 2));
      case 'pulse': {
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(60, t);
        osc.frequency.exponentialRampToValueAtTime(38, t + 0.45);
        osc.connect(this.envelope(t, 0.5, 0.25));
        osc.start(t);
        osc.stop(t + 0.55);
        return this.whoosh(t);
      }
      case 'curseCast': return this.curseCast(t, Math.max(0.4, o.durS ?? 1.4));
      case 'curseHit': {
        [185, 262].forEach((f) => this.tone(f, 'sawtooth', t, 0.55, 0.32, 1200));
        return this.noiseBurst(t, 'highpass', 2200, 0.12, 0.32);
      }
      case 'curseFizzle': return this.noiseBurst(t, 'highpass', 4200, 0.4, 0.063);
    }
  }

  /** Two detuned saws through a bandpass sweeping 400 → 900 Hz over the scan warning, rising to −16 dB. */
  private chant(t: number, dur: number): void {
    const ctx = this.ctx!;
    this.chantUntil = t + dur;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16 * SFX_LEVEL, t + dur * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    g.connect(this.master!);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    f.connect(g);
    for (const hz of [146.8, 148.1]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz;
      osc.connect(f);
      osc.start(t);
      osc.stop(t + dur + 0.2);
    }
  }

  /** 330 → 311 Hz triangle glide + a whisper of noise over the curse wind-up (−16 dB). */
  private curseCast(t: number, dur: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.linearRampToValueAtTime(311, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16 * SFX_LEVEL, t + 0.08);
    g.gain.setValueAtTime(0.16 * SFX_LEVEL, t + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    g.connect(this.master!);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.15);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 3000;
    hp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.06 * SFX_LEVEL, t + dur * 0.8);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    src.connect(hp).connect(ng).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.15);
  }

  /**
   * Proximity shimmer near a KNOWN (already seen) uncollected clue: a soft high loop whose level follows `level` (0 at
   * 6 m … 1 at 2 m ≈ −20 dB) and pans with the clue's bearing (−1 left … 1 right). Call ~4 Hz; 0 fades it out. Mute
   * covers it (master gain). Created lazily on first use.
   */
  setShimmer(level: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const lv = Math.max(0, Math.min(1, level));
    if (!this.shimmerGain) {
      if (lv <= 0) return;
      this.startShimmer();
    }
    const t = ctx.currentTime;
    this.shimmerGain!.gain.setTargetAtTime(this.muted ? 0 : lv * 0.1, t, 0.25);
    this.shimmerPan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.2);
  }

  private shimmerGain: GainNode | null = null;
  private shimmerPan: StereoPannerNode | null = null;

  private startShimmer(): void {
    const ctx = this.ctx!;
    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0;
    try {
      this.shimmerPan = ctx.createStereoPanner();
      this.shimmerGain.connect(this.shimmerPan).connect(this.master!);
    } catch {
      this.shimmerGain.connect(this.master!);
    }
    const trem = ctx.createOscillator();
    trem.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
    trem.connect(depth);
    for (const [f, lvl] of [[1760, 0.5], [2217.5, 0.35], [2637, 0.25]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = lvl;
      depth.connect(g.gain);
      osc.connect(g).connect(this.shimmerGain);
      osc.start();
    }
    trem.start();
  }

  /**
   * Threat-driven ambience (+ `nearestM`: distance to the nearest active monster, which speeds the heartbeat up as it
   * closes in — see heartbeatIntervalS) (0 calm … 1 about to catch): a low drone that swells with the threat, and ONE shared
   * heartbeat whose rate follows the danger level (call every frame; level 0 = silent, 1 ≈ 1 Hz, 2 ≈ 2 Hz). `source`
   * picks the timbre: the Hyde's growl drone, or Crackstone's organ fifth (110 + 164.8 Hz) — crossfaded over ~0.6 s.
   */
  setThreat(threat: number, level: 0 | 1 | 2, source: ThreatSource = 'hyde', nearestM: number | null = null): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.threat = Math.max(0, Math.min(1, threat));
    if (!this.droneGain) this.startDrone();
    if (!this.organGain) this.startOrgan();
    const t = ctx.currentTime;
    const switched = source !== this.source;
    this.source = source;
    const level0 = this.muted ? 0 : 0.015 + this.threat * 0.11;
    const tc = switched ? SOURCE_FADE_TC : 0.4;
    this.droneGain!.gain.setTargetAtTime(source === 'hyde' ? level0 : 0, t, tc);
    this.organGain!.gain.setTargetAtTime(source === 'crackstone' ? level0 * 0.8 : 0, t, tc);
    this.droneFilter!.frequency.setTargetAtTime(160 + this.threat * 520, t, 0.4);
    const chant = t < this.chantUntil ? CHANT_DUCK : 1;
    this.musicGain?.gain.setTargetAtTime(MUSIC_LEVEL * (1 - MUSIC_DUCK * this.threat) * chant, t, 0.6);
    // the beat follows whichever is more urgent: the monsters' alert level or how close the nearest one is
    const prox = heartbeatIntervalS(nearestM);
    const interval = Math.min(level === 2 ? 0.5 : level === 1 ? 1.0 : Infinity, prox ?? Infinity);
    if (Number.isFinite(interval) && !this.muted && t >= this.nextBeatAt) {
      this.heartbeat(t + 0.01);
      this.nextBeatAt = t + interval;
    }
  }

  /**
   * Prologue mood: a low gothic organ pad swells in under the (uninterrupted) theme; turning it off fades the pad out
   * over ~2.5 s while the island loads, so the music carries straight into the investigation.
   */
  setPrologueMood(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    if (on) {
      if (this.padStopTimer) clearTimeout(this.padStopTimer);
      this.padStopTimer = null;
      if (!this.padGain) this.startPad();
      this.padGain!.gain.cancelScheduledValues(t);
      this.padGain!.gain.setTargetAtTime(PAD_LEVEL, t, PAD_FADE_TC);
      return;
    }
    if (!this.padGain) return;
    this.padGain.gain.cancelScheduledValues(t);
    this.padGain.gain.setTargetAtTime(0, t, PAD_FADE_TC);
    if (this.padStopTimer) clearTimeout(this.padStopTimer);
    this.padStopTimer = setTimeout(() => this.stopPad(), 4000);
  }

  /**
   * Optional narration clip, routed through the master gain (mute covers it) with the music ducked while it plays.
   * `done` resolves when the clip ends, fails, or is stopped.
   */
  playVoice(src: string): { done: Promise<void>; stop: () => void } {
    const ctx = this.ctx;
    if (!ctx || !this.master) return { done: Promise.resolve(), stop: () => undefined };
    const el = new Audio(src);
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = () => {
        this.musicGain?.gain.setTargetAtTime(MUSIC_LEVEL, ctx.currentTime, 0.4);
        resolve();
      };
    });
    try {
      ctx.createMediaElementSource(el).connect(this.master);
    } catch {
      finish();
      return { done, stop: () => undefined };
    }
    el.addEventListener('ended', finish, { once: true });
    el.addEventListener('error', finish, { once: true });
    this.musicGain?.gain.setTargetAtTime(MUSIC_LEVEL * VOICE_DUCK, ctx.currentTime, 0.3);
    void el.play().catch(finish);
    return {
      done,
      stop: () => {
        el.pause();
        finish();
      },
    };
  }

  private startPad(): void {
    const ctx = this.ctx!;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.connect(this.padGain).connect(this.master!);
    // D minor organ: root + fifth in the bass, minor third on top, each with a soft octave partial.
    const tremolo = ctx.createOscillator();
    tremolo.frequency.value = 0.18;
    const depth = ctx.createGain();
    depth.gain.value = 0.25;
    tremolo.connect(depth);
    for (const [f, type, level] of [[73.42, 'sine', 1], [110, 'triangle', 0.55], [146.83, 'sine', 0.5], [174.61, 'triangle', 0.35], [293.66, 'sine', 0.12]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = level;
      depth.connect(g.gain);
      osc.connect(g).connect(filter);
      osc.start();
      this.padOscs.push(osc);
    }
    tremolo.start();
    this.padOscs.push(tremolo);
  }

  private stopPad(): void {
    this.padStopTimer = null;
    for (const o of this.padOscs) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
    this.padOscs = [];
    this.padGain?.disconnect();
    this.padGain = null;
  }

  /** Silences the threat layer (pause, menus, run end). */
  calm(): void {
    this.threat = 0;
    if (this.ctx && this.droneGain) this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    if (this.ctx && this.organGain) this.organGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    if (this.ctx && this.musicGain) this.musicGain.gain.setTargetAtTime(MUSIC_LEVEL, this.ctx.currentTime, 0.6);
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

  /** Crackstone's drone: an organ fifth (110 + 164.8 Hz triangles, lowpass 900 Hz). */
  private startOrgan(): void {
    const ctx = this.ctx!;
    this.organGain = ctx.createGain();
    this.organGain.gain.value = 0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.connect(this.organGain).connect(this.master!);
    for (const hz of [110, 164.8]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz;
      osc.connect(f);
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

/** Heartbeat by proximity: silent beyond 25 m, then faster the closer the nearest monster is (1.1 s → 0.33 s at ≤ 3 m). */
export const HEARTBEAT_FAR_M = 25;
const HEARTBEAT_NEAR_M = 3;
export function heartbeatIntervalS(distanceM: number | null): number | null {
  if (distanceM === null || !Number.isFinite(distanceM) || distanceM > HEARTBEAT_FAR_M) return null;
  const k = Math.min(1, Math.max(0, (HEARTBEAT_FAR_M - distanceM) / (HEARTBEAT_FAR_M - HEARTBEAT_NEAR_M)));
  return 1.1 - (1.1 - 0.33) * k;
}
