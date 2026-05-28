/**
 * A small Web Audio API wrapper used by Run Show. HTMLAudioElement was being
 * blocked by autoplay rules — after auto-advance and a 5s pre-roll there's no
 * recent user gesture, so audio.play() silently failed on iOS/Safari. With a
 * single AudioContext unlocked on the Start tap, buffer playback is allowed for
 * the rest of the session, so segment music reliably plays at every cue.
 *
 * Use:
 *   audioEngine.init();                      // on Start (user gesture)
 *   audioEngine.play(src, { durationSec });  // fades in; stops + fades out at durationSec
 *   audioEngine.stop();                      // fades out current
 *   audioEngine.setMuted(true|false);
 */

type CtxCtor = typeof AudioContext;

interface PlayOptions {
  fadeMs?: number;
  durationSec?: number; // total seconds to play (incl. fade out at the end)
}

const DEFAULT_FADE_MS = 800;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private muted = false;

  /** Create + unlock the AudioContext. Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx: CtxCtor | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: CtxCtor }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    // Resume in case the context is created in suspended state (Safari).
    this.ctx.resume().catch(() => {});
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  /** Play the given audio src (data URL or http url) from the start with a fade in. */
  async play(src: string, opts: PlayOptions = {}): Promise<void> {
    if (!this.ctx || !this.master) return;
    this.stopNow();
    const buffer = await this.getBuffer(src);
    if (!buffer || !this.ctx || !this.master) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.connect(gain).connect(this.master);
    const fadeS = (opts.fadeMs ?? DEFAULT_FADE_MS) / 1000;
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeS);
    source.start(now);
    if (opts.durationSec && opts.durationSec > 0) {
      const end = now + opts.durationSec;
      const fadeStart = Math.max(now + fadeS, end - fadeS);
      gain.gain.setValueAtTime(1, fadeStart);
      gain.gain.linearRampToValueAtTime(0, end);
      try { source.stop(end + 0.05); } catch { /* ignore */ }
    }
    this.currentSource = source;
    this.currentGain = gain;
  }

  /** Fade out the current source (or stop instantly if none). */
  stop(opts: { fadeMs?: number } = {}): void {
    if (!this.ctx || !this.currentSource || !this.currentGain) return;
    const fadeS = (opts.fadeMs ?? DEFAULT_FADE_MS) / 1000;
    const now = this.ctx.currentTime;
    const g = this.currentGain.gain;
    const currentVal = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(currentVal, now);
    g.linearRampToValueAtTime(0, now + fadeS);
    try { this.currentSource.stop(now + fadeS + 0.05); } catch { /* ignore */ }
    this.currentSource = null;
    this.currentGain = null;
  }

  /** Stop immediately with no fade. */
  stopNow(): void {
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* ignore */ }
      this.currentSource = null;
    }
    this.currentGain = null;
  }

  dispose(): void {
    this.stopNow();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.master = null;
    this.buffers.clear();
  }

  private async getBuffer(src: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.buffers.get(src);
    if (cached) return cached;
    try {
      const res = await fetch(src);
      const arr = await res.arrayBuffer();
      // Older Safari requires the callback form, but modern returns a promise.
      const buf = await this.ctx.decodeAudioData(arr.slice(0));
      this.buffers.set(src, buf);
      return buf;
    } catch (e) {
      console.warn('audioEngine: failed to load/decode source', e);
      return null;
    }
  }
}

export const audioEngine = new AudioEngine();
