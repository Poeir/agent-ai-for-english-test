from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://english_test:secret@localhost:5432/english_test"
    openai_api_key: str = ""
    openai_base_url: str = "https://gen.ai.kku.ac.th/api/v1"
    openai_model: str = "gemini-2.5-flash-lite"
    environment: str = "development"
    secret_key: str = "change-me"
    judge_pass_threshold: float = 7.0
    max_revision_loops: int = 1
    cefr_mastery_threshold: float = 0.7
    llm_json_repair_enabled: bool = False
    # Verifier self-consistency: number of blind-solver passes per pipeline run.
    # 2 = cheaper (default), 3 = more robust against single-sample noise.
    verifier_k_samples: int = 2
    # Skip the multi-answer detector when all k solver votes agree AND the average
    # confidence is at least this value (cheap-path for clearly-correct items).
    verifier_multianswer_confidence_skip: float = 0.85


settings = Settings()
