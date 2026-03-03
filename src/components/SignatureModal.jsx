import { useMemo, useRef, useState } from "react";
import { Layer, Line, Stage } from "react-konva";

const FONT_OPTIONS = [
  { value: "classic", label: "Classic" },
  { value: "script", label: "Script" },
  { value: "formal", label: "Formal" }
];

export default function SignatureModal({ region, onClose, onSubmit }) {
  const [mode, setMode] = useState("draw");
  const [typedName, setTypedName] = useState("");
  const [typedFont, setTypedFont] = useState("classic");
  const [uploadedBase64, setUploadedBase64] = useState(null);
  const [localError, setLocalError] = useState("");
  const [lines, setLines] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const stageRef = useRef(null);

  const stageSize = useMemo(
    () => ({
      width: Math.max(300, Math.round(region.width * 680)),
      height: Math.max(120, Math.round(region.height * 680))
    }),
    [region]
  );

  const startDraw = (e) => {
    setIsDrawing(true);
    const pos = e.target.getStage().getPointerPosition();
    setLines((prev) => [...prev, { points: [pos.x, pos.y] }]);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    setLines((prev) => {
      const lastLine = prev[prev.length - 1];
      if (!lastLine) return prev;
      const updated = {
        ...lastLine,
        points: [...lastLine.points, point.x, point.y]
      };
      return [...prev.slice(0, -1), updated];
    });
  };

  const endDraw = () => setIsDrawing(false);

  const handleUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setUploadedBase64(reader.result?.toString() || null);
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (mode === "draw") {
      if (!lines.length) {
        setLocalError("Draw your signature first.");
        return;
      }
      const dataUrl = stageRef.current?.toDataURL({ pixelRatio: 2 });
      if (!dataUrl) return;
      setLocalError("");
      onSubmit({
        method: "draw",
        drawn_signature_base64: dataUrl
      });
      return;
    }
    if (mode === "type") {
      if (!typedName.trim()) {
        setLocalError("Type your signature first.");
        return;
      }
      setLocalError("");
      onSubmit({
        method: "type",
        typed_name: typedName.trim(),
        typed_font: typedFont
      });
      return;
    }
    if (!uploadedBase64) {
      setLocalError("Upload a signature image first.");
      return;
    }
    setLocalError("");
    onSubmit({
      method: "upload",
      uploaded_signature_base64: uploadedBase64
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="title-font text-xl text-sky-100">Sign Region</h2>
          <button className="text-slate-400 hover:text-white" onClick={onClose} type="button">Close</button>
        </div>
        <div className="mb-4 flex gap-2">
          {["draw", "type", "upload"].map((value) => (
            <button
              key={value}
              className={`rounded-lg px-3 py-2 text-sm ${mode === value ? "bg-sky-700" : "bg-slate-800"}`}
              onClick={() => {
                setMode(value);
                setLocalError("");
              }}
              type="button"
            >
              {value}
            </button>
          ))}
        </div>

        {mode === "draw" && (
          <div className="rounded-lg border border-slate-700 bg-slate-100 p-2">
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            >
              <Layer>
                {lines.map((line, idx) => (
                  <Line key={idx} points={line.points} stroke="#0f172a" strokeWidth={3} tension={0.4} lineCap="round" />
                ))}
              </Layer>
            </Stage>
            <button
              className="mt-2 rounded bg-slate-700 px-2 py-1 text-xs"
              onClick={() => setLines([])}
              type="button"
            >
              Clear
            </button>
          </div>
        )}

        {mode === "type" && (
          <div className="space-y-3">
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              placeholder="Type your signature"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
            />
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={typedFont}
              onChange={(e) => setTypedFont(e.target.value)}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value}>{font.label}</option>
              ))}
            </select>
          </div>
        )}

        {mode === "upload" && (
          <div className="space-y-3">
            <input type="file" accept="image/png,image/jpeg" onChange={handleUpload} />
            {uploadedBase64 ? <img src={uploadedBase64} alt="Uploaded signature" className="max-h-32 rounded border border-slate-700" /> : null}
          </div>
        )}

        {localError ? <p className="mt-3 text-sm text-red-400">{localError}</p> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button className="rounded-lg border border-slate-700 px-3 py-2" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="rounded-lg bg-emerald-700 px-3 py-2" onClick={handleSubmit} type="button">
            Apply Signature
          </button>
        </div>
      </div>
    </div>
  );
}
