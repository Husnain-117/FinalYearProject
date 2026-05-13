/**
 * Sales Call API Service
 * 
 * Connects to clara-backend's voice call API for AI-powered sales calls
 * 
 * Endpoints:
 * - POST /api/sales/calls/start - Start a new call
 * - GET /api/sales/calls/{session_id}/status - Get call status
 * - POST /api/sales/calls/{session_id}/end - End a call
 * - GET /api/sales/calls/sessions - List all sessions
 * - GET /api/sales/calls/health - Health check
 * 
 * @author Faheem
 */

// Clara backend URL - update this to match your setup
const CLARA_BACKEND_URL = import.meta.env.VITE_CLARA_BACKEND_URL || 'http://localhost:8001';

// =============================================================================
// TYPES
// =============================================================================

export interface BANTAssessment {
  budget: 'unknown' | 'low' | 'medium' | 'high';
  authority: 'unknown' | 'no' | 'yes' | 'influencer';
  need: 'unknown' | 'low' | 'medium' | 'high' | 'urgent';
  timeline: 'unknown' | 'no_timeline' | 'future' | 'this_quarter' | 'immediate';
}

export interface TranscriptMessage {
  role: 'user' | 'ai';
  text: string;
  timestamp: string;
}

export interface StartCallRequest {
  lead_id?: string;
}

export interface StartCallResponse {
  success: boolean;
  session_id?: string;
  message: string;
}

export interface CallStatusResponse {
  success: boolean;
  session_id: string;
  status: 'idle' | 'connecting' | 'active' | 'ending' | 'completed' | 'failed';
  duration: number;
  qualification_status: string;
  lead_score: number;
  bant: BANTAssessment;
  transcript: TranscriptMessage[];
  total_turns: number;
  error?: string;
}

export interface EndCallResponse {
  success: boolean;
  session_id: string;
  summary: {
    duration: number;
    qualification_status: string;
    lead_score: number;
    bant: BANTAssessment;
    transcript_turns: number;
    transcript: TranscriptMessage[];
  };
}

export interface CallSession {
  session_id: string;
  lead_id: string | null;
  status: string;
  start_time: string | null;
  end_time: string | null;
  duration: number;
  transcript: TranscriptMessage[];
  qualification_status: string;
  lead_score: number;
  bant: BANTAssessment;
  metadata: Record<string, unknown>;
}

export interface HealthCheckResponse {
  success: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    orchestrator: boolean;
    sales_agent: boolean;
    voice_stream: boolean;
  };
  stt_model: string;
  tts_model: string;
  llm_model: string;
  error?: string;
}

// CRM Call Record (from database)
export interface CRMCallRecord {
  id: string;
  lead_id: string | null;
  duration: number;
  call_type: string;
  outcome: string;
  notes: string | null;
  call_start_time: string;
  created_at: string;
  transcript: string | null;
  lead_score_after: number | null;
  qualification_status: string | null;
  bant_assessment: BANTAssessment | null;
  ai_session_id: string | null;
  lead: {
    contact_person: string | null;
    company_name: string | null;
    email: string | null;
    lead_score: number | null;
  } | null;
}

export interface CallStatistics {
  totalCalls: number;
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  successRate: number;
  qualificationRate: number;
  outcomes: Record<string, number>;
  callsByDay: Array<{ date: string; count: number }>;
  qualificationBreakdown: {
    unqualified: number;
    marketing_qualified: number;
    sales_qualified: number;
    opportunity: number;
  };
}

// =============================================================================
// API CLIENT
// =============================================================================

/**
 * Sales Call API Client
 */
export const salesCallApi = {
  /**
   * Check if the voice call service is healthy
   */
  async healthCheck(): Promise<HealthCheckResponse> {
    try {
      const response = await fetch(`${CLARA_BACKEND_URL}/api/sales/calls/health`);
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Health check failed:', error);
      return {
        success: false,
        status: 'unhealthy',
        components: {
          orchestrator: false,
          sales_agent: false,
          voice_stream: false,
        },
        stt_model: 'unknown',
        tts_model: 'unknown',
        llm_model: 'unknown',
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  },

  /**
   * Start a new voice call session
   * 
   * @param leadId - Optional lead ID to associate with the call
   * @returns Session info with session_id
   */
  async startCall(leadId?: string): Promise<StartCallResponse> {
    try {
      const response = await fetch(`${CLARA_BACKEND_URL}/api/sales/calls/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lead_id: leadId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to start call:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to start call',
      };
    }
  },

  /**
   * Get current status of a call session
   * 
   * @param sessionId - The call session ID
   * @returns Current call status and metadata
   */
  async getCallStatus(sessionId: string): Promise<CallStatusResponse> {
    try {
      const response = await fetch(`${CLARA_BACKEND_URL}/api/sales/calls/${sessionId}/status`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get call status:', error);
      return {
        success: false,
        session_id: sessionId,
        status: 'failed',
        duration: 0,
        qualification_status: 'unknown',
        lead_score: 0,
        bant: {
          budget: 'unknown',
          authority: 'unknown',
          need: 'unknown',
          timeline: 'unknown',
        },
        transcript: [],
        total_turns: 0,
        error: error instanceof Error ? error.message : 'Failed to get status',
      };
    }
  },

  /**
   * End an active call session
   * 
   * @param sessionId - The call session ID
   * @returns Call summary with all collected data
   */
  async endCall(sessionId: string): Promise<EndCallResponse> {
    try {
      const response = await fetch(`${CLARA_BACKEND_URL}/api/sales/calls/${sessionId}/end`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to end call:', error);
      throw error;
    }
  },

  /**
   * List all call sessions
   * 
   * @returns List of all sessions
   */
  async listSessions(): Promise<{ success: boolean; sessions: CallSession[]; total: number }> {
    try {
      const response = await fetch(`${CLARA_BACKEND_URL}/api/sales/calls/sessions`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to list sessions:', error);
      return {
        success: false,
        sessions: [],
        total: 0,
      };
    }
  },

  /**
   * Clean up a call session
   * 
   * @param sessionId - The call session ID
   */
  async cleanupSession(sessionId: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch(`${CLARA_BACKEND_URL}/api/sales/calls/${sessionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to cleanup session:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to cleanup',
      };
    }
  },

  // =============================================================================
  // CRM DATA ENDPOINTS - For Sales Hub Dashboard
  // =============================================================================

  /**
   * Get call history from CRM database
   * 
   * @param limit - Maximum number of calls to return
   * @returns List of call records with lead info
   */
  async getCallHistory(limit: number = 50): Promise<{ success: boolean; calls: CRMCallRecord[]; total: number }> {
    try {
      const response = await fetch(`${CLARA_BACKEND_URL}/api/sales/calls/history?limit=${limit}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get call history:', error);
      return {
        success: false,
        calls: [],
        total: 0,
      };
    }
  },

  /**
   * Get call statistics for Sales Hub dashboard
   * 
   * @returns Statistics object with aggregated data
   */
  async getCallStatistics(): Promise<{ success: boolean } & Partial<CallStatistics>> {
    try {
      const response = await fetch(`${CLARA_BACKEND_URL}/api/sales/calls/statistics`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get call statistics:', error);
      return {
        success: false,
        totalCalls: 0,
        totalDurationSeconds: 0,
        averageDurationSeconds: 0,
        successRate: 0,
        qualificationRate: 0,
        outcomes: {},
        callsByDay: [],
        qualificationBreakdown: {
          unqualified: 0,
          marketing_qualified: 0,
          sales_qualified: 0,
          opportunity: 0,
        },
      };
    }
  },

  /**
   * Convert text to speech using ElevenLabs (via backend) and return audio Blob
   */
  async speak(text: string): Promise<Blob | null> {
    try {
      const response = await fetch(`${CLARA_BACKEND_URL}/api/sales/calls/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(`TTS request failed: ${response.status}`);
      return await response.blob();
    } catch (error) {
      console.error('TTS speak failed:', error);
      return null;
    }
  },
};

export default salesCallApi;

