"""
Voice Stream - Integrate voice input with orchestrator
Owner: Faheem
"""

import sys
import os
from typing import Dict, Any, Optional, Callable
from pathlib import Path

# Add parent directory to path to import from Verbi
verbi_path = Path(__file__).parent.parent.parent / "Verbi"
sys.path.insert(0, str(verbi_path))

from voice_assistant.transcription import transcribe_audio
from voice_assistant.text_to_speech import text_to_speech
from voice_assistant.audio import record_audio, play_audio
from voice_assistant.config import Config as VerbiConfig
from voice_assistant.interruption_handler import get_interruption_handler
from voice_assistant.vad_detector import VADDetector

from utils.logger import get_logger
from config import settings

logger = get_logger("voice_stream")


class VoiceStream:
    """
    Voice stream handler - integrates voice I/O with orchestrator
    
    Handles:
    - Audio recording
    - Speech-to-Text conversion
    - Text-to-Speech synthesis
    - Audio playback
    """
    
    def __init__(self):
        """Initialize voice stream"""
        self.input_audio_path = "voice_input.wav"
        self.output_audio_path = "voice_output.wav"
        
        # Determine TTS output format (Cartesia uses streaming, others use files)
        if settings.TTS_MODEL in ['openai', 'melotts']:
            self.output_audio_path = "voice_output.mp3"
        elif settings.TTS_MODEL == 'cartesia':
            self.output_audio_path = "voice_output.wav"
        elif settings.TTS_MODEL == 'elevenlabs':
            self.output_audio_path = "voice_output.mp3"
        
        # Initialize interruption handling (only for Cartesia streaming TTS)
        self.interrupt_handler = None
        self.vad_detector = None
        
        if settings.TTS_MODEL == 'cartesia':
            self.interrupt_handler = get_interruption_handler()
            # Initialize VAD detector with more sensitive settings for easier interruption
            # Lower aggressiveness = more sensitive (detects softer speech)
            # Lower speech_frames_threshold = faster detection
            # Lower energy_threshold = more sensitive to speech
            self.vad_detector = VADDetector(
                sample_rate=16000,
                frame_duration_ms=30,
                aggressiveness=1,  # More sensitive (was 3) - detects softer speech
                speech_frames_threshold=5,  # Faster interruption (was 8) - detects speech sooner
                energy_threshold=300  # Lower threshold (was 500) - more sensitive
            )
            logger.info(f"Interruption handling enabled for {settings.TTS_MODEL} TTS (sensitive mode)")
        
        logger.info("Voice stream initialized")
        logger.info(f"STT Model: {settings.STT_MODEL}")
        logger.info(f"TTS Model: {settings.TTS_MODEL}")
    
    def capture_voice_input(self) -> Optional[str]:
        """
        Capture voice input and convert to text
        
        Returns:
            Transcribed text or None if failed
        """
        try:
            logger.info("Recording audio...")
            
            # Record audio using Verbi's audio module
            record_audio(self.input_audio_path)
            
            # Transcribe audio
            logger.info("Transcribing audio...")
            transcribed_text = self._transcribe(self.input_audio_path)
            
            if not transcribed_text or not transcribed_text.strip():
                logger.warning("No speech detected or transcription empty")
                return None
            
            logger.info(f"Transcribed: {transcribed_text}")
            return transcribed_text
            
        except Exception as e:
            logger.error(f"Error capturing voice input: {e}")
            return None
    
    def generate_voice_output(self, text: str) -> bool:
        """
        Generate voice output from text with interruption support
        
        Args:
            text: Text to convert to speech
            
        Returns:
            True if successful, False otherwise
        """
        try:
            logger.info("Generating speech...")
            
            # Get appropriate API key based on TTS model
            api_key = self._get_tts_api_key()
            
            # Setup interruption handling for streaming TTS (Cartesia only)
            was_interrupted = False
            if settings.TTS_MODEL == 'cartesia' and self.vad_detector and self.interrupt_handler:
                # Clear any previous interruption state
                self.interrupt_handler.clear_interrupt()
                
                # Define callback for when user speech is detected during TTS
                def on_speech_detected():
                    """Callback when user speech is detected during TTS."""
                    logger.warning("🎤🎤🎤 USER INTERRUPTION DETECTED! 🎤🎤🎤")
                    self.interrupt_handler.request_interrupt("user_speech_during_tts")
                    # Don't stop monitoring - let TTS check for interruption and break naturally
                    # This ensures the interruption signal is properly processed
                
                # Start VAD monitoring BEFORE TTS begins
                # Small delay to ensure VAD is calibrated and ready
                import time
                logger.info("Starting VAD monitoring for interruption detection...")
                self.vad_detector.start_monitoring(on_speech_detected)
                # Give VAD time to calibrate ambient noise and initialize
                time.sleep(0.2)  # Increased delay for better calibration
                logger.info("✅ VAD monitoring active - you can interrupt by speaking normally")
            
            try:
                # Generate speech using Verbi's TTS module
                text_to_speech(
                    model=settings.TTS_MODEL,
                    api_key=api_key,
                    text=text,
                    output_file_path=self.output_audio_path,
                    local_model_path=None
                )
            except RuntimeError as e:
                # Suppress generator cleanup errors during interruption (expected behavior)
                if "generator ignored GeneratorExit" not in str(e):
                    if settings.TTS_MODEL == 'elevenlabs':
                        logger.warning(f"ElevenLabs TTS error: {e} — falling back to Piper...")
                        return self._fallback_to_piper(text)
                    raise
                was_interrupted = True
                logger.info("TTS generator was interrupted (expected)")
            except GeneratorExit:
                # Also handle GeneratorExit which can occur during interruption
                was_interrupted = True
                logger.info("TTS generator exit (interruption)")
            except Exception as e:
                # Catch any ElevenLabs API/network errors and fall back to Piper
                if settings.TTS_MODEL == 'elevenlabs':
                    logger.warning(f"ElevenLabs TTS failed: {e} — falling back to Piper...")
                    return self._fallback_to_piper(text)
                logger.error(f"TTS error: {e}")
                return False
            
            # Stop VAD monitoring after TTS completes (or is interrupted)
            if self.vad_detector and self.vad_detector.is_active():
                self.vad_detector.stop_monitoring()
                logger.debug("VAD monitoring stopped")
            
            # Check if TTS was interrupted (double-check)
            if self.interrupt_handler and self.interrupt_handler.is_interrupted():
                was_interrupted = True
                reason = self.interrupt_handler.get_interrupt_reason()
                logger.warning(f"⚠️ Response interrupted by user: {reason}")
                self.interrupt_handler.clear_interrupt()
            
            if was_interrupted:
                logger.info("Speech generation interrupted - user will speak next")
                return "interrupted"  # Return special value to indicate interruption
            
            logger.info("Speech generated successfully")
            return True
            
        except Exception as e:
            logger.error(f"Error generating voice output: {e}")
            # Stop VAD monitoring if still active
            if self.vad_detector and self.vad_detector.is_active():
                self.vad_detector.stop_monitoring()
            return False
    
    def play_voice_output(self) -> bool:
        """
        Play generated voice output
        
        Returns:
            True if successful, False otherwise
        """
        try:
            logger.info("Playing audio...")
            
            # Play audio using Verbi's audio module
            play_audio(self.output_audio_path)
            
            return True
            
        except Exception as e:
            logger.error(f"Error playing voice output: {e}")
            return False
    
    def _is_closing_word(self, text: str) -> bool:
        """
        Check if the transcribed text contains closing words/phrases
        
        Args:
            text: Transcribed text to check
            
        Returns:
            True if closing words detected, False otherwise
        """
        closing_phrases = [
            "goodbye", "bye", "bye bye", "see you", "see ya",
            "exit", "quit", "end conversation", "stop",
            "that's all", "that's it", "thank you goodbye",
            "thanks goodbye", "thank you bye", "thanks bye",
            "i'm done", "i'm finished", "we're done", "we're finished",
            "end call", "hang up", "disconnect"
        ]
        
        text_lower = text.lower().strip()
        
        # Check for exact matches or phrases
        for phrase in closing_phrases:
            if phrase in text_lower:
                return True
        
        return False
    
    def voice_interaction(
        self,
        process_message_callback: Callable[[str], Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Complete voice interaction cycle (single turn)
        
        Args:
            process_message_callback: Function to process the transcribed text
            
        Returns:
            Interaction result
        """
        try:
            # Step 1: Capture voice input
            transcribed_text = self.capture_voice_input()
            
            if not transcribed_text:
                return {
                    "success": False,
                    "error": "Failed to capture voice input"
                }
            
            # Step 2: Process message through orchestrator (via callback)
            logger.info("Processing message through orchestrator...")
            processing_result = process_message_callback(transcribed_text)
            
            # Step 3: Generate and play voice response
            response_text = processing_result.get("message", "I apologize, I didn't understand that.")
            
            voice_result = self.generate_voice_output(response_text)
            
            # Check if TTS was interrupted
            if voice_result == "interrupted":
                logger.info("Agent response was interrupted - user is speaking")
                # Return special result indicating interruption
                return {
                    "success": True,
                    "transcribed_text": transcribed_text,
                    "response_text": response_text,
                    "voice_output_generated": False,
                    "interrupted": True,
                    "processing_result": processing_result
                }
            elif voice_result:
                # NOTE: Frontend browser Audio API handles TTS playback — skip backend pygame
                pass
            else:
                logger.error("Failed to generate voice output")
            
            return {
                "success": True,
                "transcribed_text": transcribed_text,
                "response_text": response_text,
                "voice_output_generated": voice_result if voice_result != "interrupted" else False,
                "interrupted": voice_result == "interrupted",
                "processing_result": processing_result
            }
            
        except Exception as e:
            logger.error(f"Error in voice interaction: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def continuous_voice_interaction(
        self,
        process_message_callback: Callable[[str], Dict[str, Any]],
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Continuous voice interaction loop - continues until closing words are detected
        
        Args:
            process_message_callback: Function to process the transcribed text
            session_id: Optional session ID to maintain conversation context
            
        Returns:
            Final interaction result with conversation summary
        """
        conversation_turns = []
        turn_count = 0
        
        logger.info("Starting continuous voice conversation...")
        logger.info("Say 'goodbye', 'exit', 'quit', or similar to end the conversation")
        
        try:
            while True:
                turn_count += 1
                logger.info(f"\n{'='*60}")
                logger.info(f"Turn {turn_count} - Listening...")
                logger.info(f"{'='*60}")
                
                # Step 1: Capture voice input
                transcribed_text = self.capture_voice_input()
                
                if not transcribed_text:
                    logger.warning("No speech detected, continuing...")
                    continue
                
                # Step 2: Check for closing words
                if self._is_closing_word(transcribed_text):
                    logger.info("Closing words detected. Ending conversation...")
                    break
                
                # Step 3: Process message through orchestrator (via callback)
                logger.info("Processing message through orchestrator...")
                processing_result = process_message_callback(transcribed_text)
                
                # Step 4: Generate and play voice response
                response_text = processing_result.get("message", "I apologize, I didn't understand that.")
                
                voice_result = self.generate_voice_output(response_text)
                
                # Check if TTS was interrupted
                if voice_result == "interrupted":
                    logger.info("Agent response was interrupted - user is speaking")
                    # Continue to next iteration to capture user's interruption
                    continue
                elif voice_result:
                    # NOTE: Frontend browser Audio API handles TTS playback — skip backend pygame
                    pass
                else:
                    logger.error("Failed to generate voice output")
                
                # Store turn in conversation history
                conversation_turns.append({
                    "turn": turn_count,
                    "user_input": transcribed_text,
                    "agent_response": response_text,
                    "metadata": processing_result.get("metadata", {}),
                    "interrupted": voice_result == "interrupted"
                })
                
                logger.info(f"Turn {turn_count} completed successfully")
                
        except KeyboardInterrupt:
            logger.info("Conversation interrupted by user (Ctrl+C)")
            return {
                "success": True,
                "interrupted": True,
                "turns_completed": turn_count,
                "conversation_turns": conversation_turns
            }
        except Exception as e:
            logger.error(f"Error in continuous voice interaction: {e}")
            return {
                "success": False,
                "error": str(e),
                "turns_completed": turn_count,
                "conversation_turns": conversation_turns
            }
        
        # Conversation ended normally
        logger.info(f"\n{'='*60}")
        logger.info(f"Conversation ended after {turn_count} turns")
        logger.info(f"{'='*60}")
        
        return {
            "success": True,
            "turns_completed": turn_count,
            "conversation_turns": conversation_turns,
            "ended_by": "closing_words"
        }
    
    def _transcribe(self, audio_file_path: str) -> str:
        """
        Transcribe audio file
        
        Args:
            audio_file_path: Path to audio file
            
        Returns:
            Transcribed text
        """
        # Get API key based on STT model
        if settings.STT_MODEL == 'groq':
            api_key = settings.GROQ_API_KEY
        elif settings.STT_MODEL == 'openai':
            api_key = settings.OPENAI_API_KEY
        elif settings.STT_MODEL == 'deepgram':
            api_key = settings.DEEPGRAM_API_KEY
        else:
            api_key = None
        
        # Transcribe using Verbi's transcription module
        text = transcribe_audio(
            model=settings.STT_MODEL,
            api_key=api_key,
            audio_file_path=audio_file_path,
            local_model_path=None
        )
        
        return text
    
    def _get_tts_api_key(self) -> Optional[str]:
        """Get TTS API key based on configured model (matching Verbi config)"""
        if settings.TTS_MODEL == 'openai':
            return settings.OPENAI_API_KEY
        elif settings.TTS_MODEL == 'deepgram':
            return settings.DEEPGRAM_API_KEY
        elif settings.TTS_MODEL == 'cartesia':
            return settings.CARTESIA_API_KEY
        elif settings.TTS_MODEL == 'elevenlabs':
            return settings.ELEVENLABS_API_KEY
        else:
            return None

    def _fallback_to_piper(self, text: str) -> bool:
        """Fall back to Piper TTS when ElevenLabs is unavailable"""
        try:
            logger.info("Using Piper TTS as fallback...")
            fallback_path = "voice_output_fallback.wav"
            text_to_speech(
                model='piper',
                api_key=None,
                text=text,
                output_file_path=fallback_path,
                local_model_path=None
            )
            play_audio(fallback_path)
            return True
        except Exception as e:
            logger.error(f"Piper fallback also failed: {e}")
            return False
    
    def cleanup(self):
        """Clean up audio files and stop VAD monitoring"""
        try:
            # Stop VAD monitoring if active
            if self.vad_detector and self.vad_detector.is_active():
                self.vad_detector.stop_monitoring()
                logger.debug("VAD monitoring stopped")
            
            # Clear interruption state
            if self.interrupt_handler:
                self.interrupt_handler.clear_interrupt()
            
            # Clean up audio files
            if os.path.exists(self.input_audio_path):
                os.remove(self.input_audio_path)
            
            if os.path.exists(self.output_audio_path):
                os.remove(self.output_audio_path)
            
            logger.info("Cleaned up audio files and resources")
            
        except Exception as e:
            logger.warning(f"Error cleaning up: {e}")


def test_voice_stream():
    """Test voice stream functionality"""
    logger.info("=== Testing Voice Stream ===")
    
    voice_stream = VoiceStream()
    
    # Test 1: Capture voice input
    logger.info("\nTest 1: Capturing voice input...")
    text = voice_stream.capture_voice_input()
    
    if text:
        logger.info(f"✓ Voice input captured: {text}")
    else:
        logger.error("✗ Failed to capture voice input")
        return False
    
    # Test 2: Generate voice output
    logger.info("\nTest 2: Generating voice output...")
    test_response = "Hello! This is a test of the voice output system."
    success = voice_stream.generate_voice_output(test_response)
    
    if success:
        logger.info("✓ Voice output generated")
    else:
        logger.error("✗ Failed to generate voice output")
        return False
    
    # Test 3: Play voice output
    logger.info("\nTest 3: Playing voice output...")
    success = voice_stream.play_voice_output()
    
    if success:
        logger.info("✓ Voice output played")
    else:
        logger.error("✗ Failed to play voice output")
        return False
    
    # Cleanup
    voice_stream.cleanup()
    
    logger.info("\n=== All voice stream tests passed! ===")
    return True


if __name__ == "__main__":
    test_voice_stream()

