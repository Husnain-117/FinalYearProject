import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase, resetAuthCircuitBreaker, isAuthCircuitOpen } from '../api/supabaseClient';

// Define your extended User type including role and other app-specific details
export interface UserProfile {
  id: string;
  email?: string;
  role?: 'agent' | 'manager' | 'super_admin'; // Changed from string to specific union
  full_name?: string;
  manager_id?: string | null;
  // Add other profile fields you might need from public.users
}

interface AuthContextType {
  session: Session | null;
  user: SupabaseUser | null; // Supabase's own user object
  profile: UserProfile | null; // Your application-specific user profile
  loading: boolean;
  serviceReachable: boolean; // false when Supabase DNS/network is down
  login: (email: string, password: string) => Promise<any>;
  signup: (email: string, password: string, fullName: string) => Promise<any>; // Added signup
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true); // Still true initially for overall app readiness
  const [initialAuthCheckComplete, setInitialAuthCheckComplete] = useState(false);
  const [serviceReachable, setServiceReachable] = useState(true);

  // Effect for initial session and auth listener
  useEffect(() => {
    console.log('[AuthContext] Main useEffect mounting.');
    // setLoading(true); // Loading is true by default, will be managed by profile fetch effect

    // Initial session check
    supabase.auth.getSession().then(({ data: { session: currentSession }, error: sessionError }) => {
      if (sessionError) {
        console.error('[AuthContext] Initial getSession error:', sessionError.name, sessionError.message);
        // Network failure while refreshing a stale token — sign out locally (no network call)
        // to clear the stored token and stop the SDK's internal retry loop immediately.
        if (sessionError.name === 'AuthRetryableFetchError' || isAuthCircuitOpen()) {
          setServiceReachable(false);
          supabase.auth.signOut({ scope: 'local' });
        }
      }
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setInitialAuthCheckComplete(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      console.log('[AuthContext] onAuthStateChange: Event:', _event, 'Session:', currentSession);
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setInitialAuthCheckComplete(true); // Ensure this is true if auth state changes, for profile fetch effect
    });

    return () => {
      console.log('[AuthContext] Main useEffect unmounting.');
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // Effect for fetching profile when user changes OR initial auth check completes
  useEffect(() => {
    if (!initialAuthCheckComplete) {
      console.log('[AuthContext] ProfileFetchEffect: Skipping, initial auth check not complete.');
      setLoading(true); // Keep loading true if initial check isn't done
      return;
    }

    if (user) {
      console.log('[AuthContext] ProfileFetchEffect: User found (ID:', user.id, '). Setting loading true and fetching profile.');
      setLoading(true);
      setProfile(null); // Clear old profile while fetching new one

      supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single()
        .then(
          ({ data: userProfile, error: profileError }) => { // onfulfilled
            console.log('[AuthContext] ProfileFetchEffect: Profile fetch result - Data:', userProfile, 'Error:', profileError);
            if (profileError) {
              console.error('[AuthContext] ProfileFetchEffect: Error fetching profile:', profileError.message);
              setProfile(null);
            } else {
              setProfile(userProfile as UserProfile);
            }
            setLoading(false);
            console.log('[AuthContext] ProfileFetchEffect: setLoading(false) after profile data attempt.');
          },
          (rejectionError: any) => { // onrejected
            console.error('[AuthContext] ProfileFetchEffect: Promise REJECTED during profile fetch:', rejectionError);
            setProfile(null);
            setLoading(false);
            console.log('[AuthContext] ProfileFetchEffect: setLoading(false) after promise rejection.');
          }
        );
    } else {
      console.log('[AuthContext] ProfileFetchEffect: No user. Clearing profile, setLoading(false).');
      setProfile(null);
      setLoading(false); // If no user, we are done loading (an empty state)
    }
  }, [user, initialAuthCheckComplete]);

  const login = async (email: string, password: string) => {
    // Reset circuit breaker so a fresh attempt is allowed (e.g. after project is unpaused)
    resetAuthCircuitBreaker();
    setServiceReachable(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.name === 'AuthRetryableFetchError') setServiceReachable(false);
      throw error;
    }
    // onAuthStateChange will set user, triggering profile fetch effect
    return data;
  };

  const signup = async (email: string, password: string, fullName: string) => {
    // setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        }
      }
    });
    if (error) {
      // setLoading(false);
      throw error;
    }
    return data;
  };

  const logout = async () => {
    // setLoading(true); // Allow effects to manage loading state
    await supabase.auth.signOut();
    // onAuthStateChange will set user to null, triggering profile effect to clear profile & set loading false
  };
  
  const value = {
    session,
    user,
    profile,
    loading,
    serviceReachable,
    login,
    signup, 
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 