"""
Clara Multi-Agent Backend - Main Application

This is the main entry point for the Clara Multi-Agent system.
It initializes FastAPI, sets up agents (Sales, Marketing, Support),
and provides REST API endpoints for message processing and voice interactions.

Features:
- Sales Agent: Lead management and CRM operations
- Marketing Agent: AI-powered content generation and lead analysis
- Support Agent: Customer support (placeholder)
- Voice Stream: Voice input/output processing

Marketing Agent Endpoints (/api/marketing/*):
- analyze-lead: Get lead temperature and recommendations
- analyze-batch: Batch lead analysis with prioritization
- generate-email: AI-generated email content
- generate-sms: SMS message generation
- generate-call-script: Cold call script generation
- generate-ad-copy: Platform-specific ad copy
- campaign-insights: Campaign performance analytics

@author Sheryar
"""

import asyncio
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uvicorn

from orchestrator.core import get_orchestrator
from agents.sales_agent.agent import SalesAgent
from agents.marketing_agent.agent import MarketingAgent
from agents.support_agent.agent import SupportAgent
from utils.logger import get_logger
from config import settings

# Initialize logger
logger = get_logger("main")

# Initialize FastAPI app
app = FastAPI(
    title="Clara Multi-Agent Backend",
    description="Intelligent multi-agent system for CRM automation",
    version="1.0.0"
)

# Add CORS middleware
# In production set ALLOWED_ORIGINS=https://yourapp.vercel.app (comma-separated)
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances
orchestrator = None
agents = {}
voice_stream = None


# Pydantic models for API
class MessageRequest(BaseModel):
    message: str
    input_channel: str = "voice"
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    conversation_history: Optional[list] = None


class MessageResponse(BaseModel):
    success: bool
    message: str
    agent: str
    metadata: Dict[str, Any]
    actions: list


@app.on_event("startup")
async def startup_event():
    """Initialize system on startup"""
    global orchestrator, agents, voice_stream
    
    try:
        logger.info("🚀 Starting Clara Multi-Agent Backend...")
        
        # Initialize orchestrator
        logger.info("Initializing orchestrator...")
        orchestrator = get_orchestrator()
        
        # Initialize agents
        logger.info("Initializing agents...")
        if settings.SALES_AGENT_ENABLED:
            agents["sales"] = SalesAgent()
            logger.info("✓ Sales Agent initialized")
        
        if settings.SUPPORT_AGENT_ENABLED:
            agents["support"] = SupportAgent()
            logger.info("✓ Support Agent initialized")
        
        if settings.MARKETING_AGENT_ENABLED:
            # Marketing Agent - handles content generation, lead analysis, campaigns
            agents["marketing"] = MarketingAgent()
            logger.info("✓ Marketing Agent initialized")
        
        # Initialize voice stream if enabled (lazy import — pyaudio only on local)
        if settings.VOICE_INPUT_ENABLED:
            logger.info("Initializing voice stream...")
            from input_streams.voice_stream import VoiceStream
            voice_stream = VoiceStream()
            logger.info("✓ Voice stream initialized")
        
        logger.info(f"✨ Clara Backend started successfully on port {settings.ORCHESTRATOR_PORT}")
        logger.info(f"   Environment: {settings.ENVIRONMENT}")
        logger.info(f"   Enabled agents: {orchestrator.get_enabled_agents()}")
        
    except Exception as e:
        logger.error(f"Failed to start application: {e}")
        raise


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down Clara Backend...")
    
    if voice_stream:
        voice_stream.cleanup()


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "app": "Clara Multi-Agent Backend",
        "version": "1.0.0",
        "status": "operational",
        "endpoints": {
            "health": "/health",
            "process_message": "/api/message",
            "voice_interaction": "/api/voice",
            "agent_status": "/api/agents/status",
            "orchestrator_status": "/api/orchestrator/status",
        }
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "orchestrator": "operational" if orchestrator else "not initialized",
        "agents": {
            agent_name: "operational"
            for agent_name in agents.keys()
        }
    }


@app.post("/api/message", response_model=MessageResponse)
async def process_message(request: MessageRequest):
    """
    Process a text message through the orchestrator
    
    Args:
        request: Message request with text and metadata
        
    Returns:
        Agent response
    """
    try:
        logger.info(f"Processing message from {request.input_channel}")
        
        # Process through orchestrator
        processed_message = orchestrator.process_message(
            raw_message=request.message,
            input_channel=request.input_channel,
            user_info={"user_id": request.user_id} if request.user_id else None,
            session_id=request.session_id,
            conversation_history=request.conversation_history
        )
        
        # Route to agent
        agent_response = orchestrator.route_to_agent(processed_message, agents)
        
        if not agent_response.get("success") and agent_response.get("error"):
            raise HTTPException(status_code=500, detail=agent_response.get("error"))
        
        return agent_response
        
    except Exception as e:
        logger.error(f"Error processing message: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/voice")
async def voice_interaction():
    """
    Handle complete voice interaction (single turn)
    
    Captures voice input, processes it, and returns voice output
    """
    try:
        if not voice_stream:
            raise HTTPException(status_code=400, detail="Voice input not enabled")
        
        logger.info("Starting voice interaction...")
        
        # Define callback for processing message
        def process_callback(text: str) -> Dict[str, Any]:
            # Process through orchestrator
            processed = orchestrator.process_message(
                raw_message=text,
                input_channel="voice"
            )
            
            # Route to agent
            response = orchestrator.route_to_agent(processed, agents)
            
            return response
        
        # Execute voice interaction
        result = voice_stream.voice_interaction(process_callback)
        
        return result
        
    except Exception as e:
        logger.error(f"Error in voice interaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/voice/continuous")
async def continuous_voice_interaction(session_id: Optional[str] = None):
    """
    Handle continuous voice interaction
    
    Continues conversation until closing words are detected (goodbye, exit, quit, etc.)
    Maintains conversation context across turns.
    
    Args:
        session_id: Optional session ID to maintain conversation context
    """
    try:
        if not voice_stream:
            raise HTTPException(status_code=400, detail="Voice input not enabled")
        
        logger.info("Starting continuous voice interaction...")
        
        # Use provided session_id or generate one
        if not session_id:
            import uuid
            session_id = f"voice-session-{uuid.uuid4().hex[:8]}"
        
        # Define callback for processing message
        def process_callback(text: str) -> Dict[str, Any]:
            # Process through orchestrator with session_id
            processed = orchestrator.process_message(
                raw_message=text,
                input_channel="voice",
                session_id=session_id
            )
            
            # Route to agent
            response = orchestrator.route_to_agent(processed, agents)
            
            return response
        
        # Execute continuous voice interaction
        result = voice_stream.continuous_voice_interaction(
            process_callback,
            session_id=session_id
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Error in continuous voice interaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agents/status")
async def get_agent_status():
    """Get status of all agents"""
    status = {}
    
    for agent_name, agent in agents.items():
        status[agent_name] = agent.get_agent_status()
    
    return {
        "enabled_agents": list(agents.keys()),
        "agent_details": status
    }


@app.get("/api/orchestrator/status")
async def get_orchestrator_status():
    """Get orchestrator status and statistics"""
    if not orchestrator:
        raise HTTPException(status_code=500, detail="Orchestrator not initialized")
    
    return orchestrator.get_orchestrator_status()


@app.post("/api/test/pipeline")
async def test_pipeline(message: str = "Hello, I'm interested in your product"):
    """Test the complete pipeline with a sample message"""
    try:
        result = orchestrator.test_pipeline(message)
        
        return {
            "test_result": result,
            "pipeline_status": "operational" if result.get("success") else "failed"
        }
        
    except Exception as e:
        logger.error(f"Pipeline test failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/agent/{agent_type}/reset/{session_id}")
async def reset_agent_session(agent_type: str, session_id: str):
    """Reset a specific agent session"""
    if agent_type not in agents:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_type}' not found")
    
    agent = agents[agent_type]
    
    if hasattr(agent, 'reset_session'):
        agent.reset_session(session_id)
        return {"message": f"Session {session_id} reset for {agent_type} agent"}
    else:
        raise HTTPException(status_code=400, detail="Agent does not support session reset")


# =============================================================================
# MARKETING AGENT ROUTES (LangChain + Gemini)
# =============================================================================

# Import and include marketing routes from routes directory
from routes.marketing import router as marketing_router
app.include_router(marketing_router)

# Import and include expanded Ollama-powered marketing hub routes
from routes.marketing_hub import router as marketing_hub_router
app.include_router(marketing_hub_router)


# =============================================================================
# SALES CALL ROUTES (Voice Pipeline Integration)
# =============================================================================

# Import and include sales call routes for AI voice calls
from routes.sales_calls import router as sales_calls_router
app.include_router(sales_calls_router)


# =============================================================================
# SUPPORT AGENT ROUTES (KB + Tickets)
# =============================================================================

try:
    from agents.support_agent.kb_api import router as kb_router
    from agents.support_agent.ticket_api import router as ticket_router
    app.include_router(kb_router)
    app.include_router(ticket_router)
    logger.info("Support Agent routes registered: /api/kb and /api/tickets")
except Exception as e:
    logger.warning(f"Support Agent routes not loaded: {e}")


# =============================================================================
# EMAIL PROXY — Resend API (server-side, no key exposed to browser)
# =============================================================================

class SendEmailRequest(BaseModel):
    to: str
    subject: str
    html: str


@app.post("/api/send-email")
async def send_email_proxy(req: SendEmailRequest):
    """Send email via Resend API server-side."""
    import requests as _req

    api_key = settings.RESEND_API_KEY
    if not api_key:
        raise HTTPException(status_code=500, detail="RESEND_API_KEY is not configured")

    from_email = settings.RESEND_FROM_EMAIL or "onboarding@resend.dev"

    try:
        resp = _req.post(
            "https://api.resend.com/emails",
            json={"from": from_email, "to": req.to, "subject": req.subject, "html": req.html},
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=15,
        )
        data = resp.json()
        if not resp.ok:
            error_msg = data.get("message") or data.get("name") or "Resend API error"
            logger.error(f"Resend error {resp.status_code}: {data}")
            raise HTTPException(status_code=resp.status_code, detail=error_msg)
        logger.info(f"Email sent via Resend → id={data.get('id')} to={req.to}")
        return {"id": data.get("id"), "message": "Email sent successfully"}
    except _req.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Resend API: {e}")


def main():
    """Main entry point"""
    logger.info("="*60)
    logger.info("  CLARA MULTI-AGENT BACKEND")
    logger.info("  Version: 1.0.0")
    logger.info("  Environment: " + settings.ENVIRONMENT)
    logger.info("="*60)
    
    # Run FastAPI app
    uvicorn.run(
        app,
        host=settings.ORCHESTRATOR_HOST,
        port=settings.ORCHESTRATOR_PORT,
        log_level=settings.LOG_LEVEL.lower()
    )


if __name__ == "__main__":
    main()

