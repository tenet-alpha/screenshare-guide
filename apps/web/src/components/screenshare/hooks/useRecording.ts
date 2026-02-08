import { useRef, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import type { UploadStatus } from "../types";

interface UseRecordingOptions {
  sessionId: string;
}

export function useRecording({ sessionId }: UseRecordingOptions) {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // tRPC mutations
  const getUploadUrl = trpc.session.getUploadUrl.useMutation();
  const updateSession = trpc.session.update.useMutation();

  const startRecording = useCallback((stream: MediaStream) => {
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
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }, []);

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

  const cleanup = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
  }, []);

  return {
    startRecording,
    stopRecording,
    uploadRecording,
    uploadStatus,
    cleanup,
  };
}
