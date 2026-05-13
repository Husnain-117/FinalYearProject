"""
Global Configuration for Clara Multi-Agent Backend
"""

import os
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Load environment variables — .env.local overrides .env (same as Vite convention)
load_dotenv(".env")
load_dotenv(".env.local", override=True)


class Settings(BaseSettings):
    """Global application settings"""
    
    # ===== Application =====
    APP_NAME: str = "Clara Multi-Agent Backend"
    VERSION: str = "1.0.0"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    
    # ===== Server =====
    ORCHESTRATOR_HOST: str = "0.0.0.0"
    ORCHESTRATOR_PORT: int = 8001
    LOG_LEVEL: str = "INFO"
    
    # ===== LLM API Keys =====
    OPENAI_API_KEY: str = Field(default="")
    GROQ_API_KEY: str = Field(default="")  # Primary - using Groq for LLM
    ANTHROPIC_API_KEY: str = Field(default="")
    GEMINI_API_KEY: str = Field(default="AIzaSyADeYgcwx3_wLr8zNxnQJIV4cMYxT-59CA")  # Google Gemini for marketing content
    CARTESIA_API_KEY: str = Field(default="")  # For TTS
    DEEPGRAM_API_KEY: str = Field(default="")  # Backup for STT/TTS
    ELEVENLABS_API_KEY: str = Field(default="")  # ElevenLabs TTS (primary, fast)
    RESEND_API_KEY: str = Field(default="re_e2bEvcQt_HJAUKNzFBRywFL9UgY5aDNhP")  # Resend email service
    RESEND_FROM_EMAIL: str = Field(default="onboarding@resend.dev")  # Sender address (use verified domain for arbitrary recipients)
    
    # ===== Supabase =====
    SUPABASE_URL: str = Field(default="")
    SUPABASE_ANON_KEY: str = Field(default="")
    SUPABASE_SERVICE_KEY: str = Field(default="")
    SUPABASE_KEY: str = Field(default="")  # Alternative key name for compatibility
    
    # ===== Ollama Configuration (Local LLM) =====
    OLLAMA_API_URL: str = Field(default="http://localhost:11434/api/chat")
    OLLAMA_MODEL_NAME: str = Field(default="llama3.1")
    
    # ===== Agent Configuration =====
    SALES_AGENT_ENABLED: bool = True
    SUPPORT_AGENT_ENABLED: bool = False
    MARKETING_AGENT_ENABLED: bool = True  # Enabled for Marketing Hub integration
    
    # LLM Models (using Groq Llama 3.3 70B - Latest)
    SALES_AGENT_MODEL: str = "llama-3.3-70b-versatile"  # Groq 70B (newest model)
    SUPPORT_AGENT_MODEL: str = "llama-3.3-70b-versatile"
    MARKETING_AGENT_MODEL: str = "llama-3.3-70b-versatile"
    
    # ===== Classification =====
    CLASSIFICATION_CONFIDENCE_THRESHOLD: float = 0.75
    DEFAULT_AGENT: str = "sales"
    
    # ===== Voice Integration (matching Verbi configuration) =====
    VOICE_INPUT_ENABLED: bool = True
    STT_MODEL: str = "groq"  # Using Groq Whisper for transcription
    TTS_MODEL: str = "elevenlabs"  # Using ElevenLabs TTS (primary, streaming) with Piper fallback
    
    # ===== Email Integration =====
    EMAIL_INPUT_ENABLED: bool = False
    IMAP_SERVER: str = "imap.gmail.com"
    IMAP_PORT: int = 993
    EMAIL_ADDRESS: str = ""
    EMAIL_PASSWORD: str = ""
    
    # ===== Chatbot Integration =====
    CHATBOT_INPUT_ENABLED: bool = False
    CHATBOT_WEBHOOK_URL: str = ""
    
    # ===== Database =====
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20
    
    # ===== Logging =====
    LOG_FILE_PATH: str = "logs/clara-backend.log"
    LOG_ROTATION: str = "10 MB"
    LOG_RETENTION: str = "30 days"
    
    # ===== Rate Limiting =====
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_PERIOD: int = 60
    
    # ===== Testing =====
    TEST_MODE: bool = False
    MOCK_CRM_RESPONSES: bool = False
    
    class Config:
        env_file = (".env", ".env.local")  # .env.local wins (last file has highest priority)
        case_sensitive = True
        extra = "ignore"


# Global settings instance
settings = Settings()


# Helper functions
def get_agent_model(agent_type: str) -> str:
    """Get the LLM model for a specific agent"""
    models = {
        "sales": settings.SALES_AGENT_MODEL,
        "support": settings.SUPPORT_AGENT_MODEL,
        "marketing": settings.MARKETING_AGENT_MODEL,
    }
    return models.get(agent_type, "gpt-4-turbo-preview")


def is_agent_enabled(agent_type: str) -> bool:
    """Check if an agent is enabled"""
    enabled_map = {
        "sales": settings.SALES_AGENT_ENABLED,
        "support": settings.SUPPORT_AGENT_ENABLED,
        "marketing": settings.MARKETING_AGENT_ENABLED,
    }
    return enabled_map.get(agent_type, False)


def get_api_key(service: str) -> str:
    """Get API key for a service"""
    keys = {
        "openai": settings.OPENAI_API_KEY,
        "groq": settings.GROQ_API_KEY,
        "anthropic": settings.ANTHROPIC_API_KEY,
        "gemini": settings.GEMINI_API_KEY,  # Google Gemini API for marketing content
    }
    return keys.get(service, "")

