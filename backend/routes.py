import os
import logging
import asyncio
import json


from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from database import get_session
from models import Job, Thumbnail

from services.generator import process_job, retry_thumbnail, STYLE_ORDER
from services.validation_service import validate_headshot, download_image, ValidationError
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
    headshot_url: str | None = None  # None/empty = product-only thumbnail (no person)

class CreateJobResponse(BaseModel):
    job_id: str

class ThumbnailsResponse(BaseModel):
    id : str
    style_name : str
    status : str
    imagekit_url : str | None = None
    error_message : str | None = None 
    variants : dict | None = None

class JobResponse(BaseModel):
    id : str
    prompt : str
    num_thumbnails : int
    headshot_url : str
    status : str
    thumbnails : list[ThumbnailsResponse]

@router.post("/upload-headshot")
async def upload_headshot(file: UploadFile | None = File(None), url: str | None = Form(None)):
    # Accepts either a device upload (`file`) or an internet image link (`url`).
    # The photo is validated before it is uploaded to ImageKit.
    try:
        if file is not None:
            contents = await file.read()
            content_type = file.content_type or "image/png"
            file_name = file.filename or "headshot.jpg"
        elif url and url.strip():
            contents, content_type, file_name = await download_image(url.strip())
        else:
            raise ValidationError("missing", "Choose a photo or paste an image link.")

        warnings = await validate_headshot(contents, content_type)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail={"code": e.code, "message": e.message})

    try:
        uploaded_url = upload_file(
            file_bytes=contents,
            file_name=file_name,
            folder="/headshots",
            content_type=content_type,
        )
    except Exception as e:
        logger.error(f"ImageKit upload failed: {e}")
        raise HTTPException(status_code=502, detail={"code": "upload_failed", "message": "Couldn't save the photo to image hosting. Please try again."})

    if url and file is None:
        warnings.append(
            "This photo is from the internet. If it shows a real, identifiable person who isn't you, "
            "make sure you have their permission. OpenAI may refuse to generate their likeness."
        )
    return {"url": uploaded_url, "warnings": warnings}


@router.post("/jobs", response_model=CreateJobResponse)
async def create_job(request: CreateJobRequest, session: Session = Depends(get_session)):
    if request.num_thumbnails < 1 or request.num_thumbnails > 3:
        raise HTTPException(status_code=400, detail="num_thumbnails must be between 1 and 3")
    
    job = Job(
        prompt=request.prompt,
        num_thumbnails=request.num_thumbnails,
        headshot_url=request.headshot_url or "",
    )
    session.add(job)
    
    styles = STYLE_ORDER[:request.num_thumbnails]
    for style in styles:
        thumb = Thumbnail(job_id=job.id, style_name=style)
        session.add(thumb)

    session.commit()

    # Fire and forget style generation
    asyncio.create_task(process_job(job.id))

    return CreateJobResponse(job_id=job.id)  

@router.post("/thumbnails/{thumbnail_id}/retry", response_model=CreateJobResponse)
async def retry_failed_thumbnail(thumbnail_id: str, session: Session = Depends(get_session)):
    thumb = session.get(Thumbnail, thumbnail_id)
    if not thumb:
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    if thumb.status != "failed":
        raise HTTPException(status_code=400, detail="Only failed thumbnails can be retried")

    # Mark as generating now so the SSE stream doesn't report the job as done
    thumb.status = "generating"
    thumb.error_message = None
    session.add(thumb)
    session.commit()

    asyncio.create_task(retry_thumbnail(thumbnail_id))
    return CreateJobResponse(job_id=thumb.job_id)

@router.get("/job/{job_id}", response_model=JobResponse)
async def get_job(job_id: str, session : Session = Depends(get_session)):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    thumbnails = session.exec(select(Thumbnail).where(Thumbnail.job_id == job_id)).all()

    thumb_response =[]
    for t in thumbnails:
        veriants = get_variants(t.imagekit_url) if t.imagekit_url else None
        thumb_response.append(
            ThumbnailsResponse(
                id = t.id,
                style_name = t.style_name,
                status = t.status,
                imagekit_url = t.imagekit_url,
                error_message = t.error_message,
                variants = veriants
            )
        )

    return  JobResponse (
        id = job.id,
        prompt = job.prompt,
        num_thumbnails = job.num_thumbnails,
        headshot_url = job.headshot_url,
        status = job.status,
        thumbnails = thumb_response
    )

@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id : str):
    async def event_generator():
        from database import engine
        sent_thumbnails = set()

        while True:
            with Session(engine) as session:
                job = session.get(Job, job_id)
                if not job:
                    data = json.dumps({"error": "Job not found"})
                    yield f"event: error\ndata: {data}\n\n"
                    return
                thumbnails = session.exec(
                    select(Thumbnail).where(Thumbnail.job_id == job_id)
                ).all()

                for t in thumbnails:
                    if t.id in sent_thumbnails:
                        continue
                    if t.status == "uploaded":
                        varitants = get_variants(t.imagekit_url)
                        data = json.dumps({
                            "thumbnail_id" : t.id,
                            "style_name" : t.style_name,
                            "imagekit_url" : t.imagekit_url,
                            "variants" : varitants
                        })

                        yield f"event: thumbnail_ready\ndata: {data}\n\n"
                        sent_thumbnails.add(t.id)
                    elif t.status == "failed":
                        data = json.dumps({
                            "thumbnail_id" : t.id,
                            "style_name" : t.style_name,
                            "error" : t.error_message
                        })
                        yield f"event: thumbnail_failed\ndata: {data}\n\n"
                        sent_thumbnails.add(t.id)
                all_done = all(t.status in ("uploaded", "failed") for t in thumbnails)
                if all_done and len(sent_thumbnails) == len(thumbnails):
                    data = json.dumps({"job_id": job_id, "status": job.status})
                    yield f"event: job_completed\ndata: {data}\n\n"
                    return
            
            await asyncio.sleep(1.5)
    
    return StreamingResponse(
        event_generator(), 
        media_type="text/event-stream",
        headers = {
            "Cache-Control" : "no-cache",
            "Connection" : "keep-alive",
            "X-Accel-Buffering" : "no",
        }
    )