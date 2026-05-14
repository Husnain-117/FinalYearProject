"""
Sales Call API Routes
REST API endpoints for AI-powered voice sales calls

@author Faheem
"""

import asyncio
import requests as http_requests

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, Dict, Any

from services.voice_call_service import get_voice_call_service
from utils.logger import get_logger
from config import settings

logger = get_logger("sales_calls_api")

router = APIRouter(prefix="/api/sales/calls", tags=["Sales Calls"])


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================

class StartCallRequest(BaseModel):
    """Request to start a new call"""
    lead_id: Optional[str] = None


class TTSRequest(BaseModel):
    """Request to convert text to speech"""
    text: str


class MessageRequest(BaseModel):
    """Send a transcribed user message to an active call session (production mode).

    In production the browser captures audio via Web Speech API and sends
    the transcribed text here. The backend processes it through the LLM and
    returns the AI reply text; the frontend then calls /tts to synthesise audio.
    """
    text: str


class StartCallResponse(BaseModel):
    """Response after starting a call"""
    success: bool
    session_id: Optional[str] = None
    message: str


class CallStatusResponse(BaseModel):
    """Response with call status"""
    success: bool
    session_id: str
    status: str
    duration: int
    qualification_status: str
    lead_score: int
    bant: Dict[str, str]
    transcript: list
    total_turns: int


class EndCallResponse(BaseModel):
    """Response after ending a call"""
    success: bool
    session_id: str
    summary: Dict[str, Any]


# =============================================================================
# API ENDPOINTS
# =============================================================================


@router.post("/tts")
async def text_to_speech(request: TTSRequest):
    """Convert text to speech using ElevenLabs API and return MP3 audio"""
    try:
        api_key = settings.ELEVENLABS_API_KEY
        if not api_key:
            raise HTTPException(status_code=503, detail="ElevenLabs API key not configured")

        resp = http_requests.post(
            "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM",
            headers={
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": api_key,
            },
            json={
                "text": request.text,
                "model_id": "eleven_turbo_v2_5",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            },
            timeout=30,
        )
        resp.raise_for_status()
        return Response(content=resp.content, media_type="audio/mpeg")
    except http_requests.RequestException as e:
        logger.error(f"ElevenLabs TTS error: {e}")
        raise HTTPException(status_code=503, detail=f"ElevenLabs API error: {str(e)}")


@router.post("/start", response_model=StartCallResponse)
async def start_call(request: StartCallRequest):
    """
    Start a new AI voice call session
    
    This initializes the voice pipeline and starts listening for user input.
    The call continues until the user says "goodbye" or the call is ended via API.
    
    Args:
        request: Contains optional lead_id to associate with the call
        
    Returns:
        Session ID and instructions
    """
    try:
        logger.info(f"Starting new call. Lead ID: {request.lead_id}")
        
        service = get_voice_call_service()
        
        # Create session
        session = service.create_session(lead_id=request.lead_id)
        
        # Start the call
        result = service.start_call(session.session_id)
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to start call"))
        
        return StartCallResponse(
            success=True,
            session_id=session.session_id,
            message=result.get("message", "Call started")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting call: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{session_id}/status")
async def get_call_status(session_id: str):
    """
    Get current status of a call session
    
    Returns real-time information about:
    - Call status (active, completed, etc.)
    - Current duration
    - Lead qualification status
    - Lead score
    - BANT assessment
    - Recent transcript
    
    Args:
        session_id: The call session ID
        
    Returns:
        Current call status and metadata
    """
    try:
        service = get_voice_call_service()
        result = service.get_call_status(session_id)
        
        if not result["success"]:
            raise HTTPException(status_code=404, detail=result.get("error", "Session not found"))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting call status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/message")
async def send_message(session_id: str, request: MessageRequest):
    """
    Send a transcribed user message to an active call session.
    Used in production mode where the frontend handles mic/STT.
    
    Returns the AI response text, which the frontend can then TTS.
    """
    try:
        service = get_voice_call_service()
        session = service.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        if session.status != "active":
            raise HTTPException(status_code=400, detail="Call is not active")

        # Invoke the callback we stored in run_voice_call
        if not hasattr(session, "_process_callback") or not callable(session._process_callback):
            raise HTTPException(status_code=500, detail="Session not configured for message processing")
            
        result = session._process_callback(request.text)
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending message: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{session_id}/end")
async def end_call(session_id: str):
    """
    End an active call session
    
    Stops the voice pipeline and returns a summary of the call including:
    - Total duration
    - Final qualification status
    - Lead score
    - BANT assessment
    - Full transcript
    
    Args:
        session_id: The call session ID
        
    Returns:
        Call summary with all collected data
    """
    try:
        logger.info(f"Ending call: {session_id}")
        
        service = get_voice_call_service()
        result = service.end_call(session_id)
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result.get("error", "Failed to end call"))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error ending call: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sessions")
async def list_sessions():
    """
    List all call sessions
    
    Returns a list of all call sessions (active and completed)
    """
    try:
        service = get_voice_call_service()
        sessions = service.get_all_sessions()
        
        return {
            "success": True,
            "sessions": sessions,
            "total": len(sessions)
        }
        
    except Exception as e:
        logger.error(f"Error listing sessions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{session_id}")
async def cleanup_session(session_id: str):
    """
    Clean up a call session
    
    Removes the session from memory
    """
    try:
        service = get_voice_call_service()
        service.cleanup_session(session_id)
        
        return {
            "success": True,
            "message": f"Session {session_id} cleaned up"
        }
        
    except Exception as e:
        logger.error(f"Error cleaning up session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check():
    """
    Health check for the sales call service
    
    Verifies that all components are initialized and ready
    """
    try:
        service = get_voice_call_service()
        
        # Run blocking initialization in a thread-pool so we never stall the event loop.
        # Without this, concurrent page-load requests (health + stats + history) would
        # cause connection resets that the browser surfaces as CORS null errors.
        loop = asyncio.get_event_loop()
        components_ready = await loop.run_in_executor(None, service.initialize_components)
        
        return {
            "success": True,
            "status": "healthy" if components_ready else "degraded",
            "components": {
                "orchestrator": service._orchestrator is not None,
                "sales_agent": "sales" in service._agents,
                "voice_stream": service._voice_stream is not None
            },
            "stt_model": settings.STT_MODEL,
            "tts_model": settings.TTS_MODEL,
            "llm_model": "llama-3.3-70b-versatile"
        }
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "success": False,
            "status": "unhealthy",
            "error": str(e)
        }


# =============================================================================
# CRM DATA ENDPOINTS - For Sales Hub Dashboard
# =============================================================================

@router.get("/history")
async def get_call_history(limit: int = 50):
    """
    Get AI call history from CRM database
    
    Returns a list of recent AI calls with lead information for the Sales Hub
    
    Args:
        limit: Maximum number of calls to return (default 50)
        
    Returns:
        List of call records with lead info
    """
    try:
        from crm_integration.calls_api import CallsAPI
        
        calls_api = CallsAPI()
        calls = calls_api.list_ai_calls(limit=limit)
        
        return {
            "success": True,
            "calls": calls,
            "total": len(calls)
        }
        
    except Exception as e:
        logger.error(f"Error getting call history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statistics")
async def get_call_statistics():
    """
    Get AI call statistics for Sales Hub dashboard
    
    Returns aggregated statistics including:
    - Total calls
    - Average duration
    - Success rate
    - Qualification rate
    - Calls by day
    - Outcome breakdown
    
    Returns:
        Statistics dictionary
    """
    try:
        from crm_integration.calls_api import CallsAPI
        
        calls_api = CallsAPI()
        stats = calls_api.get_ai_call_statistics()
        
        return {
            "success": True,
            **stats
        }
        
    except Exception as e:
        logger.error(f"Error getting call statistics: {e}")
        raise HTTPException(status_code=500, detail=str(e))
