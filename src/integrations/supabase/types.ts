export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      archived_seasons: {
        Row: {
          archived_at: number
          contestants: Json
          created_at: string
          final_standings: Json
          id: string
          league_id: string | null
          scoring_events: Json
          season: number
        }
        Insert: {
          archived_at: number
          contestants: Json
          created_at?: string
          final_standings: Json
          id?: string
          league_id?: string | null
          scoring_events: Json
          season: number
        }
        Update: {
          archived_at?: number
          contestants?: Json
          created_at?: string
          final_standings?: Json
          id?: string
          league_id?: string | null
          scoring_events?: Json
          season?: number
        }
        Relationships: [
          {
            foreignKeyName: "archived_seasons_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      bug_reports: {
        Row: {
          admin_notes: string | null
          created_at: string
          description: string
          id: string
          league_id: string | null
          page_url: string | null
          status: string
          user_id: string
          user_viewed_response: boolean
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          description: string
          id?: string
          league_id?: string | null
          page_url?: string | null
          status?: string
          user_id: string
          user_viewed_response?: boolean
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          description?: string
          id?: string
          league_id?: string | null
          page_url?: string | null
          status?: string
          user_id?: string
          user_viewed_response?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "bug_reports_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          is_bot: boolean
          league_id: string
          reactions: Json | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_bot?: boolean
          league_id: string
          reactions?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_bot?: boolean
          league_id?: string
          reactions?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      contestants: {
        Row: {
          age: number | null
          created_at: string
          id: string
          image_url: string | null
          is_eliminated: boolean
          location: string | null
          name: string
          owner: string | null
          pick_number: number | null
          session_id: string
          tribe: string | null
        }
        Insert: {
          age?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_eliminated?: boolean
          location?: string | null
          name: string
          owner?: string | null
          pick_number?: number | null
          session_id: string
          tribe?: string | null
        }
        Update: {
          age?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_eliminated?: boolean
          location?: string | null
          name?: string
          owner?: string | null
          pick_number?: number | null
          session_id?: string
          tribe?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contestants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      crying_contestants: {
        Row: {
          contestant_id: string
          created_at: string
          episode: number
          id: string
          session_id: string
        }
        Insert: {
          contestant_id: string
          created_at?: string
          episode: number
          id?: string
          session_id: string
        }
        Update: {
          contestant_id?: string
          created_at?: string
          episode?: number
          id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crying_contestants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_order: {
        Row: {
          created_at: string
          id: string
          player_name: string
          position: number
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_name: string
          position: number
          session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          player_name?: string
          position?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_order_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      final_predictions: {
        Row: {
          created_at: string
          episode: number
          id: string
          is_revealed: boolean
          player_name: string
          predicted_winner: string
          session_id: string
        }
        Insert: {
          created_at?: string
          episode: number
          id?: string
          is_revealed?: boolean
          player_name: string
          predicted_winner: string
          session_id: string
        }
        Update: {
          created_at?: string
          episode?: number
          id?: string
          is_revealed?: boolean
          player_name?: string
          predicted_winner?: string
          session_id?: string
        }
        Relationships: []
      }
      game_sessions: {
        Row: {
          created_at: string
          current_draft_index: number
          draft_type: string
          episode: number
          game_type: string
          id: string
          is_post_merge: boolean
          league_id: string | null
          mode: string
          picks_per_team: number | null
          season: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_draft_index?: number
          draft_type?: string
          episode?: number
          game_type?: string
          id?: string
          is_post_merge?: boolean
          league_id?: string | null
          mode?: string
          picks_per_team?: number | null
          season?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_draft_index?: number
          draft_type?: string
          episode?: number
          game_type?: string
          id?: string
          is_post_merge?: boolean
          league_id?: string | null
          mode?: string
          picks_per_team?: number | null
          season?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_sessions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_memberships: {
        Row: {
          id: string
          joined_at: string | null
          league_id: string | null
          role: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string | null
          league_id?: string | null
          role: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string | null
          league_id?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_memberships_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_teams: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          id: string
          league_id: string
          name: string
          position: number
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          id?: string
          league_id: string
          name: string
          position: number
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          id?: string
          league_id?: string
          name?: string
          position?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          allow_player_scoring: boolean
          archived_at: string | null
          auto_renew: boolean
          created_at: string | null
          id: string
          invite_code: string
          is_inactive_notified: boolean
          last_activity_at: string | null
          name: string
          owner_id: string
          scoring_config: Json | null
          team_count: number | null
        }
        Insert: {
          allow_player_scoring?: boolean
          archived_at?: string | null
          auto_renew?: boolean
          created_at?: string | null
          id?: string
          invite_code: string
          is_inactive_notified?: boolean
          last_activity_at?: string | null
          name: string
          owner_id: string
          scoring_config?: Json | null
          team_count?: number | null
        }
        Update: {
          allow_player_scoring?: boolean
          archived_at?: string | null
          auto_renew?: boolean
          created_at?: string | null
          id?: string
          invite_code?: string
          is_inactive_notified?: boolean
          last_activity_at?: string | null
          name?: string
          owner_id?: string
          scoring_config?: Json | null
          team_count?: number | null
        }
        Relationships: []
      }
      master_contestants: {
        Row: {
          age: number | null
          created_at: string | null
          id: string
          image_url: string | null
          name: string
          occupation: string | null
          season_number: number
          tribe: string | null
        }
        Insert: {
          age?: number | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          name: string
          occupation?: string | null
          season_number: number
          tribe?: string | null
        }
        Update: {
          age?: number | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          name?: string
          occupation?: string | null
          season_number?: number
          tribe?: string | null
        }
        Relationships: []
      }
      news_posts: {
        Row: {
          author_id: string | null
          content: string
          expires_at: string | null
          external_id: string | null
          id: string
          is_spoiler: boolean
          published_at: string
          source: string
          source_url: string | null
          title: string
        }
        Insert: {
          author_id?: string | null
          content: string
          expires_at?: string | null
          external_id?: string | null
          id?: string
          is_spoiler?: boolean
          published_at?: string
          source?: string
          source_url?: string | null
          title: string
        }
        Update: {
          author_id?: string | null
          content?: string
          expires_at?: string | null
          external_id?: string | null
          id?: string
          is_spoiler?: boolean
          published_at?: string
          source?: string
          source_url?: string | null
          title?: string
        }
        Relationships: []
      }
      player_profiles: {
        Row: {
          avatar: string | null
          created_at: string
          id: string
          player_name: string
          session_id: string
        }
        Insert: {
          avatar?: string | null
          created_at?: string
          id?: string
          player_name: string
          session_id: string
        }
        Update: {
          avatar?: string | null
          created_at?: string
          id?: string
          player_name?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_profiles_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
        }
        Relationships: []
      }
      scoring_events: {
        Row: {
          action: string
          contestant_id: string
          contestant_name: string
          created_at: string
          episode: number
          id: string
          points: number
          session_id: string
        }
        Insert: {
          action: string
          contestant_id: string
          contestant_name: string
          created_at?: string
          episode: number
          id?: string
          points: number
          session_id: string
        }
        Update: {
          action?: string
          contestant_id?: string
          contestant_name?: string
          created_at?: string
          episode?: number
          id?: string
          points?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoring_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_templates: {
        Row: {
          config: Json
          created_at: string
          created_by: string
          description: string | null
          emoji: string
          id: string
          league_id: string
          name: string
        }
        Insert: {
          config: Json
          created_at?: string
          created_by: string
          description?: string | null
          emoji?: string
          id?: string
          league_id: string
          name: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          emoji?: string
          id?: string
          league_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoring_templates_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      user_player_mapping: {
        Row: {
          created_at: string
          id: string
          player_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          player_name?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_league_health: {
        Args: never
        Returns: {
          archived_at: string
          cast_count: number
          created_at: string
          current_season: number
          drafted_count: number
          episode: number
          ever_drafted: boolean
          ever_scored: boolean
          game_type: string
          id: string
          last_activity_at: string
          last_member_sign_in: string
          member_count: number
          mode: string
          name: string
          owner_email: string
          owner_id: string
          scored_episodes: number
          season: number
          season_scoring_events: number
          stage: string
        }[]
      }
      admin_set_league_archived: {
        Args: { archive: boolean; league_ids: string[] }
        Returns: number
      }
      claim_team: {
        Args: { team_id: string }
        Returns: {
          avatar_url: string | null
          created_at: string | null
          id: string
          league_id: string
          name: string
          position: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "league_teams"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_league: {
        Args: { league_name: string }
        Returns: {
          allow_player_scoring: boolean
          archived_at: string | null
          auto_renew: boolean
          created_at: string | null
          id: string
          invite_code: string
          is_inactive_notified: boolean
          last_activity_at: string | null
          name: string
          owner_id: string
          scoring_config: Json | null
          team_count: number | null
        }
        SetofOptions: {
          from: "*"
          to: "leagues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_league: { Args: { league_uuid: string }; Returns: undefined }
      execute_draft_pick: {
        Args: {
          _contestant_id: string
          _expected_index: number
          _owner: string
          _pick_number: number
          _session_id: string
        }
        Returns: boolean
      }
      generate_invite_code: { Args: never; Returns: string }
      get_available_teams: {
        Args: { league_uuid: string }
        Returns: {
          avatar_url: string | null
          created_at: string | null
          id: string
          league_id: string
          name: string
          position: number
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "league_teams"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_league_role: {
        Args: { _league_id: string; _roles: string[]; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_league_member: {
        Args: { _league_id: string; _user_id: string }
        Returns: boolean
      }
      is_session_league_member: {
        Args: { _session_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      join_league: {
        Args: { invite_code_input: string }
        Returns: {
          id: string
          joined_at: string | null
          league_id: string | null
          role: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "league_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      make_super_admin: {
        Args: { user_uuid: string }
        Returns: {
          id: string
          joined_at: string | null
          league_id: string | null
          role: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "league_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_league_member: {
        Args: { _league_id: string; _user_id: string }
        Returns: undefined
      }
      rename_team_everywhere: {
        Args: {
          _league_id: string
          _new_name: string
          _old_name: string
          _team_id: string
        }
        Returns: undefined
      }
      resize_league: {
        Args: { league_uuid: string; new_size: number }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
