"use client";

// Throwaway test page for lib/handTracker.ts. Put it at app/test/tracker/page.tsx
// and visit http://localhost:3000/test/tracker
// Shows live grab/pose values for both hands, plus a cube you can pick up,
// move and rotate with your RIGHT hand (grab = make a fist).

import { useRef, useState } from "react";
import { Webcam } from "../../../components/webcam";
// import {
//   HandTracker,
//   toRawHands,
//   qMul,
//   qIdentity,
//   quatAngle,
//   type HandState,
//   type Quat,
//   type Vec3,
// } from "/lib/handTracker";
import {
    HandTracker,
    toRawHands,
    qMul,
    qIdentity,
    quatAngle,
    type HandState,
    type Quat,
    type Vec3
} from "@/lib/hand-tracker";

const ASPECT = 4 / 3;   // your webcam's videoWidth / videoHeight (see note in the chat)
const MOVE_GAIN = 800;  // metres of hand travel -> CSS pixels of cube travel

// Quaternion (MediaPipe axes: z away) -> CSS matrix3d (CSS z points toward the viewer).
// Conjugating by diag(1,1,-1) expresses the same physical rotation in CSS axes.
const FLIP = [1, 1, -1];
function cssRotation(q: Quat): string {
    const { x, y, z, w } = q;
    const R = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
    const c = (i: number, j: number) => R[i][j] * FLIP[i] * FLIP[j];
    
    // matrix3d is column-major
    return `matrix3d(${c(0, 0)},${c(1, 0)},${c(2, 0)},0,${c(0, 1)},${c(1, 1)},${c(2, 1)},0,${c(0, 2)},${c(1, 2)},${c(2, 2)},0,0,0,0,1)`;
}

const FACES = [
    { t: "translateZ(50px)", c: "#e74c3c", n: "F" },
    { t: "rotateY(180deg) translateZ(50px)", c: "#3498db", n: "B" },
    { t: "rotateY(90deg) translateZ(50px)", c: "#2ecc71", n: "R" },
    { t: "rotateY(-90deg) translateZ(50px)", c: "#f1c40f", n: "L" },
    { t: "rotateX(90deg) translateZ(50px)", c: "#9b59b6", n: "T" },
    { t: "rotateX(-90deg) translateZ(50px)", c: "#e67e22", n: "D" },
];

const f2 = (n: number) => n.toFixed(2);
const v3 = (v: Vec3) => `${f2(v.x)}, ${f2(v.y)}, ${f2(v.z)}`;

function Hud({ name, s }: { name: string; s: HandState }) {
    const speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
    const deg = (quatAngle(s.rotSinceGrab) * 180) / Math.PI;
    return (
        <pre style={{ background: "#111", color: "#0f0", padding: 8, margin: "8px 0", fontSize: 13 }}>
{`${name}: ${s.present ? "tracked" : "no hand"}   ${s.grabbing ? "GRABBING" : "open"}
grabAmount ${f2(s.grabAmount)} ${"█".repeat(Math.round(s.grabAmount * 20)).padEnd(20, "░")}
palm (m)   ${v3(s.palm)}
speed      ${f2(speed)} m/s
since grab ${v3(s.moveSinceGrab)} m, ${deg.toFixed(0)}°`}
    </pre>
    );
}

type View = { l: HandState; r: HandState; pos: Vec3; rot: Quat; gesture: string };

export default function TrackerTest() {
    // Trackers and the cube's pose live in refs so they survive re-renders.
    const right = useRef(new HandTracker({ aspect: ASPECT }));
    const left = useRef(new HandTracker({ aspect: ASPECT }));
    const block = useRef<{ pos: Vec3; rot: Quat }>({ pos: { x: 0, y: 0, z: 0 }, rot: qIdentity() });

    const [view, setView] = useState<View | null>(null);
    const [log, setLog] = useState<string[]>([]);

    return (
        <div style={{ padding: 16, fontFamily: "sans-serif", display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
                {/* Mirror the preview so it behaves like a mirror (the tracker data is already mirrored). */}
                <div className="[&_video]:-scale-x-100">
                    <Webcam
                        hidden={false}
                        onFrame={(result, t) => {
                            const hands = toRawHands(result, { mirrored: false });
                            const r = right.current.update(hands.Right ?? null, t);
                            const l = left.current.update(hands.Left ?? null, t);

                            // The clutch: the cube only follows the hand while it is grabbing.
                            const b = block.current;
                            if (r.grabbing) {
                                b.pos = {
                                x: b.pos.x + r.moveDelta.x * MOVE_GAIN,
                                y: b.pos.y + r.moveDelta.y * MOVE_GAIN,
                                z: b.pos.z + r.moveDelta.z * MOVE_GAIN,
                                };
                                b.rot = qMul(r.rotDelta, b.rot);
                            }

                            const events: string[] = [];
                            for (const [name, s] of [["R", r], ["L", l]] as const) {
                                const stamp = `${(t / 1000).toFixed(2)}s ${name}`;
                                if (s.justGrabbed) events.push(`${stamp} grab`);
                                if (s.justReleased) events.push(`${stamp} release`);
                            }
                            if (events.length) setLog((prev) => [...events, ...prev].slice(0, 8));

                            // MediaPipe's own classifier, handy as a cross-check against grabAmount.
                            const gesture = result.gestures?.[0]?.[0]?.categoryName ?? "-";
                            setView({ l, r, pos: b.pos, rot: b.rot, gesture });
                        }}
                    />
                </div>
                {view && <>
                    <Hud name="RIGHT" s={view.r} />
                    <Hud name="LEFT" s={view.l} />
                    <p style={{ fontSize: 13 }}>MediaPipe gesture (first hand): {view.gesture}</p>
                </>}
                <pre style={{ fontSize: 13 }}>{log.join("\n") || "grab / release events appear here"}</pre>
            </div>

            <div style={{ perspective: 800, width: 300, height: 300, position: "relative", border: "1px solid #888" }}>
                {view && (
                <div
                    style={{
                    position: "absolute",
                    left: 100,
                    top: 100,
                    width: 100,
                    height: 100,
                    transformStyle: "preserve-3d",
                    // CSS z points toward the viewer, MediaPipe z points away. So we negate it.
                    transform: `translate3d(${view.pos.x}px, ${view.pos.y}px, ${-view.pos.z}px) ${cssRotation(view.rot)}`,
                    }}
                >
                    {FACES.map((f) => <div
                        key={f.n}
                        style={{
                        position: "absolute",
                        width: 100,
                        height: 100,
                        background: f.c,
                        opacity: 0.85,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 32,
                        transform: f.t,
                        }}
                    >
                        {f.n}
                    </div>
                    )}
                </div>
                )}
            </div>
        </div>
    );
}
