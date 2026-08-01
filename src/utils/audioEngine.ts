/**
 * A small Web Audio API wrapper used by Run Show. HTMLAudioElement was being
 * blocked by autoplay rules — after auto-advance and a 5s pre-roll there's no
 * recent user gesture, so audio.play() silently failed on iOS/Safari. With a
 * single AudioContext unlocked on the first tap, buffer playback is allowed for
 * the rest of the session, so the soundboard reliably plays every track.
 *
 * Run Show is a soundboard now: one track at a time, started and stopped by the
 * operator. Pressing a second button while something is playing crossfades —
 * the outgoing track keeps its own gain node and fades out on its own schedule
 * while the new one fades in, so a handover never clicks or drops to silence.
 *
 * Use:
 *   audioEngine.init();                                  // on any user gesture
 *   audioEngine.play(src, { fadeInMs, fadeOutMs, onEnded });
 *   audioEngine.stop({ fadeMs });                        // fades out current
 *   audioEngine.setMuted(true|false);
 */

import { dataUrlToBytes } from './media';
import { isMediaRef, resolveMediaUrl } from './mediaStore';

type CtxCtor = typeof AudioContext;

interface PlayOptions {
  /** Fade-in for the track being started. */
  fadeInMs?: number;
  /** Fade-out applied to whatever is already playing. */
  fadeOutMs?: number;
  /** Total seconds to play (incl. the fade out at the end). Full track if unset. */
  durationSec?: number;
  /** Called when the track finishes on its own — not when it's stopped or replaced. */
  onEnded?: () => void;
}

const DEFAULT_FADE_IN_MS = 1200;
const DEFAULT_FADE_OUT_MS = 400;

/**
 * The bytes behind an already-resolved source, ready for decodeAudioData.
 *
 * Uploaded tracks resolve to a `data:` URL, and those are decoded in-process:
 * fetch() answers to CSP `connect-src`, which doesn't allow data:, so fetching
 * one is a blocked request and a soundboard button that does nothing. Anything
 * else (an http link) is a real network resource and still goes over fetch.
 */
async function readSourceBytes(url: string): Promise<ArrayBuffer | null> {
  if (url.startsWith('data:')) {
    const bytes = dataUrlToBytes(url);
    return bytes ? (bytes.buffer as ArrayBuffer) : null;
  }
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.arrayBuffer();
}

interface Playing {
  src: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  token: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private current: Playing | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private muted = false;
  /**
   * Bumped on every play() and stop(). A play() that awaits a decode and comes
   * back to find the token moved on has been superseded — two fast taps must
   * not leave both tracks running.
   */
  private token = 0;

  /**
   * Create + unlock the AudioContext. Safe to call any time; call it from a
   * user gesture (a button press) so the context is allowed to run.
   */
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

  /** The source currently playing, or null. */
  get playingSrc(): string | null {
    return this.current?.src ?? null;
  }

  /**
   * Pre-decode an audio source so the next play() call is instant.
   * Safe to call any time after init() — silently no-ops if there's no ctx
   * yet. Repeated calls for the same src hit the buffer cache.
   */
  async preload(src: string): Promise<void> {
    if (!this.ctx) return;
    await this.getBuffer(src);
  }

  /** Resume the AudioContext if it was auto-suspended (Safari/iOS especially). */
  private async ensureRunning(): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
  }

  /**
   * Play `src` from the top with a fade in, fading out anything already
   * playing. Resolves true once the track is actually running — false if the
   * source couldn't be decoded, or if a later play()/stop() superseded it.
   */
  async play(src: string, opts: PlayOptions = {}): Promise<boolean> {
    this.init();
    if (!this.ctx || !this.master) return false;
    const token = ++this.token;
    // Release the outgoing track first so the fade starts on the tap, not
    // after the (possibly slow) decode of the incoming one.
    this.release(opts.fadeOutMs ?? DEFAULT_FADE_OUT_MS);
    // Safari/iOS can auto-suspend the AudioContext after a stretch of silence.
    // Always resume before scheduling a source — otherwise start() is silent.
    await this.ensureRunning();
    const buffer = await this.getBuffer(src);
    if (!buffer || this.token !== token || !this.ctx || !this.master) return false;
    // The decode and resume above are async; the ctx could have been suspended
    // again in between. Resume once more so currentTime advances.
    await this.ensureRunning();
    if (this.token !== token || !this.ctx || !this.master) return false;

    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.connect(gain).connect(this.master);
    const fadeS = (opts.fadeInMs ?? DEFAULT_FADE_IN_MS) / 1000;
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
    // Only fires for a track that ran to its end — release() detaches this
    // handler before stopping, so a stop or a handover stays silent.
    source.onended = () => {
      if (this.current?.token !== token) return;
      this.current = null;
      opts.onEnded?.();
    };
    this.current = { src, source, gain, token };
    return true;
  }

  /** Fade out whatever is playing. */
  stop(opts: { fadeMs?: number } = {}): void {
    // Cancel any play() still waiting on a decode, or it would start after the
    // operator has already asked for silence.
    this.token++;
    this.release(opts.fadeMs ?? DEFAULT_FADE_OUT_MS);
  }

  /** Stop immediately with no fade. */
  stopNow(): void {
    this.token++;
    this.release(0);
  }

  /**
   * Detach the current track and fade it out over `fadeMs`. The nodes stay
   * alive until the fade finishes — the engine just stops calling it current.
   */
  private release(fadeMs: number): void {
    const playing = this.current;
    this.current = null;
    if (!playing || !this.ctx) return;
    playing.source.onended = null;
    if (fadeMs <= 0) {
      try { playing.source.stop(); } catch { /* ignore */ }
      return;
    }
    const fadeS = fadeMs / 1000;
    const now = this.ctx.currentTime;
    const g = playing.gain.gain;
    const currentVal = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(currentVal, now);
    g.linearRampToValueAtTime(0, now + fadeS);
    try { playing.source.stop(now + fadeS + 0.05); } catch { /* ignore */ }
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
      // Large tracks live in the chunked media store and the show only holds
      // a `media:` reference — resolve it to a data URL before decoding.
      // Plain data URLs / http links pass through unchanged. Buffers cache
      // under the original src, so a track only resolves once per session.
      const resolved = isMediaRef(src) ? await resolveMediaUrl(src) : src;
      if (!resolved) return null;
      const arr = await readSourceBytes(resolved);
      if (!arr) return null;
      // Older Safari requires the callback form, but modern returns a promise.
      const buf = await this.ctx.decodeAudioData(arr);
      this.buffers.set(src, buf);
      return buf;
    } catch (e) {
      console.warn('audioEngine: failed to load/decode source', e);
      return null;
    }
  }
}

export const audioEngine = new AudioEngine();
