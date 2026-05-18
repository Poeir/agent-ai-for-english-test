from openai import AsyncOpenAI

from app.config import settings


class LLMError(Exception):
    pass


_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def complete(system: str, user: str, model: str | None = None) -> str:
    client = get_client()
    target_model = model or settings.openai_model
    try:
        response = await client.chat.completions.create(
            model=target_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.7,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        raise LLMError(f"OpenAI call failed: {e}") from e
