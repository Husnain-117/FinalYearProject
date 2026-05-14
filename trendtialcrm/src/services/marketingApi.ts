/**
 * Marketing API Service
 * 
 * This service handles all communication between the TrendtialCRM frontend
 * and the Clara Marketing Agent backend. It provides methods for:
 * - Lead analysis and temperature scoring
 * - AI-powered content generation (emails, SMS, cold calls, ads)
 * - Campaign insights and performance tracking
 * - Nurturing sequence recommendations
 * 
 * Backend: clara-backend/agents/marketing_agent/
 * API Routes: clara-backend/agents/marketing_agent/MARKETING_ROUTES.py
 * 
 * @author Sheryar
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Backend API base URL for the Clara Marketing Agent
 * 
 * Configure in your .env file:
 *   VITE_CLARA_BACKEND_URL=http://localhost:8001
 * 
 * The Clara backend runs on port 8001 by default (configured in clara-backend/config.py)
 * Make sure the backend is running before making API calls
 */
// Trailing slash is stripped so we never get double-slash URLs like
// https://backend-gpr3.onrender.com//api/marketing/... (Render rejects those with 400).
const MARKETING_API_BASE_URL = (
  import.meta.env.VITE_CLARA_BACKEND_URL || 'http://localhost:8001'
).replace(/\/+$/, '');

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Lead temperature classification
 * - hot: High engagement, ready to convert
 * - warm: Moderate engagement, needs nurturing
 * - cold: Low engagement, needs re-engagement
 */
export type LeadTemperature = 'hot' | 'warm' | 'cold';

/**
 * Lead priority level for marketing actions
 */
export type LeadPriority = 'high' | 'medium' | 'low';

/**
 * Content types that can be generated
 */
export type ContentType = 'email' | 'sms' | 'cold-call' | 'fb-ad' | 'tiktok-ad' | 'linkedin-ad' | 'google-ad';

/**
 * Tone options for generated content
 */
export type ContentTone = 'professional' | 'friendly' | 'casual' | 'formal' | 'persuasive';

/**
 * Lead analysis result from the marketing agent
 */
export interface LeadAnalysis {
  lead_id: string;
  lead_name: string;
  temperature: LeadTemperature;
  temperature_score: number;  // 0-100 score
  temperature_reasons: string[];
  priority: LeadPriority;
  nurturing_stage: 'awareness' | 'consideration' | 'decision' | 'retention';
  recommended_action: string;
  content_suggestions: {
    email_type: string;
    call_urgency: 'immediate' | 'this_week' | 'next_week' | 'not_needed';
    ad_retargeting: boolean;
  };
  talking_points: string[];
  risk_factors: string[];
  analyzed_at: string;
}

/**
 * Batch lead analysis summary
 */
export interface BatchAnalysisSummary {
  total_leads: number;
  hot_leads: number;
  warm_leads: number;
  cold_leads: number;
  total_pipeline_value: number;
}

/**
 * Batch lead analysis result
 */
export interface BatchAnalysisResult {
  summary: BatchAnalysisSummary;
  prioritized_leads: LeadAnalysis[];
  segment_recommendations: {
    hot_leads_action: string;
    warm_leads_action: string;
    cold_leads_action: string;
  };
  analyzed_at: string;
}

/**
 * Generated email content
 */
export interface GeneratedEmail {
  subject_line: string;
  preview_text: string;
  greeting: string;
  body: string;
  cta: string;
  signature: string;
  ps_line: string | null;
  personalization_used?: string[];
  email_type: string;
  tone: string;
  lead_id: string;
  is_fallback?: boolean;
}

/**
 * Generated SMS content
 */
export interface GeneratedSMS {
  message: string;
  character_count: number;
  has_link_placeholder: boolean;
  urgency_level: 'low' | 'medium' | 'high';
  sms_type: string;
  lead_id: string;
  is_fallback?: boolean;
}

/**
 * Generated cold call script
 */
export interface GeneratedCallScript {
  opener: string;
  introduction: string;
  value_proposition: string;
  qualifying_questions: string[];
  pain_point_probes: string[];
  objection_handlers: {
    no_time: string;
    not_interested: string;
    using_competitor: string;
    no_budget: string;
    send_info: string;
  };
  closing: string;
  voicemail_script: string;
  estimated_duration: string;
  objective: string;
  lead_id: string;
  is_fallback?: boolean;
}

/**
 * Generated ad copy
 */
export interface GeneratedAdCopy {
  headlines: string[];
  primary_text: string;
  description: string;
  cta_button: string;
  hooks: string[];
  hashtags: string[];
  emoji_suggestions: string[];
  a_b_variations: Array<{
    headline: string;
    primary_text: string;
  }>;
  platform: string;
  objective: string;
  platform_limits?: {
    primary_text_limit?: number;
    headline_limit?: number;
    description_limit?: number;
  };
  is_fallback?: boolean;
}

/**
 * Campaign source statistics
 */
export interface CampaignSource {
  name: string;
  total_leads: number;
  total_value: number;
  closed_won: number;
  conversion_rate: number;
}

/**
 * Campaign insights from the marketing agent
 */
export interface CampaignInsights {
  sources: CampaignSource[];
  total_leads: number;
  total_pipeline_value: number;
  ai_insights: string[];
}

/**
 * Nurturing sequence step
 */
export interface NurturingStep {
  day: number;
  action_type: 'email' | 'call' | 'sms' | 'linkedin' | 'wait';
  action_name: string;
  description: string;
  template_key: string | null;
  conditions: string | null;
  scheduled_date?: string;
  status?: 'pending' | 'completed' | 'skipped';
}

/**
 * Nurturing sequence for a lead
 */
export interface NurturingSequence {
  sequence_name: string;
  total_duration_days: number;
  goal: string;
  steps: NurturingStep[];
  exit_criteria: string[];
  success_metrics: string[];
  lead_id: string;
  lead_name: string;
  started_at: string;
}

// =============================================================================
// API ERROR HANDLING
// =============================================================================

/**
 * Custom error class for Marketing API errors
 */
export class MarketingApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'MarketingApiError';
  }
}

/**
 * Generic API call handler with error handling
 */
async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${MARKETING_API_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new MarketingApiError(
        errorData.detail || `API error: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof MarketingApiError) {
      throw error;
    }
    // Network or other errors
    console.error(`Marketing API error for ${endpoint}:`, error);
    throw new MarketingApiError(
      `Failed to connect to Marketing Agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
      0
    );
  }
}

// =============================================================================
// LEAD ANALYSIS APIs
// =============================================================================

/**
 * Analyze a single lead and get marketing intelligence
 * 
 * Returns temperature, priority, recommendations, and talking points
 * 
 * @param leadId - The UUID of the lead to analyze
 * @returns Lead analysis with temperature, priority, and recommendations
 */
export async function analyzeLead(leadId: string): Promise<LeadAnalysis> {
  return apiCall<LeadAnalysis>('/api/marketing/analyze-lead', {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId }),
  });
}

/**
 * Analyze multiple leads and get prioritized list
 * 
 * @param stage - Optional pipeline stage filter
 * @param limit - Maximum number of leads to analyze (default: 10)
 * @returns Batch analysis with summary and prioritized leads
 */
export async function analyzeLeadsBatch(
  stage?: string,
  limit: number = 10
): Promise<BatchAnalysisResult> {
  return apiCall<BatchAnalysisResult>('/api/marketing/analyze-batch', {
    method: 'POST',
    body: JSON.stringify({ stage, limit }),
  });
}

/**
 * Get quick temperature score for a lead
 * 
 * @param leadId - The UUID of the lead
 * @returns Temperature and score only
 */
export async function getLeadTemperature(
  leadId: string
): Promise<{ lead_id: string; temperature: LeadTemperature; temperature_score: number; priority: LeadPriority }> {
  return apiCall(`/api/marketing/lead-temperature/${leadId}`);
}

/**
 * Get leads filtered by temperature
 * 
 * @param temperature - Filter by temperature (hot, warm, cold)
 * @param limit - Maximum number of leads (default: 10)
 */
export async function getLeadsByTemperature(
  temperature: LeadTemperature,
  limit: number = 10
): Promise<{ temperature: LeadTemperature; leads: any[]; count: number }> {
  return apiCall('/api/marketing/leads-by-temperature', {
    method: 'POST',
    body: JSON.stringify({ temperature, limit }),
  });
}

// =============================================================================
// CONTENT GENERATION APIs
// =============================================================================

/**
 * Generate personalized email content for a lead
 * 
 * Uses AI to create emails based on lead data and stage
 * 
 * @param leadId - The UUID of the lead
 * @param emailType - Type of email (follow_up, welcome, re_engagement, etc.)
 * @param tone - Tone of the email (professional, friendly, etc.)
 */
export async function generateEmail(
  leadId: string,
  emailType: string = 'follow_up',
  tone: ContentTone = 'professional'
): Promise<GeneratedEmail> {
  return apiCall<GeneratedEmail>('/api/marketing/generate-email', {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId, email_type: emailType, tone }),
  });
}

/**
 * Generate SMS message for a lead
 * 
 * Creates concise SMS within character limits
 * 
 * @param leadId - The UUID of the lead
 * @param smsType - Type of SMS (quick_follow_up, appointment_reminder, etc.)
 * @param context - Additional context for the message
 */
export async function generateSMS(
  leadId: string,
  smsType: string = 'quick_follow_up',
  context: string = ''
): Promise<GeneratedSMS> {
  return apiCall<GeneratedSMS>('/api/marketing/generate-sms', {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId, sms_type: smsType, context }),
  });
}

/**
 * Generate cold call script for a lead
 * 
 * Creates complete call script with objection handlers
 * 
 * @param leadId - The UUID of the lead
 * @param objective - Call objective (discovery, demo_booking, etc.)
 */
export async function generateCallScript(
  leadId: string,
  objective: string = 'discovery'
): Promise<GeneratedCallScript> {
  return apiCall<GeneratedCallScript>('/api/marketing/generate-call-script', {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId, objective }),
  });
}

/**
 * Generate ad copy for a specific platform
 * 
 * Creates platform-optimized ad content with A/B variations
 * 
 * @param platform - Ad platform (facebook, tiktok, google, linkedin)
 * @param industry - Target industry
 * @param painPoints - Target pain points
 * @param objective - Ad objective (awareness, conversion, etc.)
 */
export async function generateAdCopy(
  platform: string = 'facebook',
  industry: string = '',
  painPoints: string = '',
  objective: string = 'awareness'
): Promise<GeneratedAdCopy> {
  return apiCall<GeneratedAdCopy>('/api/marketing/generate-ad-copy', {
    method: 'POST',
    body: JSON.stringify({ 
      platform, 
      industry, 
      pain_points: painPoints, 
      objective 
    }),
  });
}

/**
 * Generate content for multiple leads at once
 * 
 * @param stage - Pipeline stage to filter leads
 * @param contentType - Type of content to generate
 * @param limit - Maximum number of leads
 * @param options - Additional options based on content type
 */
export async function generateBatchContent(
  stage: string,
  contentType: 'email' | 'sms' | 'call_script',
  limit: number = 10,
  options?: {
    email_type?: string;
    tone?: ContentTone;
    sms_type?: string;
    objective?: string;
  }
): Promise<{ content: any[]; count: number }> {
  return apiCall('/api/marketing/generate-batch-content', {
    method: 'POST',
    body: JSON.stringify({
      stage,
      content_type: contentType,
      limit,
      ...options,
    }),
  });
}

// =============================================================================
// NURTURING SEQUENCE APIs
// =============================================================================

/**
 * Get recommended nurturing sequence for a lead
 * 
 * Returns a complete sequence with scheduled dates
 * 
 * @param leadId - The UUID of the lead
 */
export async function getNurturingSequence(
  leadId: string
): Promise<NurturingSequence> {
  return apiCall<NurturingSequence>(`/api/marketing/nurturing-sequence/${leadId}`);
}

/**
 * Get immediate next action for a lead
 * 
 * @param leadId - The UUID of the lead
 */
export async function getNextAction(leadId: string): Promise<{
  action_type: string;
  action_name: string;
  description: string;
  template_key: string | null;
  scheduled_date?: string;
  sequence_name?: string;
}> {
  return apiCall(`/api/marketing/next-action/${leadId}`);
}

/**
 * Get list of available nurturing sequences
 */
export async function getAvailableSequences(): Promise<{
  sequences: Array<{
    key: string;
    name: string;
    duration_days: number;
    goal: string;
    step_count: number;
  }>;
}> {
  return apiCall('/api/marketing/sequences');
}

// =============================================================================
// CAMPAIGN INSIGHTS APIs
// =============================================================================

/**
 * Get campaign performance insights
 * 
 * Returns source statistics and AI-generated insights
 */
export async function getCampaignInsights(): Promise<CampaignInsights> {
  return apiCall<CampaignInsights>('/api/marketing/campaign-insights');
}

/**
 * Get leads by pipeline stage
 * 
 * @param stage - Pipeline stage to filter
 * @param limit - Maximum number of leads
 */
export async function getLeadsByStage(
  stage: string,
  limit: number = 10
): Promise<{ stage: string; leads: any[]; count: number }> {
  return apiCall(`/api/marketing/leads-by-stage/${stage}?limit=${limit}`);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Map frontend content type to backend format
 */
export function mapContentType(type: ContentType): {
  backendType: string;
  endpoint: string;
} {
  const mapping: Record<ContentType, { backendType: string; endpoint: string }> = {
    'email': { backendType: 'email', endpoint: 'generate-email' },
    'sms': { backendType: 'sms', endpoint: 'generate-sms' },
    'cold-call': { backendType: 'call_script', endpoint: 'generate-call-script' },
    'fb-ad': { backendType: 'facebook', endpoint: 'generate-ad-copy' },
    'tiktok-ad': { backendType: 'tiktok', endpoint: 'generate-ad-copy' },
    'linkedin-ad': { backendType: 'linkedin', endpoint: 'generate-ad-copy' },
    'google-ad': { backendType: 'google', endpoint: 'generate-ad-copy' },
  };
  return mapping[type];
}

/**
 * Format content for display based on type
 */
export function formatGeneratedContent(
  content: GeneratedEmail | GeneratedSMS | GeneratedCallScript | GeneratedAdCopy,
  type: ContentType
): { subject?: string; body: string } {
  switch (type) {
    case 'email':
      const email = content as GeneratedEmail;
      return {
        subject: email.subject_line,
        body: `${email.greeting}\n\n${email.body}\n\n${email.cta}\n\n${email.signature}${email.ps_line ? `\n\nP.S. ${email.ps_line}` : ''}`,
      };
    
    case 'sms':
      const sms = content as GeneratedSMS;
      return { body: sms.message };
    
    case 'cold-call':
      const script = content as GeneratedCallScript;
      return {
        subject: `Cold Call Script - ${script.objective}`,
        body: `**OPENER:**\n${script.opener}\n\n**INTRODUCTION:**\n${script.introduction}\n\n**VALUE PROPOSITION:**\n${script.value_proposition}\n\n**QUALIFYING QUESTIONS:**\n${script.qualifying_questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n**OBJECTION HANDLERS:**\n${Object.entries(script.objection_handlers).map(([key, val]) => `- "${key.replace('_', ' ')}": ${val}`).join('\n')}\n\n**CLOSING:**\n${script.closing}\n\n**VOICEMAIL:**\n${script.voicemail_script}`,
      };
    
    case 'fb-ad':
    case 'tiktok-ad':
    case 'linkedin-ad':
    case 'google-ad':
      const ad = content as GeneratedAdCopy;
      return {
        subject: ad.headlines[0],
        body: `**HEADLINES:**\n${ad.headlines.join('\n')}\n\n**PRIMARY TEXT:**\n${ad.primary_text}\n\n**DESCRIPTION:**\n${ad.description}\n\n**CTA BUTTON:** ${ad.cta_button}\n\n**HOOKS:**\n${ad.hooks.join('\n')}\n\n**HASHTAGS:** ${ad.hashtags.join(' ')}\n\n**A/B VARIATIONS:**\n${ad.a_b_variations.map((v, i) => `Variation ${i + 1}:\n- Headline: ${v.headline}\n- Text: ${v.primary_text}`).join('\n\n')}`,
      };
    
    default:
      return { body: JSON.stringify(content, null, 2) };
  }
}

/**
 * Calculate local lead score based on lead data
 * Used when backend is not available
 */
export function calculateLocalLeadScore(lead: {
  deal_value?: number | null;
  status_bucket?: string | null;
  created_at?: string | null;
  lead_score?: number | null;
}): { score: number; temperature: LeadTemperature; priority: LeadPriority } {
  let score = 0;
  
  // Deal value scoring (0-25 points)
  const dealValue = lead.deal_value || 0;
  if (dealValue >= 10000) score += 25;
  else if (dealValue >= 1000) score += 15;
  else if (dealValue > 0) score += 5;
  
  // Status bucket scoring (0-30 points)
  const statusBucket = lead.status_bucket || 'P3';
  if (statusBucket === 'P1') score += 30;
  else if (statusBucket === 'P2') score += 15;
  else score += 5;
  
  // Recency scoring (0-20 points)
  if (lead.created_at) {
    const daysSinceCreated = Math.floor(
      (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceCreated <= 1) score += 20;
    else if (daysSinceCreated <= 7) score += 15;
    else if (daysSinceCreated <= 30) score += 10;
  }
  
  // Existing lead score contribution (0-25 points)
  const existingScore = lead.lead_score || 0;
  score += Math.round(existingScore * 0.25);
  
  // Cap at 100
  score = Math.min(100, score);
  
  // Determine temperature and priority
  let temperature: LeadTemperature;
  let priority: LeadPriority;
  
  if (score >= 70) {
    temperature = 'hot';
    priority = 'high';
  } else if (score >= 40) {
    temperature = 'warm';
    priority = 'medium';
  } else {
    temperature = 'cold';
    priority = 'low';
  }
  
  return { score, temperature, priority };
}

/**
 * Get recommended action based on temperature
 */
export function getRecommendedAction(temperature: LeadTemperature): string {
  switch (temperature) {
    case 'hot':
      return 'Schedule immediate call';
    case 'warm':
      return 'Send personalized email';
    case 'cold':
      return 'Add to nurture sequence';
    default:
      return 'Follow up via email';
  }
}

/**
 * Get why explanation for recommended action
 */
export function getActionReason(
  temperature: LeadTemperature,
  score: number,
  dealValue: number
): string {
  if (temperature === 'hot') {
    if (dealValue >= 10000) return 'High-value lead with strong engagement signals';
    return 'High engagement, ready to convert';
  }
  if (temperature === 'warm') {
    return 'Good potential, needs nurturing';
  }
  return 'Low engagement, long-term nurturing needed';
}

export default {
  // Lead Analysis
  analyzeLead,
  analyzeLeadsBatch,
  getLeadTemperature,
  getLeadsByTemperature,
  
  // Content Generation
  generateEmail,
  generateSMS,
  generateCallScript,
  generateAdCopy,
  generateBatchContent,
  
  // Nurturing
  getNurturingSequence,
  getNextAction,
  getAvailableSequences,
  
  // Campaign Insights
  getCampaignInsights,
  getLeadsByStage,
  
  // Utilities
  mapContentType,
  formatGeneratedContent,
  calculateLocalLeadScore,
  getRecommendedAction,
  getActionReason,
};

