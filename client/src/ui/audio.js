export function createAudio({ state, settings }) {
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

  function sweep(from, to, duration, gain = 0.05, type = "sine") {
    if (!state.audio || !settings.sound) return;
    const start = state.audio.currentTime;
    const osc = state.audio.createOscillator();
    const vol = state.audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    vol.gain.setValueAtTime(gain, start);
    vol.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(vol).connect(state.audio.destination);
    osc.start(start);
    osc.stop(start + duration + 0.01);
  }

  return {
    unlockAudio,
    playStrike(offset) {
      const bus = master(0.24);
      tone(320 + offset * 190, 0.045, 0.18, "square", bus);
      tone(165 + offset * 90, 0.08, 0.08, "triangle", bus, 0.012);
    },
    playWall() {
      const bus = master(0.16);
      tone(640, 0.035, 0.12, "sine", bus);
      tone(920, 0.028, 0.06, "triangle", bus, 0.014);
    },
    playPower() {
      const bus = master(0.22);
      [260, 390, 520, 780].forEach((freq, index) => tone(freq, 0.11, 0.13, "sine", bus, index * 0.045));
    },
    playMiss() {
      sweep(150, 48, 0.22, 0.055, "sawtooth");
    },
    playGameOver(won) {
      const bus = master(0.22);
      const notes = won ? [330, 440, 660] : [260, 190, 120];
      notes.forEach((freq, index) => tone(freq, 0.16, 0.13, "triangle", bus, index * 0.08));
    },
    playRumble() {
      if (!state.audio) return;
      sweep(70, 34, 1.15, 0.07, "sawtooth");
    }
  };
}
