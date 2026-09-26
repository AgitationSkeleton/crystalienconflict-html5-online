// Sound, through Web Audio.
//
// Flash plays two kinds here: event sounds started by a timeline's StartSound tags
// (every effect in the game goes through the soundFX clip this way), and Sound objects,
// which this game only uses to mute a clip -- `new Sound(mc).setVolume(0)`.  A Sound
// object's volume applies to the sounds owned by that clip and everything inside it, so
// a sound's gain is the product of the volumes up its owner's ancestry.
//
// Browsers only let audio start after a click or key press.  The original's own first
// screen is a PLAY button, so by the time anything is meant to be heard, audio is live.

export class SoundSystem {
  constructor(player) {
    this.player = player;
    this.ctx = null;
    this.master = null;
    this.playing = new Set();       // {id, lib, owner, src, gain}
    this.kinds = null;              // online: a gain for each kind of sound (music, sound, ui)
    this.volumes = { music: 1, sound: 1, ui: 1 };
  }

  // Online: the settings' volumes, 0..1 for each kind of sound.
  setVolumes(v) {
    Object.assign(this.volumes, v);
    if (this.kinds) for (const k of Object.keys(this.kinds)) this.kinds[k].gain.value = this.volumes[k];
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.kinds = {};
      for (const k of ['music', 'sound', 'ui']) {
        this.kinds[k] = this.ctx.createGain();
        this.kinds[k].gain.value = this.volumes[k];
        this.kinds[k].connect(this.master);
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get live() {
    return this.ctx && this.ctx.state === 'running';
  }

  async buffer(lib, id) {
    const s = lib.sounds.get(id);
    if (!s) return null;
    if (s.buffer) return s.buffer;
    if (!s.decoding) {
      // decodeAudioData detaches its input, so decode a copy.
      s.decoding = this.ctx.decodeAudioData(s.data.slice(0)).then((b) => (s.buffer = b)).catch(() => null);
    }
    return s.decoding;
  }

  volumeOf(owner) {
    let v = 1;
    for (let o = owner; o; o = o.$parent) {
      if (o.$soundVolume !== undefined) v *= o.$soundVolume / 100;
    }
    return Math.max(0, v);
  }

  // The owners' volumes changed (a Sound.setVolume): update what is playing.  Envelopes
  // have their own gain node, so this never disturbs a fade in progress.  (A sound still
  // being decoded has no gain node yet; it reads the volume when it starts.)
  refreshVolumes() {
    for (const p of this.playing) if (p.gain) p.gain.gain.value = this.volumeOf(p.owner);
  }

  // A StartSound tag: SOUNDINFO decides whether it stops, restarts, or loops.
  timelineSound(owner, id, info) {
    this.start(owner.$lib, id, owner, info || {});
  }

  start(lib, id, owner, info) {
    if (!this.live) return null;
    if (info.syncStop) {
      for (const p of [...this.playing]) if (p.id === id && p.lib === lib) this.stopOne(p);
      return null;
    }
    if (info.syncNoMultiple) {
      for (const p of this.playing) if (p.id === id && p.lib === lib) return null;
    }
    const entry = { id, lib, owner, src: null, gain: null, stopped: false };
    this.playing.add(entry);
    this.buffer(lib, id).then((buf) => {
      if (!buf || entry.stopped) {
        this.playing.delete(entry);
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      // Two stages: the sound's own envelope, then its owners' volume.  (The in-game music
      // fades in by envelope; muting and unmuting for the pause menu must not undo that.)
      const env = this.ctx.createGain();
      if (info.envelope && info.envelope.length) {
        // Envelope points are in 44.1kHz samples with levels 0..32768 per channel;
        // both channels are averaged, which is all this game's sounds would need.
        const t0 = this.ctx.currentTime;
        const lvl = (e) => ((e[1] + e[2]) / 2) / 32768;
        env.gain.setValueAtTime(lvl(info.envelope[0]), t0);
        for (const e of info.envelope) env.gain.linearRampToValueAtTime(lvl(e), t0 + e[0] / 44100);
      }
      const gain = this.ctx.createGain();
      gain.gain.value = this.volumeOf(owner);
      src.connect(env);
      env.connect(gain);
      const kind = (lib.soundKinds && lib.soundKinds.get(id)) || 'sound';
      gain.connect(this.kinds ? this.kinds[kind] : this.master);
      entry.src = src;
      entry.gain = gain;
      const loops = Math.max(1, info.loops || 1);
      const inPt = info.inPoint ? info.inPoint / 44100 : 0;
      const outPt = info.outPoint ? info.outPoint / 44100 : buf.duration;
      const length = Math.max(0, outPt - inPt);
      if (loops > 1) {
        src.loop = true;
        src.loopStart = inPt;
        src.loopEnd = outPt;
        src.start(0, inPt, length * loops);
      } else {
        src.start(0, inPt, length);
      }
      src.onended = () => {
        this.playing.delete(entry);
        if (entry.onComplete) entry.onComplete();
      };
    });
    return entry;
  }

  stopOne(p) {
    p.stopped = true;
    this.playing.delete(p);
    if (p.src) {
      try { p.src.onended = null; p.src.stop(); } catch (e) { /* already stopped */ }
    }
  }

  stopAll() {
    for (const p of [...this.playing]) this.stopOne(p);
  }

  // Stop everything owned by a clip that has left the stage.  Flash lets event sounds
  // finish even then, so this is only used by Sound.stop().
  stopOwnedBy(owner, id) {
    for (const p of [...this.playing]) {
      let o = p.owner;
      while (o && o !== owner) o = o.$parent;
      if (o && (id === undefined || p.id === id)) this.stopOne(p);
    }
  }
}
