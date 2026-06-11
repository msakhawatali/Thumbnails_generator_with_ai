# 🎬 THUMBMAKER

AI-powered YouTube Thumbnail Generator — provide your photo and topic, get professional thumbnails instantly!

<img width="1600" height="900" alt="Screenshot (76)" src="https://github.com/user-attachments/assets/f6256d93-0d51-41d0-a66d-b31c6e473858" />

---

## ✨ Features

- 🤖 Automatic thumbnail generation using AI (FLUX model via OpenAI)
- 🖼️ 3 unique styles — Bold Dramatic, Clean Minimal, Vibrant Energetic
- ☁️ Automatic image hosting via ImageKit
- 📐 3 formats — YouTube (1280×720), Shorts (1080×1920), Square (1080×1080)
- ⚡ Live updates via SSE (Server-Sent Events)
- 🎨 Modern dark UI

---

## 🛠️ Tech Stack

| Part | Technology |
|------|-----------|
| Frontend | React + Vite |
| Backend | Python + FastAPI |
| Database | SQLite |
| Image Generation | FLUX Schnell (OpenRouter) |
| Image Hosting | ImageKit |

---

## 📁 Project Structure

```
THUMBMAKER/
├── backend/
│   ├── main.py                  # FastAPI app entry point
│   ├── routes.py                # API endpoints
│   ├── models.py                # Database models
│   ├── database.py              # DB connection
│   ├── config.py                # Environment variables
│   ├── requirements.txt         # Python dependencies
│   └── services/
│       ├── generator.py         # Style prompts + job processor
│       ├── openai_service.py    # AI image generation
│       └── imagekit_service.py  # Image upload + variants
└── frontend/
    ├── src/
    │   ├── App.jsx              # Main UI
    │   ├── App.css              # Styles
    │   └── api.js               # API calls
    ├── vite.config.js
    └── package.json
```

---

## ⚙️ Setup

### 1. Clone the repository

```bash
git clone https://github.com/msakhawatali/THUMBMAKER.git
cd THUMBMAKER
```

### 2. Backend setup

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# Mac/Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 3. Environment variables

Create a `backend/.env` file:

```dotenv
OPENAI_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxx"
IMAGEKIT_PRIVATE_KEY="private_xxxxxxxxxxxxxxxx"
IMAGEKIT_PUBLIC_KEY="public_xxxxxxxxxxxxxxxx"
IMAGEKIT_URL_ENDPOINT="https://ik.imagekit.io/your_id"
```

### 4. Frontend setup

```bash
cd frontend
npm install
```

---

## 🚀 Running the App

**Terminal 1 — Backend:**
```bash
cd backend
uvicorn main:app --reload
# Runs on http://localhost:8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
```

Open in browser: **http://localhost:5173**

---

## 🔑 API Keys

| Service | Link | Free? |
|---------|------|-------|
| OpenAI | [openai.ai](https://platform.openai.com) | ❌ Requires deposit |
| ImageKit | [imagekit.io](https://imagekit.io) | ✅ Free tier (20GB/month) |

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload-headshot` | Upload headshot photo |
| `POST` | `/api/jobs` | Create a new thumbnail job |
| `GET` | `/api/jobs/{id}/stream` | Live SSE updates |

---

## 🔒 .gitignore

Make sure these files are never pushed to GitHub:

```
backend/.env
backend/.venv/
backend/__pycache__/
backend/*.db
frontend/node_modules/
frontend/dist/
```

---

## 📄 License

MIT License — free to use!
