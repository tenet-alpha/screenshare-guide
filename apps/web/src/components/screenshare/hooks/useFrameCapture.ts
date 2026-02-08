import { useRef, useCallback } from "react";
import { FRAME_STALENESS_MS } from "@screenshare-guide/protocol";
import type { ProofStep } from "@screenshare-guide/protocol";

/**
 * djb2 hash — fast, good distribution for pixel data
 */
function djb2Hash(data: Uint8ClampedArray, sampleStep: number = 4): number {
  let hash = 5381;
  for (let i = 0; i < data.length; i += sampleStep) {
    hash = ((hash << 5) + hash + data[i]) | 0; // hash * 33 + byte
  }
  return hash;
}

interface UseFrameCaptureOptions {
  wsRef: React.RefObject<WebSocket | null>;
  steps: ProofStep[];
  currentStepRef: React.MutableRefObject<number>;
  linkClickedStepsRef: React.MutableRefObject<Set<number>>;
}

export function useFrameCapture({
  wsRef,
  steps,
  currentStepRef,
  linkClickedStepsRef,
}: UseFrameCaptureOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Frame hash dedup refs
  const hashCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameHashRef = useRef<number>(0);
  const lastFrameSendTimeRef = useRef<number>(0);

  const startFrameSampling = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Create offscreen 16×16 canvas for frame hashing (once)
    if (!hashCanvasRef.current) {
      hashCanvasRef.current = document.createElement("canvas");
      hashCanvasRef.current.width = 16;
      hashCanvasRef.current.height = 16;
    }
    const hashCanvas = hashCanvasRef.current;
    const hashCtx = hashCanvas.getContext("2d")!;

    frameIntervalRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || video.readyState < 2) return;

      // Pause frame analysis until link is clicked for steps with links
      // Use refs to avoid stale closure values inside setInterval
      const stepForCheck = currentStepRef.current;
      if (steps[stepForCheck]?.link && !linkClickedStepsRef.current.has(stepForCheck)) {
        return; // Don't send frames until the user clicks the link
      }

      // Frame hash dedup — hash center 50% of frame to ignore PiP overlay in corners
      hashCtx.drawImage(video, 0, 0, 16, 16);
      const pixelData = hashCtx.getImageData(4, 4, 8, 8).data; // center 8×8 region
      const hash = djb2Hash(pixelData, 4);
      const now = Date.now();
      const timeSinceLastSend = now - lastFrameSendTimeRef.current;

      if (hash === lastFrameHashRef.current && timeSinceLastSend < FRAME_STALENESS_MS) {
        return; // Skip — unchanged screen within staleness window
      }

      // Update hash and send time
      lastFrameHashRef.current = hash;
      lastFrameSendTimeRef.current = now;

      canvas.width = Math.min(video.videoWidth, 1024);
      canvas.height = Math.min(video.videoHeight, (canvas.width / video.videoWidth) * video.videoHeight);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      wsRef.current.send(JSON.stringify({ type: "frame", imageData: canvas.toDataURL("image/jpeg", 0.6) }));
    }, 500);
  }, [wsRef, steps, currentStepRef, linkClickedStepsRef]);

  const startCapture = useCallback(async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: "monitor",   // prefer full screen
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
      // @ts-expect-error — Chrome 107+ supports surfaceTypes to hide tab/window options
      surfaceTypes: ["monitor"],       // only show "Entire Screen" in picker
      selfBrowserSurface: "exclude",   // hide our own tab from the picker
      monitorTypeSurfaces: "include",  // ensure screen options show
    });
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;

    // Check if user selected entire screen vs tab/window
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings() as any;
    if (settings.displaySurface && settings.displaySurface !== "monitor") {
      // They picked a tab or window — this will go black when they switch tabs
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        "Please share your entire screen, not a tab or window. " +
        "This is needed so we can see when you navigate between pages."
      );
    }

    // Wait for video to actually have decoded frames before sampling
    const video = videoRef.current!;
    const onCanPlay = () => {
      video.removeEventListener("canplay", onCanPlay);
      startFrameSampling();
    };
    if (video.readyState >= 3) {
      startFrameSampling(); // already has data
    } else {
      video.addEventListener("canplay", onCanPlay);
    }

    return stream;
  }, [startFrameSampling]);

  const stopCapture = useCallback(() => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  return {
    videoRef,
    canvasRef,
    streamRef,
    startCapture,
    stopCapture,
  };
}
