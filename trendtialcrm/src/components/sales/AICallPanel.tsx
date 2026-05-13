/**
 * AICallPanel - AI-powered inbound call interface with real backend integration
 * 
 * Connects to clara-backend's voice pipeline for real AI sales calls.
 * 
 * Features:
 * - Real-time voice conversation with AI Sales Agent
 * - Live BANT assessment and lead scoring
 * - Automatic CRM updates
 * - Call transcript recording
 * - Session persistence (survives page refresh/remount)
 * 
 * Voice Pipeline:
 * - STT: Groq Whisper (cloud, free)
 * - LLM: Llama 3.3 70B (Groq, free)
 * - TTS: ElevenLabs eleven_turbo_v2_5 (cloud, streaming)
 * 
 * @author Faheem
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  PhoneIcon, 
  PhoneXMarkIcon,
  PhoneArrowDownLeftIcon,
  MicrophoneIcon,
  SpeakerWaveIcon,
  UserCircleIcon,
  CpuChipIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { salesCallApi, BANTAssessment, TranscriptMessage } from '../../services/salesCallApi';

type CallStatus = 'idle' | 'connecting' | 'active' | 'ending' | 'completed' | 'failed';
type QualificationStatus = 'unqualified' | 'marketing_qualified' | 'sales_qualified' | 'opportunity';

interface BackendHealth {
  isHealthy: boolean;
  isChecking: boolean;
  error: string | null;
  components: {
    orchestrator: boolean;
    sales_agent: boolean;
    voice_stream: boolean;
  } | null;
}

// Session storage key for persisting active call
const SESSION_STORAGE_KEY = 'clara_active_call_session';

// Helper to get saved session data
const getSavedSession = () => {
  try {
    const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

const AICallPanel: React.FC = () => {
  // Call state - initialize ALL from sessionStorage if available
  const [sessionId, setSessionId] = useState<string | null>(() => {
    const saved = getSavedSession();
    return saved?.sessionId ?? null;
  });
  const [callStatus, setCallStatus] = useState<CallStatus>(() => {
    const saved = getSavedSession();
    return saved?.callStatus ?? 'idle';
  });
  const [callDuration, setCallDuration] = useState(() => {
    const saved = getSavedSession();
    return saved?.callDuration ?? 0;
  });
  const [qualificationStatus, setQualificationStatus] = useState<QualificationStatus>(() => {
    const saved = getSavedSession();
    return saved?.qualificationStatus ?? 'unqualified';
  });
  const [leadScore, setLeadScore] = useState(() => {
    const saved = getSavedSession();
    return saved?.leadScore ?? 0;
  });
  const [bant, setBant] = useState<BANTAssessment>(() => {
    const saved = getSavedSession();
    return saved?.bant ?? {
      budget: 'unknown',
      authority: 'unknown',
      need: 'unknown',
      timeline: 'unknown',
    };
  });
  const [transcript, setTranscript] = useState<TranscriptMessage[]>(() => {
    const saved = getSavedSession();
    return saved?.transcript ?? [];
  });
  const [statusMessages, setStatusMessages] = useState<string[]>(() => {
    const saved = getSavedSession();
    return saved?.statusMessages ?? [];
  });
  const [error, setError] = useState<string | null>(null);
  
  // Backend health
  const [backendHealth, setBackendHealth] = useState<BackendHealth>({
    isHealthy: false,
    isChecking: true,
    error: null,
    components: null,
  });
  
  // Polling interval ref
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isResumingRef = useRef(false);
  // Auto-retry ref for backend health polling
  const healthPollRef = useRef<NodeJS.Timeout | null>(null);
  // Sentinel ref — keeps the transcript pinned to the latest message
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const lastPlayedMsgRef = useRef<string>('');  // tracks last AI message spoken

  // Persist ALL session state to sessionStorage when it changes
  useEffect(() => {
    if (sessionId && (callStatus === 'active' || callStatus === 'connecting')) {
      const sessionData = {
        sessionId,
        callStatus,
        callDuration,
        qualificationStatus,
        leadScore,
        bant,
        transcript,
        statusMessages,
      };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
    } else if (callStatus === 'idle' || callStatus === 'completed' || callStatus === 'failed') {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [sessionId, callStatus, callDuration, qualificationStatus, leadScore, bant, transcript, statusMessages]);

  // Check backend health on mount; auto-retry every 15 s while backend is unreachable.
  // This handles the common race where the backend starts AFTER the page loads.
  useEffect(() => {
    checkBackendHealth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!backendHealth.isHealthy && !backendHealth.isChecking) {
      healthPollRef.current = setTimeout(() => {
        healthPollRef.current = null;
        checkBackendHealth();
      }, 15_000);
    } else if (backendHealth.isHealthy && healthPollRef.current) {
      clearTimeout(healthPollRef.current);
      healthPollRef.current = null;
    }
    return () => {
      if (healthPollRef.current) {
        clearTimeout(healthPollRef.current);
        healthPollRef.current = null;
      }
    };
  }, [backendHealth.isHealthy, backendHealth.isChecking]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timer effect
  useEffect(() => {
    if (callStatus === 'active') {
      timerRef.current = setInterval(() => {
        setCallDuration((prev: number) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [callStatus]);

  // Cancel browser speech synthesis immediately when call is no longer active
  useEffect(() => {
    if (callStatus !== 'active') {
      window.speechSynthesis?.cancel();
    }
  }, [callStatus]);

  // Auto-scroll to latest message whenever transcript grows
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Browser Web Speech API fallback — always works, no API key needed
  const speakWithBrowser = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    utterance.volume = 1.0;
    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const voice =
        voices.find(v => v.lang === 'en-US' && !v.localService) ||
        voices.find(v => v.lang.startsWith('en-US')) ||
        voices.find(v => v.lang.startsWith('en'));
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    };
    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak();
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        doSpeak();
      };
    }
  };

  // Play AI response — try ElevenLabs first, fall back to browser speech
  useEffect(() => {
    if (callStatus !== 'active') return;  // only speak during active calls
    const aiMsgs = transcript.filter(m => m.role === 'ai');
    if (aiMsgs.length === 0) return;
    const latest = aiMsgs[aiMsgs.length - 1];
    if (latest.text === lastPlayedMsgRef.current) return;
    lastPlayedMsgRef.current = latest.text;
    salesCallApi.speak(latest.text).then(blob => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play().catch(() => speakWithBrowser(latest.text));
        audio.onended = () => URL.revokeObjectURL(url);
      } else {
        // ElevenLabs unavailable (e.g. 402) — use browser TTS
        speakWithBrowser(latest.text);
      }
    });
  }, [transcript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timerRef.current)  clearInterval(timerRef.current);
      if (healthPollRef.current) clearTimeout(healthPollRef.current);
    };
  }, []);

  // Check backend health
  const checkBackendHealth = async () => {
    setBackendHealth(prev => ({ ...prev, isChecking: true, error: null }));
    
    try {
      const health = await salesCallApi.healthCheck();
      
      setBackendHealth({
        isHealthy: health.status === 'healthy',
        isChecking: false,
        error: health.error || null,
        components: health.components,
      });
    } catch (err) {
      setBackendHealth({
        isHealthy: false,
        isChecking: false,
        error: 'Cannot connect to Clara backend',
        components: null,
      });
    }
  };

  // Poll for call status updates
  const startPolling = useCallback((sid: string) => {
    // Clear any existing polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    
    console.log('Starting polling for session:', sid);
    let errorCount = 0;
    const MAX_ERRORS = 5;
    
    pollingRef.current = setInterval(async () => {
      try {
        const status = await salesCallApi.getCallStatus(sid);
        
        if (status.success) {
          errorCount = 0; // Reset error count on success
          
          // Only update status if it's a valid transition
          // Don't go from active -> idle (that's a reset, not a status update)
          const currentStatus = status.status as CallStatus;
          
          // Update data regardless of status
          setQualificationStatus(status.qualification_status as QualificationStatus);
          setLeadScore(status.lead_score);
          setBant(status.bant);
          
          // Merge transcripts - keep existing and add new ones
          if (status.transcript && status.transcript.length > 0) {
            setTranscript(prev => {
              // If backend has more messages, use backend's transcript
              if (status.transcript.length > prev.length) {
                return status.transcript;
              }
              // Otherwise keep existing (prevents flickering)
              return prev.length > 0 ? prev : status.transcript;
            });
          }
          
          // Update duration from backend
          if (status.duration !== undefined) {
            setCallDuration(status.duration);
          }
          
          // Only update status for valid transitions (not to idle)
          if (currentStatus !== 'idle') {
            setCallStatus(currentStatus);
          }
          
          // Stop polling if call ended
          if (currentStatus === 'completed' || currentStatus === 'failed') {
            console.log('Call ended with status:', currentStatus);
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        } else {
          // Backend returned success: false
          console.warn('Polling returned unsuccessful:', status);
          errorCount++;
        }
      } catch (err) {
        console.error('Polling error:', err);
        errorCount++;
        
        // Don't immediately fail - allow some errors
        if (errorCount >= MAX_ERRORS) {
          console.error('Too many polling errors, stopping polling');
          setError('Lost connection to backend. The call may still be active.');
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      }
    }, 1000); // Poll every second
  }, []);

  // Resume active session on mount (after startPolling is defined)
  // State is already restored from sessionStorage in useState initializers
  useEffect(() => {
    const saved = getSavedSession();
    if (saved && !isResumingRef.current) {
      const { sessionId: savedSessionId, callStatus: savedStatus } = saved;
      if (savedSessionId && (savedStatus === 'active' || savedStatus === 'connecting')) {
        console.log('Resuming active call session:', savedSessionId);
        isResumingRef.current = true;
        // State is already restored, just add resume message and start polling
        setStatusMessages(prev => {
          // Don't add duplicate resume messages
          if (prev.some(m => m.includes('Resuming'))) return prev;
          return [...prev, '🔄 Resuming active call session...'];
        });
        // Start polling for the resumed session
        startPolling(savedSessionId);
      }
    }
  }, [startPolling]);

  // Format duration to MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start a real call
  const handleStartCall = async () => {
    setError(null);
    setCallStatus('connecting');
    setCallDuration(0);
    setStatusMessages(['🔔 Initializing AI voice assistant...']);
    setTranscript([]);
    setQualificationStatus('unqualified');
    setLeadScore(0);
    setBant({
      budget: 'unknown',
      authority: 'unknown',
      need: 'unknown',
      timeline: 'unknown',
    });
    
    try {
      // Start call via API
      const response = await salesCallApi.startCall();
      
      if (!response.success || !response.session_id) {
        throw new Error(response.message || 'Failed to start call');
      }
      
      setSessionId(response.session_id);
      setStatusMessages(prev => [...prev, '✓ Session created', '🎤 Speak into your microphone...']);
      setCallStatus('active');
      
      // Start polling for updates
      startPolling(response.session_id);
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start call';
      setError(errorMsg);
      setCallStatus('failed');
      setStatusMessages(prev => [...prev, `❌ Error: ${errorMsg}`]);
    }
  };

  // End the call
  const handleEndCall = async () => {
    if (!sessionId) return;
    
    setCallStatus('ending');
    setStatusMessages(prev => [...prev, '→ Ending call...']);
    
    // Stop polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    
    try {
      const response = await salesCallApi.endCall(sessionId);
      
      if (response.success && response.summary) {
        // Update with final summary
        setCallDuration(response.summary.duration);
        setQualificationStatus(response.summary.qualification_status as QualificationStatus);
        setLeadScore(response.summary.lead_score);
        setBant(response.summary.bant);
        setTranscript(response.summary.transcript);
      }
      
      setCallStatus('completed');
      setStatusMessages(prev => [...prev, '✓ Call completed successfully']);
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to end call';
      setError(errorMsg);
      setCallStatus('failed');
    }
  };

  // Reset for new call
  const handleNewCall = () => {
    setSessionId(null);
    setCallStatus('idle');
    setCallDuration(0);
    setQualificationStatus('unqualified');
    setLeadScore(0);
    setBant({
      budget: 'unknown',
      authority: 'unknown',
      need: 'unknown',
      timeline: 'unknown',
    });
    setStatusMessages([]);
    setTranscript([]);
    setError(null);
  };

  const getStatusColor = (status: CallStatus): string => {
    switch (status) {
      case 'idle': return 'bg-white/10 text-white/80 border-white/20';
      case 'connecting': return 'bg-yellow-400/20 text-yellow-200 border-yellow-400/30 animate-pulse';
      case 'active': return 'bg-emerald-400/20 text-emerald-200 border-emerald-400/30';
      case 'ending': return 'bg-orange-400/20 text-orange-200 border-orange-400/30';
      case 'completed': return 'bg-emerald-400/20 text-emerald-200 border-emerald-400/30';
      case 'failed': return 'bg-red-400/20 text-red-200 border-red-400/30';
      default: return 'bg-white/10 text-white/60 border-white/10';
    }
  };

  // Get qualification badge
  const getQualificationBadge = (status: QualificationStatus) => {
    switch (status) {
      case 'unqualified':
        return <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600">Unqualified</span>;
      case 'marketing_qualified':
        return <span className="px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-700">MQL</span>;
      case 'sales_qualified':
        return <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-700">SQL</span>;
      case 'opportunity':
        return <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700 animate-pulse">🔥 Opportunity</span>;
    }
  };

  // BANT progress indicator
  const getBANTProgress = () => {
    let count = 0;
    if (bant.budget !== 'unknown') count++;
    if (bant.authority !== 'unknown') count++;
    if (bant.need !== 'unknown') count++;
    if (bant.timeline !== 'unknown') count++;
    return count;
  };

  // Get score color based on value
  const getScoreColor = (score: number): string => {
    if (score >= 70) return 'text-green-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-gray-600';
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
      {/* Premium gradient header */}
      <div className="relative bg-gradient-to-br from-slate-900 via-indigo-900 to-violet-900 px-6 py-5 overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-violet-500 rounded-full opacity-10 -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        <div className="absolute bottom-0 left-8 w-24 h-24 bg-indigo-400 rounded-full opacity-10 translate-y-1/2 pointer-events-none" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-2.5 border border-white/20">
              <PhoneArrowDownLeftIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white leading-tight">Clara AI Sales Call</h2>
              <p className="text-xs text-violet-300/80 mt-0.5">ElevenLabs · Groq Whisper · Llama 70B</p>
            </div>
          </div>
          <div className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${getStatusColor(callStatus)}`}>
            {callStatus === 'idle' && 'Ready'}
            {callStatus === 'connecting' && 'Connecting...'}
            {callStatus === 'active' && (
              <span className="flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                <span>Live</span>
              </span>
            )}
            {callStatus === 'ending' && 'Ending...'}
            {callStatus === 'completed' && '✓ Done'}
            {callStatus === 'failed' && 'Failed'}
          </div>
        </div>
      </div>

      <div className="p-5">
        {/* Backend Health Warning */}
        {!backendHealth.isHealthy && !backendHealth.isChecking && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start space-x-3">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-900">Backend Not Connected</p>
                <p className="text-xs text-red-700 mt-1">{backendHealth.error || 'Cannot connect to Clara backend'}</p>
                <p className="text-xs text-red-500 mt-1">Make sure clara-backend is running on port 8001</p>
                <button
                  onClick={checkBackendHealth}
                  className="mt-2 text-xs text-red-700 hover:text-red-900 font-medium flex items-center space-x-1"
                >
                  <ArrowPathIcon className="h-3.5 w-3.5" />
                  <span>Retry Connection</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── IDLE STATE ── */}
        {callStatus === 'idle' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-center">
                <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">STT</p>
                <p className="text-xs text-indigo-500 mt-0.5 font-medium">Groq Whisper</p>
              </div>
              <div className="bg-violet-50 border border-violet-100 rounded-xl p-3 text-center">
                <p className="text-xs font-bold text-violet-700 uppercase tracking-wide">TTS</p>
                <p className="text-xs text-violet-500 mt-0.5 font-medium">ElevenLabs</p>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">LLM</p>
                <p className="text-xs text-blue-500 mt-0.5 font-medium">Llama 3.3 70B</p>
              </div>
            </div>

            {backendHealth.isChecking && (
              <div className="flex items-center space-x-2 text-xs text-gray-400 bg-gray-50 rounded-xl p-3 border border-gray-100">
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                <span>Checking backend connection...</span>
              </div>
            )}

            {backendHealth.isHealthy && backendHealth.components && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                <div className="flex items-center space-x-2 mb-2">
                  <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-semibold text-emerald-800">All Systems Ready</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { label: 'Orchestrator', ok: backendHealth.components.orchestrator },
                    { label: 'Sales Agent', ok: backendHealth.components.sales_agent },
                    { label: 'Voice', ok: backendHealth.components.voice_stream },
                  ].map(c => (
                    <div key={c.label} className={`flex items-center space-x-1 text-xs ${c.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                      {c.ok ? <CheckCircleIcon className="h-3 w-3" /> : <XCircleIcon className="h-3 w-3" />}
                      <span>{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleStartCall}
              disabled={!backendHealth.isHealthy || backendHealth.isChecking}
              className={`w-full py-5 rounded-2xl font-semibold text-base transition-all duration-200 flex items-center justify-center space-x-3 ${
                backendHealth.isHealthy
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-lg shadow-indigo-200/60 hover:shadow-xl hover:scale-[1.01] active:scale-[0.99]'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <div className={`rounded-full p-1.5 ${backendHealth.isHealthy ? 'bg-white/20' : 'bg-gray-200'}`}>
                <PhoneIcon className="h-5 w-5" />
              </div>
              <span>Start AI Voice Call</span>
            </button>
            <p className="text-center text-xs text-gray-400">
              Say &quot;goodbye&quot; to end · Powered by ElevenLabs eleven_turbo_v2_5
            </p>
          </div>
        )}

        {/* ── ACTIVE / CONNECTING / ENDING STATE ── */}
        {(callStatus === 'connecting' || callStatus === 'active' || callStatus === 'ending') && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-2xl p-5 text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500 rounded-full opacity-10 -translate-y-1/2 translate-x-1/2 pointer-events-none" />
              <div className="relative">
                <div className="text-5xl font-mono font-bold text-white tracking-widest mb-3">
                  {formatDuration(callDuration)}
                </div>
                {callStatus === 'active' && (
                  <div className="flex items-end justify-center space-x-[3px] h-8 mb-3">
                    {[4, 8, 14, 10, 18, 12, 7, 16, 9, 14, 6, 11, 8, 15, 5].map((h, i) => (
                      <div
                        key={i}
                        className="w-1 bg-violet-400 rounded-full animate-pulse"
                        style={{ height: `${h}px`, animationDuration: `${500 + i * 60}ms`, animationDelay: `${i * 40}ms` }}
                      />
                    ))}
                  </div>
                )}
                {callStatus === 'connecting' && (
                  <div className="flex items-center justify-center space-x-2 mb-3">
                    <ArrowPathIcon className="h-4 w-4 text-indigo-300 animate-spin" />
                    <span className="text-indigo-300 text-sm">Initializing voice pipeline...</span>
                  </div>
                )}
                <div className="flex items-center justify-center space-x-5 text-xs">
                  <span className="flex items-center text-emerald-400 space-x-1">
                    <MicrophoneIcon className="h-3.5 w-3.5" /><span>Listening</span>
                  </span>
                  <span className="text-white/20">|</span>
                  <span className="flex items-center text-violet-300 space-x-1">
                    <SpeakerWaveIcon className="h-3.5 w-3.5" /><span>AI Speaking</span>
                  </span>
                </div>
                {sessionId && (
                  <p className="text-xs text-white/25 mt-2 font-mono">{sessionId.slice(0, 20)}...</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5">
                <p className="text-xs text-gray-400 font-medium mb-1.5">Qualification</p>
                {getQualificationBadge(qualificationStatus)}
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5">
                <p className="text-xs text-gray-400 font-medium mb-0.5">Lead Score</p>
                <p className={`text-2xl font-bold ${getScoreColor(leadScore)}`}>
                  {leadScore}<span className="text-sm font-normal text-gray-400">/100</span>
                </p>
              </div>
            </div>

            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700">BANT Assessment</span>
                <span className="text-xs font-bold text-indigo-600 bg-indigo-100 px-2.5 py-0.5 rounded-full">{getBANTProgress()}/4</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(['budget', 'authority', 'need', 'timeline'] as const).map((key) => (
                  <div
                    key={key}
                    className={`text-center p-2.5 rounded-xl transition-all duration-300 ${
                      bant[key] !== 'unknown' ? 'bg-emerald-100 border border-emerald-200 shadow-sm' : 'bg-white border border-gray-200'
                    }`}
                  >
                    <p className="text-xs font-semibold text-gray-600 capitalize">{key}</p>
                    {bant[key] !== 'unknown' ? (
                      <>
                        <CheckCircleIcon className="h-4 w-4 text-emerald-500 mx-auto mt-1" />
                        <p className="text-xs text-emerald-600 mt-0.5 font-medium truncate">{bant[key]}</p>
                      </>
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-dashed border-gray-300 mx-auto mt-1" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-100 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-white flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Live Transcript</span>
                {callStatus === 'active' && (
                  <span className="flex items-center space-x-1.5 text-xs text-emerald-600">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    <span>Live</span>
                  </span>
                )}
              </div>
              <div className="p-4 max-h-44 overflow-y-auto space-y-3">
                {transcript.length === 0 ? (
                  <p className="text-sm text-gray-400 italic text-center py-3">Waiting for conversation to begin...</p>
                ) : (
                  transcript.map((msg, i) => (
                    <div key={i} className={`flex items-start space-x-2 ${msg.role !== 'ai' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                      <div className={`flex-shrink-0 rounded-full p-1.5 ${msg.role === 'ai' ? 'bg-indigo-100' : 'bg-emerald-100'}`}>
                        {msg.role === 'ai' ? <CpuChipIcon className="h-3 w-3 text-indigo-600" /> : <UserCircleIcon className="h-3 w-3 text-emerald-600" />}
                      </div>
                      <div className={`rounded-xl px-3 py-2 max-w-[80%] text-sm leading-relaxed ${
                        msg.role === 'ai' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900'
                      }`}>{msg.text}</div>
                    </div>
                  ))
                )}
                {callStatus === 'active' && (
                  <div className="flex items-center space-x-1 px-1">
                    {[0, 150, 300].map(d => (
                      <div key={d} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {callStatus !== 'ending' && (
              <button
                onClick={handleEndCall}
                className="w-full flex items-center justify-center space-x-2 py-4 rounded-2xl font-semibold bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-200 transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]"
              >
                <PhoneXMarkIcon className="h-5 w-5" />
                <span>End Call</span>
              </button>
            )}
          </div>
        )}

        {/* ── COMPLETED STATE ── */}
        {callStatus === 'completed' && (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl p-5 text-white text-center">
              <div className="bg-white/20 rounded-full w-12 h-12 flex items-center justify-center mx-auto mb-3">
                <CheckCircleIcon className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-lg">Call Completed!</h3>
              <p className="text-sm text-white/80 mt-0.5">Duration: {formatDuration(callDuration)}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <p className="text-xs text-gray-400 font-medium mb-1.5">Final Qualification</p>
                {getQualificationBadge(qualificationStatus)}
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <p className="text-xs text-gray-400 font-medium mb-0.5">Lead Score</p>
                <p className={`text-2xl font-bold ${getScoreColor(leadScore)}`}>
                  {leadScore}<span className="text-sm font-normal text-gray-400">/100</span>
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <p className="text-xs text-gray-400 font-medium mb-0.5">BANT Progress</p>
                <p className="text-2xl font-bold text-gray-800">{getBANTProgress()}<span className="text-sm font-normal text-gray-400">/4</span></p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <p className="text-xs text-gray-400 font-medium mb-0.5">Turns</p>
                <p className="text-2xl font-bold text-gray-800">{transcript.filter(t => t.role === 'user').length}</p>
              </div>
            </div>

            {transcript.length > 0 && (
              <div className="bg-gray-50 border border-gray-100 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-100 bg-white">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Full Transcript</span>
                </div>
                <div className="p-4 max-h-44 overflow-y-auto space-y-3">
                  {transcript.map((msg, i) => (
                    <div key={i} className={`flex items-start space-x-2 ${msg.role !== 'ai' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                      <div className={`flex-shrink-0 rounded-full p-1.5 ${msg.role === 'ai' ? 'bg-indigo-100' : 'bg-emerald-100'}`}>
                        {msg.role === 'ai' ? <CpuChipIcon className="h-3 w-3 text-indigo-600" /> : <UserCircleIcon className="h-3 w-3 text-emerald-600" />}
                      </div>
                      <div className={`rounded-xl px-3 py-2 max-w-[80%] text-sm leading-relaxed ${
                        msg.role === 'ai' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900'
                      }`}>{msg.text}</div>
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              </div>
            )}

            <button
              onClick={handleNewCall}
              className="w-full flex items-center justify-center space-x-3 py-4 rounded-2xl font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-lg shadow-indigo-200/60 transition-all duration-200 hover:scale-[1.01]"
            >
              <PhoneIcon className="h-5 w-5" />
              <span>Start New Call</span>
            </button>
          </div>
        )}

        {/* ── FAILED STATE ── */}
        {callStatus === 'failed' && (
          <div className="space-y-5">
            <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center">
              <div className="bg-red-100 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-3">
                <XCircleIcon className="h-7 w-7 text-red-600" />
              </div>
              <h3 className="font-bold text-gray-900 text-lg">Call Failed</h3>
              <p className="text-sm text-red-600 mt-1.5">{error || 'An error occurred'}</p>
            </div>
            <button
              onClick={handleNewCall}
              className="w-full flex items-center justify-center space-x-2 py-4 rounded-2xl font-semibold bg-gray-800 hover:bg-gray-900 text-white transition-all duration-200"
            >
              <ArrowPathIcon className="h-5 w-5" />
              <span>Try Again</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AICallPanel;
