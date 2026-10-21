import { useState, useRef } from "react";
import "./App.css";
import { uploadHeadshot, uploadHeadshotFromUrl, createJob, retryThumbnail, subscribeJob } from "./api";

const STYLE_LABELS = {
  bold_dramatic: "Bold Dramatic",
  clean_minimal: "Clean Minimal",
  vibrant_energetic: "Vibrant Energetic",
};

const SOURCES = [
  { id: "device", label: "📁 My own photo" },
  { id: "internet", label: "🌐 Photo from the internet" },
  { id: "none", label: "📦 No person / Product only" },
];

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// photo.status: "idle" | "checking" | "ok" | "rejected"
const EMPTY_PHOTO = { status: "idle", url: null, warnings: [], error: "" };

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [numThumbnails, setNumThumbnails] = useState(3);

  const [source, setSource] = useState("device");
  const [headshotFile, setHeadshotFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [linkInput, setLinkInput] = useState("");
  const [photo, setPhoto] = useState(EMPTY_PHOTO);

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  const [jobId, setJobId] = useState(null);
  const [thumbnails, setThumbnails] = useState([]);
  const [jobDone, setJobDone] = useState(false);

  const fileInputRef = useRef();

  function clearPhoto() {
    setHeadshotFile(null);
    setPreviewUrl(null);
    setLinkInput("");
    setPhoto(EMPTY_PHOTO);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSourceChange(id) {
    if (id === source) return;
    setSource(id);
    clearPhoto();
    setError("");
  }

  // Photos are validated by the backend as soon as they're chosen, before generation starts
  async function checkPhoto(uploadFn) {
    setPhoto({ ...EMPTY_PHOTO, status: "checking" });
    try {
      const { url, warnings } = await uploadFn();
      setPhoto({ status: "ok", url, warnings: warnings || [], error: "" });
      return url;
    } catch (err) {
      setPhoto({ ...EMPTY_PHOTO, status: "rejected", error: err.message || "This photo couldn't be used." });
      return null;
    }
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setHeadshotFile(file);
    setPreviewUrl(URL.createObjectURL(file));

    // Quick checks in the browser before sending anything
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return setPhoto({ ...EMPTY_PHOTO, status: "rejected", error: "Please use a JPG, PNG or WEBP image." });
    }
    if (file.size > MAX_FILE_BYTES) {
      return setPhoto({ ...EMPTY_PHOTO, status: "rejected", error: "That image is larger than 10MB." });
    }
    checkPhoto(() => uploadHeadshot(file));
  }

  async function handleCheckLink() {
    const link = linkInput.trim();
    if (!/^https?:\/\//i.test(link)) {
      return setPhoto({ ...EMPTY_PHOTO, status: "rejected", error: "Please paste a link starting with http:// or https://" });
    }
    setPreviewUrl(null);
    const url = await checkPhoto(() => uploadHeadshotFromUrl(link));
    if (url) setPreviewUrl(url);
  }

  function updateThumb(styleName, changes) {
    setThumbnails((prev) => prev.map((t) => (t.style_name === styleName ? { ...t, ...changes } : t)));
  }

  function listen(id) {
    subscribeJob(id, {
      onThumbnailReady(data) {
        updateThumb(data.style_name, {
          status: "uploaded", imagekit_url: data.imagekit_url, variants: data.variants, id: data.thumbnail_id, error_message: null,
        });
        setStatusMsg("One thumbnail is ready!");
      },
      onThumbnailFailed(data) {
        updateThumb(data.style_name, { status: "failed", error_message: data.error, id: data.thumbnail_id });
      },
      onJobCompleted() {
        setStatusMsg("");
        setJobDone(true);
        setLoading(false);
      },
      onError() {
        setError("Lost connection to the server while generating. Check your connection and reload the page.");
        setStatusMsg("");
        setLoading(false);
        setJobDone(true);
      },
    });
  }

  async function handleSubmit() {
    if (!prompt.trim()) return setError("Be sure to write a topic.");
    if (source !== "none") {
      if (photo.status === "checking") return setError("Please wait, your photo is still being checked.");
      if (photo.status !== "ok") {
        return setError(source === "device" ? "Upload a photo that passes the check first." : "Paste an image link and click Check first.");
      }
    }
    setError("");
    setLoading(true);
    setJobDone(false);
    setThumbnails([]);

    try {
      setStatusMsg("Work has started, thumbnails are being generated...");
      const headshotUrl = source === "none" ? null : photo.url;
      const { job_id } = await createJob(prompt, numThumbnails, headshotUrl);
      setJobId(job_id);

      // Placeholder cards
      const placeholders = Array.from({ length: numThumbnails }, (_, i) => ({
        id: i,
        style_name: ["bold_dramatic", "clean_minimal", "vibrant_energetic"][i],
        status: "generating",
        imagekit_url: null,
        variants: null,
      }));
      setThumbnails(placeholders);

      listen(job_id);
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setLoading(false);
      setStatusMsg("");
    }
  }

  async function handleRetry(thumb) {
    updateThumb(thumb.style_name, { status: "generating", error_message: null });
    setJobDone(false);
    setStatusMsg("Retrying...");
    try {
      await retryThumbnail(thumb.id);
      listen(jobId);
    } catch (err) {
      updateThumb(thumb.style_name, { status: "failed", error_message: err.message });
      setStatusMsg("");
      setJobDone(true);
    }
  }

  // Back to the form with the same topic, so the user can pick another photo
  function handleChooseDifferentPhoto() {
    clearPhoto();
    setThumbnails([]);
    setJobDone(false);
    setJobId(null);
    setStatusMsg("");
    setError("");
  }

  function handleReset() {
    setPrompt("");
    clearPhoto();
    setSource("device");
    setThumbnails([]);
    setJobDone(false);
    setJobId(null);
    setStatusMsg("");
    setError("");
    setNumThumbnails(3);
  }

  const hasFailed = thumbnails.some((t) => t.status === "failed");
  const showForm = !loading && !jobDone && thumbnails.length === 0;

  return (
    <div className="app">
      {/* HEADER */}
      <header className="header">
        <div className="header-tag">AI Powered</div>
        <h1>THUMB<span>MAKER</span></h1>
        <p>Provide your photo and topic — AI will create professional thumbnails for YouTube.</p>
      </header>

      {/* FORM */}
      {showForm && (
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

          {/* Image source */}
          <div className="field">
            <label>Image source</label>
            <div className="source-tabs">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  className={`source-tab ${source === s.id ? "active" : ""}`}
                  onClick={() => handleSourceChange(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Device upload */}
          {source === "device" && (
            <div className="field">
              <label>Your photo (headshot)</label>
              <div className={`upload-zone ${headshotFile ? "has-file" : ""}`}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                />
                {previewUrl ? (
                  <>
                    <img src={previewUrl} alt="preview" className="upload-preview" />
                    <span className="filename">{headshotFile.name}</span>
                    <p>Click to change</p>
                  </>
                ) : (
                  <>
                    <span className="upload-icon">🖼️</span>
                    <p>Click here or drag your photo</p>
                    <p>A clear head-and-shoulders photo — JPG, PNG, WEBP, max 10MB</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Internet link */}
          {source === "internet" && (
            <div className="field">
              <label>Image link</label>
              <div className="link-row">
                <input
                  type="url"
                  className="link-input"
                  placeholder="https://unsplash.com/photos/... or a direct image link"
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCheckLink()}
                />
                <button
                  className="link-btn"
                  onClick={handleCheckLink}
                  disabled={!linkInput.trim() || photo.status === "checking"}
                >
                  Check
                </button>
              </div>
              <div className="disclaimer">
                ⚠️ When using photos from the internet, respect the rights of any person in the photo
                and the policies of platforms (YouTube/OpenAI).
              </div>
              {previewUrl && <img src={previewUrl} alt="preview" className="upload-preview link-preview" />}
            </div>
          )}

          {/* Product only */}
          {source === "none" && (
            <div className="info-msg">
              📦 No photo needed. AI will create a product-focused thumbnail without any person —
              e.g. the product, a luxury box, a price tag, "$$$" text.
            </div>
          )}

          {/* Photo check result */}
          {source !== "none" && photo.status === "checking" && (
            <div className="photo-check checking"><div className="spinner" /> Checking your photo...</div>
          )}
          {source !== "none" && photo.status === "ok" && (
            <div className="photo-check ok">
              ✓ Photo looks good.
              {photo.warnings.map((w, i) => <div key={i} className="photo-warning">⚠️ {w}</div>)}
            </div>
          )}
          {source !== "none" && photo.status === "rejected" && (
            <div className="photo-check rejected">
              ❌ {photo.error}
              <div className="photo-actions">
                <button className="link-action" onClick={clearPhoto}>Choose a different photo</button>
                <button className="link-action" onClick={() => handleSourceChange("none")}>Use product only</button>
              </div>
            </div>
          )}

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

          <button
            className="btn-submit"
            onClick={handleSubmit}
            disabled={loading || (source !== "none" && photo.status !== "ok")}
          >
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

      {!showForm && error && <div className="error-msg results-error">{error}</div>}

      {/* RESULTS */}
      {thumbnails.length > 0 && (
        <div className="results">
          <h2 className="results-title">
            {jobDone ? (hasFailed ? "SOME THUMBNAILS FAILED" : "THUMBNAILS READY! 🎉") : "GENERATING..."}
          </h2>
          <div className="thumbnails-grid">
            {thumbnails.map((t, i) => (
              <ThumbnailCard key={i} thumb={t} onRetry={jobDone ? () => handleRetry(t) : null} />
            ))}
          </div>

          {jobDone && (
            <div className="result-actions">
              {hasFailed && (
                <button className="btn-reset" onClick={handleChooseDifferentPhoto}>
                  ↺ Choose a different photo
                </button>
              )}
              <button className="btn-reset" onClick={handleReset}>
                ← Generate new thumbnails
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThumbnailCard({ thumb, onRetry }) {
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
          <>
            <div className="thumb-error">❌ {thumb.error_message || "Something went wrong."}</div>
            {onRetry && typeof thumb.id === "string" && (
              <button className="retry-btn" onClick={onRetry}>↻ Retry</button>
            )}
          </>
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
