/**
 * SalesHubPage - Main Sales Hub Dashboard
 * 
 * This page serves as the central hub for all sales-related activities
 * in the TrendtialCRM system. It connects to the Clara Sales Agent backend
 * for AI-powered voice calls and lead qualification.
 * 
 * Features:
 * - AI Call Center: Initiate AI-powered sales calls with leads
 * - Call Analytics: Performance tracking and qualification metrics
 * - Recent Calls: History of AI-handled calls with transcripts
 * 
 * Architecture:
 * - Frontend: React + TypeScript with TanStack Query for data fetching
 * - Backend: Clara Sales Agent (Python FastAPI)
 * - Voice: Groq Whisper (STT) + ElevenLabs eleven_turbo_v2_5 (TTS) + Llama 3.3 70B (LLM)
 * 
 * Related Files:
 * - Backend: clara-backend/agents/sales_agent/
 * - Voice: clara-backend/input_streams/voice_stream.py
 * - Components: src/components/sales/
 * 
 * Lead Qualification (BANT Framework):
 * - Budget: Financial capacity assessment
 * - Authority: Decision-making power identification
 * - Need: Business requirement evaluation
 * - Timeline: Purchase timeline determination
 * 
 * Lead Scoring (0-100):
 * - Company Fit: 0-25 points
 * - Engagement: 0-25 points
 * - BANT: 0-30 points
 * - Intent Signals: 0-20 points
 * 
 * @author Faheem
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLeadsQuery } from '../hooks/queries/useLeadsQuery';
import { Lead } from '../types';
import { CallStatistics } from '../types/sales';
import { salesCallApi, CRMCallRecord } from '../services/salesCallApi';
import { 
  PhoneIcon, 
  ChartBarIcon, 
  ClockIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

// =============================================================================
// TAB COMPONENTS
// =============================================================================

/**
 * CallDashboard - Overview statistics for AI sales calls
 * Shows total calls, avg duration, qualification rate, success rate
 */
import CallDashboard from '../components/sales/CallDashboard';

/**
 * AICallPanel - Interface to initiate AI-powered sales calls
 * Select a lead and start an AI voice conversation
 */
import AICallPanel from '../components/sales/AICallPanel';

/**
 * RecentAICalls - List of recent AI-handled calls
 * Shows call history with outcomes and quick actions
 */
import RecentAICalls from '../components/sales/RecentAICalls';

/**
 * CallAnalytics - Detailed analytics and charts
 * BANT completion rates, outcome distribution, qualification funnel
 */
import CallAnalytics from '../components/sales/CallAnalytics';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Available tabs in the Sales Hub
 */
type TabType = 'ai-calls' | 'analytics' | 'call-history';

/**
 * Tab configuration with id, label, and icon
 */
interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ReactNode;
  description: string;
}

// =============================================================================
// TAB CONFIGURATION
// =============================================================================

/**
 * Tab definitions with labels, icons, and descriptions
 * Icons use Heroicons for consistency with the rest of the app
 */
const TABS: TabConfig[] = [
  {
    id: 'ai-calls',
    label: 'AI Call Center',
    icon: <PhoneIcon className="h-5 w-5" />,
    description: 'Start AI-powered sales calls with leads'
  },
  {
    id: 'analytics',
    label: 'Call Analytics',
    icon: <ChartBarIcon className="h-5 w-5" />,
    description: 'View call performance and qualification metrics'
  },
  {
    id: 'call-history',
    label: 'Call History',
    icon: <ClockIcon className="h-5 w-5" />,
    description: 'Review past AI calls and transcripts'
  }
];

// =============================================================================
// EMPTY STATS (shown while loading or when backend is unavailable)
// =============================================================================

const EMPTY_STATS: CallStatistics = {
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

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const SalesHubPage: React.FC = () => {
  // Track currently active tab
  const [activeTab, setActiveTab] = useState<TabType>('ai-calls');
  
  /**
   * Fetch leads data using TanStack Query
   * This data is passed to AICallPanel for lead selection
   */
  const { data: leadsResponse, isLoading: isLoadingLeads } = useLeadsQuery({});
  const leads: Lead[] = leadsResponse?.leads || [];

  // Real data from CRM database
  const [stats, setStats] = useState<CallStatistics>(EMPTY_STATS);
  const [calls, setCalls] = useState<CRMCallRecord[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingCalls, setIsLoadingCalls] = useState(true);
  // null = still determining; true = connected; false = unreachable
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);

  // Fetch call statistics
  const fetchStats = useCallback(async () => {
    setIsLoadingStats(true);
    try {
      const response = await salesCallApi.getCallStatistics();
      if (response.success) {
        setStats({
          totalCalls: response.totalCalls || 0,
          totalDurationSeconds: response.totalDurationSeconds || 0,
          averageDurationSeconds: response.averageDurationSeconds || 0,
          successRate: response.successRate || 0,
          qualificationRate: response.qualificationRate || 0,
          outcomes: response.outcomes || {},
          callsByDay: response.callsByDay || [],
          qualificationBreakdown: response.qualificationBreakdown || {
            unqualified: 0,
            marketing_qualified: 0,
            sales_qualified: 0,
            opportunity: 0,
          },
        });
        setBackendAvailable(true);
      } else {
        setBackendAvailable(false);
      }
    } catch (error) {
      console.error('Failed to fetch call statistics:', error);
      setBackendAvailable(false);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  // Fetch call history
  const fetchCalls = useCallback(async () => {
    setIsLoadingCalls(true);
    try {
      const response = await salesCallApi.getCallHistory(50);
      if (response.success) {
        setCalls(response.calls);
        setBackendAvailable(true);
      } else {
        setBackendAvailable(false);
      }
    } catch (error) {
      console.error('Failed to fetch call history:', error);
      setBackendAvailable(false);
    } finally {
      setIsLoadingCalls(false);
    }
  }, []);

  // Fetch data on mount
  useEffect(() => {
    fetchStats();
    fetchCalls();
  }, [fetchStats, fetchCalls]);

  // Refresh data handler
  const handleRefresh = () => {
    fetchStats();
    fetchCalls();
  };

  /**
   * Render tab navigation buttons
   * Active tab gets highlighted with primary color border
   */
  const renderTabs = () => (
    <div className="border-b border-gray-200 mb-6">
      <nav className="-mb-px flex space-x-8" aria-label="Sales Hub Tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              group inline-flex items-center py-4 px-1 border-b-2 font-medium text-sm
              transition-colors duration-200
              ${activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            {/* Tab Icon */}
            <span className={`mr-2 transition-colors ${
              activeTab === tab.id ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-500'
            }`}>
              {tab.icon}
            </span>
            {/* Tab Label */}
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );

  /**
   * Render active tab content
   * Each tab component receives appropriate data
   */
  const renderTabContent = () => {
    switch (activeTab) {
      case 'ai-calls':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - AI Call Panel */}
            <div className="lg:col-span-1">
              <AICallPanel />
            </div>
            
            {/* Right Column - Stats + Recent Calls */}
            <div className="lg:col-span-2 space-y-6">
              <CallDashboard 
                stats={stats} 
                isLoading={isLoadingStats} 
              />
              <RecentAICalls 
                calls={calls} 
                isLoading={isLoadingCalls}
                limit={3}
              />
            </div>
          </div>
        );
        
      case 'analytics':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Dashboard Stats */}
            <div className="lg:col-span-2">
              <CallDashboard 
                stats={stats} 
                isLoading={isLoadingStats} 
              />
            </div>
            
            {/* Right Column - Detailed Analytics */}
            <div className="lg:col-span-1">
              <CallAnalytics 
                stats={stats} 
                isLoading={isLoadingStats} 
              />
            </div>
          </div>
        );
        
      case 'call-history':
        return (
          <div className="space-y-6">
            <RecentAICalls 
              calls={calls} 
              isLoading={isLoadingCalls}
              limit={20}
            />
          </div>
        );
        
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-indigo-100 rounded-lg p-2">
                <SparklesIcon className="h-6 w-6 text-indigo-600" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Sales Hub</h1>
                <p className="mt-1 text-sm text-gray-600">
                  AI-powered sales calls and lead qualification
                  <span className="ml-2 text-xs text-gray-400">
                    • {leads.length} leads available
                    {isLoadingLeads && ' (refreshing...)'}
                  </span>
                </p>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={isLoadingStats || isLoadingCalls}
              className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <svg 
                className={`h-4 w-4 ${(isLoadingStats || isLoadingCalls) ? 'animate-spin' : ''}`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Refresh</span>
            </button>
          </div>
          
          {/* Quick Stats Banner */}
          <div className="mt-6 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-6">
                <div>
                  <p className="text-sm opacity-80">Today's Calls</p>
                  <p className="text-2xl font-bold">{stats.callsByDay[stats.callsByDay.length - 1]?.count || 0}</p>
                </div>
                <div className="h-10 w-px bg-white/20"></div>
                <div>
                  <p className="text-sm opacity-80">Total Calls</p>
                  <p className="text-2xl font-bold">{stats.totalCalls}</p>
                </div>
                <div className="h-10 w-px bg-white/20"></div>
                <div>
                  <p className="text-sm opacity-80">Qualification Rate</p>
                  <p className="text-2xl font-bold">{stats.qualificationRate}%</p>
                </div>
              </div>
              <div className="hidden md:block">
                <p className="text-sm opacity-80">Powered by</p>
                <p className="font-semibold">Sales Agent</p>
              </div>
            </div>
          </div>
        </div>

        {/* Backend unavailable notice */}
        {backendAvailable === false && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-yellow-400/50 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            <span className="mt-0.5 shrink-0">⚠️</span>
            <span>
              <strong>Clara backend is unreachable</strong> — call statistics and history cannot be loaded.
              Make sure the backend is running on port 8001, then{' '}
              <button
                onClick={handleRefresh}
                className="underline underline-offset-2 font-medium hover:opacity-70"
              >
                retry
              </button>.
            </span>
          </div>
        )}

        {/* Tab Navigation */}
        {renderTabs()}

        {/* Tab Content Area */}
        <div className="mt-6">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
};

export default SalesHubPage;

