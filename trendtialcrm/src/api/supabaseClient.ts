import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL and Anon Key are required. Check your .env file.");
}

// --- Circuit Breaker + Fetch Timeout ---
// The Supabase SDK retries up to 7 times internally on network failure.
// Without this, a paused/unreachable project floods the console for minutes.
// Circuit breaker trips after 2 consecutive auth-endpoint failures and stops
// all further retries until resetAuthCircuitBreaker() is called (e.g. on login).
const FETCH_TIMEOUT_MS = 8_000;
const CIRCUIT_BREAKER_THRESHOLD = 2;
let _consecutiveAuthFailures = 0;

export const resetAuthCircuitBreaker = () => {
  _consecutiveAuthFailures = 0;
};

export const isAuthCircuitOpen = () =>
  _consecutiveAuthFailures >= CIRCUIT_BREAKER_THRESHOLD;

const fetchWithTimeout = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.href
      : (input as Request).url;
  const isAuthEndpoint = href.includes('/auth/v1/');

  if (isAuthEndpoint && _consecutiveAuthFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    return Promise.reject(new TypeError('NetworkError when attempting to fetch resource.'));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  return fetch(input, { ...init, signal: controller.signal })
    .then((response) => {
      if (isAuthEndpoint) _consecutiveAuthFailures = 0;
      return response;
    })
    .catch((error) => {
      if (isAuthEndpoint) _consecutiveAuthFailures++;
      throw error;
    })
    .finally(() => clearTimeout(timer));
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
});