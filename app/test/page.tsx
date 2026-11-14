"use client";

// Throwaway test page: uses your partner's Webcam and shows your finger counts.
// Visit http://localhost:3000/test

import { useState } from "react";
import { Webcam } from "../webcam";
import { splitHands, countFinger, type HandInput } from "../../lib/gestures";

export default function TestPage() {
  const [left, setLeft] = useState("none");
  const [right, setRight] = useState("none");
  const [labels, setLabels] = useState("none");  

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <Webcam
        hidden={false}
        onFrame={(result) => {
          // Older and newer versions of the library name this field differently.
          const handedness = (result as any).handedness ?? (result as any).handednesses ?? [];

          // Turn MediaPipe's result into a list of hands, each with a label and 21 points.
          const hands: HandInput[] = result.landmarks.map((landmarks, i) => ({
            id: handedness[i]?.[0]?.categoryName ?? "?",
            landmarks,
          }));

          const { left, right } = splitHands(hands);
          setLeft(left ? String(countFinger(left)) : "none");
          setRight(right ? String(countFinger(right)) : "none");
          setLabels(hands.length ? hands.map((h) => h.id).join(", ") : "none");
        }}
      />
      <h1 style={{ fontSize: 48, margin: "12px 0 0" }}>Left hand: {left}</h1>
      <h1 style={{ fontSize: 48, margin: 0 }}>Right hand: {right}</h1>
      <p>Labels MediaPipe is giving: {labels}</p>
    </div>
  );
}
