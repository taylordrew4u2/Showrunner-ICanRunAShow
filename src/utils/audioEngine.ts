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
import { createBudgetedCache } from './budgetedCache';

type CtxCtor = typeof AudioContext;

/**
 * Why a press did or didn't make sound. `play()` used to answer with a bare
 * false, which left the board unable to tell "that file is gone" from "you
 * pressed something else first" — and left the operator staring at silence
 * with nothing to act on.
 */
export type PlayResult =
  /** Running. */
  | 'started'
  /** A later press or a stop took over. Normal; not an error. */
  | 'superseded'
  /** No Web Audio in this browser at all. */
  | 'no-audio-support'
  /** The track's file couldn't be fetched or decrypted out of the media store. */
  | 'media-unavailable'
  /** Fetched, but not audio this browser can decode. */
  | 'decode-failed'
  /** The AudioContext wouldn't start — the browser is still holding audio back. */
  | 'blocked';

interface PlayOptions {
  /** Fade-in for the track being started. */
  fadeInMs?: number;
  /** Fade-out applied to whatever is already playing. */
  fadeOutMs?: number;
  /** Where in the track to start, in seconds. The top of the file if unset. */
  offsetSec?: number;
  /** Seconds to play from `offsetSec` (incl. the fade out at the end). To the
   *  end of the track if unset. */
  durationSec?: number;
  /** Called when the track finishes on its own — not when it's stopped or replaced. */
  onEnded?: () => void;
}

const DEFAULT_FADE_IN_MS = 1200;
const DEFAULT_FADE_OUT_MS = 400;

/**
 * How much decoded audio the engine keeps ready, in bytes of PCM.
 *
 * A decoded track is float samples, not the file: a 3½-minute stereo song is
 * ~75MB, so a full bill of walk-ons decoded up front ran to the better part of
 * a gigabyte, and a phone browser answers that by reloading the tab — blank
 * page, clock and pads gone, mid-show. 320MB is four or five whole songs, or
 * dozens of trimmed walk-ons, ready to start on the press; anything past that
 * decodes when it's pressed. The budget is soft: the track that crosses it is
 * kept, and a press always gets its track, so the engine can run over by one.
 */
export const BUFFER_BUDGET_BYTES = 320 * 1024 * 1024;

function bufferBytes(buf: AudioBuffer): number {
  return buf.length * buf.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
}

/**
 * What to do with a freshly decoded track. A press keeps it whatever the cost
 * and lets older tracks go to make room; decoding ahead stops at the budget so
 * it never pushes out a pad the operator is about to press.
 */
type Retain = 'always' | 'if-room';

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
  /**
   * Decoded tracks, oldest use first: the front is the track that has gone
   * longest without a press or a preload — the one to let go of when a press
   * needs room. See BUFFER_BUDGET_BYTES.
   */
  private buffers = createBudgetedCache<AudioBuffer>(bufferBytes, BUFFER_BUDGET_BYTES);
  /**
   * Context time the last fade-out ends. A closing board waits for it: the
   * fade End Show promises is on this context, and closing early cuts it dead.
   */
  private drainUntil = 0;
  private muted = false;
  /**
   * Bumped on every play() and stop(). A play() that awaits a decode and comes
   * back to find the token moved on has been superseded — two fast taps must
   * not leave both tracks running.
   */
  private token = 0;
  /** Which half of a load broke, per source — see loadBuffer(). */
  private loadFailures = new Map<string, PlayResult>();
  /**
   * Loads in progress, keyed by source. A press that lands while the up-front
   * preload is still working on that same track joins the existing decode
   * instead of starting a second fetch — which on a big file is the difference
   * between the walk-on landing on the press and landing a second late.
   */
  private pending = new Map<string, Promise<AudioBuffer | null>>();

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
   * yet. Repeated calls for the same src hit the buffer cache. Once the ready
   * tracks fill the budget this does nothing, and the track loads on its press.
   */
  async preload(src: string): Promise<void> {
    if (!this.ctx) return;
    if (!this.buffers.has(src) && !this.pending.has(src) && this.buffers.held >= BUFFER_BUDGET_BYTES) return;
    await this.getBuffer(src, 'if-room');
  }

  /**
   * Resume the AudioContext if it isn't running.
   *
   * iOS Safari has a non-standard 'interrupted' state it drops into after a
   * phone call, Siri, or another app taking audio — which on a show night is
   * exactly when the next walk-on is due. Anything that isn't 'running' gets a
   * resume(), not just 'suspended'.
   */
  private async ensureRunning(): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
  }

  /**
   * Play `src` from the top with a fade in, fading out anything already
   * playing. The result says what actually happened — see PlayResult.
   */
  async play(src: string, opts: PlayOptions = {}): Promise<PlayResult> {
    this.init();
    if (!this.ctx || !this.master) return 'no-audio-support';
    const token = ++this.token;
    // Release the outgoing track first so the fade starts on the tap, not
    // after the (possibly slow) decode of the incoming one.
    this.release(opts.fadeOutMs ?? DEFAULT_FADE_OUT_MS);
    // Safari/iOS can auto-suspend the AudioContext after a stretch of silence.
    // Always resume before scheduling a source — otherwise start() is silent.
    await this.ensureRunning();
    const buffer = await this.getBuffer(src, 'always');
    if (this.token !== token || !this.ctx || !this.master) return 'superseded';
    if (!buffer) return this.loadFailures.get(src) ?? 'media-unavailable';
    // The decode and resume above are async; the ctx could have been suspended
    // again in between. Resume once more so currentTime advances.
    await this.ensureRunning();
    if (this.token !== token || !this.ctx || !this.master) return 'superseded';
    // A context still suspended after two resume attempts means the browser is
    // holding audio back, and reporting that is more use than a dead button.
    // Only 'suspended' though — never refuse to try on a state we don't
    // recognise. Being wrong here costs a cue, and starting a source that
    // turns out to be silent costs nothing.
    if (this.ctx.state === 'suspended') return 'blocked';

    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.connect(gain).connect(this.master);
    const fadeS = Math.max(0, opts.fadeInMs ?? DEFAULT_FADE_IN_MS) / 1000;
    const now = this.ctx.currentTime;
    // A zero fade starts at full volume: an operator who asked for instant
    // wants the transient, and a ramp to "now" would swallow it.
    if (fadeS > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fadeS);
    } else {
      gain.gain.setValueAtTime(1, now);
    }
    // A trimmed song starts where the producer set its in-point rather than at
    // the top of the file, and a start past the end of the audio would play
    // nothing at all, so it is clamped to something that can still be heard.
    const offset = Math.min(Math.max(0, opts.offsetSec ?? 0), Math.max(0, buffer.duration - 0.05));
    source.start(now, offset);
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
    return 'started';
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
    const stopAt = now + fadeS + 0.05;
    this.drainUntil = Math.max(this.drainUntil, stopAt);
    try { playing.source.stop(stopAt); } catch { /* ignore */ }
  }

  /**
   * Let everything go: playback, the context and every decoded track. Called
   * when Run Show closes, so a show's worth of PCM is not carried into the
   * next one. init() makes a fresh context on the next open.
   */
  dispose(): void {
    this.stopNow();
    const ctx = this.ctx;
    if (ctx) {
      // A fade-out still running — End Show fades and then closes the board
      // in the same breath — is left to finish before the context goes.
      // Everything else is let go of now.
      const waitMs = Math.max(0, (this.drainUntil - ctx.currentTime) * 1000);
      const close = () => ctx.close().catch(() => {});
      if (waitMs > 0) setTimeout(close, waitMs);
      else close();
      this.ctx = null;
    }
    this.drainUntil = 0;
    this.master = null;
    this.buffers.clear();
    this.loadFailures.clear();
  }

  /** Decoded and ready to start on the next press with no wait. */
  isReady(src: string): boolean {
    return this.buffers.has(src);
  }

  private getBuffer(src: string, retain: Retain): Promise<AudioBuffer | null> {
    if (!this.ctx) return Promise.resolve(null);
    const cached = this.buffers.get(src);
    if (cached) {
      this.retain(src, cached, retain);
      return Promise.resolve(cached);
    }
    // Each caller decides for itself whether the decode is kept: a press that
    // joins a preload past the budget still keeps its track.
    const inFlight = this.pending.get(src);
    if (inFlight) return inFlight.then((buf) => this.keep(src, buf, retain));
    const load = this.loadBuffer(src).finally(() => this.pending.delete(src));
    this.pending.set(src, load);
    return load.then((buf) => this.keep(src, buf, retain));
  }

  private keep(src: string, buf: AudioBuffer | null, retain: Retain): AudioBuffer | null {
    if (buf) this.retain(src, buf, retain);
    return buf;
  }

  /**
   * File `buf` under `src` at the fresh end of the cache, or move it there if
   * it's already in. A press then lets the stalest tracks go until the rest
   * fit the budget; decoding ahead keeps the track only while there's room.
   */
  private retain(src: string, buf: AudioBuffer, retain: Retain): void {
    // A decode that lands after dispose() has nowhere to go: the context it
    // was decoded for is closed, and filing it would keep it for good.
    if (!this.ctx) return;
    if (this.buffers.has(src)) {
      this.buffers.touch(src);
      return;
    }
    if (retain === 'if-room' && this.buffers.held >= BUFFER_BUDGET_BYTES) return;
    // A buffer evicted here is only dropped from the cache: a source node
    // already playing it holds its own reference and runs to the end.
    this.buffers.set(src, buf, retain === 'always');
  }

  private async loadBuffer(src: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    // Which half failed, for the caller to report. Recorded per source before
    // each step rather than guessed afterwards, so "the file is missing" never
    // gets reported as "that isn't audio" — and so two concurrent loads don't
    // overwrite each other's reason.
    this.loadFailures.set(src, 'media-unavailable');
    try {
      // Large tracks live in the chunked media store and the show only holds
      // a `media:` reference — resolve it to a data URL before decoding.
      // Plain data URLs / http links pass through unchanged. Buffers cache
      // under the original src, so a track resolves once while it stays ready.
      const resolved = isMediaRef(src) ? await resolveMediaUrl(src) : src;
      if (!resolved) return null;
      const arr = await readSourceBytes(resolved);
      if (!arr) return null;
      this.loadFailures.set(src, 'decode-failed');
      // Older Safari requires the callback form, but modern returns a promise.
      const buf = await this.ctx.decodeAudioData(arr);
      this.loadFailures.delete(src);
      return buf;
    } catch (e) {
      console.warn('audioEngine: failed to load/decode source', src, e);
      return null;
    }
  }
}

export const audioEngine = new AudioEngine();
