/* Camera and microphone helpers (shared with Garage). */
(function (root) {
  'use strict';

  /** Opens the camera (or photo library) and returns a resized JPEG: { mime, data (base64), preview (data URL) }. */
  function pickPhoto() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment');
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) { resolve(null); return; }
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = () => {
          const max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          const dataUrl = c.toDataURL('image/jpeg', 0.8);
          resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Couldn’t read that photo. Try again.')); };
        img.src = url;
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Records from the microphone as a small 16 kHz WAV (a format Gemini reads reliably).
   * start() resolves to a recorder with stop() -> { mime, data } and level() -> 0..1 for a meter.
   */
  async function startRecording(maxSeconds) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser can’t use the microphone.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    let peak = 0, stopped = false;
    proc.onaudioprocess = e => {
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let m = 0; for (let i = 0; i < d.length; i += 64) m = Math.max(m, Math.abs(d[i]));
      peak = m;
    };
    src.connect(proc); proc.connect(ctx.destination);
    let timer;
    const done = new Promise(res => { timer = setTimeout(() => res(), (maxSeconds || 30) * 1000); });
    async function stop() {
      if (stopped) return null;
      stopped = true; clearTimeout(timer);
      proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop());
      const rate = ctx.sampleRate; await ctx.close();
      const len = chunks.reduce((n, c) => n + c.length, 0), all = new Float32Array(len);
      let o = 0; chunks.forEach(c => { all.set(c, o); o += c.length; });
      return { mime: 'audio/wav', data: wavBase64(downsample(all, rate, 16000), 16000), seconds: len / rate };
    }
    return { stop: stop, level: () => peak, timedOut: done };
  }

  function downsample(buf, from, to) {
    if (to >= from) return buf;
    const ratio = from / to, out = new Float32Array(Math.floor(buf.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio), b = Math.min(buf.length, Math.floor((i + 1) * ratio));
      let s = 0; for (let j = a; j < b; j++) s += buf[j];
      out[i] = s / Math.max(1, b - a);
    }
    return out;
  }
  function wavBase64(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    const bytes = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  root.BudgetMedia = { pickPhoto: pickPhoto, startRecording: startRecording };
})(typeof window !== 'undefined' ? window : globalThis);
