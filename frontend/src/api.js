const API_BASE = "/api";

// Error that carries the backend's reason code (e.g. "unsafe", "no_face", "network")
export class ApiError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

async function request(path, options, fallbackMessage) {
    let res;
    try {
        res = await fetch(`${API_BASE}${path}`, options);
    } catch {
        throw new ApiError("Network error: couldn't reach the server. Check your connection and try again.", "network");
    }
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = body?.detail;
        if (detail?.message) throw new ApiError(detail.message, detail.code);
        if (typeof detail === "string") throw new ApiError(detail, "server");
        throw new ApiError(`${fallbackMessage} (server error ${res.status}).`, "server");
    }
    return res.json();
}

export async function uploadHeadshot(file) {
    const form = new FormData();
    form.append("file", file);
    return request("/upload-headshot", { method: "POST", body: form }, "Failed to upload headshot");
}

export async function uploadHeadshotFromUrl(url) {
    const form = new FormData();
    form.append("url", url);
    return request("/upload-headshot", { method: "POST", body: form }, "Failed to fetch image from link");
}

export async function createJob(prompt, numThumbnails, headshotUrl) {
    return request("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            prompt,
            num_thumbnails: numThumbnails,
            headshot_url: headshotUrl,
        }),
    }, "Failed to create job");
}

export async function retryThumbnail(thumbnailId) {
    return request(`/thumbnails/${thumbnailId}/retry`, { method: "POST" }, "Failed to retry thumbnail");
}

export function subscribeJob(jobId, { onThumbnailReady, onThumbnailFailed, onJobCompleted, onError }) {
    const es = new EventSource(`${API_BASE}/jobs/${jobId}/stream`);

    es.addEventListener("thumbnail_ready", (e) => onThumbnailReady(JSON.parse(e.data)));
    es.addEventListener("thumbnail_failed", (e) => onThumbnailFailed(JSON.parse(e.data)));
    es.addEventListener("job_completed", (e) => { onJobCompleted(JSON.parse(e.data)); es.close(); });
    es.addEventListener("error", (e) => { onError(e); es.close(); });

    return es;
}
