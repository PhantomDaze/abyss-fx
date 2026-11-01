/* WebAudio 合成音效：不加载任何外部音频文件 */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});

  const Audio = {
    ctx: null,
    master: null,
    enabled: true,
    volume: 0.3,
    _ensure() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 6;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    setEnabled(v) {
      this.enabled = !!v;
      if (!this.enabled) this.stopVoice();
      if (!this.enabled && this.ctx) {
        try {
          this.ctx.suspend();
        } catch (_) {}
      } else if (this.enabled && this.ctx) {
        try {
          this.ctx.resume();
        } catch (_) {}
      }
    },
    _tone(freq, dur, type, when, gain, slideTo, filterFreq) {
      const ctx = this._ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + (when || 0);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let node = osc;
      if (filterFreq) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = filterFreq;
        node.connect(f);
        node = f;
      }
      node.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    _noise(dur, gain, filterFreq, when) {
      const ctx = this._ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + (when || 0);
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq || 400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain || 0.15, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.master);
      src.start(t0);
    },
    click() {
      this._tone(1200, 0.03, 'sine', 0, 0.03);
    },
    open(side) {
      this._tone(side > 0 ? 520 : 420, 0.12, 'triangle', 0, 0.1, side > 0 ? 660 : 340);
    },
    close(win) {
      if (win) {
        this._tone(523.25, 0.14, 'sine', 0, 0.09);
        this._tone(783.99, 0.18, 'sine', 0.09, 0.08);
      } else {
        this._tone(392, 0.16, 'triangle', 0, 0.08, 293.66);
      }
    },
    error() {
      this._tone(220, 0.08, 'square', 0, 0.05, 180, 800);
      this._tone(180, 0.1, 'square', 0.09, 0.045, 140, 700);
    },
    alert() {
      this._tone(220, 0.09, 'square', 0, 0.06, 200, 800);
      this._tone(220, 0.09, 'square', 0.16, 0.06, 200, 800);
    },
    liquidate() {
      this._tone(82, 0.9, 'sine', 0, 0.16, 38);
      this._noise(0.45, 0.12, 300);
    },
    achieve() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => this._tone(f, 0.5, 'triangle', i * 0.09, 0.08));
    },
    news() {
      this._tone(1400, 0.04, 'sine', 0, 0.025);
    },
    swap(positive) {
      this._tone(positive ? 700 : 500, 0.07, 'sine', 0, 0.04);
    },
    // 久留美语音：用 HTMLAudioElement 播放本地 mp3。
    // 不用 WebAudio decodeAudioData，是为了兼容直接双击 index.html 的 file:// 场景。
    voiceVolume: 0.85,
    _voice: null,
    playVoice(src) {
      if (!this.enabled) return false;
      try {
        if (!this._voice) {
          this._voice = document.createElement('audio');
          this._voice.preload = 'auto';
        }
        if (this._voice.getAttribute('src') !== src) this._voice.setAttribute('src', src);
        this._voice.volume = this.voiceVolume;
        this._voice.currentTime = 0;
        const p = this._voice.play();
        if (p && p.catch) p.catch(() => {});
        return true;
      } catch (_) {
        return false;
      }
    },
    stopVoice() {
      if (!this._voice) return;
      try {
        this._voice.pause();
        this._voice.currentTime = 0;
      } catch (_) {}
    },
  };

  // 页面隐藏时挂起音频
  document.addEventListener('visibilitychange', () => {
    if (!Audio.ctx) {
      if (document.hidden) Audio.stopVoice();
      return;
    }
    try {
      if (document.hidden) {
        Audio.ctx.suspend();
        Audio.stopVoice();
      } else if (Audio.enabled) Audio.ctx.resume();
    } catch (_) {}
  });

  FX.Audio = Audio;
})();
