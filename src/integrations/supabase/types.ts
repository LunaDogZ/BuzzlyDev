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
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _deprecated_prospects: {
        Row: {
          company: string | null
          created_at: string | null
          email: string
          id: string
          last_activity: string | null
          location: string | null
          name: string
          notes: string | null
          phone: string | null
          position: string | null
          score: number | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string | null
          email: string
          id?: string
          last_activity?: string | null
          location?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          position?: string | null
          score?: number | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string | null
          email?: string
          id?: string
          last_activity?: string | null
          location?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          position?: string | null
          score?: number | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      aarrr_categories: {
        Row: {
          color_code: string | null
          created_at: string | null
          description: string | null
          display_order: number | null
          icon_url: string | null
          id: string
          name: string
          slug: string
          updated_at: string | null
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string | null
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      action_type: {
        Row: {
          action_name: string
          color_code: string | null
          created_at: string | null
          description: string | null
          icon_url: string | null
          id: string
        }
        Insert: {
          action_name: string
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
        }
        Update: {
          action_name?: string
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
        }
        Relationships: []
      }
      ad_accounts: {
        Row: {
          account_name: string
          created_at: string | null
          id: string
          is_active: boolean | null
          platform_account_id: string | null
          platform_id: string | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_name: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          platform_account_id?: string | null
          platform_id?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          platform_account_id?: string | null
          platform_id?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_accounts_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_accounts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_buying_types: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          name: string
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ad_groups: {
        Row: {
          created_at: string | null
          description: string | null
          external_group_id: string | null
          group_type: string | null
          id: string
          name: string
          source_platform: string | null
          status: string | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          external_group_id?: string | null
          group_type?: string | null
          id?: string
          name: string
          source_platform?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          external_group_id?: string | null
          group_type?: string | null
          id?: string
          name?: string
          source_platform?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_groups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_insights: {
        Row: {
          ad_account_id: string | null
          adds_to_cart: number | null
          ads_id: string | null
          campaign_id: string | null
          clicks: number | null
          conversions: number | null
          cpc: number | null
          cpm: number | null
          created_at: string | null
          ctr: number | null
          data_source: string
          date: string
          id: string
          impressions: number | null
          leads: number | null
          reach: number | null
          revenue: number | null
          roas: number | null
          spend: number | null
        }
        Insert: {
          ad_account_id?: string | null
          adds_to_cart?: number | null
          ads_id?: string | null
          campaign_id?: string | null
          clicks?: number | null
          conversions?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          ctr?: number | null
          data_source?: string
          date: string
          id?: string
          impressions?: number | null
          leads?: number | null
          reach?: number | null
          revenue?: number | null
          roas?: number | null
          spend?: number | null
        }
        Update: {
          ad_account_id?: string | null
          adds_to_cart?: number | null
          ads_id?: string | null
          campaign_id?: string | null
          clicks?: number | null
          conversions?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string | null
          ctr?: number | null
          data_source?: string
          date?: string
          id?: string
          impressions?: number | null
          leads?: number | null
          reach?: number | null
          revenue?: number | null
          roas?: number | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_insights_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_insights_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "debug_insights_linkage"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "ad_insights_ads_id_fkey"
            columns: ["ads_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_insights_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_personas: {
        Row: {
          ad_id: string
          assigned_at: string
          persona_id: string
        }
        Insert: {
          ad_id: string
          assigned_at?: string
          persona_id: string
        }
        Update: {
          ad_id?: string
          assigned_at?: string
          persona_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_personas_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_personas_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "customer_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: {
          ad_copy: string | null
          ad_group_id: string | null
          budget: number | null
          call_to_action: string | null
          content: string | null
          created_at: string | null
          creative_type: string | null
          creative_url: string | null
          external_error: string | null
          external_status: string | null
          headline: string | null
          id: string
          media_urls: string[] | null
          name: string
          persona_data: Json | null
          platform: string | null
          platform_ad_id: string | null
          preview_url: string | null
          scheduled_at: string | null
          status: string | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          ad_copy?: string | null
          ad_group_id?: string | null
          budget?: number | null
          call_to_action?: string | null
          content?: string | null
          created_at?: string | null
          creative_type?: string | null
          creative_url?: string | null
          external_error?: string | null
          external_status?: string | null
          headline?: string | null
          id?: string
          media_urls?: string[] | null
          name: string
          persona_data?: Json | null
          platform?: string | null
          platform_ad_id?: string | null
          preview_url?: string | null
          scheduled_at?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          ad_copy?: string | null
          ad_group_id?: string | null
          budget?: number | null
          call_to_action?: string | null
          content?: string | null
          created_at?: string | null
          creative_type?: string | null
          creative_url?: string | null
          external_error?: string | null
          external_status?: string | null
          headline?: string | null
          id?: string
          media_urls?: string[] | null
          name?: string
          persona_data?: Json | null
          platform?: string | null
          platform_ad_id?: string | null
          preview_url?: string | null
          scheduled_at?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ads_ad_group_id_fkey"
            columns: ["ad_group_id"]
            isOneToOne: false
            referencedRelation: "ad_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ads_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attribution_types: {
        Row: {
          attribution_window_days: number | null
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          name: string
          platform_mapping_standard_id: string | null
          priority_score: number | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          attribution_window_days?: number | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          platform_mapping_standard_id?: string | null
          priority_score?: number | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          attribution_window_days?: number | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          platform_mapping_standard_id?: string | null
          priority_score?: number | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attribution_types_platform_mapping_standard_id_fkey"
            columns: ["platform_mapping_standard_id"]
            isOneToOne: false
            referencedRelation: "platform_standard_mappings"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs_enhanced: {
        Row: {
          action_type_id: string | null
          category: string | null
          created_at: string | null
          description: string | null
          error_id: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          server_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          action_type_id?: string | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          error_id?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          server_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          action_type_id?: string | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          error_id?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          server_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_enhanced_action_type_id_fkey"
            columns: ["action_type_id"]
            isOneToOne: false
            referencedRelation: "action_type"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_enhanced_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "server"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          alert_threshold_percent: number
          amount: number
          budget_type: string
          campaign_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          end_date: string | null
          id: string
          is_active: boolean
          name: string
          remaining_amount: number | null
          spent_amount: number
          start_date: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          alert_threshold_percent?: number
          amount?: number
          budget_type?: string
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name: string
          remaining_amount?: number | null
          spent_amount?: number
          start_date?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          alert_threshold_percent?: number
          amount?: number
          budget_type?: string
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          name?: string
          remaining_amount?: number | null
          spent_amount?: number
          start_date?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_types: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          icon_url: string | null
          id: string
          is_active: boolean | null
          name: string
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      campaign_ads: {
        Row: {
          ad_id: string
          assigned_at: string
          campaign_id: string
        }
        Insert: {
          ad_id: string
          assigned_at?: string
          campaign_id: string
        }
        Update: {
          ad_id?: string
          assigned_at?: string
          campaign_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_ads_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_ads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_tags: {
        Row: {
          campaign_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_tags_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ad_account_id: string | null
          ad_buying_type_id: string | null
          budget_amount: number | null
          created_at: string | null
          end_date: string | null
          id: string
          mapping_groups_id: string | null
          name: string
          objective: string | null
          start_date: string | null
          status: string | null
          target_kpi_clicks: number | null
          target_kpi_conversions: number | null
          target_kpi_impressions: number | null
          target_kpi_metric: string | null
          target_kpi_spend: number | null
          target_kpi_value: number | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          ad_account_id?: string | null
          ad_buying_type_id?: string | null
          budget_amount?: number | null
          created_at?: string | null
          end_date?: string | null
          id?: string
          mapping_groups_id?: string | null
          name: string
          objective?: string | null
          start_date?: string | null
          status?: string | null
          target_kpi_clicks?: number | null
          target_kpi_conversions?: number | null
          target_kpi_impressions?: number | null
          target_kpi_metric?: string | null
          target_kpi_spend?: number | null
          target_kpi_value?: number | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          ad_account_id?: string | null
          ad_buying_type_id?: string | null
          budget_amount?: number | null
          created_at?: string | null
          end_date?: string | null
          id?: string
          mapping_groups_id?: string | null
          name?: string
          objective?: string | null
          start_date?: string | null
          status?: string | null
          target_kpi_clicks?: number | null
          target_kpi_conversions?: number | null
          target_kpi_impressions?: number | null
          target_kpi_metric?: string | null
          target_kpi_spend?: number | null
          target_kpi_value?: number | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "debug_insights_linkage"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "campaigns_ad_buying_type_id_fkey"
            columns: ["ad_buying_type_id"]
            isOneToOne: false
            referencedRelation: "ad_buying_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_analysis: {
        Row: {
          active_users_data: Json | null
          average_retention: number | null
          churn_rate: number | null
          cohort_date: string
          cohort_size: number | null
          cohort_type: string | null
          created_at: string | null
          id: string
          lifetime_value: number | null
          retention_data: Json | null
          revenue_data: Json | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          active_users_data?: Json | null
          average_retention?: number | null
          churn_rate?: number | null
          cohort_date: string
          cohort_size?: number | null
          cohort_type?: string | null
          created_at?: string | null
          id?: string
          lifetime_value?: number | null
          retention_data?: Json | null
          revenue_data?: Json | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          active_users_data?: Json | null
          average_retention?: number | null
          churn_rate?: number | null
          cohort_date?: string
          cohort_size?: number | null
          cohort_type?: string | null
          created_at?: string | null
          id?: string
          lifetime_value?: number | null
          retention_data?: Json | null
          revenue_data?: Json | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cohort_analysis_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_events: {
        Row: {
          ad_account_id: string | null
          ads_id: string | null
          attribution_type_id: string | null
          attribution_window: number | null
          conversion_item_id: string | null
          created_at: string | null
          event_name: string | null
          event_type_id: string | null
          event_value: number | null
          id: string
          meta_data: Json | null
          occurred_at: string
          platform_event_id: string | null
          processing_status: string | null
          updated_at: string | null
        }
        Insert: {
          ad_account_id?: string | null
          ads_id?: string | null
          attribution_type_id?: string | null
          attribution_window?: number | null
          conversion_item_id?: string | null
          created_at?: string | null
          event_name?: string | null
          event_type_id?: string | null
          event_value?: number | null
          id?: string
          meta_data?: Json | null
          occurred_at: string
          platform_event_id?: string | null
          processing_status?: string | null
          updated_at?: string | null
        }
        Update: {
          ad_account_id?: string | null
          ads_id?: string | null
          attribution_type_id?: string | null
          attribution_window?: number | null
          conversion_item_id?: string | null
          created_at?: string | null
          event_name?: string | null
          event_type_id?: string | null
          event_value?: number | null
          id?: string
          meta_data?: Json | null
          occurred_at?: string
          platform_event_id?: string | null
          processing_status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversion_events_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_events_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "debug_insights_linkage"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "conversion_events_ads_id_fkey"
            columns: ["ads_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_events_attribution_type_id_fkey"
            columns: ["attribution_type_id"]
            isOneToOne: false
            referencedRelation: "attribution_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversion_events_event_type_id_fkey"
            columns: ["event_type_id"]
            isOneToOne: false
            referencedRelation: "event_types"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          code: string | null
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string | null
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      currencies: {
        Row: {
          code: string
          created_at: string | null
          decimal_places: number | null
          id: string
          is_active: boolean | null
          name: string
          symbol: string | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          decimal_places?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          symbol?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          decimal_places?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          symbol?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      customer: {
        Row: {
          acquisition_source: string | null
          birthday_at: string | null
          company_name: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          last_active: string | null
          phone_number: string | null
          plan_type: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          acquisition_source?: string | null
          birthday_at?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          last_active?: string | null
          phone_number?: string | null
          plan_type?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          acquisition_source?: string | null
          birthday_at?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          last_active?: string | null
          phone_number?: string | null
          plan_type?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      customer_activities: {
        Row: {
          browser: string | null
          campaign_id: string | null
          created_at: string | null
          device_type: string | null
          event_data: Json | null
          event_type_id: string | null
          id: string
          ip_address: string | null
          page_url: string | null
          profile_customer_id: string | null
          referrer_url: string | null
          session_id: string | null
        }
        Insert: {
          browser?: string | null
          campaign_id?: string | null
          created_at?: string | null
          device_type?: string | null
          event_data?: Json | null
          event_type_id?: string | null
          id?: string
          ip_address?: string | null
          page_url?: string | null
          profile_customer_id?: string | null
          referrer_url?: string | null
          session_id?: string | null
        }
        Update: {
          browser?: string | null
          campaign_id?: string | null
          created_at?: string | null
          device_type?: string | null
          event_data?: Json | null
          event_type_id?: string | null
          id?: string
          ip_address?: string | null
          page_url?: string | null
          profile_customer_id?: string | null
          referrer_url?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_activities_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_activities_event_type_id_fkey"
            columns: ["event_type_id"]
            isOneToOne: false
            referencedRelation: "event_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_activities_profile_customer_id_fkey"
            columns: ["profile_customer_id"]
            isOneToOne: false
            referencedRelation: "profile_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_coupons: {
        Row: {
          collected_at: string
          customer_id: string
          discount_id: string
          id: string
          used_at: string | null
        }
        Insert: {
          collected_at?: string
          customer_id: string
          discount_id: string
          id?: string
          used_at?: string | null
        }
        Update: {
          collected_at?: string
          customer_id?: string
          discount_id?: string
          id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_coupons_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notifications: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_read: boolean
          message: string
          related_id: string | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_read?: boolean
          message: string
          related_id?: string | null
          title: string
          type: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_read?: boolean
          message?: string
          related_id?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      customer_personas: {
        Row: {
          active_hours: string | null
          ad_targeting_mapping: Json | null
          age_max: number | null
          age_min: number | null
          avatar_url: string | null
          company_size: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json | null
          description: string | null
          gender_id: string | null
          goals: string[] | null
          id: string
          industry: string | null
          interests: string[] | null
          is_active: boolean | null
          is_template: boolean
          location_id: string | null
          pain_points: string[] | null
          persona_name: string
          preferred_devices: string[] | null
          profession: string | null
          psychographics: Json | null
          salary_range: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          active_hours?: string | null
          ad_targeting_mapping?: Json | null
          age_max?: number | null
          age_min?: number | null
          avatar_url?: string | null
          company_size?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json | null
          description?: string | null
          gender_id?: string | null
          goals?: string[] | null
          id?: string
          industry?: string | null
          interests?: string[] | null
          is_active?: boolean | null
          is_template?: boolean
          location_id?: string | null
          pain_points?: string[] | null
          persona_name: string
          preferred_devices?: string[] | null
          profession?: string | null
          psychographics?: Json | null
          salary_range?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          active_hours?: string | null
          ad_targeting_mapping?: Json | null
          age_max?: number | null
          age_min?: number | null
          avatar_url?: string | null
          company_size?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json | null
          description?: string | null
          gender_id?: string | null
          goals?: string[] | null
          id?: string
          industry?: string | null
          interests?: string[] | null
          is_active?: boolean | null
          is_template?: boolean
          location_id?: string | null
          pain_points?: string[] | null
          persona_name?: string
          preferred_devices?: string[] | null
          profession?: string | null
          psychographics?: Json | null
          salary_range?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      data_pipeline: {
        Row: {
          config: Json | null
          created_at: string | null
          id: string
          last_run_at: string | null
          name: string
          next_run_at: string | null
          pipeline_type_id: string | null
          schedule_cron: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          id?: string
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          pipeline_type_id?: string | null
          schedule_cron?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          id?: string
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          pipeline_type_id?: string | null
          schedule_cron?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_pipeline_pipeline_type_id_fkey"
            columns: ["pipeline_type_id"]
            isOneToOne: false
            referencedRelation: "pipeline_type"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_pipeline: {
        Row: {
          config: Json | null
          created_at: string | null
          deployed_at: string | null
          deployed_by: string | null
          id: string
          name: string
          pipeline_type_id: string | null
          status: string | null
          version: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          deployed_at?: string | null
          deployed_by?: string | null
          id?: string
          name: string
          pipeline_type_id?: string | null
          status?: string | null
          version?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          deployed_at?: string | null
          deployed_by?: string | null
          id?: string
          name?: string
          pipeline_type_id?: string | null
          status?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deployment_pipeline_pipeline_type_id_fkey"
            columns: ["pipeline_type_id"]
            isOneToOne: false
            referencedRelation: "pipeline_type"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          discount_type: string
          discount_value: number
          end_date: string | null
          id: string
          is_active: boolean
          max_discount_amount: number | null
          min_order_value: number | null
          name: string | null
          published_at: string | null
          start_date: string | null
          updated_at: string
          usage_count: number
          usage_limit: number | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          end_date?: string | null
          id?: string
          is_active?: boolean
          max_discount_amount?: number | null
          min_order_value?: number | null
          name?: string | null
          published_at?: string | null
          start_date?: string | null
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          end_date?: string | null
          id?: string
          is_active?: boolean
          max_discount_amount?: number | null
          min_order_value?: number | null
          name?: string | null
          published_at?: string | null
          start_date?: string | null
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
        }
        Relationships: []
      }
      email_campaigns: {
        Row: {
          category: string | null
          click_count: number
          created_at: string
          created_by: string | null
          id: string
          name: string
          open_count: number
          recipient_count: number
          scheduled_at: string | null
          sent_at: string | null
          status: string
          subject: string
          team_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          click_count?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          open_count?: number
          recipient_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          team_id: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          click_count?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          open_count?: number
          recipient_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          email: string
          id: string
          invitation_expires_at: string | null
          invitation_token: string | null
          invited_by: string | null
          is_locked: boolean | null
          password_hash: string | null
          role_employees_id: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          email: string
          id?: string
          invitation_expires_at?: string | null
          invitation_token?: string | null
          invited_by?: string | null
          is_locked?: boolean | null
          password_hash?: string | null
          role_employees_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          email?: string
          id?: string
          invitation_expires_at?: string | null
          invitation_token?: string | null
          invited_by?: string | null
          is_locked?: boolean | null
          password_hash?: string | null
          role_employees_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_role_employees_id_fkey"
            columns: ["role_employees_id"]
            isOneToOne: false
            referencedRelation: "role_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees_profile: {
        Row: {
          aptitude: string | null
          birthday_at: string | null
          created_at: string | null
          employees_id: string | null
          first_name: string | null
          id: string
          last_active: string | null
          last_name: string | null
          profile_img: string | null
          role_employees_id: string | null
          updated_at: string | null
        }
        Insert: {
          aptitude?: string | null
          birthday_at?: string | null
          created_at?: string | null
          employees_id?: string | null
          first_name?: string | null
          id?: string
          last_active?: string | null
          last_name?: string | null
          profile_img?: string | null
          role_employees_id?: string | null
          updated_at?: string | null
        }
        Update: {
          aptitude?: string | null
          birthday_at?: string | null
          created_at?: string | null
          employees_id?: string | null
          first_name?: string | null
          id?: string
          last_active?: string | null
          last_name?: string | null
          profile_img?: string | null
          role_employees_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_profile_employees_id_fkey"
            columns: ["employees_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_role_employees_id_fkey"
            columns: ["role_employees_id"]
            isOneToOne: false
            referencedRelation: "role_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          created_at: string | null
          id: string
          level: string
          message: string
          metadata: Json | null
          request_id: string | null
          stack_trace: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          level: string
          message: string
          metadata?: Json | null
          request_id?: string | null
          stack_trace?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          level?: string
          message?: string
          metadata?: Json | null
          request_id?: string | null
          stack_trace?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      event_types: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          event_category_id: string | null
          icon_url: string | null
          id: string
          is_active: boolean | null
          name: string
          platform_mapping_event_id: string | null
          priority_score: number | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          event_category_id?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          platform_mapping_event_id?: string | null
          priority_score?: number | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          event_category_id?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          platform_mapping_event_id?: string | null
          priority_score?: number | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_types_platform_mapping_event_id_fkey"
            columns: ["platform_mapping_event_id"]
            isOneToOne: false
            referencedRelation: "platform_mapping_events"
            referencedColumns: ["id"]
          },
        ]
      }
      external_api_status: {
        Row: {
          color_code: string | null
          created_at: string | null
          icon_url: string | null
          id: string
          last_status_code: number | null
          latency_ms: number | null
          platform_id: string | null
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          icon_url?: string | null
          id?: string
          last_status_code?: number | null
          latency_ms?: number | null
          platform_id?: string | null
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          icon_url?: string | null
          id?: string
          last_status_code?: number | null
          latency_ms?: number | null
          platform_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_api_status_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: true
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          comment: string | null
          created_at: string | null
          customer_activities_id: string | null
          id: string
          rating_id: string | null
          user_id: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          customer_activities_id?: string | null
          id?: string
          rating_id?: string | null
          user_id?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          customer_activities_id?: string | null
          id?: string
          rating_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_customer_activities_id_fkey"
            columns: ["customer_activities_id"]
            isOneToOne: false
            referencedRelation: "customer_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_rating_id_fkey"
            columns: ["rating_id"]
            isOneToOne: false
            referencedRelation: "rating"
            referencedColumns: ["id"]
          },
        ]
      }
      funnel_stages: {
        Row: {
          aarrr_categories_id: string | null
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          name: string | null
          slug: string | null
        }
        Insert: {
          aarrr_categories_id?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          name?: string | null
          slug?: string | null
        }
        Update: {
          aarrr_categories_id?: string | null
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          name?: string | null
          slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funnel_stages_aarrr_categories_id_fkey"
            columns: ["aarrr_categories_id"]
            isOneToOne: false
            referencedRelation: "aarrr_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      genders: {
        Row: {
          created_at: string | null
          id: string
          name_gender: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name_gender: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name_gender?: string
        }
        Relationships: []
      }
      group_template_settings: {
        Row: {
          created_at: string | null
          id: string
          mapping_groups_id: string | null
          metric_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          mapping_groups_id?: string | null
          metric_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          mapping_groups_id?: string | null
          metric_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_template_settings_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "metric_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          created_at: string
          current_stage: string | null
          dag_run_id: string | null
          error_message: string | null
          error_report_path: string | null
          file_hash: string | null
          file_size_bytes: number | null
          finished_at: string | null
          id: string
          original_filename: string
          platform: string
          rows_ok: number
          rows_quarantined: number
          rows_total: number
          stage_updated_at: string | null
          started_at: string | null
          status: string
          storage_path: string
          team_id: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          current_stage?: string | null
          dag_run_id?: string | null
          error_message?: string | null
          error_report_path?: string | null
          file_hash?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          id?: string
          original_filename: string
          platform: string
          rows_ok?: number
          rows_quarantined?: number
          rows_total?: number
          stage_updated_at?: string | null
          started_at?: string | null
          status?: string
          storage_path: string
          team_id: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          current_stage?: string | null
          dag_run_id?: string | null
          error_message?: string | null
          error_report_path?: string | null
          file_hash?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          id?: string
          original_filename?: string
          platform?: string
          rows_ok?: number
          rows_quarantined?: number
          rows_total?: number
          stage_updated_at?: string | null
          started_at?: string | null
          status?: string
          storage_path?: string
          team_id?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      import_row_errors: {
        Row: {
          column_name: string | null
          created_at: string
          error_code: string
          error_message: string | null
          id: string
          import_job_id: string
          raw_row: Json | null
          row_number: number
        }
        Insert: {
          column_name?: string | null
          created_at?: string
          error_code: string
          error_message?: string | null
          id?: string
          import_job_id: string
          raw_row?: Json | null
          row_number: number
        }
        Update: {
          column_name?: string | null
          created_at?: string
          error_code?: string
          error_message?: string | null
          id?: string
          import_job_id?: string
          raw_row?: Json | null
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_row_errors_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      industries: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          icon_url: string | null
          id: string
          is_active: boolean | null
          name: string
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ingestion_batches: {
        Row: {
          batch_id: string
          counts: Json
          import_job_id: string
          promoted_at: string
          rows_promoted: number
          team_id: string
        }
        Insert: {
          batch_id: string
          counts?: Json
          import_job_id: string
          promoted_at?: string
          rows_promoted?: number
          team_id: string
        }
        Update: {
          batch_id?: string
          counts?: Json
          import_job_id?: string
          promoted_at?: string
          rows_promoted?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_batches_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_batches_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_dlq: {
        Row: {
          batch_id: string | null
          dag_run_id: string | null
          detail: Json | null
          error_code: string
          error_message: string | null
          file_hash: string | null
          id: string
          import_job_id: string | null
          occurred_at: string
          original_filename: string | null
          platform: string | null
          rows_attempted: number
          rows_rejected: number
          stage: string | null
          team_id: string | null
        }
        Insert: {
          batch_id?: string | null
          dag_run_id?: string | null
          detail?: Json | null
          error_code: string
          error_message?: string | null
          file_hash?: string | null
          id?: string
          import_job_id?: string | null
          occurred_at?: string
          original_filename?: string | null
          platform?: string | null
          rows_attempted?: number
          rows_rejected?: number
          stage?: string | null
          team_id?: string | null
        }
        Update: {
          batch_id?: string | null
          dag_run_id?: string | null
          detail?: Json | null
          error_code?: string
          error_message?: string | null
          file_hash?: string | null
          id?: string
          import_job_id?: string | null
          occurred_at?: string
          original_filename?: string | null
          platform?: string | null
          rows_attempted?: number
          rows_rejected?: number
          stage?: string | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_dlq_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: true
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_dlq_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_staging: {
        Row: {
          batch_id: string
          created_at: string
          payload: Json
          row_index: number
          target_table: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          payload: Json
          row_index: number
          target_table: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          payload?: Json
          row_index?: number
          target_table?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          billing_details: Json | null
          created_at: string | null
          currency_id: string | null
          discount_amount: number | null
          due_date: string | null
          id: string
          invoice_number: string | null
          line_items: Json | null
          paid_at: string | null
          pdf_url: string | null
          status: string | null
          subscription_id: string | null
          subtotal: number
          tax_amount: number | null
          total: number
          transaction_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          billing_details?: Json | null
          created_at?: string | null
          currency_id?: string | null
          discount_amount?: number | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          line_items?: Json | null
          paid_at?: string | null
          pdf_url?: string | null
          status?: string | null
          subscription_id?: string | null
          subtotal: number
          tax_amount?: number | null
          total: number
          transaction_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          billing_details?: Json | null
          created_at?: string | null
          currency_id?: string | null
          discount_amount?: number | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          line_items?: Json | null
          paid_at?: string | null
          pdf_url?: string | null
          status?: string | null
          subscription_id?: string | null
          subtotal?: number
          tax_amount?: number | null
          total?: number
          transaction_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          alley: string | null
          country_id: string | null
          created_at: string | null
          district: string | null
          house_no: string | null
          id: string
          province_id: string | null
          road: string | null
          sub_district: string | null
          village_no: string | null
        }
        Insert: {
          alley?: string | null
          country_id?: string | null
          created_at?: string | null
          district?: string | null
          house_no?: string | null
          id?: string
          province_id?: string | null
          road?: string | null
          sub_district?: string | null
          village_no?: string | null
        }
        Update: {
          alley?: string | null
          country_id?: string | null
          created_at?: string | null
          district?: string | null
          house_no?: string | null
          id?: string
          province_id?: string | null
          road?: string | null
          sub_district?: string | null
          village_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "provinces"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_activity_codes: {
        Row: {
          action_code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          reward_points: number
          usage_limit: number | null
        }
        Insert: {
          action_code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          reward_points?: number
          usage_limit?: number | null
        }
        Update: {
          action_code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          reward_points?: number
          usage_limit?: number | null
        }
        Relationships: []
      }
      loyalty_mission_completions: {
        Row: {
          action_type: string
          completed_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          action_type: string
          completed_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          action_type?: string
          completed_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      loyalty_missions: {
        Row: {
          action_type: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_one_time: boolean | null
          label: string
          points_awarded: number
        }
        Insert: {
          action_type: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_one_time?: boolean | null
          label: string
          points_awarded: number
        }
        Update: {
          action_type?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_one_time?: boolean | null
          label?: string
          points_awarded?: number
        }
        Relationships: []
      }
      loyalty_points: {
        Row: {
          _override_changer_id: string | null
          created_at: string | null
          id: string
          last_activity_at: string | null
          lifetime_points: number | null
          loyalty_tier_id: string | null
          manual_override_at: string | null
          point_balance: number | null
          profile_customer_id: string | null
          status: string | null
          total_points_earned: number | null
          updated_at: string | null
        }
        Insert: {
          _override_changer_id?: string | null
          created_at?: string | null
          id?: string
          last_activity_at?: string | null
          lifetime_points?: number | null
          loyalty_tier_id?: string | null
          manual_override_at?: string | null
          point_balance?: number | null
          profile_customer_id?: string | null
          status?: string | null
          total_points_earned?: number | null
          updated_at?: string | null
        }
        Update: {
          _override_changer_id?: string | null
          created_at?: string | null
          id?: string
          last_activity_at?: string | null
          lifetime_points?: number | null
          loyalty_tier_id?: string | null
          manual_override_at?: string | null
          point_balance?: number | null
          profile_customer_id?: string | null
          status?: string | null
          total_points_earned?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_loyalty_tier_id_fkey"
            columns: ["loyalty_tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_profile_customer_id_fkey"
            columns: ["profile_customer_id"]
            isOneToOne: true
            referencedRelation: "profile_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_tier_history: {
        Row: {
          change_reason: string | null
          change_type: string
          changed_at: string
          changer_id: string | null
          id: string
          new_tier: string
          old_tier: string | null
          profile_customer_id: string
        }
        Insert: {
          change_reason?: string | null
          change_type?: string
          changed_at?: string
          changer_id?: string | null
          id?: string
          new_tier: string
          old_tier?: string | null
          profile_customer_id: string
        }
        Update: {
          change_reason?: string | null
          change_type?: string
          changed_at?: string
          changer_id?: string | null
          id?: string
          new_tier?: string
          old_tier?: string | null
          profile_customer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_tier_history_profile_customer_id_fkey"
            columns: ["profile_customer_id"]
            isOneToOne: false
            referencedRelation: "profile_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_tiers: {
        Row: {
          badge_color: string | null
          benefits_summary: string | null
          created_at: string | null
          description: string | null
          discount_percentage: number | null
          icon_url: string | null
          id: string
          is_active: boolean | null
          min_points: number | null
          min_spend_amount: number | null
          name: string
          point_multiplier: number | null
          priority_level: number | null
          retention_period_days: number | null
          updated_at: string | null
        }
        Insert: {
          badge_color?: string | null
          benefits_summary?: string | null
          created_at?: string | null
          description?: string | null
          discount_percentage?: number | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          min_points?: number | null
          min_spend_amount?: number | null
          name: string
          point_multiplier?: number | null
          priority_level?: number | null
          retention_period_days?: number | null
          updated_at?: string | null
        }
        Update: {
          badge_color?: string | null
          benefits_summary?: string | null
          created_at?: string | null
          description?: string | null
          discount_percentage?: number | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          min_points?: number | null
          min_spend_amount?: number | null
          name?: string
          point_multiplier?: number | null
          priority_level?: number | null
          retention_period_days?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      metric_templates: {
        Row: {
          calculation_formula: string | null
          created_at: string | null
          data_type: string | null
          description: string | null
          display_format: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          is_calculated: boolean | null
          mapping_category_id: string | null
          metric_name: string
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          calculation_formula?: string | null
          created_at?: string | null
          data_type?: string | null
          description?: string | null
          display_format?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          is_calculated?: boolean | null
          mapping_category_id?: string | null
          metric_name: string
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          calculation_formula?: string | null
          created_at?: string | null
          data_type?: string | null
          description?: string | null
          display_format?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          is_calculated?: boolean | null
          mapping_category_id?: string | null
          metric_name?: string
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_reports: boolean
          id: string
          push_notifications: boolean
          updated_at: string
          user_id: string
          weekly_digest: boolean
        }
        Insert: {
          created_at?: string
          email_reports?: boolean
          id?: string
          push_notifications?: boolean
          updated_at?: string
          user_id: string
          weekly_digest?: boolean
        }
        Update: {
          created_at?: string
          email_reports?: boolean
          id?: string
          push_notifications?: boolean
          updated_at?: string
          user_id?: string
          weekly_digest?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_archived: boolean
          is_read: boolean
          link: string | null
          source_id: string | null
          target_role: string
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_archived?: boolean
          is_read?: boolean
          link?: string | null
          source_id?: string | null
          target_role: string
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_archived?: boolean
          is_read?: boolean
          link?: string | null
          source_id?: string | null
          target_role?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          icon_url: string | null
          id: string
          is_active: boolean | null
          name: string
          provider_id: string | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          provider_id?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          provider_id?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_providers: {
        Row: {
          api_endpoint: string | null
          created_at: string | null
          description: string | null
          icon_url: string | null
          id: string
          is_active: boolean | null
          name: string
          slug: string | null
          supported_currencies: string[] | null
          updated_at: string | null
        }
        Insert: {
          api_endpoint?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          slug?: string | null
          supported_currencies?: string[] | null
          updated_at?: string | null
        }
        Update: {
          api_endpoint?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          slug?: string | null
          supported_currencies?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount: number
          created_at: string | null
          currency_id: string | null
          discount_amount: number | null
          discount_id: string | null
          gateway_response: Json | null
          gateway_transaction_id: string | null
          id: string
          payment_gateway: string | null
          payment_method_id: string | null
          status: string | null
          subscription_id: string | null
          transaction_type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency_id?: string | null
          discount_amount?: number | null
          discount_id?: string | null
          gateway_response?: Json | null
          gateway_transaction_id?: string | null
          id?: string
          payment_gateway?: string | null
          payment_method_id?: string | null
          status?: string | null
          subscription_id?: string | null
          transaction_type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency_id?: string | null
          discount_amount?: number | null
          discount_id?: string | null
          gateway_response?: Json | null
          gateway_transaction_id?: string | null
          id?: string
          payment_gateway?: string | null
          payment_method_id?: string | null
          status?: string | null
          subscription_id?: string | null
          transaction_type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_definition: {
        Row: {
          behaviors: Json | null
          characteristics: Json | null
          created_at: string | null
          demographics: Json | null
          description: string | null
          icon_url: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          behaviors?: Json | null
          characteristics?: Json | null
          created_at?: string | null
          demographics?: Json | null
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          behaviors?: Json | null
          characteristics?: Json | null
          created_at?: string | null
          demographics?: Json | null
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      persona_metrics_daily: {
        Row: {
          count: number
          created_at: string | null
          id: string
          metric_date: string
          metric_type: string
          metric_value: string
        }
        Insert: {
          count?: number
          created_at?: string | null
          id?: string
          metric_date: string
          metric_type: string
          metric_value: string
        }
        Update: {
          count?: number
          created_at?: string | null
          id?: string
          metric_date?: string
          metric_type?: string
          metric_value?: string
        }
        Relationships: []
      }
      pipeline_settings: {
        Row: {
          name: string
          updated_at: string
          value: string
        }
        Insert: {
          name: string
          updated_at?: string
          value: string
        }
        Update: {
          name?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      pipeline_type: {
        Row: {
          color_code: string | null
          created_at: string | null
          description: string | null
          icon_url: string | null
          id: string
          name: string
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name: string
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      platform_categories: {
        Row: {
          created_at: string | null
          description: string | null
          icon_url: string | null
          id: string
          name: string
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name: string
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name?: string
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      platform_mapping_events: {
        Row: {
          created_at: string | null
          data_type: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          mapping_category_id: string | null
          platform_field_name: string
          platform_id: string | null
          standard_field_name: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          data_type?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          mapping_category_id?: string | null
          platform_field_name: string
          platform_id?: string | null
          standard_field_name?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          data_type?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          mapping_category_id?: string | null
          platform_field_name?: string
          platform_id?: string | null
          standard_field_name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_mapping_events_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_standard_mappings: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          mapping_category_id: string | null
          platform_field_name: string
          platform_id: string | null
          standard_field_name: string | null
          transform_formula: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          mapping_category_id?: string | null
          platform_field_name: string
          platform_id?: string | null
          standard_field_name?: string | null
          transform_formula?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          mapping_category_id?: string | null
          platform_field_name?: string
          platform_id?: string | null
          standard_field_name?: string | null
          transform_formula?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_standard_mappings_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      platforms: {
        Row: {
          api_version: string | null
          created_at: string | null
          description: string | null
          icon_url: string | null
          id: string
          is_active: boolean | null
          name: string
          platform_category_id: string | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          api_version?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          platform_category_id?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          api_version?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          platform_category_id?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platforms_platform_category_id_fkey"
            columns: ["platform_category_id"]
            isOneToOne: false
            referencedRelation: "platform_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      point_earning_rules: {
        Row: {
          action_code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_times_per_user: number | null
          name: string
          points_reward: number
          updated_at: string | null
        }
        Insert: {
          action_code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_times_per_user?: number | null
          name: string
          points_reward: number
          updated_at?: string | null
        }
        Update: {
          action_code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_times_per_user?: number | null
          name?: string
          points_reward?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      points_transactions: {
        Row: {
          balance_after: number
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          loyalty_points_id: string | null
          points_amount: number
          reference_id: string | null
          reference_type: string | null
          transaction_type: string
          user_id: string
        }
        Insert: {
          balance_after: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          loyalty_points_id?: string | null
          points_amount: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_type: string
          user_id: string
        }
        Update: {
          balance_after?: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          loyalty_points_id?: string | null
          points_amount?: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "points_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      post_personas: {
        Row: {
          assigned_at: string
          persona_id: string
          post_id: string
        }
        Insert: {
          assigned_at?: string
          persona_id: string
          post_id: string
        }
        Update: {
          assigned_at?: string
          persona_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_personas_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "customer_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_personas_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_customers: {
        Row: {
          avatar_url: string | null
          birthday_at: string | null
          created_at: string | null
          first_name: string | null
          gender: string | null
          id: string
          last_active: string | null
          last_name: string | null
          location_id: string | null
          loyalty_point_id: string | null
          phone_number: string | null
          profile_img: string | null
          role_id: string | null
          salary_range: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          birthday_at?: string | null
          created_at?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_active?: string | null
          last_name?: string | null
          location_id?: string | null
          loyalty_point_id?: string | null
          phone_number?: string | null
          profile_img?: string | null
          role_id?: string | null
          salary_range?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          birthday_at?: string | null
          created_at?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_active?: string | null
          last_name?: string | null
          location_id?: string | null
          loyalty_point_id?: string | null
          phone_number?: string | null
          profile_img?: string | null
          role_id?: string | null
          salary_range?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_customers_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_server: {
        Row: {
          created_at: string | null
          description: string | null
          icon_url: string | null
          id: string
          link_url: string | null
          name: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          link_url?: string | null
          name: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          link_url?: string | null
          name?: string
        }
        Relationships: []
      }
      provinces: {
        Row: {
          country_id: string | null
          created_at: string | null
          id: string
          postal_code: string | null
          province_name: string
        }
        Insert: {
          country_id?: string | null
          created_at?: string | null
          id?: string
          postal_code?: string | null
          province_name: string
        }
        Update: {
          country_id?: string | null
          created_at?: string | null
          id?: string
          postal_code?: string | null
          province_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "provinces_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
      rating: {
        Row: {
          color_code: string | null
          created_at: string | null
          descriptions: string | null
          icon_url: string | null
          id: string
          name: string | null
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          descriptions?: string | null
          icon_url?: string | null
          id?: string
          name?: string | null
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          descriptions?: string | null
          icon_url?: string | null
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string | null
          created_by: string | null
          date_range_type: string | null
          description: string | null
          end_date: string | null
          file_format: string | null
          file_url: string | null
          filters: Json | null
          generated_at: string | null
          id: string
          name: string
          report_type: string
          start_date: string | null
          status: string | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date_range_type?: string | null
          description?: string | null
          end_date?: string | null
          file_format?: string | null
          file_url?: string | null
          filters?: Json | null
          generated_at?: string | null
          id?: string
          name: string
          report_type: string
          start_date?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date_range_type?: string | null
          description?: string | null
          end_date?: string | null
          file_format?: string | null
          file_url?: string | null
          filters?: Json | null
          generated_at?: string | null
          id?: string
          name?: string
          report_type?: string
          start_date?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      request_logs: {
        Row: {
          duration_ms: number | null
          id: string
          method: string | null
          request_body: Json | null
          request_header: Json | null
          response_body: Json | null
          server_id: string | null
          status_code_id: string | null
          timestamp: string | null
          url: string | null
        }
        Insert: {
          duration_ms?: number | null
          id?: string
          method?: string | null
          request_body?: Json | null
          request_header?: Json | null
          response_body?: Json | null
          server_id?: string | null
          status_code_id?: string | null
          timestamp?: string | null
          url?: string | null
        }
        Update: {
          duration_ms?: number | null
          id?: string
          method?: string | null
          request_body?: Json | null
          request_header?: Json | null
          response_body?: Json | null
          server_id?: string | null
          status_code_id?: string | null
          timestamp?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_logs_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "server"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_metrics: {
        Row: {
          ad_spend: number | null
          average_order_value: number | null
          created_at: string | null
          gross_revenue: number | null
          id: string
          metric_date: string
          net_revenue: number | null
          new_customers: number | null
          previous_period_revenue: number | null
          profit: number | null
          profit_margin: number | null
          returning_customers: number | null
          revenue_by_campaign: Json | null
          revenue_by_channel: Json | null
          revenue_growth_percent: number | null
          team_id: string | null
          total_orders: number | null
          updated_at: string | null
        }
        Insert: {
          ad_spend?: number | null
          average_order_value?: number | null
          created_at?: string | null
          gross_revenue?: number | null
          id?: string
          metric_date: string
          net_revenue?: number | null
          new_customers?: number | null
          previous_period_revenue?: number | null
          profit?: number | null
          profit_margin?: number | null
          returning_customers?: number | null
          revenue_by_campaign?: Json | null
          revenue_by_channel?: Json | null
          revenue_growth_percent?: number | null
          team_id?: string | null
          total_orders?: number | null
          updated_at?: string | null
        }
        Update: {
          ad_spend?: number | null
          average_order_value?: number | null
          created_at?: string | null
          gross_revenue?: number | null
          id?: string
          metric_date?: string
          net_revenue?: number | null
          new_customers?: number | null
          previous_period_revenue?: number | null
          profit?: number | null
          profit_margin?: number | null
          returning_customers?: number | null
          revenue_by_campaign?: Json | null
          revenue_by_channel?: Json | null
          revenue_growth_percent?: number | null
          team_id?: string | null
          total_orders?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "revenue_metrics_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_items: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          points_cost: number
          reward_type: string
          stock_quantity: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          points_cost: number
          reward_type: string
          stock_quantity?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          points_cost?: number
          reward_type?: string
          stock_quantity?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      reward_redemptions: {
        Row: {
          admin_notes: string | null
          fulfilled_at: string | null
          id: string
          points_transaction_id: string | null
          redeemed_at: string | null
          redemption_code: string | null
          reward_id: string
          status: string | null
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          fulfilled_at?: string | null
          id?: string
          points_transaction_id?: string | null
          redeemed_at?: string | null
          redemption_code?: string | null
          reward_id: string
          status?: string | null
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          fulfilled_at?: string | null
          id?: string
          points_transaction_id?: string | null
          redeemed_at?: string | null
          redemption_code?: string | null
          reward_id?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_points_transaction_id_fkey"
            columns: ["points_transaction_id"]
            isOneToOne: false
            referencedRelation: "points_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "reward_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      role_employees: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          permission_level: number | null
          role_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          permission_level?: number | null
          role_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          permission_level?: number | null
          role_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      scheduled_reports: {
        Row: {
          created_at: string
          created_by: string | null
          format: string
          frequency: string
          id: string
          is_active: boolean
          last_run_at: string | null
          name: string
          next_run_at: string | null
          recipients: Json
          report_id: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          format?: string
          frequency?: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          recipients?: Json
          report_id?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          format?: string
          frequency?: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          recipients?: Json
          report_id?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reports_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      security_level: {
        Row: {
          color_code: string | null
          created_at: string | null
          description: string | null
          icon_url: string | null
          id: string
          name: string
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name: string
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          description?: string | null
          icon_url?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      server: {
        Row: {
          color_code: string | null
          cpu_usage_percent: number | null
          disk_total: number | null
          disk_used: number | null
          hostname: string
          icon_url: string | null
          id: string
          ip_address: string | null
          last_update: string | null
          provider_server_id: string | null
          status: string | null
          system_boot_time: string | null
          total_memory: number | null
          used_memory: number | null
        }
        Insert: {
          color_code?: string | null
          cpu_usage_percent?: number | null
          disk_total?: number | null
          disk_used?: number | null
          hostname: string
          icon_url?: string | null
          id?: string
          ip_address?: string | null
          last_update?: string | null
          provider_server_id?: string | null
          status?: string | null
          system_boot_time?: string | null
          total_memory?: number | null
          used_memory?: number | null
        }
        Update: {
          color_code?: string | null
          cpu_usage_percent?: number | null
          disk_total?: number | null
          disk_used?: number | null
          hostname?: string
          icon_url?: string | null
          id?: string
          ip_address?: string | null
          last_update?: string | null
          provider_server_id?: string | null
          status?: string | null
          system_boot_time?: string | null
          total_memory?: number | null
          used_memory?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "server_provider_server_id_fkey"
            columns: ["provider_server_id"]
            isOneToOne: false
            referencedRelation: "provider_server"
            referencedColumns: ["id"]
          },
        ]
      }
      social_comments: {
        Row: {
          author_avatar_url: string | null
          author_name: string
          author_platform_id: string | null
          content: string
          created_at: string
          id: string
          is_read: boolean
          is_replied: boolean
          platform_comment_id: string | null
          platform_id: string | null
          post_id: string
          replied_at: string | null
          reply_content: string | null
          sentiment: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          author_avatar_url?: string | null
          author_name?: string
          author_platform_id?: string | null
          content: string
          created_at?: string
          id?: string
          is_read?: boolean
          is_replied?: boolean
          platform_comment_id?: string | null
          platform_id?: string | null
          post_id: string
          replied_at?: string | null
          reply_content?: string | null
          sentiment?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          author_avatar_url?: string | null
          author_name?: string
          author_platform_id?: string | null
          content?: string
          created_at?: string
          id?: string
          is_read?: boolean
          is_replied?: boolean
          platform_comment_id?: string | null
          platform_id?: string | null
          post_id?: string
          replied_at?: string | null
          reply_content?: string | null
          sentiment?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_comments_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_comments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          ad_group_id: string | null
          click_count: number | null
          clicks: number | null
          comments: number | null
          content: string | null
          created_at: string | null
          created_by: string | null
          engagement_rate: number | null
          hashtags: string[] | null
          id: string
          impressions: number | null
          likes: number | null
          media_urls: string[] | null
          mentions: string[] | null
          name: string | null
          open_count: number | null
          platform_id: string | null
          platform_post_id: string | null
          post_channel: string
          post_type: string | null
          post_url: string | null
          published_at: string | null
          reach: number | null
          recipient_count: number | null
          saves: number | null
          scheduled_at: string | null
          sent_at: string | null
          shares: number | null
          status: string | null
          subject: string | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          ad_group_id?: string | null
          click_count?: number | null
          clicks?: number | null
          comments?: number | null
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          engagement_rate?: number | null
          hashtags?: string[] | null
          id?: string
          impressions?: number | null
          likes?: number | null
          media_urls?: string[] | null
          mentions?: string[] | null
          name?: string | null
          open_count?: number | null
          platform_id?: string | null
          platform_post_id?: string | null
          post_channel?: string
          post_type?: string | null
          post_url?: string | null
          published_at?: string | null
          reach?: number | null
          recipient_count?: number | null
          saves?: number | null
          scheduled_at?: string | null
          sent_at?: string | null
          shares?: number | null
          status?: string | null
          subject?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          ad_group_id?: string | null
          click_count?: number | null
          clicks?: number | null
          comments?: number | null
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          engagement_rate?: number | null
          hashtags?: string[] | null
          id?: string
          impressions?: number | null
          likes?: number | null
          media_urls?: string[] | null
          mentions?: string[] | null
          name?: string | null
          open_count?: number | null
          platform_id?: string | null
          platform_post_id?: string | null
          post_channel?: string
          post_type?: string | null
          post_url?: string | null
          published_at?: string | null
          reach?: number | null
          recipient_count?: number | null
          saves?: number | null
          scheduled_at?: string | null
          sent_at?: string | null
          shares?: number | null
          status?: string | null
          subject?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_ad_group_id_fkey"
            columns: ["ad_group_id"]
            isOneToOne: false
            referencedRelation: "ad_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string | null
          currency_id: string | null
          description: string | null
          display_order: number | null
          feature_active: Json | null
          features: Json | null
          id: string
          is_active: boolean | null
          is_popular: boolean | null
          limits: Json | null
          max_workspace: number | null
          name: string
          price_monthly: number | null
          price_yearly: number | null
          slug: string | null
          tier: number
          trial_days: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency_id?: string | null
          description?: string | null
          display_order?: number | null
          feature_active?: Json | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          is_popular?: boolean | null
          limits?: Json | null
          max_workspace?: number | null
          name: string
          price_monthly?: number | null
          price_yearly?: number | null
          slug?: string | null
          tier?: number
          trial_days?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency_id?: string | null
          description?: string | null
          display_order?: number | null
          feature_active?: Json | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          is_popular?: boolean | null
          limits?: Json | null
          max_workspace?: number | null
          name?: string
          price_monthly?: number | null
          price_yearly?: number | null
          slug?: string | null
          tier?: number
          trial_days?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plans_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_cycle: string | null
          cancel_at_period_end: boolean | null
          cancelled_at: string | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_id: string
          status: string | null
          team_id: string | null
          trial_end: string | null
          trial_start: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean | null
          cancelled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id: string
          status?: string | null
          team_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean | null
          cancelled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id?: string
          status?: string | null
          team_id?: string | null
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      suspicious_activities: {
        Row: {
          activity_type: string
          created_at: string | null
          description: string | null
          id: string
          is_resolved: boolean | null
          metadata: Json | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string | null
          user_id: string
        }
        Insert: {
          activity_type: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_resolved?: boolean | null
          metadata?: Json | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_resolved?: boolean | null
          metadata?: Json | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suspicious_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_history: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          platform_id: string
          rows_synced: number
          started_at: string
          status: string
          sync_type: string
          team_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          platform_id: string
          rows_synced?: number
          started_at?: string
          status?: string
          sync_type?: string
          team_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          platform_id?: string
          rows_synced?: number
          started_at?: string
          status?: string
          sync_type?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_history_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_history_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health: {
        Row: {
          id: string
          last_checked: string | null
          metadata: Json | null
          response_time_ms: number | null
          service_name: string
          service_type: string
          status: string
          uptime_percentage: number | null
        }
        Insert: {
          id?: string
          last_checked?: string | null
          metadata?: Json | null
          response_time_ms?: number | null
          service_name: string
          service_type: string
          status: string
          uptime_percentage?: number | null
        }
        Update: {
          id?: string
          last_checked?: string | null
          metadata?: Json | null
          response_time_ms?: number | null
          service_name?: string
          service_type?: string
          status?: string
          uptime_percentage?: number | null
        }
        Relationships: []
      }
      tags: {
        Row: {
          color_code: string
          created_at: string
          created_by: string | null
          entity_type: string
          id: string
          name: string
          team_id: string
          updated_at: string
        }
        Insert: {
          color_code?: string
          created_at?: string
          created_by?: string | null
          entity_type?: string
          id?: string
          name: string
          team_id: string
          updated_at?: string
        }
        Update: {
          color_code?: string
          created_at?: string
          created_by?: string | null
          entity_type?: string
          id?: string
          name?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      team_activity_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          target_email: string | null
          target_user_id: string | null
          team_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          target_email?: string | null
          target_user_id?: string | null
          team_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_email?: string | null
          target_user_id?: string | null
          team_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_activity_logs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invitations: {
        Row: {
          created_at: string
          custom_permissions: Json | null
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["team_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          team_id: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_permissions?: Json | null
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          team_id: string
          token?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_permissions?: Json | null
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          team_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_history: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string | null
          id: string
          is_manual_override: boolean | null
          new_tier_id: string
          previous_tier_id: string | null
          user_id: string
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string | null
          id?: string
          is_manual_override?: boolean | null
          new_tier_id: string
          previous_tier_id?: string | null
          user_id: string
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string | null
          id?: string
          is_manual_override?: boolean | null
          new_tier_id?: string
          previous_tier_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_history_new_tier_id_fkey"
            columns: ["new_tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_history_previous_tier_id_fkey"
            columns: ["previous_tier_id"]
            isOneToOne: false
            referencedRelation: "loyalty_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      time_zones: {
        Row: {
          country_id: string | null
          created_at: string | null
          iana_name: string
          id: string
          utc_offset_sec: number | null
        }
        Insert: {
          country_id?: string | null
          created_at?: string | null
          iana_name: string
          id?: string
          utc_offset_sec?: number | null
        }
        Update: {
          country_id?: string | null
          created_at?: string | null
          iana_name?: string
          id?: string
          utc_offset_sec?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "time_zones_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
        ]
      }
      user_completed_rules: {
        Row: {
          completed_at: string | null
          id: string
          points_transaction_id: string | null
          rule_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          points_transaction_id?: string | null
          rule_id: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          points_transaction_id?: string | null
          rule_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_completed_rules_points_transaction_id_fkey"
            columns: ["points_transaction_id"]
            isOneToOne: false
            referencedRelation: "points_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_completed_rules_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "point_earning_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_completed_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      user_payment_methods: {
        Row: {
          account_last_four: string | null
          bank_name: string | null
          billing_details: Json | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last_four: string | null
          created_at: string | null
          gateway_customer_id: string | null
          gateway_payment_method_id: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          payment_method_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_last_four?: string | null
          bank_name?: string | null
          billing_details?: Json | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last_four?: string | null
          created_at?: string | null
          gateway_customer_id?: string | null
          gateway_payment_method_id?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          payment_method_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_last_four?: string | null
          bank_name?: string | null
          billing_details?: Json | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last_four?: string | null
          created_at?: string | null
          gateway_customer_id?: string | null
          gateway_payment_method_id?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          payment_method_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_payment_methods_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_payment_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      user_redeemed_coupons: {
        Row: {
          coupon_code: string
          customer_name: string | null
          discount_id: string | null
          id: string
          redeemed_at: string
          reward_item_id: string
          status: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          coupon_code: string
          customer_name?: string | null
          discount_id?: string | null
          id?: string
          redeemed_at?: string
          reward_item_id: string
          status?: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          coupon_code?: string
          customer_name?: string | null
          discount_id?: string | null
          id?: string
          redeemed_at?: string
          reward_item_id?: string
          status?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_redeemed_coupons_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_redeemed_coupons_reward_item_id_fkey"
            columns: ["reward_item_id"]
            isOneToOne: false
            referencedRelation: "reward_items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workspace_ad_persona: {
        Row: {
          avatar_url: string | null
          created_at: string
          custom_bio: string | null
          custom_title: string | null
          id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          custom_bio?: string | null
          custom_title?: string | null
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          custom_bio?: string | null
          custom_title?: string | null
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_ad_persona_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_api_keys: {
        Row: {
          access_token: string | null
          account_id_on_platform: string | null
          api_key_encrypted: string | null
          api_secret_encrypted: string | null
          created_at: string | null
          error_message: string | null
          id: string
          is_active: boolean | null
          last_synced_at: string | null
          platform_id: string
          refresh_token: string | null
          scopes: string | null
          sync_status: string | null
          team_id: string
          token_expires_at: string | null
          updated_at: string | null
          webhook_url: string | null
        }
        Insert: {
          access_token?: string | null
          account_id_on_platform?: string | null
          api_key_encrypted?: string | null
          api_secret_encrypted?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          platform_id: string
          refresh_token?: string | null
          scopes?: string | null
          sync_status?: string | null
          team_id: string
          token_expires_at?: string | null
          updated_at?: string | null
          webhook_url?: string | null
        }
        Update: {
          access_token?: string | null
          account_id_on_platform?: string | null
          api_key_encrypted?: string | null
          api_secret_encrypted?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          platform_id?: string
          refresh_token?: string | null
          scopes?: string | null
          sync_status?: string | null
          team_id?: string
          token_expires_at?: string | null
          updated_at?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_api_keys_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_api_keys_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          custom_permissions: Json | null
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["team_role"]
          status: Database["public"]["Enums"]["member_status"]
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          custom_permissions?: Json | null
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["member_status"]
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          custom_permissions?: Json | null
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["team_role"]
          status?: Database["public"]["Enums"]["member_status"]
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          related_id: string | null
          title: string
          type: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          related_id?: string | null
          title: string
          type: string
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          related_id?: string | null
          title?: string
          type?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          business_type_id: string | null
          company_name: string | null
          created_at: string
          default_currency: string | null
          description: string | null
          id: string
          industries_id: string | null
          logo_url: string | null
          name: string
          owner_id: string
          status: string | null
          timezone: string | null
          updated_at: string
          workspace_url: string | null
        }
        Insert: {
          business_type_id?: string | null
          company_name?: string | null
          created_at?: string
          default_currency?: string | null
          description?: string | null
          id?: string
          industries_id?: string | null
          logo_url?: string | null
          name: string
          owner_id: string
          status?: string | null
          timezone?: string | null
          updated_at?: string
          workspace_url?: string | null
        }
        Update: {
          business_type_id?: string | null
          company_name?: string | null
          created_at?: string
          default_currency?: string | null
          description?: string | null
          id?: string
          industries_id?: string | null
          logo_url?: string | null
          name?: string
          owner_id?: string
          status?: string | null
          timezone?: string | null
          updated_at?: string
          workspace_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_business_type_id_fkey"
            columns: ["business_type_id"]
            isOneToOne: false
            referencedRelation: "business_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_industries_id_fkey"
            columns: ["industries_id"]
            isOneToOne: false
            referencedRelation: "industries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      audit_logs_view: {
        Row: {
          action_type_id: string | null
          base_action_name: string | null
          category: string | null
          created_at: string | null
          description: string | null
          display_action_name: string | null
          error_id: string | null
          id: string | null
          ip_address: string | null
          metadata: Json | null
          server_id: string | null
          status: string | null
          user_email: string | null
          user_id: string | null
          user_role: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_enhanced_action_type_id_fkey"
            columns: ["action_type_id"]
            isOneToOne: false
            referencedRelation: "action_type"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_enhanced_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "server"
            referencedColumns: ["id"]
          },
        ]
      }
      debug_insights_linkage: {
        Row: {
          account_id: string | null
          account_name: string | null
          account_team_id: string | null
          date: string | null
          insight_acc_id: string | null
          insight_id: string | null
          team_name: string | null
          team_owner_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_accounts_team_id_fkey"
            columns: ["account_team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_insights_ad_account_id_fkey"
            columns: ["insight_acc_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_insights_ad_account_id_fkey"
            columns: ["insight_acc_id"]
            isOneToOne: false
            referencedRelation: "debug_insights_linkage"
            referencedColumns: ["account_id"]
          },
        ]
      }
    }
    Functions: {
      admin_override_tier: {
        Args: { p_new_tier_name: string; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      apply_collected_discount: { Args: { p_code: string }; Returns: Json }
      auto_stop_completed_campaigns: {
        Args: never
        Returns: {
          campaign_id: string
          campaign_name: string
          overall_pct: number
        }[]
      }
      award_loyalty_points: { Args: { p_action_type: string }; Returns: Json }
      can_manage_team: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      create_ad_with_mirror_post: {
        Args: {
          p_ad_copy: string
          p_ad_group_id: string
          p_budget: number
          p_call_to_action: string
          p_content: string
          p_creative_type: string
          p_creative_url: string
          p_headline: string
          p_media_urls: string[]
          p_name: string
          p_platform_ad_id: string
          p_platform_id: string
          p_preview_url: string
          p_scheduled_at: string
          p_status: string
          p_team_id: string
        }
        Returns: Json
      }
      create_weekly_digest_notifications: { Args: never; Returns: number }
      debug_dashboard_visibility: { Args: never; Returns: string }
      discard_staging_batch: { Args: { p_batch_id: string }; Returns: number }
      ensure_loyalty_wallet: { Args: never; Returns: undefined }
      evaluate_inactivity_tier_downgrades: { Args: never; Returns: Json }
      get_available_discounts: {
        Args: { p_customer_id: string }
        Returns: {
          code: string
          description: string
          id: string
          name: string
          publish_time: string
        }[]
      }
      get_customer_journey_funnel_totals: {
        Args: { p_date_from?: string; p_platform_id?: string }
        Returns: Json
      }
      get_customer_journey_monthly_data: {
        Args: { p_months_back?: number; p_platform_id?: string }
        Returns: {
          acquisition: number
          acquisition_is_estimated: boolean
          awareness: number
          consideration: number
          conversion: number
          conversion_is_estimated: boolean
          intent: number
          intent_is_estimated: boolean
          month: string
          month_label: string
        }[]
      }
      get_employee_role: { Args: { _user_id: string }; Returns: string }
      get_my_loyalty_tier: { Args: never; Returns: Json }
      get_my_team_ids: { Args: never; Returns: string[] }
      get_notification_preferences: {
        Args: { p_user_id: string }
        Returns: {
          email_reports: boolean
          push_notifications: boolean
          weekly_digest: boolean
        }[]
      }
      get_team_role: {
        Args: { _team_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["team_role"]
      }
      get_tier_history_for_support: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          change_reason: string
          change_type: string
          changed_at: string
          changer_id: string
          customer_email: string
          customer_first_name: string
          customer_last_name: string
          customer_user_id: string
          id: string
          new_tier: string
          old_tier: string
          profile_customer_id: string
        }[]
      }
      has_employee_role: {
        Args: { _role_name: string; _user_id: string }
        Returns: boolean
      }
      has_permission: {
        Args: { _permission: string; _team_id: string; _user_id: string }
        Returns: boolean
      }
      has_role:
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
        | { Args: { _role: string; _user_id: string }; Returns: boolean }
      increment_discount_usage: { Args: { d_id: string }; Returns: undefined }
      is_employee: { Args: { _user_id: string }; Returns: boolean }
      is_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      manual_override_customer_tier: {
        Args: {
          new_tier_id: string
          override_reason?: string
          target_user_id: string
        }
        Returns: Json
      }
      pipeline_setting: { Args: { _name: string }; Returns: string }
      pipeline_webhook_health: { Args: never; Returns: Json }
      process_scheduled_reports_with_preferences: {
        Args: never
        Returns: {
          recipient_email: string
          recipient_user_id: string
          report_id: string
          report_name: string
        }[]
      }
      promote_batch: {
        Args: { p_batch_id: string; p_import_job_id: string; p_team_id: string }
        Returns: Json
      }
      redeem_reward: { Args: { p_reward_item_id: string }; Returns: Json }
      search_customers_for_support: {
        Args: { p_query: string }
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          loyalty_points_balance: number
          loyalty_tier: string
        }[]
      }
      seed_demo_insights: {
        Args: { p_ad_account_id: string }
        Returns: undefined
      }
      send_promo_to_customer: {
        Args: {
          p_context?: string
          p_customer_id: string
          p_discount_id: string
        }
        Returns: Json
      }
      set_pipeline_setting: {
        Args: { _name: string; _value: string }
        Returns: string
      }
      sync_tier_from_lifetime_points: { Args: never; Returns: Json }
      try_cast_uuid: { Args: { _text: string }; Returns: string }
      update_tier_retention_period: {
        Args: { p_retention_days: number; p_tier_id: string }
        Returns: Json
      }
      validate_collected_discount: { Args: { p_code: string }; Returns: Json }
    }
    Enums: {
      app_role: "customer" | "admin" | "owner" | "dev" | "support"
      invitation_status: "pending" | "accepted" | "declined" | "expired"
      member_status: "active" | "suspended" | "removed"
      team_role: "owner" | "admin" | "editor" | "viewer"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["customer", "admin", "owner", "dev", "support"],
      invitation_status: ["pending", "accepted", "declined", "expired"],
      member_status: ["active", "suspended", "removed"],
      team_role: ["owner", "admin", "editor", "viewer"],
    },
  },
} as const
