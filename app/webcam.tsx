'use client'

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";

export function Webcam() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
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
                        const result = gestureRecognizer.recognizeForVideo(
                            video, 
                            performance.now()
                        );

                        if (result.gestures.length > 0) {
                        const topGesture = result.gestures[0][0]; // [handIndex][topCategory]
                        const hand = result.handedness[0]?.[0]?.categoryName ?? "Unknown";

                        setDebugInfo((prev) => {
                            // Only trigger a re-render if the gesture changed
                            if (prev?.gesture === topGesture.categoryName && prev?.handedness === hand) {
                            return prev;
                            }
                            return {
                            gesture: topGesture.categoryName,
                            score: Math.round(topGesture.score * 100),
                            handedness: hand,
                            };
                        });
                        } else {
                        setDebugInfo((prev) => (prev === null ? null : null));
                        }

                        if (result.gestures.length > 0)
                            console.log("Detected:", result.gestures[0]);
                    }

                    animationFrameId = requestAnimationFrame(renderLoop);
                }

                renderLoop();
            } catch (err) {
                setError("Unable to access webcam.");
                console.error("Error accessing webcam", err);
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
                />
                {debugInfo ? (
                    <div className="mt-2 p-2 bg-black/80 text-white rounded text-sm font-mono">
                        Hand: {debugInfo.handedness} | Gesture: {debugInfo.gesture} ({debugInfo.score}%)
                    </div>
                ) : (
                    <p className="mt-2 text-sm text-gray-500">No hand detected</p>
                )}
            </>
        )}
    </div>
}
