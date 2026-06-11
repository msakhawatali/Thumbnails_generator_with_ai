import logging
from fastapi import FastAPI
from contextlib import asynccontextmanager

from fastapi.middleware.cors import CORSMiddleware
from database import create_tables
from routes import router

@asynccontextmanager
async def lifeshan(app : FastAPI):
    create_tables()
    yield

app = FastAPI(
    title = "YouTube Tumbnail Generator API",
    lifespan = lifeshan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

