"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  audioData: string; // Base64 encoded audio
  onComplete?: () => void;
}

export function AudioPlayer({ audioData, onComplete }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioData) return;

    // Create blob URL from base64
    const byteCharacters = atob(audioData);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);

    audio.src = url;
    audio.play().catch(console.error);

    // Cleanup
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [audioData]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      onComplete?.();
    };
    const handleTimeUpdate = () => {
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [onComplete]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(console.error);
    }
  };

  return (
    <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-4 flex items-center gap-4">
      <audio ref={audioRef} className="hidden" />

      {/* Play/Pause Button */}
      <button
        onClick={togglePlayback}
        className="w-10 h-10 bg-primary-600 hover:bg-primary-700 text-white rounded-full flex items-center justify-center transition-colors"
      >
        {isPlaying ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
          </svg>
        ) : (
          <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Progress Bar */}
      <div className="flex-1">
        <div className="h-2 bg-primary-200 dark:bg-primary-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-600 transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-primary-600 dark:text-primary-400 mt-1">
          {isPlaying ? "Playing instruction..." : "Voice instruction"}
        </p>
      </div>

      {/* Sound Wave Animation */}
      {isPlaying && (
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-1 bg-primary-600 dark:bg-primary-400 rounded-full animate-pulse"
              style={{
                height: `${Math.random() * 16 + 8}px`,
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
