import base64
import openai
from openai import AsyncOpenAI

from config import OPENAI_API_KEY

client = AsyncOpenAI(api_key=OPENAI_API_KEY)

async def generate_thumbnail(prompt: str, style_prompt:str, headshop_url: str | None) -> bytes:
    if headshop_url:
        full_prompt = (
            f"{style_prompt}\n\n"
            f"User request: {prompt}\n\n"
            "IMPORTANT: The generated thumbnail Must prominently feature the person "
            "shown in the provided reference headshot photo. Keep their likeness accurate."
        )
        content = [
            {"type": "input_image", "image_url": headshop_url},
            {"type": "input_text", "text": full_prompt}
        ]
    else:
        # Product-only mode: no person at all
        full_prompt = (
            f"{style_prompt}\n\n"
            f"User request: {prompt}\n\n"
            "IMPORTANT: Do NOT include any person, face or body in this thumbnail. "
            "Make it product-focused: show the product or objects from the topic as the hero, "
            "with bold eye-catching text and props such as a luxury box, price tag or \"$$$\"."
        )
        content = [{"type": "input_text", "text": full_prompt}]

    try:
        response = await client.responses.create(
            model="gpt-4o",
            input= [{
                "role": "user",
                "content": content,
            }],
            tools=[
                {
                    "type": "image_generation",
                    "model": "gpt-image-2",
                    "size": "1536x1024",
                    "quality": "high",
                    "output_format": "png",

                    },
                ],
        )
    except openai.RateLimitError:
        raise RuntimeError("OpenAI rate limit or quota reached. Wait a minute and retry, or check your OpenAI billing.")
    except openai.AuthenticationError:
        raise RuntimeError("OpenAI API key is invalid. Check OPENAI_API_KEY in .env.")
    except openai.APIConnectionError:
        raise RuntimeError("Network error: couldn't reach OpenAI. Check your connection and retry.")
    except openai.BadRequestError as e:
        # Includes OpenAI safety system rejections
        message = e.body.get("message") if isinstance(e.body, dict) else None
        raise RuntimeError(f"OpenAI rejected the request: {message or e}")

    for item in response.output:
        if item.type == "image_generation_call" and item.result:
            return base64.b64decode(item.result)

    # No image: surface the model's text reply (usually a refusal) as the error
    if response.output_text:
        raise RuntimeError(f"OpenAI declined to generate this image: \"{response.output_text}\"")
    raise RuntimeError("OpenAI returned no image and no explanation. Please retry.")