"use client";

// Throwaway test page for lib/grabDetector.ts. Put it at app/test/grab/page.tsx
// and visit http://localhost:3000/test/grab
// Right hand only. Drag the sliders to tune when a grab starts and ends.
// "Calibrate" is optional: hold your hand open, then closed as if gripping something.

import { useEffect, useRef, useState } from "react";
import { Webcam, type WebcamProps } from "../../../components/webcam";
import {
  GrabDetector,
  DEFAULT_GRAB_OPTIONS,
  DEFAULT_CALIBRATION,
  buildCalibration,
  pickRightHand,
  type Calibration,
  type Features,
  type GrabState,
} from "@/lib/grab-detector";

const CAL_KEY = "grabCalibration";
const THR_KEY = "grabThresholds";
const MIN_GAP = 0.05; // grabOff stays at least this far below grabOn

type Phase = { name: "open" | "closed"; start: number; samples: Features[] };
type Thresholds = { on: number; off: number };

const DEFAULT_THRESHOLDS: Thresholds = {
  on: DEFAULT_GRAB_OPTIONS.grabOn,
  off: DEFAULT_GRAB_OPTIONS.grabOff,
};

const fmt = (f: Features) => `bend ${f.bend.toFixed(0)}°  tuck ${f.tuck.toFixed(2)}`;

function Marker({ at }: { at: number }) {
  return (
    <div
      style={{ position: "absolute", left: `${at * 100}%`, top: 0, bottom: 0, width: 2, background: "#fff" }}
    />
  );
}

export default function GrabTest() {
  const detector = useRef(new GrabDetector());
  const phase = useRef<Phase | null>(null);
  const openSamples = useRef<Features[]>([]);

  const [state, setState] = useState<GrabState | null>(null);
  const [gesture, setGesture] = useState("-");
  const [log, setLog] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [cal, setCal] = useState<Calibration>(DEFAULT_CALIBRATION);
  const [thr, setThr] = useState<Thresholds>(DEFAULT_THRESHOLDS);

  // Load saved calibration and thresholds, if any.
  useEffect(() => {
    try {
      const savedCal = localStorage.getItem(CAL_KEY);
      if (savedCal) {
        const c = JSON.parse(savedCal) as Calibration;
        detector.current.setCalibration(c);
        setCal(c);
      }
      const savedThr = localStorage.getItem(THR_KEY);
      if (savedThr) {
        const t = JSON.parse(savedThr) as Thresholds;
        detector.current.setThresholds(t.on, t.off);
        setThr(t);
      }
    } catch {
      // storage unavailable or bad JSON: stay on the defaults
    }
  }, []);

  const pushLog = (msg: string) => setLog((prev) => [msg, ...prev].slice(0, 10));

  function updateThresholds(on: number, off: number) {
    const t = { on, off: Math.min(off, on - MIN_GAP) };
    detector.current.setThresholds(t.on, t.off);
    setThr(t);
    try {
      localStorage.setItem(THR_KEY, JSON.stringify(t));
    } catch {
      // ignore
    }
  }

  function startCalibration() {
    phase.current = { name: "open", start: -1, samples: [] };
  }

  function resetAll() {
    phase.current = null;
    detector.current.setCalibration(DEFAULT_CALIBRATION);
    detector.current.setThresholds(DEFAULT_THRESHOLDS.on, DEFAULT_THRESHOLDS.off);
    setCal(DEFAULT_CALIBRATION);
    setThr(DEFAULT_THRESHOLDS);
    setPrompt("");
    try {
      localStorage.removeItem(CAL_KEY);
      localStorage.removeItem(THR_KEY);
    } catch {
      // ignore
    }
  }

  // Calibration runs on frame timestamps: 1 s to get ready, then 1.5 s of recording.
  function runCalibration(s: GrabState, t: number) {
    const p = phase.current;
    if (!p) return;
    if (p.start < 0) p.start = t;
    const dt = t - p.start;
    const what = p.name === "open" ? "OPEN and flat" : "CLOSED, as if gripping something";

    if (dt < 1000) {
      setPrompt(`Get ready: hold your right hand ${what}…`);
    } else if (dt < 2500) {
      if (s.present) p.samples.push(s.features);
      setPrompt(`Recording: keep your hand ${what}`);
    } else if (p.name === "open") {
      openSamples.current = p.samples;
      phase.current = { name: "closed", start: -1, samples: [] };
    } else {
      phase.current = null;
      const result = buildCalibration(openSamples.current, p.samples);
      if ("error" in result) {
        setPrompt(`Calibration failed: ${result.error}`);
      } else {
        detector.current.setCalibration(result);
        setCal(result);
        setPrompt("Calibrated ✓");
        try {
          localStorage.setItem(CAL_KEY, JSON.stringify(result));
        } catch {
          // ignore
        }
      }
    }
  }

  const onFrame: WebcamProps["onFrame"] = (result, t) => {
    const hand = pickRightHand(result);
    const s = detector.current.update(hand, t);

    // MediaPipe's own classifier for the same hand, as a cross-check.
    const g = hand ? result.gestures?.[hand.index]?.[0] : undefined;
    setGesture(g ? `${g.categoryName} (${(g.score * 100).toFixed(0)}%)` : "-");

    const stamp = `${(t / 1000).toFixed(2)}s`;
    if (s.justGrabbed) pushLog(`${stamp}  GRAB`);
    if (s.justReleased) pushLog(`${stamp}  release`);

    runCalibration(s, t);
    setState(s);
  };

  const status = !state ? "waiting…" : !state.present ? "no right hand" : state.grabbing ? "GRABBING" : "OPEN";

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif", maxWidth: 720 }}>
      <Webcam hidden={false} onFrame={onFrame} />

      <h1 style={{ fontSize: 40, margin: "12px 0", color: state?.grabbing ? "#e74c3c" : undefined }}>{status}</h1>

      <div style={{ position: "relative", height: 24, background: "#333", borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            width: `${(state?.curl ?? 0) * 100}%`,
            height: "100%",
            background: state?.grabbing ? "#e74c3c" : "#2ecc71",
          }}
        />
        <Marker at={thr.off} />
        <Marker at={thr.on} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 4, margin: "8px 0 12px", alignItems: "center" }}>
        <span>grab above {thr.on.toFixed(2)}</span>
        <input
          type="range"
          min={0.1}
          max={0.9}
          step={0.01}
          value={thr.on}
          onChange={(e) => updateThresholds(Number(e.target.value), thr.off)}
        />
        <span>release below {thr.off.toFixed(2)}</span>
        <input
          type="range"
          min={0.05}
          max={0.85}
          step={0.01}
          value={thr.off}
          onChange={(e) => updateThresholds(thr.on, Number(e.target.value))}
        />
      </div>

      <pre style={{ background: "#111", color: "#0f0", padding: 8, fontSize: 13 }}>
{`curl              ${(state?.curl ?? 0).toFixed(2)}
raw now           ${state ? fmt(state.features) : "-"}
calibrated open   ${fmt(cal.open)}
calibrated closed ${fmt(cal.closed)}
MediaPipe says    ${gesture}`}
      </pre>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={startCalibration}>Calibrate</button>
        <button type="button" onClick={resetAll}>Reset to defaults</button>
        <span>{prompt}</span>
      </div>

      <pre style={{ fontSize: 13 }}>{log.join("\n") || "grab / release events appear here"}</pre>
    </div>
  );
}
