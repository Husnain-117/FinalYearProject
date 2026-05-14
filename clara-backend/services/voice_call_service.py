"""
Voice Call Service - Manages AI voice call sessions
Provides API interface for the voice pipeline

@author Faheem
"""

import asyncio
import uuid
import threading
import time
from typing import Dict, Any, Optional, Callable
from datetime import datetime
from enum import Enum

from utils.logger import get_logger
from config import settings

logger = get_logger("voice_call_service")


class CallStatus(str, Enum):
    """Call status enum"""
    IDLE = "idle"
    CONNECTING = "connecting"
    ACTIVE = "active"
    ENDING = "ending"
    COMPLETED = "completed"
    FAILED = "failed"


class CallSession:
    """Represents an active voice call session"""
    
    def __init__(self, session_id: str, lead_id: Optional[str] = None):
        self.session_id = session_id
        self.lead_id = lead_id
        self.status = CallStatus.IDLE
        self.start_time: Optional[datetime] = None
        self.end_time: Optional[datetime] = None
        self.duration: int = 0
        self.transcript: list = []
        self.qualification_status = "unqualified"
        self.lead_score = 0
        self.bant = {
            "budget": "unknown",
            "authority": "unknown",
            "need": "unknown",
            "timeline": "unknown"
        }
        self.metadata: Dict[str, Any] = {}
        self._thread: Optional[threading.Thread] = None
        self._stop_requested = False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert session to dictionary"""
        return {
            "session_id": self.session_id,
            "lead_id": self.lead_id,
            "status": self.status.value,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "duration": self.duration,
            "transcript": self.transcript,
            "qualification_status": self.qualification_status,
            "lead_score": self.lead_score,
            "bant": self.bant,
            "metadata": self.metadata
        }


class VoiceCallService:
    """
    Service for managing AI voice calls
    
    This service provides an API interface to the voice pipeline,
    allowing the frontend to start, monitor, and end voice calls.
    """
    
    _instance = None
    
    def __new__(cls):
        """Singleton pattern"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        """Initialize the voice call service"""
        if self._initialized:
            return
        
        self._sessions: Dict[str, CallSession] = {}
        self._orchestrator = None
        self._agents = {}
        self._voice_stream = None
        self._initialized = True
        
        logger.info("VoiceCallService initialized")
    
    def initialize_components(self):
        """Initialize orchestrator, agents, and voice stream.

        VoiceStream (pyaudio) is only imported when VOICE_INPUT_ENABLED=true.
        On Render (production) pyaudio is not installed, so we skip it entirely
        and rely on the browser-side microphone + /api/sales/calls/tts endpoint.
        """
        try:
            from orchestrator.core import get_orchestrator
            from agents.sales_agent.agent import SalesAgent

            if self._orchestrator is None:
                self._orchestrator = get_orchestrator()
                logger.info("Orchestrator initialized")

            if "sales" not in self._agents and settings.SALES_AGENT_ENABLED:
                self._agents["sales"] = SalesAgent()
                logger.info("Sales Agent initialized")

            if "support" not in self._agents and settings.SUPPORT_AGENT_ENABLED:
                from agents.support_agent.agent import SupportAgent
                self._agents["support"] = SupportAgent()
                logger.info("Support Agent initialized")

            if "marketing" not in self._agents and settings.MARKETING_AGENT_ENABLED:
                from agents.marketing_agent.agent import MarketingAgent
                self._agents["marketing"] = MarketingAgent()
                logger.info("Marketing Agent initialized")

            # Only initialize microphone stream when running locally (pyaudio required)
            if self._voice_stream is None and settings.VOICE_INPUT_ENABLED:
                from input_streams.voice_stream import VoiceStream
                self._voice_stream = VoiceStream()
                logger.info("Voice Stream initialized (local mic)")
            elif not settings.VOICE_INPUT_ENABLED:
                logger.info("Voice Stream skipped — VOICE_INPUT_ENABLED=false (production mode)")

            return True

        except Exception as e:
            logger.error(f"Failed to initialize components: {e}")
            return False
    
    def create_session(self, lead_id: Optional[str] = None) -> CallSession:
        """Create a new call session"""
        session_id = f"call-{uuid.uuid4().hex[:12]}"
        session = CallSession(session_id, lead_id)
        self._sessions[session_id] = session
        logger.info(f"Created call session: {session_id}")
        return session
    
    def get_session(self, session_id: str) -> Optional[CallSession]:
        """Get session by ID"""
        return self._sessions.get(session_id)
    
    def get_all_sessions(self) -> list:
        """Get all sessions"""
        return [s.to_dict() for s in self._sessions.values()]
    
    def start_call(self, session_id: str) -> Dict[str, Any]:
        """
        Start a voice call session
        
        This runs the voice pipeline in a background thread
        """
        session = self.get_session(session_id)
        if not session:
            return {"success": False, "error": "Session not found"}
        
        if session.status != CallStatus.IDLE:
            return {"success": False, "error": f"Session is already {session.status.value}"}
        
        # Initialize components if needed
        if not self.initialize_components():
            return {"success": False, "error": "Failed to initialize voice components"}
        
        # Start the call in a background thread
        session.status = CallStatus.CONNECTING
        session.start_time = datetime.utcnow()
        session._stop_requested = False
        
        def run_voice_call():
            """Run the voice call in background"""
            try:
                session.status = CallStatus.ACTIVE
                logger.info(f"Call {session_id} is now active")

                # Add welcome greeting so frontend plays it immediately via ElevenLabs TTS
                greeting = (
                    "Hello! Welcome to TrendtialCRM. I'm Clara, your AI sales assistant. "
                    "How can I help you today?"
                )
                session.transcript.append({
                    "role": "ai",
                    "text": greeting,
                    "timestamp": datetime.utcnow().isoformat()
                })
                logger.info("Welcome greeting added to transcript")

                # ── Process callback (used by both local mic loop and production REST mode) ──
                def process_callback(text: str) -> Dict[str, Any]:
                    """Process transcribed text through the pipeline"""
                    if session._stop_requested:
                        return {"message": "Call ending...", "success": True}

                    try:
                        session.transcript.append({
                            "role": "user",
                            "text": text,
                            "timestamp": datetime.utcnow().isoformat()
                        })

                        processed = self._orchestrator.process_message(
                            raw_message=text,
                            input_channel="voice",
                            session_id=session_id
                        )

                        response = self._orchestrator.route_to_agent(processed, self._agents)
                        if not response.get("success", True) and "not initialized" in response.get("error", ""):
                            logger.warning(
                                f"Falling back to sales agent "
                                f"(original target: {processed.get('routing', {}).get('target_agent')})"
                            )
                            processed["routing"]["target_agent"] = "sales"
                            response = self._orchestrator.route_to_agent(processed, self._agents)

                        metadata = response.get("metadata", {})
                        if metadata.get("qualification_status"):
                            session.qualification_status = metadata["qualification_status"]
                        if metadata.get("lead_score") is not None:
                            session.lead_score = metadata["lead_score"]
                        if metadata.get("bant_assessment"):
                            session.bant = metadata["bant_assessment"]

                        session.transcript.append({
                            "role": "ai",
                            "text": response.get("message", ""),
                            "timestamp": datetime.utcnow().isoformat()
                        })

                        session.metadata = metadata
                        return response

                    except Exception as e:
                        logger.error(f"Error processing message: {e}")
                        return {"message": "I apologize, there was an error.", "success": False}

                # Store callback on session so REST endpoints can invoke it
                session._process_callback = process_callback

                if self._voice_stream is not None:
                    # ── LOCAL DEV: microphone capture loop ──────────────────────────
                    logger.info("Voice listening loop started (local mic mode)")
                    # Brief pause so frontend can play the greeting first
                    time.sleep(5)
                    while not session._stop_requested:
                        try:
                            transcribed_text = self._voice_stream.capture_voice_input()
                            if session._stop_requested:
                                break
                            if not transcribed_text:
                                continue
                            if self._voice_stream._is_closing_word(transcribed_text):
                                logger.info("Closing words detected — ending call")
                                break
                            process_callback(transcribed_text)
                        except Exception as loop_err:
                            if session._stop_requested:
                                break
                            logger.error(f"Voice loop error: {loop_err}")
                            continue
                else:
                    # ── PRODUCTION: browser-driven mode ────────────────────────────
                    # The frontend captures audio via the browser's Web Speech API,
                    # sends text to POST /api/sales/calls/{session_id}/message,
                    # and plays TTS via GET /api/sales/calls/tts.
                    # This thread simply keeps the session ACTIVE until /end is called.
                    logger.info("Voice session active (production/browser mode — awaiting frontend input)")
                    while not session._stop_requested:
                        time.sleep(1)

                # Call completed
                session.status = CallStatus.COMPLETED
                session.end_time = datetime.utcnow()
                if session.start_time:
                    session.duration = int((session.end_time - session.start_time).total_seconds())

                logger.info(f"Call {session_id} completed. Duration: {session.duration}s")

            except Exception as e:
                logger.error(f"Error in voice call {session_id}: {e}")
                session.status = CallStatus.FAILED
                session.metadata["error"] = str(e)

        # Start background thread
        session._thread = threading.Thread(target=run_voice_call, daemon=True)
        session._thread.start()

        return {
            "success": True,
            "session_id": session_id,
            "message": "Call started. Speak into your microphone."
        }
    
    def end_call(self, session_id: str) -> Dict[str, Any]:
        """End an active call session"""
        session = self.get_session(session_id)
        if not session:
            return {"success": False, "error": "Session not found"}
        
        if session.status not in [CallStatus.ACTIVE, CallStatus.CONNECTING]:
            return {"success": False, "error": f"Call is not active (status: {session.status.value})"}
        
        # Request stop
        session._stop_requested = True
        session.status = CallStatus.ENDING
        
        # Clean up voice stream
        if self._voice_stream:
            self._voice_stream.cleanup()
        
        # Calculate duration
        session.end_time = datetime.utcnow()
        if session.start_time:
            session.duration = int((session.end_time - session.start_time).total_seconds())
        
        session.status = CallStatus.COMPLETED
        
        logger.info(f"Call {session_id} ended manually. Duration: {session.duration}s")
        
        return {
            "success": True,
            "session_id": session_id,
            "summary": {
                "duration": session.duration,
                "qualification_status": session.qualification_status,
                "lead_score": session.lead_score,
                "bant": session.bant,
                "transcript_turns": len(session.transcript),
                "transcript": session.transcript
            }
        }
    
    def get_call_status(self, session_id: str) -> Dict[str, Any]:
        """Get current status of a call"""
        session = self.get_session(session_id)
        if not session:
            return {"success": False, "error": "Session not found"}
        
        # Calculate current duration if active
        duration = session.duration
        if session.status == CallStatus.ACTIVE and session.start_time:
            duration = int((datetime.utcnow() - session.start_time).total_seconds())
        
        return {
            "success": True,
            "session_id": session_id,
            "status": session.status.value,
            "duration": duration,
            "qualification_status": session.qualification_status,
            "lead_score": session.lead_score,
            "bant": session.bant,
            "transcript": session.transcript[-10:],  # Last 10 messages
            "total_turns": len([t for t in session.transcript if t["role"] == "user"])
        }
    
    def cleanup_session(self, session_id: str):
        """Clean up a session"""
        if session_id in self._sessions:
            session = self._sessions[session_id]
            session._stop_requested = True
            del self._sessions[session_id]
            logger.info(f"Cleaned up session: {session_id}")


# Singleton instance
_voice_call_service: Optional[VoiceCallService] = None


def get_voice_call_service() -> VoiceCallService:
    """Get the voice call service instance"""
    global _voice_call_service
    if _voice_call_service is None:
        _voice_call_service = VoiceCallService()
    return _voice_call_service

