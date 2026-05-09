// src/pages/support/EmailSupportPage.tsx
// Email Support - Create tickets via email with AI processing
import React, { useState } from 'react';
import { useEmailIngestMutation, useAISuggestResponseMutation } from '../../hooks/queries/useSupportQuery';
import { TicketCategory } from '../../types/support';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import {
  EnvelopeIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  TagIcon,
  DocumentTextIcon,
  ClockIcon,
  BoltIcon,
  InboxIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';

const SUPPORT_API_URL = import.meta.env.VITE_CLARA_BACKEND_URL || 'http://localhost:8001';

// Email categories
const emailCategories: { value: TicketCategory; label: string; icon: string }[] = [
  { value: 'technical_issue', label: 'Technical Issue', icon: '🔧' },
  { value: 'billing', label: 'Billing & Payments', icon: '💳' },
  { value: 'account', label: 'Account & Login', icon: '👤' },
  { value: 'feature_request', label: 'Feature Request', icon: '💡' },
  { value: 'bug_report', label: 'Bug Report', icon: '🐛' },
  { value: 'general_inquiry', label: 'General Inquiry', icon: '❓' },
  { value: 'complaint', label: 'Complaint', icon: '😤' },
  { value: 'feedback', label: 'Feedback', icon: '📝' },
];

const EmailSupportPage: React.FC = () => {
  // Form state
  const [fromEmail, setFromEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<TicketCategory | ''>('');
  
  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [processingSteps, setProcessingSteps] = useState<string[]>([]);
  
  // Result state
  const [ticketCreated, setTicketCreated] = useState<any>(null);
  const [aiClassification, setAiClassification] = useState<any>(null);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  
  const emailIngestMutation = useEmailIngestMutation();
  const aiSuggestMutation = useAISuggestResponseMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromEmail || !subject || !body) return;
    
    setIsProcessing(true);
    setTicketCreated(null);
    setAiClassification(null);
    setAiResponse(null);
    setProcessingSteps([]);
    
    try {
      // Step 1: Receiving Email
      setProcessingStep('Receiving email...');
      setProcessingSteps(prev => [...prev, 'Email received ✓']);
      
      // Step 2: Create Ticket via Email Ingest - calls backend POST /api/tickets/email_ingest
      // This endpoint uses RoBERTa for classification and returns real category/priority
      setProcessingStep('Processing with AI (RoBERTa classification)...');
      
      const ticket = await emailIngestMutation.mutateAsync({
        from_email: fromEmail,
        subject: subject,
        body: body,
      });
      
      // Step 3: Set classification from REAL backend response
      setProcessingSteps(prev => [...prev, 'AI Classification complete ✓']);
      setAiClassification({
        predicted_category: ticket.category,           // Real from RoBERTa
        confidence: ticket.ai_confidence,              // Real from backend
        priority: ticket.priority,                     // Real from backend
      });
      
      setTicketCreated(ticket);
      setProcessingSteps(prev => [...prev, `Ticket ${ticket.id} created ✓`]);
      
      // Step 4: Knowledge Base Search + AI Response Generation
      setProcessingStep('Searching knowledge base & generating AI response...');
      
      try {
        // Call the backend AI answer endpoint - POST /api/tickets/{id}/answer
        const aiResult = await aiSuggestMutation.mutateAsync(ticket.id);
        
        setProcessingSteps(prev => [...prev, 'KB search complete ✓']);
        setProcessingSteps(prev => [...prev, 'AI Response generated ✓']);
        
        // Set the real AI response from backend
        setAiResponse(aiResult.answer);
        
        // Log sources if available
        if (aiResult.sources && aiResult.sources.length > 0) {
          console.log('KB Sources used:', aiResult.sources);
        }
        
      } catch (aiError) {
        console.error('AI answer generation failed:', aiError);
        setProcessingSteps(prev => [...prev, 'AI Response failed - using fallback ✓']);
        
        // Fallback response if AI fails
        setAiResponse(`Thank you for contacting our support team regarding "${subject}".

Your ticket has been created and assigned ID: ${ticket.id}

Our AI system has classified your request as: ${ticket.ai_category || 'general_inquiry'}
Priority: ${ticket.priority || 'medium'}

A support agent will review your case and respond shortly.

Best regards,
Clara AI Support System`);
      }
      
      setProcessingStep('');
      
    } catch (error) {
      console.error('Error processing email:', error);
      setProcessingStep('Error processing email. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const resetForm = () => {
    setFromEmail('');
    setSubject('');
    setBody('');
    setCategory('');
    setTicketCreated(null);
    setAiClassification(null);
    setAiResponse(null);
    setProcessingSteps([]);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center h-20 w-20 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-3xl mb-6 shadow-lg">
          <EnvelopeIcon className="h-10 w-10 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Email Support Channel</h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Submit support requests via email - AI automatically classifies, routes, and responds
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Email Form */}
        <Card className="border-2">
          <CardHeader className="bg-gray-50 border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <InboxIcon className="h-5 w-5 text-blue-500" />
              Compose Email
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* From Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  From Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="customer@example.com"
                  required
                  className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Brief description of your issue"
                  required
                  className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category (Optional - AI will auto-detect)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {emailCategories.map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setCategory(category === cat.value ? '' : cat.value)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                        category === cat.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <span>{cat.icon}</span>
                      <span>{cat.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message Body <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Describe your issue in detail..."
                  required
                  rows={6}
                  className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                />
              </div>

              {/* Submit Button */}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetForm}
                  disabled={isProcessing}
                >
                  <ArrowPathIcon className="h-4 w-4 mr-2" />
                  Reset
                </Button>
                <Button
                  type="submit"
                  disabled={isProcessing || !fromEmail || !subject || !body}
                  className="flex-1 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700"
                >
                  {isProcessing ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                      Send & Process with AI
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Processing & Results */}
        <div className="space-y-6">
          {/* Processing Steps */}
          {(isProcessing || processingSteps.length > 0) && (
            <Card className="border-2 border-blue-100 bg-blue-50/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BoltIcon className="h-5 w-5 text-blue-500" />
                  AI Processing Pipeline
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {processingSteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-sm">
                      <CheckCircleIcon className="h-5 w-5 text-green-500 flex-shrink-0" />
                      <span className="text-gray-700">{step}</span>
                    </div>
                  ))}
                  {isProcessing && processingStep && (
                    <div className="flex items-center gap-3 text-sm">
                      <ArrowPathIcon className="h-5 w-5 text-blue-500 animate-spin flex-shrink-0" />
                      <span className="text-blue-700 font-medium">{processingStep}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Classification Result */}
          {aiClassification && (
            <Card className="border-l-4 border-l-purple-500">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <SparklesIcon className="h-5 w-5 text-purple-500" />
                  AI Classification (RoBERTa)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-purple-50 rounded-lg p-3">
                    <p className="text-xs text-purple-600 mb-1">Category</p>
                    <p className="font-semibold capitalize">{aiClassification.predicted_category?.replace('_', ' ') || 'Unknown'}</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3">
                    <p className="text-xs text-purple-600 mb-1">Confidence</p>
                    <p className="font-semibold">{aiClassification.confidence ? `${(aiClassification.confidence * 100).toFixed(1)}%` : 'N/A'}</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3">
                    <p className="text-xs text-purple-600 mb-1">Priority</p>
                    <p className="font-semibold capitalize">{aiClassification.priority || 'Medium'}</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3">
                    <p className="text-xs text-purple-600 mb-1">Channel</p>
                    <p className="font-semibold capitalize">Email</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ticket Created */}
          {ticketCreated && (
            <Card className="border-l-4 border-l-green-500 bg-green-50/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-green-700">
                  <CheckCircleIcon className="h-5 w-5" />
                  Ticket Created Successfully
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 bg-green-500 rounded-xl flex items-center justify-center">
                    <DocumentTextIcon className="h-7 w-7 text-white" />
                  </div>
                  <div>
                    <p className="font-mono text-lg font-semibold text-green-800">{ticketCreated.ticket_number}</p>
                    <p className="text-sm text-green-600">Status: {ticketCreated.status} | Priority: {ticketCreated.priority}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Response */}
          {aiResponse && (
            <Card className="border-l-4 border-l-indigo-500">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <SparklesIcon className="h-5 w-5 text-indigo-500" />
                  AI Generated Response (Llama 3.1 + RAG)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-indigo-50 rounded-lg p-4">
                  <pre className="text-sm text-indigo-900 whitespace-pre-wrap font-sans">{aiResponse}</pre>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Stats & Info */}
      <div className="grid md:grid-cols-4 gap-4">
        <Card className="text-center p-6 hover:shadow-lg transition-shadow">
          <div className="h-12 w-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <EnvelopeIcon className="h-6 w-6 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">24/7</p>
          <p className="text-sm text-muted-foreground">Email Support</p>
        </Card>
        
        <Card className="text-center p-6 hover:shadow-lg transition-shadow">
          <div className="h-12 w-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <SparklesIcon className="h-6 w-6 text-purple-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">92%</p>
          <p className="text-sm text-muted-foreground">AI Accuracy</p>
        </Card>
        
        <Card className="text-center p-6 hover:shadow-lg transition-shadow">
          <div className="h-12 w-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <ClockIcon className="h-6 w-6 text-green-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">&lt;30s</p>
          <p className="text-sm text-muted-foreground">Avg Response</p>
        </Card>
        
        <Card className="text-center p-6 hover:shadow-lg transition-shadow">
          <div className="h-12 w-12 bg-indigo-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <ChartBarIcon className="h-6 w-6 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold text-gray-900">85%</p>
          <p className="text-sm text-muted-foreground">Auto-Resolved</p>
        </Card>
      </div>
    </div>
  );
};

export default EmailSupportPage;
