"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ProgressIndicator } from "./ProgressIndicator";
import { AudioPlayer } from "./AudioPlayer";

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

interface AnalysisResult {
  description: string;
  matchesSuccess: boolean;
  confidence: number;
}

export function ScreenShareSession({ token, sessionId, template, initialStep }: Props) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [instruction, setInstruction] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [audioData, setAudioData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const steps = template.steps as TemplateStep[];
  const totalSteps = steps.length;

  // Connect to WebSocket
  const connectWebSocket = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001";
    const ws = new WebSocket(`${wsUrl}/ws/${token}`);

    ws.onopen = () => {
      console.log("[WS] Connected");
      setStatus("ready");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (err) {
        console.error("[WS] Failed to parse message:", err);
      }
    };

    ws.onerror = (event) => {
      console.error("[WS] Error:", event);
      setError("Connection error. Please refresh the page.");
      setStatus("error");
    };

    ws.onclose = () => {
      console.log("[WS] Disconnected");
      if (status !== "completed" && status !== "error") {
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) {
            connectWebSocket();
          }
        }, 3000);
      }
    };

    wsRef.current = ws;
  }, [token, status]);

  // Handle incoming WebSocket messages
  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case "connected":
        setCurrentStep(data.currentStep);
        setInstruction(data.instruction);
        break;

      case "analyzing":
        setIsAnalyzing(true);
        break;

      case "analysis":
        setIsAnalyzing(false);
        setAnalysis({
          description: data.description,
          matchesSuccess: data.matchesSuccess,
          confidence: data.confidence,
        });
        break;

      case "stepComplete":
        setCurrentStep(data.currentStep);
        setInstruction(data.nextInstruction);
        setAnalysis(null);
        break;

      case "audio":
        setInstruction(data.text);
        setAudioData(data.audioData);
        break;

      case "instruction":
        setInstruction(data.text);
        break;

      case "completed":
        setStatus("completed");
        stopScreenShare();
        break;

      case "error":
        setError(data.message);
        setStatus("error");
        break;

      case "pong":
        // Heartbeat response
        break;
    }
  };

  // Start screen sharing
  const startScreenShare = async () => {
    setStatus("connecting");
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          frameRate: { ideal: 5, max: 10 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Handle user stopping share via browser UI
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopScreenShare();
      });

      // Connect to WebSocket
      connectWebSocket();

      // Start frame sampling
      startFrameSampling();

      setStatus("active");
    } catch (err: any) {
      console.error("Failed to start screen share:", err);

      if (err.name === "NotAllowedError") {
        setError("Screen sharing permission was denied. Please try again.");
      } else {
        setError("Failed to start screen sharing. Please try again.");
      }
      setStatus("error");
    }
  };

  // Stop screen sharing
  const stopScreenShare = () => {
    // Stop frame sampling
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (status !== "completed") {
      setStatus("idle");
    }
  };

  // Sample frames and send to server
  const startFrameSampling = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Sample every 2 seconds (matching server debounce)
    frameIntervalRef.current = setInterval(() => {
      if (
        !wsRef.current ||
        wsRef.current.readyState !== WebSocket.OPEN ||
        video.readyState < 2
      ) {
        return;
      }

      // Resize canvas to match video
      canvas.width = Math.min(video.videoWidth, 1280);
      canvas.height = Math.min(
        video.videoHeight,
        (canvas.width / video.videoWidth) * video.videoHeight
      );

      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert to base64 JPEG
      const imageData = canvas.toDataURL("image/jpeg", 0.7);

      // Send to server
      wsRef.current.send(
        JSON.stringify({
          type: "frame",
          imageData,
        })
      );
    }, 2000);
  };

  // Request hint
  const requestHint = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "requestHint" }));
    }
  };

  // Skip step
  const skipStep = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "skipStep" }));
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScreenShare();
    };
  }, []);

  // Heartbeat to keep connection alive
  useEffect(() => {
    const heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    return () => clearInterval(heartbeat);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-semibold">{template.name}</h1>
          <ProgressIndicator
            currentStep={currentStep}
            totalSteps={totalSteps}
          />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 max-w-7xl mx-auto w-full">
        {/* Error State */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Idle State - Start Screen */}
        {status === "idle" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="max-w-md text-center">
              <div className="w-24 h-24 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-12 h-12 text-primary-600 dark:text-primary-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-4">Ready to Start?</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-8">
                You'll be guided through {totalSteps} step{totalSteps !== 1 ? "s" : ""} with
                AI-powered voice instructions. Share your screen to begin.
              </p>
              <button
                onClick={startScreenShare}
                className="px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg text-lg transition-colors"
              >
                Share Screen & Start
              </button>
            </div>
          </div>
        )}

        {/* Active/Ready State */}
        {(status === "active" || status === "ready" || status === "connecting") && (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Video Preview */}
            <div className="lg:col-span-2">
              <div className="bg-black rounded-lg overflow-hidden aspect-video relative">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain"
                />
                {status === "connecting" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="text-center text-white">
                      <div className="spinner mx-auto mb-2"></div>
                      <p>Connecting...</p>
                    </div>
                  </div>
                )}
                {isAnalyzing && (
                  <div className="absolute top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    Analyzing...
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Current Instruction */}
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
                <h3 className="text-sm font-medium text-gray-500 mb-2">
                  Step {currentStep + 1} of {totalSteps}
                </h3>
                <p className="text-lg font-medium">
                  {instruction || steps[currentStep]?.instruction || "Loading..."}
                </p>
              </div>

              {/* Audio Player */}
              {audioData && (
                <AudioPlayer
                  audioData={audioData}
                  onComplete={() => setAudioData(null)}
                />
              )}

              {/* Analysis Result */}
              {analysis && (
                <div
                  className={cn(
                    "rounded-lg p-4",
                    analysis.matchesSuccess
                      ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                      : "bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
                  )}
                >
                  <p className="text-sm">{analysis.description}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Confidence: {Math.round(analysis.confidence * 100)}%
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={requestHint}
                  className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                >
                  Get Hint
                </button>
                <button
                  onClick={skipStep}
                  className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                >
                  Skip Step
                </button>
              </div>

              {/* Stop Button */}
              <button
                onClick={stopScreenShare}
                className="w-full px-4 py-2 bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-sm font-medium transition-colors"
              >
                Stop Session
              </button>
            </div>
          </div>
        )}

        {/* Completed State */}
        {status === "completed" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="max-w-md text-center">
              <div className="w-24 h-24 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-12 h-12 text-green-600 dark:text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-4">All Done!</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-8">
                You've completed all {totalSteps} steps. Great job!
              </p>
              <a
                href="/"
                className="px-8 py-4 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg text-lg transition-colors inline-block"
              >
                Back to Home
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
