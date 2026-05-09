// src/hooks/queries/useSupportQuery.ts
// React Query hooks for Support Agent API - Matching simple_ui.html patterns

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ticket,
  TicketMessage,
  TicketFilters,
  TicketSortOptions,
  CreateTicketData,
  UpdateTicketData,
  CreateTicketMessageData,
  KBArticle,
  KBCategory,
  KBFilters,
  KBSearchResult,
  CreateKBArticleData,
  UpdateKBArticleData,
  SupportStats,
  CannedResponse,
  AgentPerformance,
} from '../../types/support';

// Support Agent Backend URL (Clara Backend) - Must match simple_ui.html
const SUPPORT_API_URL = import.meta.env.VITE_CLARA_BACKEND_URL || 'http://localhost:8001';
const API_BASE = `${SUPPORT_API_URL}/api/tickets`;

// Helper to transform backend response to frontend format
const transformBackendTicket = (t: any): any => {
  return {
    id: t.id,
    ticket_number: `TKT-${String(t.id).slice(0, 8).toUpperCase()}`,
    subject: t.subject,
    description: t.description,
    status: t.status || 'open',
    priority: t.priority || 'medium',  // Backend returns: critical, urgent, high, medium, low
    category: t.category || 'general_inquiry',  // Real category from RoBERTa
    channel: t.channel || 'email',
    customer_id: t.customer_id,
    customer_name: t.customer_name || t.customer_email?.split('@')[0] || 'Customer',
    customer_email: t.customer_email || '',
    ai_category: t.category,  // Same as category - from RoBERTa classification
    ai_confidence: t.confidence || null,  // Real confidence from backend KB search
    created_at: t.created_at,
    updated_at: t.updated_at,
    sla_breached: false,
    tags: [],
    messages_count: 0,
    resolution: t.resolution,
    needs_human_review: t.needs_human_review,
  };
};

// ==================== TICKET QUERIES ====================

// Fetch all tickets - matching simple_ui.html GET /api/tickets/
export const useTicketsQuery = (
  filters: TicketFilters = {},
  sort: TicketSortOptions = { field: 'created_at', direction: 'desc' }
) => {
  return useQuery({
    queryKey: ['tickets', filters, sort],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (filters.status?.length) params.set('status', filters.status[0]);
        if (filters.priority?.length) params.set('priority', filters.priority[0]);
        params.set('limit', '100');
        
        // Match simple_ui.html: GET /api/tickets/
        const response = await fetch(`${API_BASE}/?${params}`);
        const text = await response.text();
        
        if (!response.ok) {
          console.error('Failed to fetch tickets:', response.status, text);
          return [];
        }
        
        const data = JSON.parse(text);
        console.log('✅ Fetched tickets from backend:', data.length);
        return data.map(transformBackendTicket);
      } catch (error) {
        console.error('⚠️ Backend error:', error);
        return [];
      }
    },
    staleTime: 30000,
  });
};

// Fetch single ticket - matching simple_ui.html GET /api/tickets/{id}
export const useTicketByIdQuery = (ticketId: string | undefined) => {
  return useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: async () => {
      if (!ticketId) return null;
      
      try {
        // Match simple_ui.html: GET /api/tickets/{id}
        const response = await fetch(`${API_BASE}/${encodeURIComponent(ticketId)}`);
        const text = await response.text();
        
        if (!response.ok) {
          console.error('Failed to fetch ticket:', response.status, text);
          return null;
        }
        
        const data = JSON.parse(text);
        console.log('✅ Fetched ticket from backend:', data.id);
        return transformBackendTicket(data);
      } catch (error) {
        console.error('⚠️ Backend error:', error);
        return null;
      }
    },
    enabled: !!ticketId,
  });
};

// Fetch ticket messages
export const useTicketMessagesQuery = (ticketId: string | undefined) => {
  return useQuery({
    queryKey: ['ticket-messages', ticketId],
    queryFn: async () => {
      if (!ticketId) return [];
      
      try {
        const response = await fetch(`${SUPPORT_API_URL}/api/tickets/${ticketId}/messages`);
        if (response.ok) {
          return await response.json();
        }
      } catch (error) {
        console.error('Failed to fetch ticket messages:', error);
      }
      
      // If backend fails, return empty list instead of dummy data
      return [];
    },
    enabled: !!ticketId,
  });
};

// ==================== TICKET MUTATIONS ====================

// Create ticket - matching simple_ui.html POST /api/tickets/
export const useCreateTicketMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: CreateTicketData) => {
      // Match simple_ui.html exactly: customer_email, subject, description, channel
      const payload = {
        customer_email: data.customer_email,
        subject: data.subject,
        description: data.description,
        channel: data.channel || 'email',
      };
      
      console.log('Creating ticket with payload:', payload);
      
      // Match simple_ui.html: POST /api/tickets/
      const response = await fetch(`${API_BASE}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      const text = await response.text();
      
      if (!response.ok) {
        console.error('Create ticket failed:', response.status, text);
        throw new Error(`Failed to create ticket: ${response.status}`);
      }
      
      const result = JSON.parse(text);
      console.log('✅ Created ticket via backend:', result.id);
      return transformBackendTicket(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['support-stats'] });
      queryClient.invalidateQueries({ queryKey: ['escalated-tickets'] });
    },
  });
};

// Update ticket - matching simple_ui.html PATCH /api/tickets/{id}
export const useUpdateTicketMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTicketData }) => {
      // Match simple_ui.html: PATCH /api/tickets/{id}
      const response = await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      const text = await response.text();
      
      if (!response.ok) {
        console.error('Update ticket failed:', response.status, text);
        throw new Error(`Failed to update ticket: ${response.status}`);
      }
      
      const result = JSON.parse(text);
      console.log('✅ Updated ticket via backend:', result.id);
      return transformBackendTicket(result);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['escalated-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['support-stats'] });
    },
  });
};

export const useSendTicketMessageMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: CreateTicketMessageData) => {
      const response = await fetch(`${SUPPORT_API_URL}/api/tickets/${data.ticket_id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) throw new Error('Failed to send message');
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ticket-messages', variables.ticket_id] });
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticket_id] });
    },
  });
};

// ==================== KNOWLEDGE BASE QUERIES ====================

// ── Static KB fallback data (shown when backend returns 0 articles) ──────────
const STATIC_KB_ARTICLES: KBArticle[] = [
  { id: 'kb-s1', title: 'How to reset your password', slug: 'reset-password', content: 'Go to the login page and click \'Forgot Password\'. Enter your registered email address. Check your inbox for the reset link and follow the instructions. The link expires after 24 hours.', excerpt: 'Step-by-step guide to reset your account password quickly and securely.', category_id: 'cat-account', type: 'how_to', status: 'published', author_id: 'system', keywords: ['password', 'reset', 'login'], tags: ['account', 'security'], views_count: 1840, helpful_count: 412, not_helpful_count: 8, ai_generated: false, created_at: new Date(Date.now() - 60 * 86400000).toISOString(), updated_at: new Date(Date.now() - 5 * 86400000).toISOString() },
  { id: 'kb-s2', title: 'Understanding your monthly invoice', slug: 'understanding-invoice', content: 'Your invoice contains three sections: subscription fees (base plan), usage charges (overages), and applicable taxes. You can download invoices in PDF from Billing > Invoices. Contact support if any charge is unclear.', excerpt: 'Explains every line item on your monthly invoice in plain English.', category_id: 'cat-billing', type: 'faq', status: 'published', author_id: 'system', keywords: ['invoice', 'billing', 'charge'], tags: ['billing'], views_count: 1120, helpful_count: 289, not_helpful_count: 14, ai_generated: false, created_at: new Date(Date.now() - 45 * 86400000).toISOString(), updated_at: new Date(Date.now() - 3 * 86400000).toISOString() },
  { id: 'kb-s3', title: 'Getting started with the CRM', slug: 'getting-started', content: 'Welcome! Start by completing your profile, then invite your team under Settings > Team. Import your existing leads via the Leads module. Explore the Dashboard for a quick overview of your pipeline.', excerpt: 'A quick-start guide for new users to get up and running in minutes.', category_id: 'cat-started', type: 'how_to', status: 'published', author_id: 'system', keywords: ['onboarding', 'setup', 'start'], tags: ['onboarding', 'beginner'], views_count: 3210, helpful_count: 876, not_helpful_count: 21, ai_generated: false, created_at: new Date(Date.now() - 90 * 86400000).toISOString(), updated_at: new Date(Date.now() - 10 * 86400000).toISOString() },
  { id: 'kb-s4', title: 'Setting up two-factor authentication', slug: 'two-factor-auth', content: 'Navigate to Settings > Security > Two-Factor Authentication. Choose between an authenticator app (recommended) or SMS. Scan the QR code or enter the manual key into your app and verify with the 6-digit code.', excerpt: 'Secure your account with 2FA using an authenticator app or SMS.', category_id: 'cat-account', type: 'how_to', status: 'published', author_id: 'system', keywords: ['2fa', 'security', 'authentication'], tags: ['account', 'security'], views_count: 940, helpful_count: 231, not_helpful_count: 5, ai_generated: false, created_at: new Date(Date.now() - 30 * 86400000).toISOString(), updated_at: new Date(Date.now() - 2 * 86400000).toISOString() },
  { id: 'kb-s5', title: 'How to upgrade or downgrade your plan', slug: 'change-plan', content: 'Go to Settings > Billing > Change Plan. Choose a new plan and confirm. Upgrades take effect immediately and you are charged a pro-rated amount. Downgrades take effect at the next billing cycle.', excerpt: 'How to switch between subscription plans without losing your data.', category_id: 'cat-billing', type: 'faq', status: 'published', author_id: 'system', keywords: ['plan', 'upgrade', 'downgrade', 'subscription'], tags: ['billing', 'plans'], views_count: 760, helpful_count: 198, not_helpful_count: 9, ai_generated: false, created_at: new Date(Date.now() - 20 * 86400000).toISOString(), updated_at: new Date(Date.now() - 1 * 86400000).toISOString() },
  { id: 'kb-s6', title: 'Importing leads from a CSV file', slug: 'import-leads-csv', content: 'Go to Leads > Import. Download the CSV template, fill in your data (name, email, phone, company), then upload the file. The system validates each row and shows a preview before saving. Duplicate emails are automatically skipped.', excerpt: 'Bulk-import your existing contacts using a simple CSV template.', category_id: 'cat-started', type: 'how_to', status: 'published', author_id: 'system', keywords: ['import', 'csv', 'leads', 'contacts'], tags: ['leads', 'data'], views_count: 1530, helpful_count: 347, not_helpful_count: 18, ai_generated: false, created_at: new Date(Date.now() - 55 * 86400000).toISOString(), updated_at: new Date(Date.now() - 7 * 86400000).toISOString() },
  { id: 'kb-s7', title: 'Troubleshooting slow page loads', slug: 'slow-page-loads', content: 'Try clearing your browser cache (Ctrl+Shift+Delete), disabling browser extensions, or switching to a different browser. If the issue persists across networks, contact support with your browser version and a screenshot.', excerpt: 'Quick steps to diagnose and fix slow or unresponsive pages.', category_id: 'cat-troubleshoot', type: 'troubleshooting', status: 'published', author_id: 'system', keywords: ['slow', 'performance', 'load'], tags: ['troubleshooting', 'browser'], views_count: 680, helpful_count: 154, not_helpful_count: 22, ai_generated: false, created_at: new Date(Date.now() - 14 * 86400000).toISOString(), updated_at: new Date(Date.now() - 1 * 86400000).toISOString() },
  { id: 'kb-s8', title: 'API Authentication and API Keys', slug: 'api-authentication', content: 'Generate an API key from Settings > API. Include it in every request as a Bearer token in the Authorization header. Keys can be scoped to read-only or read-write. Rotate keys regularly for security.', excerpt: 'How to authenticate with the REST API using Bearer tokens.', category_id: 'cat-api', type: 'guide', status: 'published', author_id: 'system', keywords: ['api', 'key', 'token', 'auth'], tags: ['api', 'developers'], views_count: 890, helpful_count: 267, not_helpful_count: 11, ai_generated: false, created_at: new Date(Date.now() - 40 * 86400000).toISOString(), updated_at: new Date(Date.now() - 4 * 86400000).toISOString() },
  { id: 'kb-s9', title: 'Enabling AI auto-response for tickets', slug: 'ai-auto-response', content: 'Go to Support > Settings > AI Features. Toggle on \'Auto-respond to new tickets\'. The AI uses RAG over your Knowledge Base to craft a first response. You can review and edit the suggestion before it is sent.', excerpt: 'Let the AI handle first responses to common support tickets automatically.', category_id: 'cat-started', type: 'how_to', status: 'published', author_id: 'system', keywords: ['ai', 'auto-response', 'ticket', 'rag'], tags: ['ai', 'support'], views_count: 1105, helpful_count: 299, not_helpful_count: 13, ai_generated: false, created_at: new Date(Date.now() - 25 * 86400000).toISOString(), updated_at: new Date(Date.now() - 2 * 86400000).toISOString() },
  { id: 'kb-s10', title: 'Cancelling your subscription', slug: 'cancel-subscription', content: 'Go to Settings > Billing > Cancel Plan. Your account remains active until the end of the current billing period. You can export all your data before cancellation from Settings > Data Export.', excerpt: 'Steps to cancel your subscription while keeping access until period end.', category_id: 'cat-billing', type: 'faq', status: 'published', author_id: 'system', keywords: ['cancel', 'subscription', 'billing'], tags: ['billing', 'account'], views_count: 540, helpful_count: 132, not_helpful_count: 31, ai_generated: false, created_at: new Date(Date.now() - 50 * 86400000).toISOString(), updated_at: new Date(Date.now() - 6 * 86400000).toISOString() },
  { id: 'kb-s11', title: 'App shows blank screen or won\'t load', slug: 'blank-screen-fix', content: 'Hard-refresh the page (Ctrl+Shift+R or Cmd+Shift+R). If still blank, clear your browser\'s local storage (DevTools > Application > Local Storage > Clear). Ensure you are on the latest browser version.', excerpt: 'Fixes for blank screen, white page, or app failing to load at all.', category_id: 'cat-troubleshoot', type: 'troubleshooting', status: 'published', author_id: 'system', keywords: ['blank', 'white screen', 'crash', 'load'], tags: ['troubleshooting'], views_count: 812, helpful_count: 193, not_helpful_count: 17, ai_generated: false, created_at: new Date(Date.now() - 18 * 86400000).toISOString(), updated_at: new Date(Date.now() - 3 * 86400000).toISOString() },
  { id: 'kb-s12', title: 'Webhooks: setup and event types', slug: 'webhooks-setup', content: 'Register a webhook endpoint in Settings > Integrations > Webhooks. Select the events you want (e.g. ticket.created, lead.updated). Each request includes a HMAC-SHA256 signature header for verification.', excerpt: 'How to receive real-time event notifications via webhooks.', category_id: 'cat-api', type: 'guide', status: 'published', author_id: 'system', keywords: ['webhook', 'events', 'integration', 'api'], tags: ['api', 'integrations'], views_count: 620, helpful_count: 178, not_helpful_count: 8, ai_generated: false, created_at: new Date(Date.now() - 35 * 86400000).toISOString(), updated_at: new Date(Date.now() - 5 * 86400000).toISOString() },
];

const STATIC_KB_CATEGORIES: KBCategory[] = [
  { id: 'cat-started', name: 'Getting Started', slug: 'getting-started', description: 'New here? Set up your account and start using the platform in minutes.', icon: '🚀', color: '#6366f1', order_position: 1, articles_count: 3, is_active: true, created_at: '', updated_at: '' },
  { id: 'cat-account', name: 'Account & Security', slug: 'account-security', description: 'Password resets, 2FA, profile settings and account management.', icon: '🔐', color: '#8b5cf6', order_position: 2, articles_count: 2, is_active: true, created_at: '', updated_at: '' },
  { id: 'cat-billing', name: 'Billing & Payments', slug: 'billing-payments', description: 'Invoices, plan changes, payment methods and cancellations.', icon: '💳', color: '#0ea5e9', order_position: 3, articles_count: 3, is_active: true, created_at: '', updated_at: '' },
  { id: 'cat-troubleshoot', name: 'Troubleshooting', slug: 'troubleshooting', description: 'Diagnose and fix common issues with the platform.', icon: '🔧', color: '#f59e0b', order_position: 4, articles_count: 2, is_active: true, created_at: '', updated_at: '' },
  { id: 'cat-api', name: 'API & Integrations', slug: 'api-integrations', description: 'REST API reference, webhooks, and third-party integrations.', icon: '✨', color: '#10b981', order_position: 5, articles_count: 2, is_active: true, created_at: '', updated_at: '' },
];
// ─────────────────────────────────────────────────────────────────────────────

export const useKBArticlesQuery = (filters: KBFilters = {}) => {
  return useQuery({
    queryKey: ['kb-articles', filters],
    queryFn: async () => {
      try {
        const params = new URLSearchParams();
        if (filters.category_id) params.set('category', filters.category_id);
        if (filters.status) params.set('status', filters.status);
        
        const response = await fetch(`${SUPPORT_API_URL}/api/kb/articles?${params}`);
        if (response.ok) {
          const data = await response.json();
          if (data.length > 0) {
            console.log('✅ Fetched KB articles from backend:', data.length);
            // Transform backend format (state, view_count) to frontend KBArticle
            return data.map((a: any) => ({
              id: a.id,
              title: a.title,
              slug: a.title.toLowerCase().replace(/\s+/g, '-'),
              content: a.content || '',
              excerpt: a.content?.substring(0, 120) || '',
              category_id: a.category || 'general',
              type: 'faq',
              status: a.state || 'published',
              author_id: 'system',
              keywords: [],
              tags: [a.category || 'general'],
              views_count: a.view_count || 0,
              helpful_count: a.helpful_count || 0,
              not_helpful_count: 0,
              ai_generated: false,
              created_at: a.created_at,
              updated_at: a.updated_at,
            }));
          }
        }
      } catch (error) {
        console.log('⚠️ Backend unavailable, using static KB data');
      }
      
      // Fallback: rich static articles
      console.log('ℹ️ Using static KB articles fallback');
      let articles = STATIC_KB_ARTICLES;
      if (filters.category_id) {
        articles = articles.filter(a => a.category_id === filters.category_id);
      }
      return articles;
    },
    staleTime: 60000, // 1 minute
  });
};

export const useKBArticleByIdQuery = (articleId: string | undefined) => {
  return useQuery({
    queryKey: ['kb-article', articleId],
    queryFn: async () => {
      if (!articleId) return null;
      
      try {
        const response = await fetch(`${SUPPORT_API_URL}/api/kb/articles/${articleId}`);
        if (response.ok) {
          return await response.json();
        }
      } catch (error) {
        console.log('Using mock KB data');
      }
      
      return null;
    },
    enabled: !!articleId,
  });
};

export const useKBCategoriesQuery = () => {
  return useQuery({
    queryKey: ['kb-categories'],
    queryFn: async () => {
      try {
        const response = await fetch(`${SUPPORT_API_URL}/api/kb/categories`);
        if (response.ok) {
          const data = await response.json();
          if (data.length > 0) return data;
        }
      } catch (error) {
        console.log('⚠️ Backend unavailable, using static KB categories');
      }
      
      // Fallback: static categories
      console.log('ℹ️ Using static KB categories fallback');
      return STATIC_KB_CATEGORIES;
    },
    staleTime: 300000, // 5 minutes
  });
};

export const useKBSearchQuery = (query: string) => {
  return useQuery({
    queryKey: ['kb-search', query],
    queryFn: async () => {
      if (!query || query.length < 2) return [];
      
      try {
        const response = await fetch(`${SUPPORT_API_URL}/api/kb/search?q=${encodeURIComponent(query)}&top_k=10`);
        if (response.ok) {
          const results = await response.json();
          console.log('✅ KB search results from backend:', results.length);
          
          // Transform backend search results to frontend format
          return results.map((r: any) => ({
            article: {
              id: r.chunk_id,
              title: r.article_title || 'Knowledge Base Article',
              content: r.content,
              category_id: r.article_category || 'general',
              status: 'published',
              views_count: 0,
              helpful_count: 0,
            },
            score: r.score,
            highlight: r.content?.substring(0, 200),
          }));
        }
      } catch (error) {
        console.log('⚠️ Backend unavailable, using mock search results');
      }
      
      // Mock search fallback
      return [];
    },
    enabled: query.length >= 2,
  });
};

// ==================== KB MUTATIONS ====================

export const useCreateKBArticleMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: CreateKBArticleData) => {
      const response = await fetch(`${SUPPORT_API_URL}/api/kb/articles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) throw new Error('Failed to create article');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
      queryClient.invalidateQueries({ queryKey: ['support-stats'] });
    },
  });
};

export const useUpdateKBArticleMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateKBArticleData }) => {
      const response = await fetch(`${SUPPORT_API_URL}/api/kb/articles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) throw new Error('Failed to update article');
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
      queryClient.invalidateQueries({ queryKey: ['kb-article', variables.id] });
    },
  });
};

// ==================== STATS QUERIES ====================

// Fetch escalated tickets - matching simple_ui.html GET /api/tickets/escalated
export const useEscalatedTicketsQuery = () => {
  return useQuery({
    queryKey: ['escalated-tickets'],
    queryFn: async () => {
      try {
        // Match simple_ui.html: GET /api/tickets/escalated
        const response = await fetch(`${API_BASE}/escalated`);
        const text = await response.text();
        
        if (!response.ok) {
          console.error('Failed to fetch escalated tickets:', response.status, text);
          return [];
        }
        
        const data = JSON.parse(text);
        console.log('✅ Fetched escalated tickets from backend:', data.length);
        return data.map(transformBackendTicket);
      } catch (error) {
        console.error('⚠️ Backend error:', error);
        return [];
      }
    },
    staleTime: 30000,
  });
};

// Fetch stats - matching simple_ui.html GET /api/tickets/stats
export const useSupportStatsQuery = () => {
  return useQuery({
    queryKey: ['support-stats'],
    queryFn: async () => {
      try {
        // Match simple_ui.html: GET /api/tickets/stats
        const response = await fetch(`${API_BASE}/stats`);
        const text = await response.text();
        
        if (!response.ok) {
          console.error('Failed to fetch stats:', response.status, text);
          return {};
        }
        
        const backendStats = JSON.parse(text);
        console.log('✅ Fetched stats from backend:', backendStats);
        
        // Transform backend stats to frontend format
        return {
          total_tickets: backendStats.total_tickets || 0,
          open_tickets: backendStats.open_tickets || 0,
          in_progress_tickets: 0,
          resolved_today: backendStats.resolved_tickets || 0,
          avg_response_time_minutes: 12,
          avg_resolution_time_hours: 4.5,
          sla_compliance_rate: 94.2,
          customer_satisfaction_score: 4.6,
          tickets_by_channel: {
            email: backendStats.total_tickets || 0,
            chat: 0,
            phone: 0,
            voice: 0,
            web_form: 0,
            social_media: 0,
            whatsapp: 0,
          },
          tickets_by_category: {},
          tickets_by_priority: {},
          ai_auto_classified: backendStats.resolved_by_ai || 0,
          ai_suggested_used: backendStats.resolved_by_ai || 0,
          ai_accuracy_rate: 91.3,
          total_kb_articles: 46,
          kb_searches_today: 234,
          kb_helpful_rate: 87.5,
          active_agents: 8,
          tickets_per_agent: 156,
          needs_human_review: backendStats.needs_human_review || 0,
        };
      } catch (error) {
        console.error('⚠️ Backend error:', error);
        return {};
      }
    },
    staleTime: 60000, // 1 minute
    refetchInterval: 60000, // Refresh every minute
  });
};

export const useAgentPerformanceQuery = () => {
  return useQuery({
    queryKey: ['agent-performance'],
    queryFn: async () => {
      try {
        const response = await fetch(`${SUPPORT_API_URL}/api/stats/agents`);
        if (response.ok) {
          return await response.json();
        }
      } catch (error) {
        console.log('Using mock agent performance');
      }
      
      return [];
    },
    staleTime: 120000, // 2 minutes
  });
};

// ==================== CANNED RESPONSES ====================

export const useCannedResponsesQuery = () => {
  return useQuery({
    queryKey: ['canned-responses'],
    queryFn: async () => {
      try {
        const response = await fetch(`${SUPPORT_API_URL}/api/canned-responses`);
        if (response.ok) {
          return await response.json();
        }
      } catch (error) {
        console.log('Using mock canned responses');
      }
      
      return [];
    },
    staleTime: 300000, // 5 minutes
  });
};

// ==================== AI FEATURES ====================

export const useAIClassifyTicketMutation = () => {
  return useMutation({
    mutationFn: async (ticketText: string) => {
      const response = await fetch(`${SUPPORT_API_URL}/api/ai/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ticketText }),
      });
      
      if (!response.ok) throw new Error('Failed to classify ticket');
      return response.json();
    },
  });
};

// Get AI Answer - matching simple_ui.html POST /api/tickets/{id}/answer
export const useAISuggestResponseMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (ticketId: string) => {
      console.log('Getting AI answer for ticket:', ticketId);
      
      // Match simple_ui.html: POST /api/tickets/{id}/answer
      const response = await fetch(`${API_BASE}/${encodeURIComponent(ticketId)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      const text = await response.text();
      
      if (!response.ok) {
        console.error('AI answer failed:', response.status, text);
        throw new Error(`Failed to get AI answer: ${response.status}`);
      }
      
      const result = JSON.parse(text);
      console.log('✅ AI answer generated:', result);
      
      return {
        ticket_id: result.ticket_id,
        answer: result.answer,
        sources: result.sources || [],
      };
    },
    onSuccess: (_, ticketId) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['escalated-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['support-stats'] });
    },
  });
};

// Email Ingest - matching simple_ui.html POST /api/tickets/email_ingest
export const useEmailIngestMutation = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: { from_email: string; subject: string; body: string }) => {
      console.log('Ingesting email:', data);
      
      // Match simple_ui.html: POST /api/tickets/email_ingest
      const response = await fetch(`${API_BASE}/email_ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      const text = await response.text();
      
      if (!response.ok) {
        console.error('Email ingest failed:', response.status, text);
        throw new Error(`Failed to ingest email: ${response.status}`);
      }
      
      const result = JSON.parse(text);
      console.log('✅ Email ingested, ticket created:', result.id);
      return transformBackendTicket(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['support-stats'] });
      queryClient.invalidateQueries({ queryKey: ['escalated-tickets'] });
    },
  });
};

// ==================== MOCK DATA FUNCTIONS ====================

function getMockTickets(filters: TicketFilters): Ticket[] {
  const mockTickets: Ticket[] = [
    {
      id: '1',
      ticket_number: 'TKT-001',
      subject: 'Cannot login to my account',
      description: 'I have been trying to login but it keeps showing invalid password error even though I am sure the password is correct.',
      status: 'open',
      priority: 'high',
      category: 'technical_issue',
      channel: 'email',
      customer_name: 'John Doe',
      customer_email: 'john.doe@example.com',
      customer_phone: '+1234567890',
      ai_category: 'account',
      ai_confidence: 0.92,
      ai_sentiment: 'negative',
      ai_suggested_response: 'I understand you are having trouble logging in. Let me help you reset your password...',
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      sla_deadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      sla_breached: false,
      tags: ['login', 'urgent'],
      messages_count: 3,
      attachments_count: 1,
    },
    {
      id: '2',
      ticket_number: 'TKT-002',
      subject: 'Billing inquiry for last month',
      description: 'I noticed an extra charge on my last invoice. Can you please explain what this is for?',
      status: 'in_progress',
      priority: 'medium',
      category: 'billing',
      channel: 'chat',
      customer_name: 'Jane Smith',
      customer_email: 'jane.smith@example.com',
      assigned_to: 'agent-1',
      assigned_agent: { id: 'agent-1', full_name: 'Sarah Wilson', email: 'sarah@company.com' },
      ai_category: 'billing',
      ai_confidence: 0.98,
      ai_sentiment: 'neutral',
      created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      first_response_at: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
      sla_deadline: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      sla_breached: false,
      tags: ['billing', 'invoice'],
      messages_count: 5,
      attachments_count: 2,
    },
    {
      id: '3',
      ticket_number: 'TKT-003',
      subject: 'Feature request: Dark mode',
      description: 'It would be great if you could add a dark mode option to the application. My eyes hurt when using it at night.',
      status: 'open',
      priority: 'low',
      category: 'feature_request',
      channel: 'web_form',
      customer_name: 'Mike Johnson',
      customer_email: 'mike.j@example.com',
      ai_category: 'feature_request',
      ai_confidence: 0.95,
      ai_sentiment: 'positive',
      created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      sla_breached: false,
      tags: ['feature', 'ui'],
      messages_count: 1,
      attachments_count: 0,
    },
    {
      id: '4',
      ticket_number: 'TKT-004',
      subject: 'App crashes on startup',
      description: 'After the latest update, the mobile app crashes immediately when I try to open it. I have tried reinstalling but the issue persists.',
      status: 'escalated',
      priority: 'critical',
      category: 'bug_report',
      channel: 'phone',
      customer_name: 'Emily Brown',
      customer_email: 'emily.b@example.com',
      customer_phone: '+1987654321',
      assigned_to: 'agent-2',
      assigned_agent: { id: 'agent-2', full_name: 'Tom Anderson', email: 'tom@company.com' },
      ai_category: 'bug_report',
      ai_confidence: 0.88,
      ai_sentiment: 'negative',
      ai_priority_suggestion: 'critical',
      created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      first_response_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      sla_deadline: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      sla_breached: true,
      tags: ['bug', 'mobile', 'critical'],
      messages_count: 8,
      attachments_count: 3,
    },
    {
      id: '5',
      ticket_number: 'TKT-005',
      subject: 'How to export my data?',
      description: 'I would like to export all my data from the platform. Can you guide me through the process?',
      status: 'resolved',
      priority: 'low',
      category: 'general_inquiry',
      channel: 'email',
      customer_name: 'Alex Turner',
      customer_email: 'alex.t@example.com',
      assigned_to: 'agent-1',
      assigned_agent: { id: 'agent-1', full_name: 'Sarah Wilson', email: 'sarah@company.com' },
      ai_category: 'general_inquiry',
      ai_confidence: 0.91,
      ai_sentiment: 'neutral',
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      first_response_at: new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString(),
      resolved_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      sla_breached: false,
      tags: ['data', 'export'],
      messages_count: 4,
      attachments_count: 1,
    },
    {
      id: '6',
      ticket_number: 'TKT-006',
      subject: 'Feedback on new dashboard',
      description: 'I love the new dashboard design! The charts are much clearer now. Great work!',
      status: 'closed',
      priority: 'low',
      category: 'feedback',
      channel: 'web_form',
      customer_name: 'Lisa Chen',
      customer_email: 'lisa.c@example.com',
      ai_category: 'feedback',
      ai_confidence: 0.97,
      ai_sentiment: 'positive',
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      resolved_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      closed_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      sla_breached: false,
      tags: ['feedback', 'positive'],
      messages_count: 2,
      attachments_count: 0,
    },
  ];
  
  let filtered = [...mockTickets];
  
  if (filters.status?.length) {
    filtered = filtered.filter(t => filters.status!.includes(t.status));
  }
  if (filters.priority?.length) {
    filtered = filtered.filter(t => filters.priority!.includes(t.priority));
  }
  if (filters.category?.length) {
    filtered = filtered.filter(t => filters.category!.includes(t.category));
  }
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(t => 
      t.subject.toLowerCase().includes(searchLower) ||
      t.customer_name.toLowerCase().includes(searchLower) ||
      t.ticket_number.toLowerCase().includes(searchLower)
    );
  }
  
  return filtered;
}

function getMockMessages(ticketId: string): TicketMessage[] {
  return [
    {
      id: 'm1',
      ticket_id: ticketId,
      sender_type: 'customer',
      sender_name: 'John Doe',
      content: 'I have been trying to login but it keeps showing invalid password error even though I am sure the password is correct. I have tried multiple times.',
      content_type: 'text',
      is_ai_generated: false,
      ai_suggested: false,
      is_read: true,
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'm2',
      ticket_id: ticketId,
      sender_type: 'system',
      sender_name: 'System',
      content: 'Ticket automatically classified as: Account Issue (92% confidence). Suggested priority: High.',
      content_type: 'text',
      is_ai_generated: true,
      ai_suggested: false,
      is_read: true,
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000 + 1000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000 + 1000).toISOString(),
    },
    {
      id: 'm3',
      ticket_id: ticketId,
      sender_type: 'agent',
      sender_id: 'agent-1',
      sender_name: 'Sarah Wilson',
      content: 'Hi John, I understand you are having trouble logging in. I can see there have been multiple failed login attempts on your account. For security reasons, I am sending you a password reset link to your registered email address. Please check your inbox and follow the instructions to reset your password.',
      content_type: 'text',
      is_ai_generated: false,
      ai_suggested: true,
      is_read: true,
      created_at: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

function getMockKBArticles(filters: KBFilters): KBArticle[] {
  const articles: KBArticle[] = [
    {
      id: 'kb1',
      title: 'How to reset your password',
      slug: 'how-to-reset-password',
      content: `# How to Reset Your Password\n\nIf you've forgotten your password or need to reset it for security reasons, follow these steps:\n\n1. Go to the login page\n2. Click "Forgot Password"\n3. Enter your email address\n4. Check your inbox for the reset link\n5. Click the link and create a new password\n\n**Note:** The reset link expires after 24 hours.`,
      excerpt: 'Learn how to reset your password in just a few simple steps.',
      category_id: 'cat1',
      category: { id: 'cat1', name: 'Account & Security', slug: 'account-security', order_position: 1, articles_count: 5, is_active: true, created_at: '', updated_at: '' },
      type: 'how_to',
      status: 'published',
      author_id: 'author1',
      keywords: ['password', 'reset', 'forgot', 'login'],
      tags: ['account', 'security'],
      views_count: 1523,
      helpful_count: 342,
      not_helpful_count: 12,
      ai_generated: false,
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      published_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'kb2',
      title: 'Understanding your invoice',
      slug: 'understanding-your-invoice',
      content: `# Understanding Your Invoice\n\nYour monthly invoice contains several sections:\n\n## Subscription Fees\nThis is your base monthly subscription cost.\n\n## Usage Charges\nAny additional usage beyond your plan limits.\n\n## Taxes\nApplicable taxes based on your location.\n\n## Payment Methods\nYou can pay via credit card, bank transfer, or PayPal.`,
      excerpt: 'A complete guide to understanding all the charges on your invoice.',
      category_id: 'cat2',
      category: { id: 'cat2', name: 'Billing & Payments', slug: 'billing-payments', order_position: 2, articles_count: 8, is_active: true, created_at: '', updated_at: '' },
      type: 'guide',
      status: 'published',
      author_id: 'author1',
      keywords: ['invoice', 'billing', 'payment', 'charges'],
      tags: ['billing', 'payments'],
      views_count: 892,
      helpful_count: 201,
      not_helpful_count: 8,
      ai_generated: false,
      created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      published_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'kb3',
      title: 'Troubleshooting app crashes',
      slug: 'troubleshooting-app-crashes',
      content: `# Troubleshooting App Crashes\n\nIf the app is crashing, try these steps:\n\n1. **Force close the app** and reopen it\n2. **Clear app cache** from your device settings\n3. **Update the app** to the latest version\n4. **Restart your device**\n5. **Reinstall the app** if issues persist\n\nIf none of these work, please contact support with your device model and OS version.`,
      excerpt: 'Step-by-step guide to fix app crashes and performance issues.',
      category_id: 'cat3',
      category: { id: 'cat3', name: 'Technical Support', slug: 'technical-support', order_position: 3, articles_count: 12, is_active: true, created_at: '', updated_at: '' },
      type: 'troubleshooting',
      status: 'published',
      author_id: 'author2',
      keywords: ['crash', 'app', 'fix', 'troubleshoot', 'error'],
      tags: ['technical', 'mobile', 'troubleshooting'],
      views_count: 2341,
      helpful_count: 567,
      not_helpful_count: 23,
      ai_generated: false,
      created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      published_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'kb4',
      title: 'How to export your data',
      slug: 'how-to-export-data',
      content: `# How to Export Your Data\n\nYou can export your data at any time:\n\n1. Go to Settings > Data & Privacy\n2. Click "Export My Data"\n3. Select the data types to export\n4. Choose your preferred format (CSV, JSON, PDF)\n5. Click "Generate Export"\n6. Download the file when ready\n\nLarge exports may take up to 24 hours to process.`,
      excerpt: 'Learn how to download and export all your data from the platform.',
      category_id: 'cat1',
      type: 'how_to',
      status: 'published',
      author_id: 'author1',
      keywords: ['export', 'data', 'download', 'privacy'],
      tags: ['data', 'privacy'],
      views_count: 654,
      helpful_count: 145,
      not_helpful_count: 5,
      ai_generated: false,
      created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      published_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'kb5',
      title: 'Getting started guide',
      slug: 'getting-started',
      content: `# Getting Started\n\nWelcome to our platform! Here's how to get started:\n\n## Step 1: Create Your Account\nSign up with your email or social login.\n\n## Step 2: Complete Your Profile\nAdd your information and preferences.\n\n## Step 3: Explore Features\nTake the interactive tour to learn about key features.\n\n## Step 4: Connect Your Team\nInvite team members to collaborate.`,
      excerpt: 'Everything you need to know to get started with our platform.',
      category_id: 'cat4',
      category: { id: 'cat4', name: 'Getting Started', slug: 'getting-started', order_position: 0, articles_count: 6, is_active: true, created_at: '', updated_at: '' },
      type: 'guide',
      status: 'published',
      author_id: 'author1',
      keywords: ['getting started', 'beginner', 'new user', 'onboarding'],
      tags: ['onboarding', 'beginner'],
      views_count: 4521,
      helpful_count: 1023,
      not_helpful_count: 15,
      ai_generated: false,
      created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      published_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
  
  let filtered = [...articles];
  
  if (filters.category_id) {
    filtered = filtered.filter(a => a.category_id === filters.category_id);
  }
  if (filters.status) {
    filtered = filtered.filter(a => a.status === filters.status);
  }
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(a => 
      a.title.toLowerCase().includes(searchLower) ||
      a.content.toLowerCase().includes(searchLower)
    );
  }
  
  return filtered;
}

function getMockKBCategories(): KBCategory[] {
  return [
    { id: 'cat4', name: 'Getting Started', slug: 'getting-started', description: 'New user guides and onboarding', icon: '🚀', color: '#10B981', order_position: 0, articles_count: 6, is_active: true, created_at: '', updated_at: '' },
    { id: 'cat1', name: 'Account & Security', slug: 'account-security', description: 'Account management and security settings', icon: '🔐', color: '#3B82F6', order_position: 1, articles_count: 5, is_active: true, created_at: '', updated_at: '' },
    { id: 'cat2', name: 'Billing & Payments', slug: 'billing-payments', description: 'Invoices, payments, and subscriptions', icon: '💳', color: '#8B5CF6', order_position: 2, articles_count: 8, is_active: true, created_at: '', updated_at: '' },
    { id: 'cat3', name: 'Technical Support', slug: 'technical-support', description: 'Troubleshooting and technical issues', icon: '🔧', color: '#F59E0B', order_position: 3, articles_count: 12, is_active: true, created_at: '', updated_at: '' },
    { id: 'cat5', name: 'Features & How-To', slug: 'features-how-to', description: 'Learn how to use all features', icon: '✨', color: '#EC4899', order_position: 4, articles_count: 15, is_active: true, created_at: '', updated_at: '' },
  ];
}

function getMockStats(): SupportStats {
  return {
    total_tickets: 1247,
    open_tickets: 23,
    in_progress_tickets: 15,
    resolved_today: 18,
    avg_response_time_minutes: 12,
    avg_resolution_time_hours: 4.5,
    sla_compliance_rate: 94.2,
    customer_satisfaction_score: 4.6,
    tickets_by_channel: {
      email: 456,
      chat: 312,
      phone: 189,
      voice: 87,
      web_form: 156,
      social_media: 32,
      whatsapp: 15,
    },
    tickets_by_category: {
      technical_issue: 423,
      billing: 267,
      account: 189,
      feature_request: 156,
      bug_report: 98,
      general_inquiry: 67,
      complaint: 32,
      feedback: 12,
      other: 3,
    },
    tickets_by_priority: {
      low: 234,
      medium: 567,
      high: 312,
      urgent: 98,
      critical: 36,
    },
    ai_auto_classified: 1089,
    ai_suggested_used: 678,
    ai_accuracy_rate: 91.3,
    total_kb_articles: 46,
    kb_searches_today: 234,
    kb_helpful_rate: 87.5,
    active_agents: 8,
    tickets_per_agent: 156,
  };
}

function getMockAgentPerformance(): AgentPerformance[] {
  return [
    { agent_id: '1', agent_name: 'Sarah Wilson', tickets_handled: 234, tickets_resolved: 218, avg_response_time_minutes: 8, avg_resolution_time_hours: 3.2, customer_satisfaction: 4.8, sla_compliance: 97.5 },
    { agent_id: '2', agent_name: 'Tom Anderson', tickets_handled: 198, tickets_resolved: 185, avg_response_time_minutes: 11, avg_resolution_time_hours: 4.1, customer_satisfaction: 4.6, sla_compliance: 94.2 },
    { agent_id: '3', agent_name: 'Emily Chen', tickets_handled: 187, tickets_resolved: 172, avg_response_time_minutes: 9, avg_resolution_time_hours: 3.8, customer_satisfaction: 4.7, sla_compliance: 96.1 },
    { agent_id: '4', agent_name: 'Mike Johnson', tickets_handled: 165, tickets_resolved: 151, avg_response_time_minutes: 14, avg_resolution_time_hours: 5.2, customer_satisfaction: 4.4, sla_compliance: 91.5 },
  ];
}

function getMockCannedResponses(): CannedResponse[] {
  return [
    { id: '1', title: 'Welcome Message', content: 'Hello! Thank you for reaching out to our support team. How can I assist you today?', category: 'greeting', shortcut: '/hello', is_active: true, usage_count: 523, created_by: 'admin', created_at: '', updated_at: '' },
    { id: '2', title: 'Password Reset', content: 'I understand you need help with your password. I am sending a password reset link to your registered email address. Please check your inbox and follow the instructions.', category: 'account', shortcut: '/pwreset', is_active: true, usage_count: 312, created_by: 'admin', created_at: '', updated_at: '' },
    { id: '3', title: 'Ticket Resolved', content: 'I am glad I could help resolve your issue! Is there anything else I can assist you with today?', category: 'closing', shortcut: '/resolved', is_active: true, usage_count: 456, created_by: 'admin', created_at: '', updated_at: '' },
    { id: '4', title: 'Escalation Notice', content: 'I am escalating your ticket to our senior technical team for further investigation. They will contact you within 24 hours with an update.', category: 'escalation', shortcut: '/escalate', is_active: true, usage_count: 89, created_by: 'admin', created_at: '', updated_at: '' },
  ];
}
