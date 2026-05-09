/**
 * ContentStudio Component
 * 
 * AI-powered content generation studio for marketing materials.
 * Connects to Clara Marketing Agent backend (Ollama - Local LLM).
 * Falls back to direct Gemini API if backend is unavailable.
 * 
 * Features:
 * - Generate personalized emails based on lead data
 * - Create SMS messages with character limits
 * - Generate cold call scripts with objection handlers
 * - Create platform-specific ad copy (Facebook, TikTok, Google, LinkedIn)
 * - Copy, send, and regenerate functionality
 * 
 * Backend: clara-backend/routes/marketing.py (Ollama - Local LLM)
 * Fallback: src/services/geminiService.ts (Direct Gemini API - if backend unavailable)
 * 
 * @author Sheryar
 */

import React, { useState, useCallback } from 'react';
import { Lead } from '../../types';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  RocketLaunchIcon,
  ClipboardDocumentIcon,
  PaperAirplaneIcon,
  ArrowPathIcon,
  SparklesIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ServerIcon,
  BookmarkIcon,
} from '@heroicons/react/24/outline';
import { addStoredCampaign, CONTENT_TYPE_CHANNEL, CONTENT_TYPE_LABEL } from '../../lib/campaignStore';

// Email service
import { sendEmail, buildMarketingEmailHtml } from '../../lib/emailService';

// Import Gemini AI service for fallback content generation
import {
  generateEmailWithGemini,
  generateSMSWithGemini,
  generateCallScriptWithGemini,
  generateAdCopyWithGemini,
  LeadInfo
} from '../../services/geminiService';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Backend URL for Clara Marketing Agent
const CLARA_BACKEND_URL = import.meta.env.VITE_CLARA_BACKEND_URL || 'http://localhost:8001';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface ContentStudioProps {
  leads: Lead[];
}

type ContentType = 'cold-call' | 'email' | 'sms' | 'fb-ad' | 'tiktok-ad';
type Tone = 'professional' | 'friendly' | 'casual' | 'formal' | 'persuasive';

interface GeneratedContent {
  subject?: string;
  body: string;
  rawData?: any;
  source: 'backend' | 'gemini-direct' | 'fallback';
}

interface Toast {
  type: 'success' | 'error' | 'info';
  message: string;
}

// =============================================================================
// CONTENT TYPE CONFIGURATION
// =============================================================================

const CONTENT_TYPES = [
  { value: 'cold-call', label: 'Cold Call Script', icon: '📞' },
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'sms', label: 'SMS', icon: '💬' },
  { value: 'fb-ad', label: 'Facebook Ad', icon: '📘' },
  { value: 'tiktok-ad', label: 'TikTok Ad', icon: '🎵' }
] as const;

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional', description: 'Formal business tone' },
  { value: 'friendly', label: 'Friendly', description: 'Warm and approachable' },
  { value: 'casual', label: 'Casual', description: 'Relaxed and conversational' },
  { value: 'formal', label: 'Formal', description: 'Very business-like' },
  { value: 'persuasive', label: 'Persuasive', description: 'Sales-focused and compelling' }
] as const;

// =============================================================================
// BACKEND API FUNCTIONS
// =============================================================================

/**
 * Call Clara Marketing Agent backend API
 */
async function callBackendAPI(endpoint: string, data: any): Promise<any> {
  const response = await fetch(`${CLARA_BACKEND_URL}/api/marketing/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `API error: ${response.status}`);
  }
  
  return response.json();
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert Lead type to LeadInfo for Gemini service
 */
function leadToLeadInfo(lead: Lead): LeadInfo {
  return {
    id: lead.id,
    name: lead.clients?.client_name || lead.contact_person || undefined,
    company: lead.clients?.company || lead.clients?.client_name || undefined,
    industry: lead.industry || lead.clients?.industry || undefined,
    email: lead.email || undefined,
    phone: lead.phone || undefined,
    deal_value: lead.deal_value || undefined,
    status_bucket: lead.status_bucket || undefined,
    notes: lead.notes || undefined
  };
}

/**
 * Format email content for display
 */
function formatEmailContent(data: any, source: GeneratedContent['source']): GeneratedContent {
  return {
    subject: data.subject_line,
    body: `${data.greeting}\n\n${data.body}\n\n${data.cta}\n\n${data.signature}${data.ps_line ? `\n\n${data.ps_line}` : ''}`,
    rawData: data,
    source
  };
}

/**
 * Format SMS content for display
 */
function formatSMSContent(data: any, source: GeneratedContent['source']): GeneratedContent {
  return {
    body: data.message,
    rawData: data,
    source
  };
}

/**
 * Format call script for display
 */
function formatCallScriptContent(script: any, source: GeneratedContent['source']): GeneratedContent {
  const objectionHandlers = Object.entries(script.objection_handlers || {})
    .map(([key, val]) => `• "${key.replace(/_/g, ' ')}": ${val}`)
    .join('\n');

  return {
    subject: `Cold Call Script - ${script.objective || 'Discovery'}`,
    body: `📞 OPENER:\n${script.opener}\n\n` +
      `👋 INTRODUCTION:\n${script.introduction}\n\n` +
      `💎 VALUE PROPOSITION:\n${script.value_proposition}\n\n` +
      `❓ QUALIFYING QUESTIONS:\n${(script.qualifying_questions || []).map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')}\n\n` +
      `🎯 PAIN POINT PROBES:\n${(script.pain_point_probes || []).map((p: string) => `• ${p}`).join('\n')}\n\n` +
      `🛡️ OBJECTION HANDLERS:\n${objectionHandlers}\n\n` +
      `🎬 CLOSING:\n${script.closing}\n\n` +
      `📱 VOICEMAIL SCRIPT:\n${script.voicemail_script}\n\n` +
      `⏱️ Estimated Duration: ${script.estimated_duration || '5-10 minutes'}`,
    rawData: script,
    source
  };
}

/**
 * Format ad copy for display
 */
function formatAdCopyContent(ad: any, source: GeneratedContent['source']): GeneratedContent {
  const variations = (ad.a_b_variations || [])
    .map((v: any, i: number) => `\nVariation ${i + 1}:\n• Headline: ${v.headline}\n• Text: ${v.primary_text}`)
    .join('\n');

  return {
    subject: (ad.headlines || [])[0] || 'Ad Copy',
    body: `📢 HEADLINES:\n${(ad.headlines || []).map((h: string) => `• ${h}`).join('\n')}\n\n` +
      `📝 PRIMARY TEXT:\n${ad.primary_text}\n\n` +
      `📋 DESCRIPTION:\n${ad.description}\n\n` +
      `🔘 CTA BUTTON: ${ad.cta_button}\n\n` +
      `🎣 HOOKS:\n${(ad.hooks || []).map((h: string) => `• ${h}`).join('\n')}\n\n` +
      `#️⃣ HASHTAGS: ${(ad.hashtags || []).join(' ')}\n\n` +
      `😀 SUGGESTED EMOJIS: ${(ad.emoji_suggestions || []).join(' ')}\n\n` +
      `🔀 A/B VARIATIONS:${variations}`,
    rawData: ad,
    source
  };
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const ContentStudio: React.FC<ContentStudioProps> = ({ leads }) => {
  // Form state
  const [selectedLead, setSelectedLead] = useState<string>('');
  const [contentType, setContentType] = useState<ContentType>('email');
  const [tone, setTone] = useState<Tone>('professional');
  
  // Generation state
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  
  // UI feedback state
  const [toast, setToast] = useState<Toast | null>(null);
  const [copied, setCopied] = useState(false);

  // Email send state
  const [showSendForm, setShowSendForm] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  // Dashboard save state
  const [savedToDashboard, setSavedToDashboard] = useState(false);

  /**
   * Show toast notification
   */
  const showToast = useCallback((type: Toast['type'], message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  /**
   * Get selected lead object
   */
  const getSelectedLead = useCallback((): Lead | undefined => {
    return leads.find(lead => lead.id === selectedLead);
  }, [leads, selectedLead]);

  /**
   * Try backend first, then fallback to direct Gemini
   */
  const handleGenerate = async () => {
    const isAdContent = contentType.includes('ad');
    if (!isAdContent && !selectedLead) {
      showToast('error', 'Please select a lead first');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedContent(null);

    const lead = getSelectedLead();
    const leadInfo: LeadInfo = lead ? leadToLeadInfo(lead) : { id: 'generic' };

    // Try backend first
    try {
      let result: any;
      let source: GeneratedContent['source'] = 'backend';

      switch (contentType) {
        case 'email':
          result = await callBackendAPI('generate-email', {
            lead_id: selectedLead,
            email_type: 'follow_up',
            tone: tone
          });
          setGeneratedContent(formatEmailContent(result, source));
          break;
          
        case 'sms':
          result = await callBackendAPI('generate-sms', {
            lead_id: selectedLead,
            sms_type: 'quick_follow_up',
            context: ''
          });
          setGeneratedContent(formatSMSContent(result, source));
          break;
          
        case 'cold-call':
          result = await callBackendAPI('generate-call-script', {
            lead_id: selectedLead,
            objective: 'discovery'
          });
          setGeneratedContent(formatCallScriptContent(result, source));
          break;
          
        case 'fb-ad':
        case 'tiktok-ad':
          result = await callBackendAPI('generate-ad-copy', {
            platform: contentType === 'fb-ad' ? 'facebook' : 'tiktok',
            industry: leadInfo.industry || 'B2B',
            pain_points: '',
            objective: 'awareness'
          });
          setGeneratedContent(formatAdCopyContent(result, source));
          break;
      }

      setBackendAvailable(true);
      showToast('success', 'Content generated via Clara Agent (Ollama - Local LLM)');
      
    } catch (backendError) {
      console.warn('Backend unavailable, falling back to direct Gemini:', backendError);
      setBackendAvailable(false);
      
      // Fallback to direct Gemini API
      try {
        let formattedContent: GeneratedContent;
        
        switch (contentType) {
          case 'email': {
            const emailResult = await generateEmailWithGemini(leadInfo, 'follow_up', tone);
            formattedContent = formatEmailContent(emailResult, 'gemini-direct');
            break;
          }
            
          case 'sms': {
            const smsResult = await generateSMSWithGemini(leadInfo, 'quick_follow_up');
            formattedContent = formatSMSContent(smsResult, 'gemini-direct');
            break;
          }
            
          case 'cold-call': {
            const scriptResult = await generateCallScriptWithGemini(leadInfo, 'discovery');
            formattedContent = formatCallScriptContent(scriptResult, 'gemini-direct');
            break;
          }
            
          case 'fb-ad': {
            const fbAdResult = await generateAdCopyWithGemini(
              'facebook',
              leadInfo.industry || 'B2B',
              'awareness'
            );
            formattedContent = formatAdCopyContent(fbAdResult, 'gemini-direct');
            break;
          }
            
          case 'tiktok-ad': {
            const tiktokAdResult = await generateAdCopyWithGemini(
              'tiktok',
              leadInfo.industry || 'B2B',
              'awareness'
            );
            formattedContent = formatAdCopyContent(tiktokAdResult, 'gemini-direct');
            break;
          }
            
          default:
            throw new Error(`Unknown content type: ${contentType}`);
        }

        setGeneratedContent(formattedContent);
        showToast('info', 'Content generated via Direct Gemini (Ollama backend unavailable)');
        
      } catch (geminiError) {
        const errorMessage = geminiError instanceof Error ? geminiError.message : 'Failed to generate content';
        setError(errorMessage);
        showToast('error', 'Generation failed');
        console.error('Content generation error:', geminiError);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Copy generated content to clipboard
   */
  const handleCopy = async () => {
    if (!generatedContent) return;
    
      const textToCopy = generatedContent.subject 
      ? `Subject: ${generatedContent.subject}\n\n${generatedContent.body}`
        : generatedContent.body;
    
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      showToast('success', 'Content copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      showToast('error', 'Failed to copy to clipboard');
    }
  };

  /**
   * Save the current generated campaign to the Marketing Dashboard
   */
  const handleSaveToDashboard = () => {
    if (!generatedContent) return;
    const lead = getSelectedLead();
    const channel = CONTENT_TYPE_CHANNEL[contentType] || contentType;
    const label   = CONTENT_TYPE_LABEL[contentType]  || contentType;
    const leadName = lead
      ? (lead.clients?.client_name || lead.contact_person || 'Lead')
      : 'General';

    addStoredCampaign({
      id:               `cs-${contentType}-${selectedLead || 'gen'}-${Date.now()}`,
      name:             `${label} — ${leadName}`,
      channel,
      total_leads:      lead ? 1 : 0,
      closed_won:       0,
      total_value:      lead?.deal_value ?? 0,
      conversion_rate:  0,
      avg_deal_value:   0,
      status:           'active',
    });

    setSavedToDashboard(true);
    showToast('success', `Campaign saved to Dashboard under "${channel}"!`);
    setTimeout(() => setSavedToDashboard(false), 3000);
  };

  /**
   * Open send form — pre-fill with lead email if available
   */
  const handleSend = () => {
    if (!generatedContent) return;
    if (contentType !== 'email') {
      showToast('info', 'Direct send is only available for Email content. Copy other formats manually.');
      return;
    }
    const lead = getSelectedLead();
    setRecipientEmail(lead?.email || '');
    setShowSendForm(prev => !prev);
  };

  /**
   * Send the generated email via Resend
   */
  const handleConfirmSend = async () => {
    if (!generatedContent || !recipientEmail.trim()) return;
    setIsSendingEmail(true);
    try {
      const lead = getSelectedLead();
      const html = buildMarketingEmailHtml({
        subject: generatedContent.subject || 'Message from TrendTial CRM',
        body: generatedContent.body,
        recipientName: (lead?.clients?.client_name ?? lead?.contact_person) ?? undefined,
      });
      await sendEmail({
        to: recipientEmail.trim(),
        subject: generatedContent.subject || 'Message from TrendTial CRM',
        html,
      });
      showToast('success', `Email sent successfully to ${recipientEmail.trim()}!`);
      setShowSendForm(false);
      setRecipientEmail('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send email';
      showToast('error', msg);
    } finally {
      setIsSendingEmail(false);
    }
  };

  /**
   * Get display name for selected lead
   */
  const getLeadDisplayName = (lead: Lead): string => {
    return lead.clients?.client_name || lead.contact_person || 'Unknown Lead';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center space-x-2 
          ${toast.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : ''}
          ${toast.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : ''}
          ${toast.type === 'info' ? 'bg-blue-50 text-blue-800 border border-blue-200' : ''}`}
        >
          {toast.type === 'success' && <CheckCircleIcon className="h-5 w-5" />}
          {toast.type === 'error' && <ExclamationTriangleIcon className="h-5 w-5" />}
          {toast.type === 'info' && <SparklesIcon className="h-5 w-5" />}
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      {/* Left Panel - Input/Controls */}
      <Card className="shadow-sm">
        <CardHeader className="border-b bg-gray-50/50">
          <CardTitle className="flex items-center text-lg">
            <SparklesIcon className="h-5 w-5 mr-2 text-primary" />
            Generate Content
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {/* Backend Status */}
          {backendAvailable !== null && (
            <div className={`p-2 rounded-md text-xs flex items-center space-x-2
              ${backendAvailable ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}
            >
              <ServerIcon className="h-4 w-4" />
              <span>
                {backendAvailable 
                  ? 'Clara Agent connected (Ollama - Local LLM)' 
                  : 'Using Direct Gemini API (Ollama backend unavailable)'}
              </span>
            </div>
          )}

          {/* Lead Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Lead
              {contentType.includes('ad') && (
                <span className="text-gray-400 font-normal ml-1">(optional for ads)</span>
              )}
            </label>
            <select
              value={selectedLead}
              onChange={(e) => setSelectedLead(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm 
                focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
                bg-white shadow-sm transition-colors"
            >
              <option value="">Choose a lead...</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {getLeadDisplayName(lead)}
                  {lead.deal_value ? ` - $${lead.deal_value.toLocaleString()}` : ''}
                </option>
              ))}
            </select>
            {selectedLead && (
              <div className="mt-2 p-2 bg-gray-50 rounded-md text-xs text-gray-600">
                {(() => {
                  const lead = getSelectedLead();
                  if (!lead) return null;
                  return (
                    <>
                      <span className="font-medium">Industry:</span> {lead.industry || 'Not specified'} |{' '}
                      <span className="font-medium">Status:</span> {lead.status_bucket || 'N/A'}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Content Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Content Type
            </label>
            <div className="space-y-2">
              {CONTENT_TYPES.map((type) => (
                <label
                  key={type.value}
                  className={`flex items-center space-x-3 cursor-pointer p-3 rounded-lg border-2 transition-all
                    ${contentType === type.value 
                      ? 'border-primary bg-primary/5 shadow-sm' 
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                >
                  <input
                    type="radio"
                    name="contentType"
                    value={type.value}
                    checked={contentType === type.value}
                    onChange={(e) => setContentType(e.target.value as ContentType)}
                    className="h-4 w-4 text-primary focus:ring-primary"
                  />
                  <span className="text-lg">{type.icon}</span>
                  <span className={`text-sm ${contentType === type.value ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                    {type.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Tone Selection */}
          {(contentType === 'email' || contentType === 'cold-call') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tone
            </label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as Tone)}
                className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm 
                  focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
                  bg-white shadow-sm transition-colors"
              >
                {TONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} - {option.description}
                  </option>
                ))}
            </select>
          </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-700 font-medium">Generation Error</p>
                <p className="text-xs text-red-600 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || (!contentType.includes('ad') && !selectedLead)}
            className="w-full bg-primary hover:bg-primary/90 text-white py-3 text-base font-medium
              disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            size="lg"
          >
            {isGenerating ? (
              <>
                <ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
                Generating with AI...
              </>
            ) : (
              <>
                <RocketLaunchIcon className="h-5 w-5 mr-2" />
                Generate {CONTENT_TYPES.find(t => t.value === contentType)?.label}
              </>
            )}
          </Button>

          {/* AI Badge */}
          <div className="flex items-center justify-center text-xs text-gray-500">
            <SparklesIcon className="h-3.5 w-3.5 mr-1" />
            Powered by Ollama - Local AI
          </div>
        </CardContent>
      </Card>

      {/* Right Panel - Generated Content */}
      <Card className="shadow-sm">
        <CardHeader className="border-b bg-gray-50/50">
          <CardTitle className="flex items-center justify-between text-lg">
            <span>Generated Content</span>
            {generatedContent && (
              <span className={`text-xs px-2 py-1 rounded-full
                ${generatedContent.source === 'backend' ? 'bg-green-100 text-green-700' : ''}
                ${generatedContent.source === 'gemini-direct' ? 'bg-blue-100 text-blue-700' : ''}
                ${generatedContent.source === 'fallback' ? 'bg-gray-100 text-gray-700' : ''}`}
              >
                {generatedContent.source === 'backend' ? 'Clara Agent' : 
                 generatedContent.source === 'gemini-direct' ? 'Direct Gemini' : 'Fallback'}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {generatedContent ? (
            <div className="space-y-4">
              {/* Content Display */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 min-h-[300px] max-h-[500px] overflow-y-auto">
                {generatedContent.subject && (
                  <div className="mb-4 pb-4 border-b border-gray-100">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      {contentType === 'email' ? 'Subject Line' : 'Title'}
                    </div>
                    <div className="text-gray-900 font-medium text-lg">
                      {generatedContent.subject}
                    </div>
                  </div>
                )}
                
                <div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    {contentType === 'email' ? 'Email Body' : 
                     contentType === 'sms' ? 'Message' : 
                     contentType === 'cold-call' ? 'Script' : 'Ad Copy'}
                  </div>
                  <div className="text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">
                    {generatedContent.body}
                  </div>
                </div>

                {contentType === 'sms' && generatedContent.rawData && (
                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <span>Character count: {generatedContent.rawData.character_count || generatedContent.body.length}</span>
                    <span className={generatedContent.body.length <= 160 ? 'text-green-600' : 'text-orange-600'}>
                      {generatedContent.body.length <= 160 ? '✓ Within SMS limit' : '⚠ Exceeds single SMS'}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={handleCopy}
                  variant="outline"
                  className={`transition-all ${copied ? 'bg-green-50 border-green-300 text-green-700' : ''}`}
                >
                  {copied ? (
                    <>
                      <CheckCircleIcon className="h-4 w-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <ClipboardDocumentIcon className="h-4 w-4 mr-2" />
                      Copy
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleSend}
                  variant="default"
                  className={`transition-all ${
                    showSendForm && contentType === 'email'
                      ? 'bg-indigo-600 hover:bg-indigo-700'
                      : 'bg-primary hover:bg-primary/90'
                  }`}
                >
                  <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                  {showSendForm && contentType === 'email' ? 'Cancel Send' : 'Send Email'}
                </Button>

                {/* Save to Dashboard */}
                <Button
                  onClick={handleSaveToDashboard}
                  variant="outline"
                  className={`col-span-2 transition-all font-medium ${
                    savedToDashboard
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                      : 'border-violet-300 text-violet-700 hover:bg-violet-50'
                  }`}
                >
                  {savedToDashboard ? (
                    <>
                      <CheckCircleIcon className="h-4 w-4 mr-2" />
                      Saved to Dashboard!
                    </>
                  ) : (
                    <>
                      <BookmarkIcon className="h-4 w-4 mr-2" />
                      Save Campaign to Dashboard
                    </>
                  )}
                </Button>

                <Button
                  onClick={handleGenerate}
                  variant="outline"
                  className="col-span-2"
                  disabled={isGenerating}
                >
                  <ArrowPathIcon className={`h-4 w-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
                  Regenerate
                </Button>
              </div>

              {/* Inline send form — shown when Send is clicked on email content */}
              {showSendForm && contentType === 'email' && (
                <div className="mt-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-3">
                  <p className="text-sm font-semibold text-indigo-800 flex items-center gap-1.5">
                    <PaperAirplaneIcon className="h-4 w-4" />
                    Send via Email
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={e => setRecipientEmail(e.target.value)}
                      placeholder="Recipient email address"
                      className="flex-1 px-3 py-2 text-sm border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                    />
                    <Button
                      onClick={handleConfirmSend}
                      disabled={isSendingEmail || !recipientEmail.trim()}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 disabled:opacity-50"
                    >
                      {isSendingEmail ? (
                        <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <PaperAirplaneIcon className="h-4 w-4 mr-1.5" />
                          Send Email
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-indigo-500">
                    ⚠ Test mode uses <code>onboarding@resend.dev</code> — delivery only to your verified Resend address.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[400px] text-gray-400">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <SparklesIcon className="h-8 w-8 text-gray-300" />
              </div>
              <p className="text-base font-medium text-gray-500 mb-1">No content generated yet</p>
              <p className="text-sm text-gray-400 text-center max-w-xs">
                Select a lead and content type, then click generate to create AI-powered marketing content
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ContentStudio;
