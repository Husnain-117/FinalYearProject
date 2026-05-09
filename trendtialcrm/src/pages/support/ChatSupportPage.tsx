// src/pages/support/ChatSupportPage.tsx
// Live Chat Support - Interactive AI chat with ticket creation
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useCreateTicketMutation, useAISuggestResponseMutation } from '../../hooks/queries/useSupportQuery';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import {
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  UserIcon,
  ClockIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  PlusIcon,
  XMarkIcon,
  BoltIcon,
  DocumentTextIcon,
  LightBulbIcon,
  MicrophoneIcon,
  StopIcon,
} from '@heroicons/react/24/outline';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isTyping?: boolean;
  ticketInfo?: any;
}

const SUPPORT_API_URL = import.meta.env.VITE_CLARA_BACKEND_URL || 'http://localhost:8001';

// Quick action suggestions
const quickActions = [
  "I can't log into my account",
  "I need help with billing",
  "How do I reset my password?",
  "I found a bug",
  "I have a feature request",
];

const ChatSupportPage: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: "Hello! 👋 I'm Clara, your AI support assistant powered by advanced language models. How can I help you today?\n\nYou can describe your issue or choose from the quick actions below. I'll automatically create a support ticket and provide instant assistance!",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');
  const [ticketCreated, setTicketCreated] = useState<any>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // STT: append transcript to the current input value
  const handleTranscript = useCallback((text: string) => {
    setInputValue(prev => (prev ? `${prev} ${text}` : text));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const { isListening, isSupported, startListening, stopListening } = useSpeechRecognition({
    onTranscript: handleTranscript,
    lang: 'en-US',
  });

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };
  
  const createTicketMutation = useCreateTicketMutation();
  const aiAnswerMutation = useAISuggestResponseMutation();

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const addMessage = (message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, {
      ...message,
      id: Date.now().toString(),
      timestamp: new Date(),
    }]);
  };

  const processUserMessage = async (userMessage: string, email: string) => {
    setIsProcessing(true);
    
    // Add typing indicator
    addMessage({
      role: 'assistant',
      content: '',
      isTyping: true,
    });

    try {
      // Step 1: Create ticket via backend - POST /api/tickets/
      // This uses RoBERTa for classification
      const ticket = await createTicketMutation.mutateAsync({
        customer_email: email,
        subject: userMessage.substring(0, 100),
        description: userMessage,
        channel: 'chat',
      });
      
      setTicketCreated(ticket);
      
      // Update typing message to show progress
      setMessages(prev => prev.map(m => 
        m.isTyping ? { ...m, content: `✓ Ticket ${ticket.ticket_number} created\n⏳ Generating AI response...` } : m
      ));
      
      // Step 2: Call AI answer endpoint - POST /api/tickets/{id}/answer
      // This uses KB search + Llama 3.1 8B
      let aiResponse = '';
      try {
        const aiResult = await aiAnswerMutation.mutateAsync(ticket.id);
        aiResponse = aiResult.answer;
        
        // Log KB sources used
        if (aiResult.sources?.length > 0) {
          console.log('KB Sources used:', aiResult.sources);
        }
      } catch (aiError) {
        console.error('AI answer failed, using fallback:', aiError);
        // Fallback if AI fails
        aiResponse = `Thank you for reaching out! I've created support ticket **${ticket.ticket_number}** for your inquiry.

📋 **Ticket Details:**
- Category: ${ticket.category?.replace('_', ' ') || 'General'}
- Priority: ${ticket.priority}
- Status: ${ticket.status}
${ticket.ai_confidence ? `- AI Confidence: ${(ticket.ai_confidence * 100).toFixed(0)}%` : ''}

A support agent will review your ticket and respond within 24 hours.`;
      }
      
      // Remove typing indicator and add real AI response
      setMessages(prev => prev.filter(m => !m.isTyping));
      
      // Format the response with ticket info
      const formattedResponse = `${aiResponse}

---
📋 **Ticket Created:** ${ticket.ticket_number}
- Category: ${ticket.category?.replace('_', ' ') || 'General'}
- Priority: ${ticket.priority}
- Channel: Chat`;

      addMessage({
        role: 'assistant',
        content: formattedResponse,
        ticketInfo: ticket,
      });
      
    } catch (error) {
      console.error('Error processing message:', error);
      setMessages(prev => prev.filter(m => !m.isTyping));
      addMessage({
        role: 'assistant',
        content: "I apologize, but I encountered an error processing your request. Please try again or contact support directly.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSend = () => {
    if (!inputValue.trim() || isProcessing) return;
    
    const userMessage = inputValue.trim();
    setInputValue('');
    
    // Add user message
    addMessage({
      role: 'user',
      content: userMessage,
    });
    
    // Check if we have email
    if (!userEmail) {
      setPendingMessage(userMessage);
      setShowEmailPrompt(true);
    } else {
      processUserMessage(userMessage, userEmail);
    }
  };

  const handleEmailSubmit = () => {
    if (!userEmail.includes('@')) return;
    setShowEmailPrompt(false);
    if (pendingMessage) {
      processUserMessage(pendingMessage, userEmail);
      setPendingMessage('');
    }
  };

  const handleQuickAction = (action: string) => {
    setInputValue(action);
    inputRef.current?.focus();
  };

  const startNewChat = () => {
    setMessages([
      {
        id: '1',
        role: 'assistant',
        content: "Hello! 👋 I'm Clara, your AI support assistant. How can I help you today?",
        timestamp: new Date(),
      },
    ]);
    setTicketCreated(null);
    setInputValue('');
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-160px)] flex flex-col">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center h-16 w-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl mb-4 shadow-lg">
          <ChatBubbleLeftRightIcon className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Live Chat Support</h1>
        <p className="text-muted-foreground">
          Chat with Clara AI - Instant responses powered by Llama 3.1 & RAG
        </p>
      </div>

      {/* Chat Container */}
      <Card className="flex-1 flex flex-col border-2 overflow-hidden">
        {/* Chat Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-green-500 to-emerald-600 text-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-white/20 rounded-full flex items-center justify-center">
              <SparklesIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold">Clara AI Assistant</h3>
              <p className="text-sm text-green-100">Online • Typically replies instantly</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={startNewChat} className="text-white hover:bg-white/20">
            <PlusIcon className="h-4 w-4 mr-1" />
            New Chat
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-3 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {/* Avatar */}
                <div className={`h-8 w-8 rounded-full flex-shrink-0 flex items-center justify-center ${
                  msg.role === 'user' 
                    ? 'bg-gray-600' 
                    : 'bg-gradient-to-br from-green-500 to-emerald-600'
                }`}>
                  {msg.role === 'user' ? (
                    <UserIcon className="h-4 w-4 text-white" />
                  ) : (
                    <SparklesIcon className="h-4 w-4 text-white" />
                  )}
                </div>
                
                {/* Message Bubble */}
                <div className={`rounded-2xl p-4 ${
                  msg.role === 'user'
                    ? 'bg-gray-600 text-white rounded-tr-none'
                    : 'bg-white border shadow-sm rounded-tl-none'
                }`}>
                  {msg.isTyping ? (
                    <div className="space-y-2">
                      {msg.content ? (
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                          <span className="text-sm text-gray-500 ml-2">Processing with AI...</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-xs mt-2 ${msg.role === 'user' ? 'text-gray-300' : 'text-gray-400'}`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions (only show at start) */}
        {messages.length === 1 && !isProcessing && (
          <div className="px-4 py-3 border-t bg-white">
            <p className="text-xs text-muted-foreground mb-2">Quick actions:</p>
            <div className="flex flex-wrap gap-2">
              {quickActions.map((action) => (
                <button
                  key={action}
                  onClick={() => handleQuickAction(action)}
                  className="px-3 py-1.5 bg-green-50 text-green-700 rounded-full text-sm hover:bg-green-100 transition-colors"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Email Prompt Modal */}
        {showEmailPrompt && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-96 p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-semibold text-gray-900">Enter your email</h3>
                <button onClick={() => setShowEmailPrompt(false)} className="text-gray-400 hover:text-gray-600">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                We need your email to create a support ticket and send you updates.
              </p>
              <input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 border rounded-lg mb-4 focus:ring-2 focus:ring-green-500/20 focus:border-green-500"
                onKeyDown={(e) => e.key === 'Enter' && handleEmailSubmit()}
              />
              <Button onClick={handleEmailSubmit} className="w-full bg-green-600 hover:bg-green-700">
                Continue
              </Button>
            </Card>
          </div>
        )}

        {/* Input Area */}
        <div className="p-4 border-t bg-white">
          <div className="flex gap-2 items-center">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={isListening ? 'Listening… speak now' : 'Type your message...'}
              disabled={isProcessing}
              className={`flex-1 px-4 py-3 border rounded-xl focus:ring-2 focus:outline-none transition-all ${
                isListening
                  ? 'border-red-400 ring-2 ring-red-200 focus:ring-red-300'
                  : 'focus:ring-green-500/20 focus:border-green-500'
              }`}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />

            {/* Microphone / STT Button — always rendered, disabled when unsupported */}
            <div
              className="relative flex-shrink-0"
              title={
                !isSupported
                  ? 'Speech input is not supported in this browser. Use Chrome or Edge.'
                  : isListening
                  ? 'Stop listening'
                  : 'Click to speak'
              }
            >
              <button
                type="button"
                onClick={toggleListening}
                disabled={isProcessing || !isSupported}
                className={`relative flex items-center justify-center gap-1.5 h-[46px] px-3 rounded-xl border-2 transition-all duration-200 ${
                  isListening
                    ? 'bg-red-50 border-red-400 text-red-600 hover:bg-red-100'
                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 hover:border-gray-300'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
              >
                {isListening ? (
                  <>
                    {/* Animated waveform bars */}
                    <span className="flex items-center gap-[2px] h-5">
                      {[...Array(5)].map((_, i) => (
                        <span
                          key={i}
                          className="stt-bar inline-block w-[3px] rounded-full bg-red-500"
                          style={{ height: '100%', transformOrigin: 'center bottom' }}
                        />
                      ))}
                    </span>
                    <StopIcon className="h-4 w-4 flex-shrink-0" />
                  </>
                ) : (
                  <MicrophoneIcon className="h-5 w-5" />
                )}
              </button>
            </div>

            <Button
              onClick={handleSend}
              disabled={!inputValue.trim() || isProcessing}
              className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 px-5 flex-shrink-0"
            >
              <PaperAirplaneIcon className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-xs text-center text-muted-foreground mt-2">
            Clara AI is powered by Llama 3.1 LLM with RAG for accurate responses
          </p>
        </div>
      </Card>

      {/* Ticket Info (if created) */}
      {ticketCreated && (
        <Card className="mt-4 bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-green-500 rounded-lg flex items-center justify-center">
                  <DocumentTextIcon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-green-800">{ticketCreated.ticket_number}</p>
                  <p className="text-sm text-green-600">Ticket created successfully</p>
                </div>
              </div>
              <div className="text-right">
                <span className="px-2 py-1 bg-green-200 text-green-800 text-xs rounded-full">
                  {ticketCreated.status}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ChatSupportPage;
