import { useEffect, useState } from 'react';
import { audioEngine } from './audioEngine';
import { loadFadeSettings } from './audioSettings';

/**
 * Hear an uploaded track where you uploaded it.
 *
 * Until now the only place a track could be played was the Run Show soundboard,
 * which means the first time you find out a file is silent, is the wrong file,
 * or won't decode in this browser is with an audience in the room. An upload
 * that can't be checked isn't finished — so a song with audio gets a play
 * button on the spot, and it goes through the same engine and the same fade
 * settings the show will use, so what you hear here is what the room hears.
 */

const FAILURE_MESSAGE: Record<string, string> = {
  'media-unavailable': "Couldn't load that audio. Try uploading the file again.",
  'decode-failed': "This browser can't play that format. Re-upload it as MP3 or M4A.",
  'no-audio-support': 'This browser has no audio support.',
  blocked: 'The browser is blocking audio. Tap the play button once more.',
};

/** How often a preview checks it's still the thing the engine is playing. */
const RECONCILE_MS = 400;

export interface TrackPreview {
  /** The source currently previewing, or null. */
  playingSrc: string | null;
  /** Why the last press made no sound, or null. */
  error: string | null;
  toggle: (src: string) => void;
}

export function useTrackPreview(): TrackPreview {
  const [playingSrc, setPlayingSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stop on unmount — leaving a track playing under a screen the operator has
  // already navigated away from is how you end up with music nobody can find
  // the off switch for.
  useEffect(() => () => audioEngine.stopNow(), []);

  // The engine plays one thing at a time for the whole app, so a preview can be
  // taken over by the soundboard or by another row. Either way this button has
  // to stop claiming it's the one playing.
  useEffect(() => {
    if (!playingSrc) return;
    const t = window.setInterval(() => {
      if (audioEngine.playingSrc !== playingSrc) setPlayingSrc(null);
    }, RECONCILE_MS);
    return () => window.clearInterval(t);
  }, [playingSrc]);

  function toggle(src: string) {
    const fade = loadFadeSettings();
    if (playingSrc === src) {
      audioEngine.stop({ fadeMs: fade.fadeOutMs });
      setPlayingSrc(null);
      return;
    }
    setPlayingSrc(src);
    setError(null);
    audioEngine
      .play(src, {
        fadeInMs: fade.fadeInMs,
        fadeOutMs: fade.fadeOutMs,
        onEnded: () => setPlayingSrc((k) => (k === src ? null : k)),
      })
      .then((result) => {
        if (result === 'started' || result === 'superseded') return;
        setPlayingSrc((k) => (k === src ? null : k));
        setError(FAILURE_MESSAGE[result] ?? "That track didn't play.");
      })
      .catch(() => {
        setPlayingSrc((k) => (k === src ? null : k));
        setError(FAILURE_MESSAGE['media-unavailable']);
      });
  }

  return { playingSrc, error, toggle };
}
