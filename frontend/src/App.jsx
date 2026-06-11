import { useState, useRef } from "react";
import "./App.css";
import { uploadHeadshot, createJob, subscribeJob } from "./api";

const STYLE_LABELS = {
  bold_dramatic: "Bold Dramatic",
  clean_minimal: "Clean Minimal",
  vibrant_energetic: "Vibrant Energetic",
};

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [numThumbnails, setNumThumbnails] = useState(3);
  const [headshotFile, setHeadshotFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  const [thumbnails, setThumbnails] = useState([]);
  const [jobDone, setJobDone] = useState(false);

  const fileInputRef = useRef();

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setHeadshotFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function handleSubmit() {
    if (!prompt.trim()) return setError("Be sure to write a topic.");
    if (!headshotFile) return setError("Upload your photo.");
    setError("");
    setLoading(true);
    setJobDone(false);
    setThumbnails([]);

    try {
      // 1. Upload headshot
      setStatusMsg("Photo is uploading...");
      const { url: headshotUrl } = await uploadHeadshot(headshotFile);

      // 2. Create job
      setStatusMsg("Work has started, thumbnails are being generated...");
      const { job_id } = await createJob(prompt, numThumbnails, headshotUrl);

      // Placeholder cards
      const placeholders = Array.from({ length: numThumbnails }, (_, i) => ({
        id: i,
        style_name: ["bold_dramatic", "clean_minimal", "vibrant_energetic"][i],
        status: "generating",
        imagekit_url: null,
        variants: null,
      }));
      setThumbnails(placeholders);

      // 3. SSE stream
      subscribeJob(job_id, {
        onThumbnailReady(data) {
          setThumbnails((prev) =>
            prev.map((t) =>
              t.style_name === data.style_name
                ? { ...t, status: "uploaded", imagekit_url: data.imagekit_url, variants: data.variants, id: data.thumbnail_id }
                : t
            )
          );
          setStatusMsg("One thumbnail is ready!");
        },
        onThumbnailFailed(data) {
          setThumbnails((prev) =>
            prev.map((t) =>
              t.style_name === data.style_name
                ? { ...t, status: "failed", error_message: data.error }
                : t
            )
          );
        },
        onJobCompleted() {
          setStatusMsg("");
          setJobDone(true);
          setLoading(false);
        },
        onError() {
          setError("There was a connection issue. Please reload the page.");
          setLoading(false);
        },
      });
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setLoading(false);
      setStatusMsg("");
    }
  }

  function handleReset() {
    setPrompt("");
    setHeadshotFile(null);
    setPreviewUrl(null);
    setThumbnails([]);
    setJobDone(false);
    setStatusMsg("");
    setError("");
    setNumThumbnails(3);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="app">
      {/* HEADER */}
      <header className="header">
        <div className="header-tag">AI Powered</div>
        <h1>THUMB<span>MAKER</span></h1>
        <p>Provide your photo and topic — AI will create professional thumbnails for YouTube.</p>
      </header>

      {/* FORM */}
      {!loading && !jobDone && (
        <div className="form-card">
          {/* Prompt */}
          <div className="field">
            <label>Video topic</label>
            <textarea
              placeholder="Example: How I made $10,000 in one month with freelancing..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          {/* Headshot Upload */}
          <div className="field">
            <label>Your photo (headshot)</label>
            <div className={`upload-zone ${headshotFile ? "has-file" : ""}`}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
              />
              {previewUrl ? (
                <>
                  <img src={previewUrl} alt="preview" className="upload-preview" />
                  <span className="filename">{headshotFile.name}</span>
                  <p>Click karke change karo</p>
                </>
              ) : (
                <>
                  <span className="upload-icon">🖼️</span>
                  <p>Click here or drag your photo</p>
                  <p>JPG, PNG — max 10MB</p>
                </>
              )}
            </div>
          </div>

          {/* Count */}
          <div className="field">
            <label>How many thumbnails do you want?</label>
            <div className="count-row">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  className={`count-btn ${numThumbnails === n ? "active" : ""}`}
                  onClick={() => setNumThumbnails(n)}
                >
                  {n} Style{n > 1 ? "s" : ""}
                </button>
              ))}
            </div>
          </div>

          {error && <div className="error-msg">{error}</div>}

          <button className="btn-submit" onClick={handleSubmit} disabled={loading}>
            GENERATE THUMBNAILS
          </button>
        </div>
      )}

      {/* STATUS BAR */}
      {statusMsg && (
        <div className="status-bar">
          <div className="spinner" />
          {statusMsg}
        </div>
      )}

      {/* RESULTS */}
      {thumbnails.length > 0 && (
        <div className="results">
          <h2 className="results-title">
            {"jobDone ? 'THUMBNAILS READY! 🎉' : 'GENERATING...'"}
          </h2>
          <div className="thumbnails-grid">
            {thumbnails.map((t, i) => (
              <ThumbnailCard key={i} thumb={t} />
            ))}
          </div>

          {jobDone && (
            <button className="btn-reset" onClick={handleReset}>
              ← Generate new thumbnails
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ThumbnailCard({ thumb }) {
  const isReady = thumb.status === "uploaded";
  const isFailed = thumb.status === "failed";

  return (
    <div className="thumb-card">
      <div className="thumb-img-wrap">
        {isReady ? (
          <img src={thumb.imagekit_url} alt={thumb.style_name} />
        ) : (
          <div className="skeleton" />
        )}
        <span className={`status-badge ${thumb.status}`}>
          {thumb.status === "generating" ? "⏳ Generating" :
           thumb.status === "uploaded"   ? "✓ Ready" :
           thumb.status === "failed"     ? "✗ Failed" : "Pending"}
        </span>
      </div>

      <div className="thumb-info">
        <div className="thumb-style-name">
          {STYLE_LABELS[thumb.style_name] || thumb.style_name}
        </div>

        {isFailed && (
          <div className="thumb-error">❌ {thumb.error_message || "Something went wrong."}</div>
        )}

        {isReady && thumb.variants && (
          <div className="variants">
            {Object.entries(thumb.variants).map(([name, url]) => (
              <a key={name} href={url} target="_blank" rel="noreferrer" className="variant-link">
                {name}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
