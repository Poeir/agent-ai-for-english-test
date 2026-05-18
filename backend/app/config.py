from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://english_test:secret@localhost:5432/english_test"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    environment: str = "development"
    secret_key: str = "change-me"
    judge_pass_threshold: float = 7.0
    max_revision_loops: int = 3


settings = Settings()
