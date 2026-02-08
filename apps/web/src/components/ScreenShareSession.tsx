"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "./AudioPlayer";
import { trpc } from "@/lib/trpc";
import { STEP_LINKS, FRAME_STALENESS_MS } from "@screenshare-guide/protocol";
import type { ExtractedDataItem } from "@screenshare-guide/protocol";

interface TemplateStep {
  instruction: string;
  successCriteria: string;
  hints?: string[];
}

interface Props {
  token: string;
  sessionId: string;
  template: {
    id: string;
    name: string;
    steps: TemplateStep[];
  };
  initialStep: number;
}

type SessionStatus = "idle" | "connecting" | "ready" | "active" | "completed" | "error";
type UploadStatus = "idle" | "uploading" | "done" | "failed" | "skipped";

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

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("w-5 h-5", className)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function ScreenShareSession({ token, sessionId, template, initialStep }: Props) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [currentStep, setCurrentStep] = useState(Math.min(initialStep, template.steps.length - 1));
  const [instruction, setInstruction] = useState<string>("");
  const [collectedData, setCollectedData] = useState<ExtractedDataItem[]>([]);
  const [audioData, setAudioData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");

  // Track which steps have had their link clicked (client-side)
  const [linkClickedSteps, setLinkClickedSteps] = useState<Set<number>>(new Set());

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pipWindowRef = useRef<any>(null);

  // MediaRecorder refs for session recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // tRPC mutation for getting upload URL
  const getUploadUrl = trpc.session.getUploadUrl.useMutation();
  const updateSession = trpc.session.update.useMutation();

  // Frame hash dedup refs
  const hashCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameHashRef = useRef<number>(0);
  const lastFrameSendTimeRef = useRef<number>(0);

  // Refs that mirror state for use inside setInterval closures
  const currentStepRef = useRef(currentStep);
  const linkClickedStepsRef = useRef(linkClickedSteps);

  // Defensive: ensure steps is always a valid array
  const steps: TemplateStep[] = (() => {
    try {
      if (Array.isArray(template.steps)) return template.steps;
      if (typeof template.steps === "string") return JSON.parse(template.steps);
      return [];
    } catch {
      return [];
    }
  })();
  const totalSteps = steps.length;

  useEffect(() => {
    setPipSupported("documentPictureInPicture" in window);
  }, []);

  // Keep refs in sync with state (for setInterval closures)
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);
  useEffect(() => { linkClickedStepsRef.current = linkClickedSteps; }, [linkClickedSteps]);

  // Keep PiP in sync
  useEffect(() => {
    updatePipContent();
  }, [instruction, currentStep, isAnalyzing, collectedData, completedSteps]);

  // On completion: show countdown in PiP, then close it
  useEffect(() => {
    if (status === "completed") {
      // Upload recording (non-blocking)
      uploadRecording();

      // If PiP is open, show a 3-2-1 countdown then close
      const pip = pipWindowRef.current;
      if (pip) {
        let count = 3;
        const showCount = () => {
          if (!pipWindowRef.current) return;
          pipWindowRef.current.document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              <div style="width:48px;height:48px;background:#22c55e;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:12px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
              </div>
              <div style="color:#fff;font-size:16px;font-weight:700;margin-bottom:4px;">Verification Complete!</div>
              <div style="color:#9ca3af;font-size:13px;">Closing in ${count}...</div>
            </div>
          `;
        };
        showCount();
        const timer = setInterval(() => {
          count--;
          if (count <= 0) {
            clearInterval(timer);
            if (pipWindowRef.current) {
              pipWindowRef.current.close();
              pipWindowRef.current = null;
            }
          } else {
            showCount();
          }
        }, 1000);
        return () => clearInterval(timer);
      }
    }
  }, [status]);

  // Upload recording to Azure Blob Storage
  const uploadRecording = useCallback(async () => {
    // Check if we have recorded chunks
    if (recordedChunksRef.current.length === 0) {
      setUploadStatus("skipped");
      return;
    }

    setUploadStatus("uploading");

    try {
      // Get presigned upload URL
      const urlResult = await getUploadUrl.mutateAsync({ sessionId });

      if (!urlResult) {
        // Azure not configured — skip silently
        setUploadStatus("skipped");
        return;
      }

      // Create blob from recorded chunks
      const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });

      // Upload via PUT with SAS URL
      const response = await fetch(urlResult.uploadUrl, {
        method: "PUT",
        body: blob,
        headers: {
          "x-ms-blob-type": "BlockBlob",
          "Content-Type": "video/webm",
        },
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      // Store the blobUrl in session metadata
      try {
        await updateSession.mutateAsync({
          id: sessionId,
          metadata: { recordingUrl: urlResult.blobUrl } as any,
        });
      } catch {
        // Non-blocking — URL was uploaded even if metadata save fails
      }

      setUploadStatus("done");

      // Free memory
      recordedChunksRef.current = [];
    } catch (err) {
      console.error("Recording upload failed:", err);
      setUploadStatus("failed");
    }
  }, [sessionId, getUploadUrl, updateSession]);

  function handleStepLinkClick(stepIndex: number) {
    const link = STEP_LINKS[stepIndex];
    if (!link) return;
    window.open(link.url, "_blank");
    // Track client-side
    setLinkClickedSteps((prev) => {
      const next = new Set(prev);
      next.add(stepIndex);
      return next;
    });
    // Send linkClicked to backend
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "linkClicked", step: stepIndex }));
    }
  }

  function updatePipContent() {
    const pipDoc = pipWindowRef.current?.document;
    if (!pipDoc) return;

    const safeStep = Math.min(currentStep, totalSteps - 1);
    const stepLink = STEP_LINKS[safeStep];

    // Build completed steps markers
    const stepsHtml = Array.from({ length: totalSteps }, (_, i) => {
      const isComplete = completedSteps.has(i);
      const isCurrent = i === safeStep;
      const bg = isComplete ? "#22c55e" : isCurrent ? "#6366f1" : "#4b5563";
      const icon = isComplete
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`
        : `${i + 1}`;
      return `<div style="background:${bg};color:#fff;font-size:11px;font-weight:700;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">${icon}</div>`;
    }).join('<div style="flex:1;height:2px;background:#374151;"></div>');

    const dataHtml = collectedData.map((d) =>
      `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>
        <span style="color:#9ca3af;font-size:11px;">${d.label}:</span>
        <span style="color:#fff;font-size:13px;font-weight:700;">${d.value}</span>
      </div>`
    ).join("");

    const analyzingHtml = isAnalyzing
      ? `<div style="display:flex;align-items:center;gap:8px;padding:8px 0 0;">
          <div style="width:8px;height:8px;background:#3b82f6;border-radius:50%;animation:pulse 1s infinite;box-shadow:0 0 8px rgba(59,130,246,0.6);"></div>
          <span style="color:#93c5fd;font-size:12px;font-weight:500;">Analyzing your screen...</span>
        </div>`
      : "";

    // Clickable link button for steps 0 and 1
    const linkBtnHtml = stepLink
      ? `<button id="step-link" style="display:block;width:100%;margin-top:8px;padding:10px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;text-align:center;">${stepLink.label}</button>`
      : "";

    const instructionText = instruction || steps[safeStep]?.instruction || "Loading...";

    pipDoc.body.innerHTML = `
      <div style="padding:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:8px;flex-shrink:0;">${stepsHtml}</div>
        ${linkBtnHtml ? `<div style="flex-shrink:0;margin-bottom:8px;">${linkBtnHtml.replace('margin-top:8px;', '')}</div>` : ""}
        <div style="color:#fff;font-size:13px;font-weight:600;line-height:1.3;flex-shrink:0;margin-bottom:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
          ${instructionText}
        </div>
        ${dataHtml ? `<div style="border-top:1px solid #374151;padding-top:4px;margin-top:4px;flex-shrink:0;overflow:hidden;">${dataHtml}</div>` : ""}
        ${analyzingHtml}
      </div>
    `;

    // Attach click handler to the link button
    if (stepLink) {
      const btn = pipDoc.getElementById("step-link");
      if (btn) {
        btn.addEventListener("click", () => handleStepLinkClick(safeStep));
      }
    }
  }

  async function openPipWindow() {
    if (!("documentPictureInPicture" in window)) return;
    try {
      const pip = await (window as any).documentPictureInPicture.requestWindow({
        width: 380,
        height: 240,
      });
      pipWindowRef.current = pip;
      const style = pip.document.createElement("style");
      style.textContent = `
        body { margin: 0; background: #1f2937; overflow: hidden; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes shimmer { 0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); } 50% { box-shadow: 0 0 12px 4px rgba(59,130,246,0.2); } 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.4); } }
        button:hover { filter: brightness(1.1); }
      `;
      pip.document.head.appendChild(style);
      pip.addEventListener("pagehide", () => { pipWindowRef.current = null; });
      updatePipContent();
    } catch (err) {
      console.error("Failed to open PiP:", err);
    }
  }

  const connectWebSocket = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
    const ws = new WebSocket(`${wsUrl}/ws/${token}`);
    ws.onopen = () => { setStatus("ready"); };
    ws.onmessage = (event) => {
      try { handleWebSocketMessage(JSON.parse(event.data)); }
      catch (err) { console.error("[WS] Parse error:", err); }
    };
    ws.onerror = () => { setError("Connection error. Please refresh the page."); setStatus("error"); };
    ws.onclose = () => {
      // Only auto-reconnect if we're still actively in a session
      // wsRef.current is set to null by stopScreenShare(), so check that too
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
          connectWebSocket();
        }
      }, 3000);
    };
    wsRef.current = ws;
  }, [token, status]);

  // Accumulate extracted data — server already canonicalizes labels,
  // so dedup by exact label match is sufficient
  function accumulateData(items: ExtractedDataItem[]) {
    if (!items?.length) return;
    setCollectedData((prev) => {
      const updated = [...prev];
      for (const item of items) {
        if (!item.label || !item.value) continue;
        const idx = updated.findIndex((d) => d.label === item.label);
        if (idx >= 0) updated[idx] = item;
        else updated.push(item);
      }
      return updated;
    });
  }

  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case "connected": {
        const clampedStep = Math.min(data.currentStep, totalSteps - 1);
        setCurrentStep(clampedStep);
        setInstruction(data.instruction);
        break;
      }

      case "analyzing":
        setIsAnalyzing(true);
        break;

      case "analysis":
        setIsAnalyzing(false);
        if (data.extractedData?.length) {
          accumulateData(data.extractedData);
        }
        break;

      case "stepComplete": {
        // Mark previous step as completed
        setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add(data.currentStep - 1);
          return next;
        });
        const clampedStep = Math.min(data.currentStep, totalSteps - 1);
        setCurrentStep(clampedStep);
        setInstruction(data.nextInstruction);
        break;
      }

      case "audio":
        // Audio is for TTS only — don't overwrite the visual instruction
        // The clean step instruction is set by stepComplete/connected messages
        setAudioData(data.audioData);
        break;

      case "instruction":
        // Text-only fallback (TTS failed) — also don't overwrite step instruction
        break;

      case "completed":
        // Accumulate any final data
        if (data.extractedData?.length) {
          accumulateData(data.extractedData);
        }
        // Mark the last step as completed
        setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add(totalSteps - 1);
          return next;
        });
        // Go straight to completed
        setStatus("completed");
        stopScreenShare(true); // keepStatus — don't overwrite "completed" with "idle"
        break;

      case "error":
        setError(data.message);
        setStatus("error");
        break;

      case "pong":
        break;
    }
  };

  const startScreenShare = async () => {
    setStatus("connecting");
    setError(null);
    try {
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
        setError(
          "Please share your entire screen, not a tab or window. " +
          "This is needed so we can see when you navigate to Meta Business Suite."
        );
        setStatus("error");
        return;
      }

      // Start MediaRecorder for session recording
      try {
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
            ? "video/webm;codecs=vp8"
            : "video/webm";
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 2_500_000, // 2.5 Mbps
        });
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        recorder.start(1000); // collect chunks every 1s
        mediaRecorderRef.current = recorder;
      } catch (err) {
        console.warn("MediaRecorder not available, skipping recording:", err);
      }

      track.addEventListener("ended", () => stopScreenShare());
      connectWebSocket();

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

      setStatus("active");
      // Auto-open PiP
      if ("documentPictureInPicture" in window) {
        setTimeout(() => openPipWindow(), 1000);
      }
    } catch (err: any) {
      setError(err.name === "NotAllowedError"
        ? "Screen sharing permission was denied. Please try again."
        : "Failed to start screen sharing. Please try again.");
      setStatus("error");
    }
  };

  const stopScreenShare = (keepStatus = false) => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (!keepStatus) {
      // Only close PiP immediately on manual stop — completion has its own PiP countdown
      if (pipWindowRef.current) { pipWindowRef.current.close(); pipWindowRef.current = null; }
      setStatus("idle");
    }
  };

  const startFrameSampling = () => {
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

      // Improvement #3: Pause frame analysis until link is clicked for steps with links
      // Use refs to avoid stale closure values inside setInterval
      const stepForCheck = currentStepRef.current;
      if (STEP_LINKS[stepForCheck] && !linkClickedStepsRef.current.has(stepForCheck)) {
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
  };

  useEffect(() => {
    return () => {
      stopScreenShare();
      // Clean up MediaRecorder on unmount
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
      recordedChunksRef.current = [];
    };
  }, []);
  useEffect(() => {
    const hb = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "ping" }));
    }, 30000);
    return () => clearInterval(hb);
  }, []);

  // Copy results to clipboard
  const handleCopyResults = async () => {
    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const lines = collectedData.map((d) => `${d.label}: ${d.value}`).join("\n");
    const text = `Instagram Audience Proof — Verified ${dateStr}\n\n${lines}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const safeStep = Math.min(currentStep, Math.max(totalSteps - 1, 0));

  // Guard: if template has no steps, show an error
  if (totalSteps === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
          <h1 className="text-xl font-semibold mb-2 text-red-600">Template Error</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Invalid template data. No steps available.
          </p>
          <a href="/" className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-500 text-white font-medium rounded-lg transition-all inline-block">
            Back to Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Off-screen video + canvas for frame capture — must be rendered (not display:none) for frame decoding */}
      <video ref={videoRef} autoPlay playsInline muted style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }} />
      <canvas ref={canvasRef} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }} />

      {/* Improvement #6: Sticky instruction bar for non-PiP browsers */}
      {status === "active" && !pipSupported && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-gray-900/90 backdrop-blur-sm border-b border-gray-700 px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <div className="bg-purple-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shrink-0">
              {safeStep + 1}
            </div>
            <p className="text-sm font-medium text-white truncate flex-1">
              {instruction || steps[safeStep]?.instruction || "Loading..."}
            </p>
            {STEP_LINKS[safeStep] && (
              <button
                onClick={() => handleStepLinkClick(safeStep)}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-md transition-colors shrink-0"
              >
                {STEP_LINKS[safeStep].label}
              </button>
            )}
            {isAnalyzing && (
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse shadow-[0_0_6px_rgba(96,165,250,0.6)]"></div>
                <span className="text-xs text-blue-300">Analyzing...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <header className={cn(
        "bg-white dark:bg-gray-800 shadow-sm p-4 border-b border-gray-200 dark:border-gray-700",
        status === "active" && !pipSupported && "mt-12" // offset for sticky bar
      )}>
        <div className="max-w-3xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold bg-gradient-to-r from-purple-600 to-pink-500 bg-clip-text text-transparent">
            Instagram Audience Proof
          </h1>
          <div className="flex items-center gap-2">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                  completedSteps.has(i)
                    ? "bg-green-500 text-white"
                    : i === safeStep
                    ? "bg-purple-500 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-500"
                )}
              >
                {completedSteps.has(i) ? (
                  <CheckIcon className="w-4 h-4 text-white" />
                ) : (
                  i + 1
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full flex flex-col items-center justify-center">
        {error && (
          <div className="w-full mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">{error}</div>
        )}

        {/* ===== IDLE ===== */}
        {status === "idle" && (
          <div className="text-center max-w-lg">
            {/* Hero */}
            <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold mb-2 text-gray-900 dark:text-gray-100">Verify Your Instagram Audience</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-8">
              Quick, secure verification of your Instagram reach and audience metrics.
            </p>

            {/* Steps explanation */}
            <div className="flex gap-4 mb-8 text-left">
              <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full flex items-center justify-center text-sm font-bold mb-3">1</div>
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">Open Meta Business Suite</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">We'll verify your Instagram handle from your business dashboard.</p>
              </div>
              <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                <div className="w-8 h-8 bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 rounded-full flex items-center justify-center text-sm font-bold mb-3">2</div>
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 mb-1">View Your Insights</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">We'll capture your reach, followers reached, and non-followers reached.</p>
              </div>
            </div>

            <button onClick={startScreenShare} className="px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-semibold rounded-xl text-lg transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]">
              Share Screen & Start
            </button>

            <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
              Your screen is only analyzed in real-time — nothing is stored except the verified metrics.
            </p>

            {!pipSupported && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                ⚠️ Use Chrome for the best experience (floating instruction overlay).
              </p>
            )}
          </div>
        )}

        {/* ===== ACTIVE ===== */}
        {(status === "active" || status === "ready" || status === "connecting") && (
          <div className="w-full space-y-6">
            {/* Improvement #4: Enhanced analysis feedback — pulse border on instruction card */}
            <div className={cn(
              "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 transition-all duration-300",
              isAnalyzing && "border-blue-400/60 dark:border-blue-500/50 shadow-[0_0_15px_-3px_rgba(59,130,246,0.3)] animate-[analyzing-pulse_2s_ease-in-out_infinite]"
            )}>
              <div className="flex items-start gap-4">
                <div className="bg-purple-500 text-white text-sm font-bold rounded-full w-8 h-8 flex items-center justify-center shrink-0">
                  {safeStep + 1}
                </div>
                <div className="flex-1">
                  <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    {instruction || steps[safeStep]?.instruction || "Loading..."}
                  </p>
                  {/* Step link */}
                  {STEP_LINKS[safeStep] && (
                    <button
                      onClick={() => handleStepLinkClick(safeStep)}
                      className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {STEP_LINKS[safeStep].label}
                    </button>
                  )}
                  {/* Improvement #3: Show waiting message if link not clicked yet */}
                  {STEP_LINKS[safeStep] && !linkClickedSteps.has(safeStep) && (
                    <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                      👆 Click the link above to open the page, then analysis will begin.
                    </p>
                  )}
                  {safeStep === 1 && linkClickedSteps.has(1) && (
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      Analyzing your insights data...
                    </p>
                  )}
                  {/* Improvement #4: More visible analyzing indicator */}
                  {isAnalyzing && (
                    <div className="flex items-center gap-2.5 mt-3 text-blue-600 dark:text-blue-400">
                      <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div>
                      <span className="text-sm font-medium">Analyzing your screen...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Verified data so far */}
            {collectedData.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
                  Extracted Data
                </h3>
                {collectedData.map((d, i) => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <CheckIcon className="w-5 h-5 text-green-500 shrink-0" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">{d.label}</span>
                    <span className="ml-auto text-base font-bold text-gray-900 dark:text-gray-100">{d.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Audio player */}
            {audioData && (
              <AudioPlayer audioData={audioData} onComplete={() => {
                setAudioData(null);
                // Signal server that audio playback finished
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: "audioComplete" }));
                }
              }} />
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              {pipSupported && (
                <button onClick={openPipWindow} className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/20 hover:bg-indigo-200 text-indigo-700 dark:text-indigo-400 rounded-lg text-sm font-medium transition-colors">
                  📌 Float Instructions
                </button>
              )}
              <div className="flex-1" />
              <button onClick={() => stopScreenShare()} className="px-4 py-2 bg-red-100 dark:bg-red-900/20 hover:bg-red-200 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium transition-colors">
                Stop Session
              </button>
            </div>
          </div>
        )}

        {/* ===== COMPLETED ===== */}
        {status === "completed" && (
          <div className="w-full max-w-lg">
            {/* Success header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Verification Successful</h2>
              <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">Your Instagram audience data has been verified.</p>
            </div>

            {/* Results card */}
            {collectedData.length > 0 ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Handle section */}
                {collectedData.find(d => d.label === "Handle") && (
                  <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 text-center">
                    <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Verified Account</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {collectedData.find(d => d.label === "Handle")?.value}
                    </p>
                  </div>
                )}

                {/* Metrics section */}
                <div className="px-6 py-5">
                  <div className="grid grid-cols-3 gap-4">
                    {collectedData.filter(d => d.label !== "Handle").map((d, j) => (
                      <div key={j} className="text-center">
                        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{d.value}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{d.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer */}
                <div className="bg-gray-50 dark:bg-gray-800/50 px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-center gap-2">
                  <CheckIcon className="w-3.5 h-3.5 text-green-500" />
                  <p className="text-xs text-gray-400">
                    Verified via live screen analysis • {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
                <p className="text-gray-500">Session completed.</p>
              </div>
            )}

            {/* Recording status — subtle */}
            {uploadStatus === "uploading" && (
              <div className="flex items-center justify-center gap-2 mt-3">
                <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs text-gray-400">Saving recording...</span>
              </div>
            )}
            {uploadStatus === "done" && (
              <div className="flex items-center justify-center gap-2 mt-3">
                <CheckIcon className="w-3 h-3 text-green-500" />
                <span className="text-xs text-gray-400">Recording saved</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-center gap-3 mt-6">
              {collectedData.length > 0 && (
                <button
                  onClick={handleCopyResults}
                  className={cn(
                    "px-5 py-2.5 rounded-xl text-sm font-medium transition-all inline-flex items-center gap-2 border",
                    copied
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
                      : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                  )}
                >
                  {copied ? (
                    <>
                      <CheckIcon className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy Results
                    </>
                  )}
                </button>
              )}
              <a href="/" className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-medium rounded-xl text-sm transition-all">
                New Verification
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
