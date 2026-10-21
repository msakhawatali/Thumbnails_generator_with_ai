import base64
import ipaddress
import json
import logging
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx

from services.openai_service import client

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


class ValidationError(Exception):
    """Photo was rejected. `code` lets the frontend pick a message, `message` is user facing."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------- downloading images from the internet ----------

def _check_public_host(url: str):
    # Block requests to localhost / private networks (SSRF protection)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValidationError("bad_url", "Please paste a valid http(s) link.")
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        raise ValidationError("bad_url", "That website could not be reached. Check the link.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise ValidationError("bad_url", "That link points to a private address and can't be used.")


async def _get(http: httpx.AsyncClient, url: str) -> httpx.Response:
    # Follow redirects manually so every hop is checked against private hosts
    for _ in range(5):
        _check_public_host(url)
        res = await http.get(url)
        if res.is_redirect:
            url = urljoin(url, res.headers.get("location", ""))
            continue
        return res
    raise ValidationError("bad_url", "That link redirects too many times.")


def _find_og_image(html: str) -> str | None:
    for pattern in (
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
    ):
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return match.group(1).replace("&amp;", "&")
    return None


async def download_image(url: str) -> tuple[bytes, str, str]:
    """Download an image from a direct link or from a page's og:image (e.g. Unsplash pages).
    Returns (bytes, content_type, file_name)."""
    headers = {"User-Agent": "Mozilla/5.0 (THUMBMAKER image fetcher)"}
    try:
        async with httpx.AsyncClient(timeout=15, headers=headers, follow_redirects=False) as http:
            res = await _get(http, url)
            content_type = res.headers.get("content-type", "").split(";")[0].strip().lower()

            if res.status_code == 200 and content_type == "text/html":
                og_image = _find_og_image(res.text)
                if not og_image:
                    raise ValidationError("no_image", "We couldn't find an image on that page. Paste a direct image link instead.")
                url = urljoin(url, og_image)
                res = await _get(http, url)
                content_type = res.headers.get("content-type", "").split(";")[0].strip().lower()
    except httpx.HTTPError as e:
        raise ValidationError("network", f"Couldn't download the image ({type(e).__name__}). Check the link and try again.")

    if res.status_code in (401, 403, 429):
        # Sites like Unsplash put pages behind bot protection
        raise ValidationError(
            "blocked",
            "This website blocks automatic downloads. Right-click the photo, choose \"Copy image address\", "
            "and paste that link instead (or download it and use \"My own photo\").",
        )
    if res.status_code != 200:
        raise ValidationError("network", f"The website returned an error ({res.status_code}) when downloading the image.")
    if content_type not in ALLOWED_TYPES:
        raise ValidationError("bad_type", "That link isn't a JPG, PNG or WEBP image.")
    if len(res.content) > MAX_IMAGE_BYTES:
        raise ValidationError("too_large", "That image is larger than 10MB.")

    ext = content_type.split("/")[1].replace("jpeg", "jpg")
    name = (urlparse(url).path.rsplit("/", 1)[-1] or "internet-photo").split(".")[0][:60]
    return res.content, content_type, f"{name}.{ext}"


# ---------- content checks ----------

VISION_PROMPT = (
    "You check photos that a user wants to use as the person in a YouTube thumbnail. "
    "Do not identify who the person is. Answer only about what is visible:\n"
    "- has_clear_face: exactly one person's face is clearly visible and not heavily covered.\n"
    "- is_head_and_shoulders: the photo is framed roughly from the chest up.\n"
    "- is_revealing: the person wears swimwear, lingerie or underwear, is nude or partly nude, "
    "or shows a lot of exposed skin, or the pose is sexual/suggestive."
)

VISION_SCHEMA = {
    "type": "object",
    "properties": {
        "has_clear_face": {"type": "boolean"},
        "is_head_and_shoulders": {"type": "boolean"},
        "is_revealing": {"type": "boolean"},
    },
    "required": ["has_clear_face", "is_head_and_shoulders", "is_revealing"],
    "additionalProperties": False,
}

UNSAFE_MESSAGE = (
    "This photo doesn't meet our safety rules (revealing clothing or exposed skin). "
    "Please use a normal headshot, or choose \"No person\" for a product-only thumbnail."
)


async def validate_headshot(image_bytes: bytes, content_type: str) -> list[str]:
    """Raise ValidationError if the photo can't be used. Returns a list of non-blocking warnings."""
    if content_type not in ALLOWED_TYPES:
        raise ValidationError("bad_type", "Please use a JPG, PNG or WEBP image.")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValidationError("too_large", "That image is larger than 10MB.")

    data_url = f"data:{content_type};base64,{base64.b64encode(image_bytes).decode()}"

    try:
        moderation = await client.moderations.create(
            model="omni-moderation-latest",
            input=[{"type": "image_url", "image_url": {"url": data_url}}],
        )
        result = moderation.results[0]
        if result.categories.sexual or result.categories.sexual_minors:
            raise ValidationError("unsafe", UNSAFE_MESSAGE)

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": VISION_PROMPT},
                {"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_url, "detail": "low"}}]},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "photo_check", "schema": VISION_SCHEMA, "strict": True},
            },
        )
    except ValidationError:
        raise
    except Exception as e:
        logger.error(f"Photo validation failed: {e}")
        raise ValidationError("check_failed", "We couldn't check this photo right now. Please try again in a moment.")

    message = response.choices[0].message
    if message.refusal or not message.content:
        # The checker itself refused to look at the photo, which is a strong sign it's not safe
        raise ValidationError("unsafe", UNSAFE_MESSAGE)
    checks = json.loads(message.content)

    if checks["is_revealing"]:
        raise ValidationError("unsafe", UNSAFE_MESSAGE)
    if not checks["has_clear_face"]:
        raise ValidationError(
            "no_face",
            "We couldn't find one clear face in this photo. Use a photo where your face is clearly visible.",
        )

    warnings = []
    if not checks["is_head_and_shoulders"]:
        warnings.append("This isn't a head-and-shoulders photo. A close-up headshot usually gives better thumbnails.")
    return warnings
