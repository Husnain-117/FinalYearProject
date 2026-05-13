# voice_assistant/text_to_speech.py
import logging
import json
import pyaudio
import elevenlabs
import soundfile as sf
import requests

from openai import OpenAI
from elevenlabs.client import ElevenLabs
from cartesia import Cartesia

from voice_assistant.config import Config
from voice_assistant.local_tts_generation import generate_audio_file_melotts

def text_to_speech(model: str, api_key:str, text:str, output_file_path:str, local_model_path:str=None):
    """
    Convert text to speech using the specified model.
    
    Args:
    model (str): The model to use for TTS ('openai', 'deepgram', 'elevenlabs', 'local').
    api_key (str): The API key for the TTS service.
    text (str): The text to convert to speech.
    output_file_path (str): The path to save the generated speech audio file.
    local_model_path (str): The path to the local model (if applicable).
    """
    
    try:
        if model == 'openai':
            client = OpenAI(api_key=api_key)
            speech_response = client.audio.speech.create(
                model="tts-1",
                voice="nova",
                input=text
            )

            speech_response.stream_to_file(output_file_path)
            # with open(output_file_path, "wb") as audio_file:
            #     audio_file.write(speech_response['data'])  # Ensure this correctly accesses the binary content

        elif model == 'deepgram':
            from deepgram import DeepgramClient, SpeakOptions
            
            client = DeepgramClient(api_key=api_key)
            options = SpeakOptions(
                model="aura-arcas-en", #"aura-luna-en", # https://developers.deepgram.com/docs/tts-models
                encoding="linear16",
                container="wav"
            )
            SPEAK_OPTIONS = {"text": text}
            response = client.speak.v("1").save(output_file_path, SPEAK_OPTIONS, options)
        
        elif model == 'elevenlabs':
            client = ElevenLabs(api_key=api_key)
            audio_bytes = b""

            # Compatible with both elevenlabs SDK v1.x and v2.x
            try:
                # v2.x SDK: client.text_to_speech.convert()
                response = client.text_to_speech.convert(
                    voice_id="21m00Tcm4TlvDq8ikWAM",
                    text=text,
                    model_id="eleven_turbo_v2_5",
                    output_format="mp3_22050_32",
                )
                for chunk in response:
                    if isinstance(chunk, bytes):
                        audio_bytes += chunk
            except AttributeError:
                # v1.x SDK: client.generate()
                logging.info("ElevenLabs: using v1.x generate() API")
                response = client.generate(
                    text=text,
                    voice="Rachel",
                    model="eleven_turbo_v2_5",
                )
                for chunk in response:
                    if isinstance(chunk, bytes):
                        audio_bytes += chunk

            if not audio_bytes:
                raise ValueError("ElevenLabs returned no audio data")

            with open(output_file_path, 'wb') as f:
                f.write(audio_bytes)
            logging.info(f"ElevenLabs TTS generated: {len(audio_bytes)} bytes")
        
        elif model == "cartesia":
            from voice_assistant.interruption_handler import get_interruption_handler
            import base64
            import warnings
            
            # Get interruption handler
            interrupt_handler = get_interruption_handler()
            
            client = Cartesia(api_key=api_key)
            voice_id = "f114a467-c40a-4db8-964d-aaba89cd08fa"
            
            model_id = "sonic-english"

            # Use the same format as your old working code
            output_format = {
                "container": "raw",
                "encoding": "pcm_f32le",
                "sample_rate": 44100,
            }

            p = pyaudio.PyAudio()
            rate = 44100

            stream = None

            try:
                # Mark TTS as active
                interrupt_handler.set_tts_active(True)
                
                # Suppress generator cleanup warnings when interrupting
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", category=RuntimeWarning)
                    
                    # Stream audio directly (like your old code)
                    generator = client.tts.sse(
                        model_id=model_id,
                        transcript=text,
                        voice={"mode": "id", "id": voice_id},
                        output_format=output_format,
                    )
                    
                    try:
                        for output in generator:
                            # Check for interruption before processing each chunk
                            if interrupt_handler.is_interrupted():
                                logging.info(f"TTS interrupted: {interrupt_handler.get_interrupt_reason()}")
                                # Simply break - Python will handle generator cleanup
                                break
                            
                            try:
                                # Extract the data attribute (base64-encoded string)
                                if hasattr(output, 'data'):
                                    data = output.data
                                elif hasattr(output, 'audio'):
                                    data = output.audio
                                else:
                                    data = output
                                
                                # Decode base64 string to raw bytes
                                if isinstance(data, str):
                                    buffer = base64.b64decode(data)
                                elif isinstance(data, (bytes, bytearray)):
                                    buffer = data
                                else:
                                    buffer = bytes(data)

                                if stream is None:
                                    stream = p.open(format=pyaudio.paFloat32, channels=1, rate=rate, output=True)

                                # Write the audio data to the stream
                                stream.write(buffer)
                            except Exception as e:
                                logging.error(f"Error streaming audio: {e}")
                                continue
                    except (GeneratorExit, StopIteration):
                        # Normal generator termination
                        pass
            
            finally:
                # Mark TTS as inactive
                interrupt_handler.set_tts_active(False)
                
                # Cleanup
                if stream:
                    stream.stop_stream()
                    stream.close()
                p.terminate()

        elif model == "melotts": # this is a local model
            generate_audio_file_melotts(text=text, filename=output_file_path)

        elif model == "piper":  # this is a local model
            try:
                response = requests.post(
                    f"{Config.PIPER_SERVER_URL}/synthesize/",
                    json={"text": text},
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    # Use the output_file_path parameter instead of hardcoded config
                    with open(output_file_path, "wb") as f:
                        f.write(response.content)
                    logging.info(f"Piper TTS output saved to {output_file_path}")
                else:
                    logging.error(f"Piper TTS API error: {response.status_code} - {response.text}")

            except Exception as e:
                logging.error(f"Piper TTS request failed: {e}")
        
        elif model == 'local':
            with open(output_file_path, "wb") as f:
                f.write(b"Local TTS audio data")
        
        else:
            raise ValueError("Unsupported TTS model")
        
    except Exception as e:
        logging.error(f"Failed to convert text to speech: {e}")