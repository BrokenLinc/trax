import { ENGINE_IDLE_RPM, ENGINE_REDLINE_RPM } from './engine.ts';

/** Buffer is one 720° cycle recorded at this crank speed. */
const REFERENCE_RPM = 1200;
/** Second exhaust pulse, as a fraction of the 720° cycle. */
const SECOND_PULSE = 270 / 720;
const MASTER_GAIN = 0.28;

/**
 * Procedural 270° parallel twin. One looping cycle holds two exhaust
 * pulses and a sub-octave sine; playback rate is `rpm / REFERENCE_RPM`,
 * so pitch and pulse spacing stay locked. A lowpass opens with RPM and
 * a waveshaper adds a little growl.
 *
 * The context is created on the first enable, which must be a user gesture.
 */
export class EngineSynth {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private pendingRpm = ENGINE_IDLE_RPM;

  setEnabled(on: boolean): void {
    if (on) this.start();
    else this.stop();
  }

  setRpm(rpm: number): void {
    this.pendingRpm = rpm;
    const ctx = this.ctx;
    const source = this.source;
    const filter = this.filter;
    if (!ctx || !source || !filter) return;
    const now = ctx.currentTime;
    source.playbackRate.setTargetAtTime(rpm / REFERENCE_RPM, now, 0.03);
    filter.frequency.setTargetAtTime(cutoffHz(rpm), now, 0.04);
  }

  dispose(): void {
    this.stop();
  }

  private start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      this.setRpm(this.pendingRpm);
      return;
    }
    const ctx = new AudioContext();
    const buffer = cycleBuffer(ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = this.pendingRpm / REFERENCE_RPM;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    filter.frequency.value = cutoffHz(this.pendingRpm);

    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve();
    shaper.oversample = '2x';

    const gain = ctx.createGain();
    gain.gain.value = MASTER_GAIN;

    source.connect(filter);
    filter.connect(shaper);
    shaper.connect(gain);
    gain.connect(ctx.destination);
    source.start();

    this.ctx = ctx;
    this.source = source;
    this.filter = filter;
    void ctx.resume();
  }

  private stop(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.source?.stop();
    this.source = null;
    this.filter = null;
    this.ctx = null;
    void ctx.close();
  }
}

function cutoffHz(rpm: number): number {
  const span = ENGINE_REDLINE_RPM - ENGINE_IDLE_RPM;
  const t = span <= 0 ? 0 : Math.min(1, Math.max(0, (rpm - ENGINE_IDLE_RPM) / span));
  return 170 + t * 820;
}

/** One 720° crank cycle: a pulse, its partner 270° later, and a sub sine. */
function cycleBuffer(ctx: AudioContext): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const cycleHz = REFERENCE_RPM / 120;
  const length = Math.max(1, Math.round(sampleRate / cycleHz));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;
    const sample = exhaustPulse(t, 0) + exhaustPulse(t, SECOND_PULSE) * 0.82 + sub(t);
    data[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const scale = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < length; i++) data[i] = (data[i] ?? 0) * scale;
  return buffer;
}

function exhaustPulse(t: number, center: number): number {
  let d = t - center;
  if (d < 0) d += 1;
  if (d > 0.11) return 0;
  const env = Math.exp(-d * 36);
  const body = Math.sin(2 * Math.PI * d * 14);
  return env * (0.7 + 0.3 * body);
}

function sub(t: number): number {
  return Math.sin(2 * Math.PI * t) * 0.62 + Math.sin(4 * Math.PI * t) * 0.18;
}

function saturationCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const drive = 1.7;
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}
