export function createAudio({ state, settings }) {
  let rumbleBus = null;
  function unlockAudio() {
    if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audio.state !== "running") state.audio.resume();
  }

  function master(gain = 0.25) {
    if (!state.audio || !settings.sound) return;
    const vol = state.audio.createGain();
    vol.gain.setValueAtTime(gain, state.audio.currentTime);
    vol.connect(state.audio.destination);
    return vol;
  }

  function tone(freq, duration, gain = 0.04, type = "sine", dest = null, delay = 0) {
    if (!state.audio || !settings.sound) return;
    const start = state.audio.currentTime + delay;
    const osc = state.audio.createOscillator();
    const vol = state.audio.createGain();
    osc.frequency.setValueAtTime(freq, start);
    osc.type = type;
    vol.gain.setValueAtTime(gain, start);
    vol.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(vol).connect(dest || state.audio.destination);
    osc.start(start);
    osc.stop(start + duration + 0.01);
  }

  function sweep(from, to, duration, gain = 0.05, type = "sine", delay = 0, dest = null) {
    if (!state.audio || !settings.sound) return;
    const start = state.audio.currentTime + delay;
    const osc = state.audio.createOscillator();
    const vol = state.audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    vol.gain.setValueAtTime(gain, start);
    vol.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(vol).connect(dest || state.audio.destination);
    osc.start(start);
    osc.stop(start + duration + 0.01);
  }

  function cancelRumble() {
    if (!rumbleBus || !state.audio) return;
    const bus = rumbleBus;
    rumbleBus = null;
    const now = state.audio.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(Math.max(0.001, bus.gain.value), now);
    bus.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
    window.setTimeout(() => bus.disconnect(), 40);
  }

  return {
    cancelRumble,
    unlockAudio,
    playStrike(offset, delay = 0) {
      const bus = master(0.24);
      tone(320 + offset * 190, 0.045, 0.18, "square", bus, delay);
      tone(165 + offset * 90, 0.08, 0.08, "triangle", bus, delay + 0.012);
    },
    playSmash(delay = 0) {
      const bus = master(0.32);
      sweep(640, 160, 0.08, 0.25, "sawtooth", delay, bus);
      tone(120, 0.12, 0.22, "triangle", bus, delay + 0.01);
    },
    playCurve(delay = 0) {
      const bus = master(0.24);
      sweep(320, 680, 0.09, 0.16, "sine", delay, bus);
      tone(440, 0.06, 0.1, "triangle", bus, delay + 0.02);
    },
    playCounter(delay = 0) {
      const bus = master(0.28);
      tone(880, 0.07, 0.2, "triangle", bus, delay);
      tone(1320, 0.05, 0.15, "sine", bus, delay + 0.005);
      sweep(380, 920, 0.06, 0.12, "square", delay, bus);
    },
    playDrive(delay = 0) {
      const bus = master(0.26);
      tone(220, 0.08, 0.22, "square", bus, delay);
      sweep(180, 290, 0.05, 0.15, "triangle", delay, bus);
    },
    playWall(delay = 0) {
      const bus = master(0.16);
      tone(640, 0.035, 0.12, "sine", bus, delay);
      tone(920, 0.028, 0.06, "triangle", bus, delay + 0.014);
    },
    playPower(type) {
      const bus = master(0.25);
      if (type === "overdrive") {
        [330, 495, 660, 990].forEach((freq, index) => tone(freq, 0.12, 0.16, "sine", bus, index * 0.04));
      } else {
        [260, 390, 520, 780].forEach((freq, index) => tone(freq, 0.11, 0.13, "sine", bus, index * 0.045));
      }
    },
    playMiss(delay = 0) {
      sweep(150, 48, 0.22, 0.055, "sawtooth", delay);
    },
    playGameOver(won) {
      const bus = master(0.22);
      const notes = won ? [330, 440, 660] : [260, 190, 120];
      notes.forEach((freq, index) => tone(freq, 0.16, 0.13, "triangle", bus, index * 0.08));
    },
    playRumble() {
      if (!state.audio) return;
      cancelRumble();
      rumbleBus = master(0.22);
      sweep(70, 34, 1.15, 0.3, "sawtooth", 0, rumbleBus);
    }
  };
}
