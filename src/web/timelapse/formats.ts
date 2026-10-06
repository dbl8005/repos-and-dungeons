/** Best MediaRecorder format: H.264 MP4 where the browser supports it, else WebM. */
export function pickMimeType(isSupported: (type: string) => boolean): { mime: string; ext: 'mp4' | 'webm' } {
  for (const mime of ['video/mp4;codecs=avc1', 'video/mp4']) if (isSupported(mime)) return { mime, ext: 'mp4' };
  for (const mime of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (isSupported(mime)) return { mime, ext: 'webm' };
  return { mime: 'video/webm', ext: 'webm' };
}

export function gifFrameTimes(durationMs: number, fps: number): number[] {
  const n = Math.round((durationMs / 1000) * fps);
  return Array.from({ length: n }, (_, i) => (i * 1000) / fps);
}
