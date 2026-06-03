import os
import logging

from fastapi import APIRouter, HTTPException, Depends, Uploadedfile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models import Job, Thumbnail

from services.generator import process_job, STYLE_ORDER
from services.imagekit_service import upload_file, get_variants

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api",
    tags=["api"],
)

# request and response schemas

class CreateJobRequest(BaseModel):
    prompt: str
    num_thumbnails: int 
    headshot_url: str

class CreateJobResponse(BaseModel):
    job_id: str

class ThumbnailsResponse(BaseModel):
    id : int
    style_name : str
    status : str
    imagekit_url : str | None = None
    error_message : str | None = None 
    variants : dict | None = None