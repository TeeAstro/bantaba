'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export type CameraState = 'idle' | 'starting' | 'on' | 'denied' | 'unavailable' | 'insecure';

// Camera → QR decoding for the scanner. Decodes ~6 frames a second from a
// downscaled canvas (plenty for a ticket held up to a phone, and easy on
// battery), and reports each code once per presentation: a code is
// ignored for as long as it stays in view, and only counts again after it
// has been out of view for `goneMs`. So someone who was just let in and
// keeps holding their phone up doesn't get re-scanned into "Already
// scanned" a few seconds later.
export function useQrScanner(onCode: (text: string) => void, goneMs = 1500) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastRef = useRef<{ text: string; seenAt: number } | null>(null);
  const pausedRef = useRef(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [state, setState] = useState<CameraState>('idle');

  const stop = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState('idle');
  }, []);

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (!code?.data) return;
    const now = Date.now();
    const last = lastRef.current;
    const stillInView = last && last.text === code.data && now - last.seenAt < goneMs;
    if (last && last.text === code.data) last.seenAt = now; // keep tracking it, even while paused
    // While a result is showing we keep watching (above) but don't submit.
    if (stillInView || pausedRef.current) return;
    lastRef.current = { text: code.data, seenAt: now };
    onCodeRef.current(code.data);
  }, [goneMs]);

  // Must be called from a user gesture (a button tap) — iOS Safari won't
  // start the camera otherwise.
  const start = useCallback(async () => {
    if (!window.isSecureContext) return setState('insecure');
    if (!navigator.mediaDevices?.getUserMedia) return setState('unavailable');
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true'); // iOS: don't go fullscreen
      await video.play();
      timerRef.current = window.setInterval(tick, 160);
      setState('on');
    } catch (err) {
      const name = (err as DOMException)?.name;
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }, [tick]);

  // While a result is on screen and a request is in flight, don't decode.
  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p;
  }, []);

  useEffect(() => stop, [stop]);

  return { videoRef, canvasRef, state, start, stop, setPaused };
}
