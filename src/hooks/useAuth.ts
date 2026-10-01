import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import { identifyUser, resetUser } from '@/lib/customerio';

export type UserRole = 'admin' | 'user';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Helper to fetch user data
    const fetchUserData = async (userId: string) => {
      const [roleResult, mappingResult] = await Promise.all([
        supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('user_player_mapping')
          .select('player_name')
          .eq('user_id', userId)
          .maybeSingle()
      ]);
      
      setUserRole(roleResult.data?.role ?? 'user');
      setPlayerName(mappingResult.data?.player_name ?? null);
      setLoading(false);
    };

    // Set up auth state listener - MUST be synchronous callback
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Only synchronous state updates here
        setSession(session);
        setUser(session?.user ?? null);
        
        // Defer async operations with setTimeout to prevent React queue issues
        if (session?.user) {
          setTimeout(() => {
            fetchUserData(session.user.id);
            identifyUser(
              session.user.id,
              session.user.email || '',
              session.user.created_at || new Date().toISOString()
            );
            // "user_signed_up" now comes from the server (cio-sync), once per person. The
            // browser used to send it on every sign-in in the first 24 hours.
          }, 0);
        } else {
          if (event === 'SIGNED_OUT') resetUser();
          setUserRole(null);
          setPlayerName(null);
          setLoading(false);
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        Promise.all([
          supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', session.user.id)
            .maybeSingle(),
          supabase
            .from('user_player_mapping')
            .select('player_name')
            .eq('user_id', session.user.id)
            .maybeSingle()
        ]).then(([roleResult, mappingResult]) => {
          setUserRole(roleResult.data?.role ?? 'user');
          setPlayerName(mappingResult.data?.player_name ?? null);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl
      }
    });
    return { error };
  };

  const signInWithGoogle = async (redirectUrl?: string) => {
    const { error } = await lovable.auth.signInWithOAuth('google', {
      redirect_uri: redirectUrl || `${window.location.origin}/leagues`
    });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  return {
    user,
    session,
    userRole,
    playerName,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    isAdmin: userRole === 'admin',
  };
}