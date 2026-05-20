import contextvars

from openai import AsyncOpenAI

from app.config import settings


class LLMError(Exception):
    pass


_client: AsyncOpenAI | None = None

# Per-pipeline token usage tracker. Lives on a contextvar so any agent calling `complete()`
# is automatically attributed to the active pipeline without changing call sites.
_token_bucket_var: contextvars.ContextVar[dict | None] = contextvars.ContextVar("token_bucket", default=None)


def install_token_bucket() -> dict:
    """Install a fresh token bucket on the current async context.
    Subsequent `complete()` calls in this context (and tasks copied from it) will accumulate here.
    """
    bucket = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "calls": 0, "by_agent": {}}
    _token_bucket_var.set(bucket)
    return bucket


def current_token_bucket() -> dict | None:
    return _token_bucket_var.get()


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
    return _client


async def complete(system: str, user: str, model: str | None = None, *, agent: str | None = None) -> str:
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
        usage = getattr(response, "usage", None)
        bucket = _token_bucket_var.get()
        if bucket is not None and usage is not None:
            ip = getattr(usage, "prompt_tokens", 0) or 0
            op = getattr(usage, "completion_tokens", 0) or 0
            tt = getattr(usage, "total_tokens", None) or (ip + op)
            bucket["input_tokens"] += ip
            bucket["output_tokens"] += op
            bucket["total_tokens"] += tt
            bucket["calls"] += 1
            if agent:
                a = bucket["by_agent"].setdefault(agent, {"input_tokens": 0, "output_tokens": 0, "calls": 0})
                a["input_tokens"] += ip
                a["output_tokens"] += op
                a["calls"] += 1
        return response.choices[0].message.content or ""
    except Exception as e:
        raise LLMError(f"OpenAI call failed: {e}") from e
