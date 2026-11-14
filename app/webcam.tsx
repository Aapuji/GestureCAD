'use client'

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, GestureRecognizer, type GestureRecognizerResult } from "@mediapipe/tasks-vision";

export interface WebcamProps {
  onFrame: (result: GestureRecognizerResult, timestamp: number) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  hidden?: boolean;
};

export function Webcam({
    onFrame,
    onReady,
    onError,
    hidden
}: WebcamProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const onFrameRef = useRef(onFrame);
    const onReadyRef = useRef(onReady);
    const onErrorRef = useRef(onError);
    useEffect(() => {
        onFrameRef.current = onFrame;
        onReadyRef.current = onReady;
        onErrorRef.current = onError;
    }, [onFrame, onReady, onError]);
    
    const [error, setError] = useState<string | null>(null);
    const [isModelReady, setIsModelReady] = useState(false);

    const [debugInfo, setDebugInfo] = useState<{
        gesture: string;
        score: number;
        handedness: string;
    } | null>(null);

    useEffect(() => {
        const originalConsoleError = console.error;
        console.error = (...args: unknown[]) => {
            if (
            typeof args[0] === "string" &&
            args[0].includes("Created TensorFlow Lite XNNPACK delegate")
            ) {
            return;
            }
            originalConsoleError(...args);
        };

        let isCancelled = false;
        let gestureRecognizer: GestureRecognizer | null = null;
        let animationFrameId: number; 
        let stream: MediaStream | null = null;

        async function startWebcam() {
            try {
                const _video = videoRef.current;
                if (!_video) return; 
                const video = _video;

                stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                });

                if (isCancelled) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }

                video.srcObject = stream;
                await video.play();

                const vision = await FilesetResolver.forVisionTasks("/wasm");
                if (isCancelled) return;

                gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: "/gesture_recognizer.task",
                        delegate: "GPU"
                    },
                    runningMode: "VIDEO",
                    numHands: 2
                });

                if (isCancelled) {
                    gestureRecognizer.close();
                    return;
                }

                onReadyRef.current?.();
                setIsModelReady(true);
                let lastVideoTime = -1;

                function renderLoop() {
                    if (
                        video &&
                        gestureRecognizer &&
                        video.readyState >= 2 &&
                        video.currentTime !== lastVideoTime
                    ) {
                        lastVideoTime = video.currentTime;
                        const now = performance.now();
                        const result = gestureRecognizer.recognizeForVideo(video, now);

                        onFrameRef.current(result, now);
                    }

                    animationFrameId = requestAnimationFrame(renderLoop);
                }

                renderLoop();
            } catch (err) {
                if (!isCancelled) {
                    const errorObj = err instanceof Error ? err : new Error(String(err));
                    onErrorRef.current?.(errorObj);
                                    
                    setError("Unable to access webcam.");
                    console.error("Error accessing webcam", err);
                }
            }
        }

        startWebcam();
        return () => {
            console.error = originalConsoleError;
            isCancelled = true;
            cancelAnimationFrame(animationFrameId);
            if (stream)
                stream.getTracks().forEach(track => track.stop());
            if (gestureRecognizer)
                gestureRecognizer.close();
        };
    }, []);

    return <div>
        {error ? (
            <p>{error}</p>
        ) : ( 
            <>
                {!isModelReady && <p>Loading hand tracking model...</p>}
                <video 
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={hidden ? "hidden" : ""}
                />
                {/* {debugInfo ? (
                    <div className="mt-2 p-2 bg-black/80 text-white rounded text-sm font-mono">
                        Hand: {debugInfo.handedness} | Gesture: {debugInfo.gesture} ({debugInfo.score}%)
                    </div>
                ) : (
                    <p className="mt-2 text-sm text-gray-500">No hand detected</p>
                )} */}
            </>
        )}
    </div>
}
