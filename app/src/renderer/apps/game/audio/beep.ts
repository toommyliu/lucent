// Copyright (c) 2026 Daniel Belyi
// Licensed under the MIT License.

const SOURCE_STOP_PADDING = 0.05;
const CLEANUP_AFTER_MS = 1_050;
const REPEAT_INTERVAL = 0.28;
const SILENCE = 0.0001;

let sharedContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (sharedContext) return sharedContext;

  try {
    sharedContext = new AudioContext();
    return sharedContext;
  } catch {
    return null;
  }
};

const renderSuccessBeep = (context: AudioContext, times: number): void => {
  const now = context.currentTime;
  const master = context.createGain();
  master.gain.value = 0.5;
  master.connect(context.destination);

  const delay = context.createDelay(1);
  delay.delayTime.value = 0.1;

  const feedbackFilter = context.createBiquadFilter();
  feedbackFilter.type = "lowpass";
  feedbackFilter.frequency.value = 4_500;

  const feedbackGain = context.createGain();
  feedbackGain.gain.value = 0.22;

  const wetGain = context.createGain();
  wetGain.gain.value = 0.16;

  master.connect(delay);
  delay.connect(feedbackFilter);
  feedbackFilter.connect(feedbackGain);
  feedbackGain.connect(delay);
  feedbackFilter.connect(wetGain);
  wetGain.connect(context.destination);

  const notes = [
    { frequency: 880, offset: 0, attack: 0.004, decay: 0.09, peak: 0.06 },
    {
      frequency: 1_108.73,
      offset: 0.06,
      attack: 0.004,
      decay: 0.1,
      peak: 0.06,
    },
    {
      frequency: 1_318.51,
      offset: 0.12,
      attack: 0.004,
      decay: 0.18,
      peak: 0.07,
    },
  ] as const;

  for (let repetition = 0; repetition < times; repetition += 1) {
    for (const note of notes) {
      const start = now + repetition * REPEAT_INTERVAL + note.offset;
      const end = start + note.attack + note.decay;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, start);
      envelope.gain.setValueAtTime(SILENCE, start);
      envelope.gain.exponentialRampToValueAtTime(
        note.peak,
        start + note.attack,
      );
      envelope.gain.exponentialRampToValueAtTime(SILENCE, end);

      oscillator.connect(envelope).connect(master);
      oscillator.start(start);
      oscillator.stop(end + SOURCE_STOP_PADDING);
    }
  }

  window.setTimeout(
    () => {
      master.disconnect();
      delay.disconnect();
      feedbackFilter.disconnect();
      feedbackGain.disconnect();
      wetGain.disconnect();
    },
    CLEANUP_AFTER_MS + (times - 1) * REPEAT_INTERVAL * 1_000,
  );
};

export const playBeep = (times: number): void => {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === "running") {
    renderSuccessBeep(context, times);
    return;
  }

  void context.resume().then(
    () => {
      if (context.state === "running") renderSuccessBeep(context, times);
    },
    () => undefined,
  );
};
