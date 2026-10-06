import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { Compositor } from './compositor.js';
import type { Controller } from './controller.js';
import { gifFrameTimes, pickMimeType } from './formats.js';
import { roomAliases } from './privacy.js';

export type ExportOptions = {
  format: 'mp4' | 'gif';
  size: 'square' | 'wide';
  seconds: 15 | 30 | 60;
  hideNames: boolean;
  sound: boolean;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRecorder: MediaRecorder | null = null;
/** For diagnostics/tests: state of the most recent MediaRecorder ('inactive' once stopped). */
export const lastRecorderState = () => lastRecorder?.state ?? 'none';

/**
 * Renders the timelapse frame by frame (the live ticker is paused) at a fixed export size and returns the file.
 * MP4/WebM is paced in real time (MediaRecorder timestamps by wall clock, and sound stays in sync); GIF renders as
 * fast as encoding allows. Everything it changes is restored in `finally`, whatever happens.
 */
export async function runExport(c: Controller, o: ExportOptions): Promise<{ blob: Blob; ext: string }> {
  const live = c.live();
  if (!live) throw new Error('No dungeon loaded yet');
  const [W, H] = o.size === 'square' ? [1080, 1080] : [1920, 1080];
  const app = c.app;
  const prevResizeTo = app.resizeTo;
  let rec: MediaRecorder | null = null;
  let audio: { stream: MediaStream; release(): void } | null = null;
  let videoStream: MediaStream | null = null;
  const draw = (comp: Compositor) => {
    app.renderer.render(app.stage);
    comp.draw(app.canvas, { ...c.overlay(), hideBubbles: o.hideNames });
  };
  try {
    c.setExporting(true);
    app.ticker.stop();
    app.resizeTo = null as never;
    app.renderer.resize(W, H);
    Object.assign(app.canvas.style, { width: '100%', height: '100%', objectFit: 'contain' });
    if (o.hideNames) c.setLabelAliases(roomAliases(live.map));
    const targetMs = o.seconds * 1000;
    if (!c.startTimelapse(targetMs)) throw new Error('Nothing to replay yet');

    if (o.format === 'gif') {
      const gw = 480, gh = Math.round((480 * H) / W);
      const comp = new Compositor(gw, gh);
      const gif = GIFEncoder();
      const times = gifFrameTimes(targetMs, 15);
      for (let i = 0; i < times.length; i++) {
        if (o.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
        c.frame(1000 / 15);
        draw(comp);
        const { data } = comp.imageData();
        const palette = quantize(data, 128);
        gif.writeFrame(applyPalette(data, palette), gw, gh, { palette, delay: Math.round(1000 / 15) });
        o.onProgress((i + 1) / times.length);
        if (i % 3 === 0) await sleep(0);
      }
      gif.finish();
      return { blob: new Blob([gif.bytes()], { type: 'image/gif' }), ext: 'gif' };
    }

    const comp = new Compositor(W, H);
    const { mime, ext } = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    videoStream = comp.canvas.captureStream(0);
    const track = videoStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    if (o.sound) {
      audio = c.audio.captureStream();
      for (const t of audio?.stream.getAudioTracks() ?? []) videoStream.addTrack(t);
    }
    rec = new MediaRecorder(videoStream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
    lastRecorder = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => rec!.addEventListener('stop', () => r()));
    rec.start(1000);
    const FPS = 30, step = 1000 / FPS;
    const t0 = performance.now();
    for (let f = 0; f * step <= targetMs; f++) {
      if (o.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      c.frame(step);
      draw(comp);
      track.requestFrame();
      o.onProgress(Math.min(1, (f * step) / targetMs));
      const wait = t0 + (f + 1) * step - performance.now();
      if (wait > 0) await sleep(wait);
    }
    rec.stop();
    await stopped;
    return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext };
  } finally {
    if (rec && rec.state !== 'inactive') rec.stop();
    videoStream?.getTracks().forEach((t) => t.stop());
    audio?.release();
    c.stopTimelapse();
    c.setLabelAliases(null);
    c.setExporting(false);
    Object.assign(app.canvas.style, { width: '', height: '', objectFit: '' });
    app.resizeTo = prevResizeTo;
    app.resize();
    app.ticker.start();
  }
}
