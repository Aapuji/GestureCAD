"use client";

import { useEffect, useRef, useState } from "react";
import { Webcam } from "./webcam";
import { World } from "../lib/world";
import { Controller } from "../lib/controller";
import { LeftHandController } from "../lib/left";
import { RightHandController } from "../lib/right";

export default function Scene() {
    const containerRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<Controller | null>(null);
    const worldRef = useRef<World | null>(null);
    const rightRef = useRef<RightHandController | null>(null);

    const [hud, setHud] = useState("starting...");

    useEffect(() => {
        const world = new World(containerRef.current!);
        worldRef.current = world;

        const left = new LeftHandController(world);
        const right = new RightHandController(world);
        rightRef.current = right;
        controllerRef.current = new Controller(left, right);

        const timer = setInterval(() => {
            setHud(
                `Left pinch: ${left.pinched ? "YES" : "no"} | gap ${left.gap.toFixed(2)} | ` +
                `strafe ${left.strafe.toFixed(2)}  forward ${left.forward.toFixed(2)}\n` +
                `Right pinch: ${right.pinched ? "YES" : "no"} | grab: ${right.grabbed ? "YES" : "no"} | ` +
                `gap ${right.gap.toFixed(2)} | curl ${right.curl.toFixed(2)}`
            );
        }, 100);

        return () => {
            clearInterval(timer);
            controllerRef.current = null;
            worldRef.current = null;
            rightRef.current = null;
            world.stop();
            world.dispose();
        };
    }, []);

    return (
        <div style={{ position: "relative", width: "100%", height: "100vh", overflow: "hidden" }}>
            {/* The 3D scene fills the page */}
            <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

            {/* Small camera preview, bottom right. Mirrored so it feels like a mirror. */}
            <style>{`.cam video { width: 100%; border-radius: 8px; transform: scaleX(-1); }`}</style>
            <div className="cam" style={{ position: "absolute", right: 12, bottom: 12, width: 240, zIndex: 2 }}>
                <Webcam onFrame={(result: any, timestamp: number) => {
                    controllerRef.current?.processInputs(result, timestamp);

                    // Only the RIGHT hand is drawn and can grab. The right hand controller
                    // keeps its own landmarks (empty when the right hand isn't visible).
                    const right = rightRef.current;
                    worldRef.current?.updateHand(
                        right ? right.handLandmarks : [],
                        right ? right.grabbed : false
                    );
                }} />
            </div>

            {/* Text on top of the scene */}
            <div
                style={{
                    position: "absolute",
                    left: 12,
                    top: 12,
                    zIndex: 2,
                    color: "white",
                    fontFamily: "sans-serif",
                    fontSize: 18,
                    lineHeight: 1.5,
                    textShadow: "0 1px 3px black",
                }}
            >
                <div style={{ whiteSpace: "pre-line" }}>{hud}</div>
                <div style={{ opacity: 0.7, fontSize: 14 }}>
                    Left hand: pinch, then move it away from where you pinched to walk.
                    <br />
                    Right hand: pinch and drag to turn the view. Touch the block (it glows) and close your fist to grab it.
                </div>
            </div>
        </div>
    );
}


