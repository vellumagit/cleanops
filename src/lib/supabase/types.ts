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
      ai_conversations: {
        Row: {
          created_at: string
          id: string
          membership_id: string | null
          messages: Json
          organization_id: string
          page_context: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          membership_id?: string | null
          messages?: Json
          organization_id: string
          page_context?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          membership_id?: string | null
          messages?: Json
          organization_id?: string
          page_context?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at: string | null
          organization_id: string
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at?: string | null
          organization_id: string
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          label?: string
          last_used_at?: string | null
          organization_id?: string
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          organization_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          organization_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_overrides: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          id: string
          kind: string
          membership_id: string
          organization_id: string
          reason: string | null
          start_time: string | null
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          kind: string
          membership_id: string
          organization_id: string
          reason?: string | null
          start_time?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          kind?: string
          membership_id?: string
          organization_id?: string
          reason?: string | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_overrides_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_slots: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          membership_id: string
          organization_id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          membership_id: string
          organization_id: string
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          membership_id?: string
          organization_id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_slots_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_slots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_rules: {
        Row: {
          amount_cents: number
          created_at: string
          efficiency_amount_cents: number
          efficiency_enabled: boolean
          efficiency_min_hours_saved: number
          efficiency_min_jobs: number
          enabled: boolean
          id: string
          min_avg_rating: number
          min_reviews_count: number
          organization_id: string
          period_days: number
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          efficiency_amount_cents?: number
          efficiency_enabled?: boolean
          efficiency_min_hours_saved?: number
          efficiency_min_jobs?: number
          enabled?: boolean
          id?: string
          min_avg_rating?: number
          min_reviews_count?: number
          organization_id: string
          period_days?: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          efficiency_amount_cents?: number
          efficiency_enabled?: boolean
          efficiency_min_hours_saved?: number
          efficiency_min_jobs?: number
          enabled?: boolean
          id?: string
          min_avg_rating?: number
          min_reviews_count?: number
          organization_id?: string
          period_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bonuses: {
        Row: {
          amount_cents: number
          bonus_type: string
          created_at: string
          employee_id: string
          id: string
          organization_id: string
          paid_at: string | null
          payroll_run_id: string | null
          period_end: string
          period_start: string
          reason: string | null
          status: Database["public"]["Enums"]["bonus_status"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          bonus_type?: string
          created_at?: string
          employee_id: string
          id?: string
          organization_id: string
          paid_at?: string | null
          payroll_run_id?: string | null
          period_end: string
          period_start: string
          reason?: string | null
          status?: Database["public"]["Enums"]["bonus_status"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          bonus_type?: string
          created_at?: string
          employee_id?: string
          id?: string
          organization_id?: string
          paid_at?: string | null
          payroll_run_id?: string | null
          period_end?: string
          period_start?: string
          reason?: string | null
          status?: Database["public"]["Enums"]["bonus_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonuses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonuses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonuses_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_assignees: {
        Row: {
          acceptance_status: string
          booking_id: string
          created_at: string
          id: string
          is_primary: boolean
          membership_id: string
          organization_id: string
          responded_at: string | null
          split_duration_minutes: number | null
          split_index: number | null
          split_start_offset_minutes: number | null
        }
        Insert: {
          acceptance_status?: string
          booking_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          membership_id: string
          organization_id: string
          responded_at?: string | null
          split_duration_minutes?: number | null
          split_index?: number | null
          split_start_offset_minutes?: number | null
        }
        Update: {
          acceptance_status?: string
          booking_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          membership_id?: string
          organization_id?: string
          responded_at?: string | null
          split_duration_minutes?: number | null
          split_index?: number | null
          split_start_offset_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_assignees_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignees_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_assignees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_checklist_items: {
        Row: {
          booking_id: string
          checked_at: string | null
          checked_by: string | null
          created_at: string
          id: string
          is_required: boolean
          notes: string | null
          ordinal: number
          organization_id: string
          phase: string
          source_template_id: string | null
          title: string
        }
        Insert: {
          booking_id: string
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          notes?: string | null
          ordinal?: number
          organization_id: string
          phase?: string
          source_template_id?: string | null
          title: string
        }
        Update: {
          booking_id?: string
          checked_at?: string | null
          checked_by?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          notes?: string | null
          ordinal?: number
          organization_id?: string
          phase?: string
          source_template_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_checklist_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checklist_items_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checklist_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_checklist_items_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_member_calendar_events: {
        Row: {
          booking_id: string
          created_at: string
          google_calendar_event_id: string
          id: string
          membership_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          google_calendar_event_id: string
          id?: string
          membership_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          google_calendar_event_id?: string
          id?: string
          membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_member_calendar_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_member_calendar_events_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_requests: {
        Row: {
          address: string | null
          booking_id: string | null
          client_id: string
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          preferred_date: string | null
          preferred_time_window: string | null
          responded_at: string | null
          responded_by: string | null
          service_type: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          booking_id?: string | null
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          preferred_date?: string | null
          preferred_time_window?: string | null
          responded_at?: string | null
          responded_by?: string | null
          service_type?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          booking_id?: string | null
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          preferred_date?: string | null
          preferred_time_window?: string | null
          responded_at?: string | null
          responded_by?: string | null
          service_type?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requests_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_series: {
        Row: {
          active: boolean
          address: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          custom_days: number[] | null
          duration_minutes: number
          ends_at: string | null
          generate_ahead: number
          hourly_rate_cents: number | null
          id: string
          monthly_dow: number | null
          monthly_nth: number | null
          notes: string | null
          organization_id: string
          package_id: string | null
          pattern: string
          service_type: string
          service_type_id: string | null
          service_type_label: string | null
          skip_dates: string[]
          start_time: string
          starts_at: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          assigned_to?: string | null
          client_id: string
          created_at?: string
          custom_days?: number[] | null
          duration_minutes: number
          ends_at?: string | null
          generate_ahead?: number
          hourly_rate_cents?: number | null
          id?: string
          monthly_dow?: number | null
          monthly_nth?: number | null
          notes?: string | null
          organization_id: string
          package_id?: string | null
          pattern: string
          service_type?: string
          service_type_id?: string | null
          service_type_label?: string | null
          skip_dates?: string[]
          start_time: string
          starts_at: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          assigned_to?: string | null
          client_id?: string
          created_at?: string
          custom_days?: number[] | null
          duration_minutes?: number
          ends_at?: string | null
          generate_ahead?: number
          hourly_rate_cents?: number | null
          id?: string
          monthly_dow?: number | null
          monthly_nth?: number | null
          notes?: string | null
          organization_id?: string
          package_id?: string | null
          pattern?: string
          service_type?: string
          service_type_id?: string | null
          service_type_label?: string | null
          skip_dates?: string[]
          start_time?: string
          starts_at?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_series_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          address: string | null
          archived_at: string | null
          assigned_to: string | null
          billing_invoice_id: string | null
          cancelled_email_sent_at: string | null
          client_id: string
          client_reminder_sent_at: string | null
          confirmation_email_sent_at: string | null
          created_at: string
          duration_minutes: number
          estimate_id: string | null
          google_calendar_event_id: string | null
          hourly_rate_cents: number | null
          id: string
          notes: string | null
          organization_id: string
          package_id: string | null
          rescheduled_email_sent_at: string | null
          review_request_sent_at: string | null
          review_token: string | null
          scheduled_at: string
          series_id: string | null
          service_type: Database["public"]["Enums"]["service_type"]
          service_type_id: string | null
          service_type_label: string | null
          splits: Json
          status: Database["public"]["Enums"]["booking_status"]
          total_cents: number
          unassigned_alert_sent_at: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          assigned_to?: string | null
          billing_invoice_id?: string | null
          cancelled_email_sent_at?: string | null
          client_id: string
          client_reminder_sent_at?: string | null
          confirmation_email_sent_at?: string | null
          created_at?: string
          duration_minutes: number
          estimate_id?: string | null
          google_calendar_event_id?: string | null
          hourly_rate_cents?: number | null
          id?: string
          notes?: string | null
          organization_id: string
          package_id?: string | null
          rescheduled_email_sent_at?: string | null
          review_request_sent_at?: string | null
          review_token?: string | null
          scheduled_at: string
          series_id?: string | null
          service_type: Database["public"]["Enums"]["service_type"]
          service_type_id?: string | null
          service_type_label?: string | null
          splits?: Json
          status?: Database["public"]["Enums"]["booking_status"]
          total_cents?: number
          unassigned_alert_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          assigned_to?: string | null
          billing_invoice_id?: string | null
          cancelled_email_sent_at?: string | null
          client_id?: string
          client_reminder_sent_at?: string | null
          confirmation_email_sent_at?: string | null
          created_at?: string
          duration_minutes?: number
          estimate_id?: string | null
          google_calendar_event_id?: string | null
          hourly_rate_cents?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          package_id?: string | null
          rescheduled_email_sent_at?: string | null
          review_request_sent_at?: string | null
          review_token?: string | null
          scheduled_at?: string
          series_id?: string | null
          service_type?: Database["public"]["Enums"]["service_type"]
          service_type_id?: string | null
          service_type_label?: string | null
          splits?: Json
          status?: Database["public"]["Enums"]["booking_status"]
          total_cents?: number
          unassigned_alert_sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_billing_invoice_id_fkey"
            columns: ["billing_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "booking_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attachments: Json
          body: string
          created_at: string
          id: string
          organization_id: string
          sender_id: string | null
          thread_id: string
        }
        Insert: {
          attachments?: Json
          body: string
          created_at?: string
          id?: string
          organization_id: string
          sender_id?: string | null
          thread_id: string
        }
        Update: {
          attachments?: Json
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          sender_id?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_thread_members: {
        Row: {
          id: string
          joined_at: string
          last_read_at: string | null
          membership_id: string
          organization_id: string
          thread_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          last_read_at?: string | null
          membership_id: string
          organization_id: string
          thread_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          last_read_at?: string | null
          membership_id?: string
          organization_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_thread_members_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_thread_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_thread_members_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["chat_thread_kind"]
          name: string | null
          organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["chat_thread_kind"]
          name?: string | null
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["chat_thread_kind"]
          name?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_template_items: {
        Row: {
          created_at: string
          id: string
          is_required: boolean
          ordinal: number
          organization_id: string
          phase: string
          template_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_required?: boolean
          ordinal?: number
          organization_id: string
          phase?: string
          template_id: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          is_required?: boolean
          ordinal?: number
          organization_id?: string
          phase?: string
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_template_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          applies_to_service_type: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          applies_to_service_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          applies_to_service_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          archived_at: string | null
          balance_cents: number
          billing_cadence: string
          billing_type: string
          created_at: string
          email: string | null
          flat_rate_cents: number | null
          gbp_clicked_at: string | null
          gbp_first_asked_at: string | null
          gbp_last_asked_at: string | null
          gbp_marked_reviewed_at_creation: boolean
          gbp_next_reminder_at: string | null
          gbp_redirect_token: string | null
          gbp_reminders_sent: number
          gbp_review_state: string
          gbp_unsubscribe_token: string | null
          gbp_unsubscribed_at: string | null
          id: string
          last_rebook_prompt_at: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          portal_accepted_at: string | null
          portal_invite_expires_at: string | null
          portal_invite_token: string | null
          portal_invited_at: string | null
          preferred_cleaner_id: string | null
          preferred_contact: Database["public"]["Enums"]["preferred_contact"]
          profile_id: string | null
          quickbooks_customer_id: string | null
          referred_by_client_id: string | null
          sage_contact_id: string | null
          sms_opted_in: boolean
          updated_at: string
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          balance_cents?: number
          billing_cadence?: string
          billing_type?: string
          created_at?: string
          email?: string | null
          flat_rate_cents?: number | null
          gbp_clicked_at?: string | null
          gbp_first_asked_at?: string | null
          gbp_last_asked_at?: string | null
          gbp_marked_reviewed_at_creation?: boolean
          gbp_next_reminder_at?: string | null
          gbp_redirect_token?: string | null
          gbp_reminders_sent?: number
          gbp_review_state?: string
          gbp_unsubscribe_token?: string | null
          gbp_unsubscribed_at?: string | null
          id?: string
          last_rebook_prompt_at?: string | null
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          portal_accepted_at?: string | null
          portal_invite_expires_at?: string | null
          portal_invite_token?: string | null
          portal_invited_at?: string | null
          preferred_cleaner_id?: string | null
          preferred_contact?: Database["public"]["Enums"]["preferred_contact"]
          profile_id?: string | null
          quickbooks_customer_id?: string | null
          referred_by_client_id?: string | null
          sage_contact_id?: string | null
          sms_opted_in?: boolean
          updated_at?: string
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          balance_cents?: number
          billing_cadence?: string
          billing_type?: string
          created_at?: string
          email?: string | null
          flat_rate_cents?: number | null
          gbp_clicked_at?: string | null
          gbp_first_asked_at?: string | null
          gbp_last_asked_at?: string | null
          gbp_marked_reviewed_at_creation?: boolean
          gbp_next_reminder_at?: string | null
          gbp_redirect_token?: string | null
          gbp_reminders_sent?: number
          gbp_review_state?: string
          gbp_unsubscribe_token?: string | null
          gbp_unsubscribed_at?: string | null
          id?: string
          last_rebook_prompt_at?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          portal_accepted_at?: string | null
          portal_invite_expires_at?: string | null
          portal_invite_token?: string | null
          portal_invited_at?: string | null
          preferred_cleaner_id?: string | null
          preferred_contact?: Database["public"]["Enums"]["preferred_contact"]
          profile_id?: string | null
          quickbooks_customer_id?: string | null
          referred_by_client_id?: string | null
          sage_contact_id?: string | null
          sms_opted_in?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_preferred_cleaner_id_fkey"
            columns: ["preferred_cleaner_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_referred_by_client_id_fkey"
            columns: ["referred_by_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_documents: {
        Row: {
          contract_id: string
          created_at: string
          file_size: number | null
          id: string
          mime_type: string | null
          name: string
          organization_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          contract_id: string
          created_at?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          name: string
          organization_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          contract_id?: string
          created_at?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          name?: string
          organization_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          agreed_price_cents: number
          client_id: string
          created_at: string
          end_date: string | null
          estimate_id: string | null
          id: string
          organization_id: string
          payment_terms: string | null
          pdf_url: string | null
          public_token: string | null
          sent_at: string | null
          service_type: Database["public"]["Enums"]["service_type"]
          service_type_id: string | null
          service_type_label: string | null
          sign_status: string
          signed_at: string | null
          signer_ip: unknown
          signer_name: string | null
          signer_signature_data_url: string | null
          signer_user_agent: string | null
          start_date: string
          status: Database["public"]["Enums"]["contract_status"]
          updated_at: string
        }
        Insert: {
          agreed_price_cents: number
          client_id: string
          created_at?: string
          end_date?: string | null
          estimate_id?: string | null
          id?: string
          organization_id: string
          payment_terms?: string | null
          pdf_url?: string | null
          public_token?: string | null
          sent_at?: string | null
          service_type: Database["public"]["Enums"]["service_type"]
          service_type_id?: string | null
          service_type_label?: string | null
          sign_status?: string
          signed_at?: string | null
          signer_ip?: unknown
          signer_name?: string | null
          signer_signature_data_url?: string | null
          signer_user_agent?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
        }
        Update: {
          agreed_price_cents?: number
          client_id?: string
          created_at?: string
          end_date?: string | null
          estimate_id?: string | null
          id?: string
          organization_id?: string
          payment_terms?: string | null
          pdf_url?: string | null
          public_token?: string | null
          sent_at?: string | null
          service_type?: Database["public"]["Enums"]["service_type"]
          service_type_id?: string | null
          service_type_label?: string | null
          sign_status?: string
          signed_at?: string | null
          signer_ip?: unknown
          signer_name?: string | null
          signer_signature_data_url?: string | null
          signer_user_agent?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["contract_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          event_payload: Json | null
          id: string
          provider_event_id: string | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          event_payload?: Json | null
          id?: string
          provider_event_id?: string | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          event_payload?: Json | null
          id?: string
          provider_event_id?: string | null
          reason?: string
        }
        Relationships: []
      }
      estimate_line_items: {
        Row: {
          created_at: string
          estimate_id: string
          id: string
          kind: Database["public"]["Enums"]["estimate_line_kind"]
          label: string
          organization_id: string
          quantity: number
          sort_order: number
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          estimate_id: string
          id?: string
          kind?: Database["public"]["Enums"]["estimate_line_kind"]
          label: string
          organization_id: string
          quantity?: number
          sort_order?: number
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          estimate_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["estimate_line_kind"]
          label?: string
          organization_id?: string
          quantity?: number
          sort_order?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_line_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          archived_at: string | null
          client_email_sent_at: string | null
          client_followup_14d_sent_at: string | null
          client_followup_7d_sent_at: string | null
          client_id: string
          created_at: string
          decided_at: string | null
          expires_at: string | null
          id: string
          notes: string | null
          organization_id: string
          pdf_url: string | null
          public_token: string | null
          sent_at: string | null
          service_description: string | null
          status: Database["public"]["Enums"]["estimate_status"]
          total_cents: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          client_email_sent_at?: string | null
          client_followup_14d_sent_at?: string | null
          client_followup_7d_sent_at?: string | null
          client_id: string
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          pdf_url?: string | null
          public_token?: string | null
          sent_at?: string | null
          service_description?: string | null
          status?: Database["public"]["Enums"]["estimate_status"]
          total_cents?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          client_email_sent_at?: string | null
          client_followup_14d_sent_at?: string | null
          client_followup_7d_sent_at?: string | null
          client_id?: string
          created_at?: string
          decided_at?: string | null
          expires_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          pdf_url?: string | null
          public_token?: string | null
          sent_at?: string | null
          service_description?: string | null
          status?: Database["public"]["Enums"]["estimate_status"]
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_posts: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          image_url: string | null
          organization_id: string
          pinned: boolean
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          image_url?: string | null
          organization_id: string
          pinned?: boolean
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          image_url?: string | null
          organization_id?: string
          pinned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "feed_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_posts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      freelancer_contacts: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          full_name: string
          id: string
          last_accepted_at: string | null
          last_offered_at: string | null
          notes: string | null
          organization_id: string
          phone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          last_accepted_at?: string | null
          last_offered_at?: string | null
          notes?: string | null
          organization_id: string
          phone: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          last_accepted_at?: string | null
          last_offered_at?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "freelancer_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_forms: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
          token: string
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id: string
          token: string
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          token?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          access_token_ciphertext: string | null
          connected_at: string
          connected_by: string | null
          external_account_id: string | null
          external_account_label: string | null
          id: string
          last_error: string | null
          membership_id: string | null
          metadata: Json
          organization_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          refresh_token_ciphertext: string | null
          scope: string | null
          status: Database["public"]["Enums"]["integration_status"]
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_ciphertext?: string | null
          connected_at?: string
          connected_by?: string | null
          external_account_id?: string | null
          external_account_label?: string | null
          id?: string
          last_error?: string | null
          membership_id?: string | null
          metadata?: Json
          organization_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          refresh_token_ciphertext?: string | null
          scope?: string | null
          status?: Database["public"]["Enums"]["integration_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_ciphertext?: string | null
          connected_at?: string
          connected_by?: string | null
          external_account_id?: string | null
          external_account_label?: string | null
          id?: string
          last_error?: string | null
          membership_id?: string | null
          metadata?: Json
          organization_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          refresh_token_ciphertext?: string | null
          scope?: string | null
          status?: Database["public"]["Enums"]["integration_status"]
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_events: {
        Row: {
          error: string | null
          event_id: string
          event_type: string
          id: string
          organization_id: string | null
          payload: Json
          processed_at: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          received_at: string
        }
        Insert: {
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          organization_id?: string | null
          payload: Json
          processed_at?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          received_at?: string
        }
        Update: {
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          assigned_to: string | null
          category: Database["public"]["Enums"]["inventory_category"]
          created_at: string
          id: string
          name: string
          notes: string | null
          organization_id: string
          quantity: number
          reorder_threshold: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          quantity?: number
          reorder_threshold?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: Database["public"]["Enums"]["inventory_category"]
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          quantity?: number
          reorder_threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_log: {
        Row: {
          actor_id: string | null
          created_at: string
          delta: number
          id: string
          item_id: string
          organization_id: string
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          delta: number
          id?: string
          item_id: string
          organization_id: string
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          delta?: number
          id?: string
          item_id?: string
          organization_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_log_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          label: string
          organization_id: string
          quantity: number
          sort_order: number
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          label: string
          organization_id: string
          quantity?: number
          sort_order?: number
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          label?: string
          organization_id?: string
          quantity?: number
          sort_order?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          organization_id: string
          provider: Database["public"]["Enums"]["integration_provider"] | null
          provider_fee_cents: number | null
          provider_payment_id: string | null
          received_at: string
          recorded_by: string | null
          reference: string | null
          refunded_cents: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          organization_id: string
          provider?: Database["public"]["Enums"]["integration_provider"] | null
          provider_fee_cents?: number | null
          provider_payment_id?: string | null
          received_at?: string
          recorded_by?: string | null
          reference?: string | null
          refunded_cents?: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          organization_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"] | null
          provider_fee_cents?: number | null
          provider_payment_id?: string | null
          received_at?: string
          recorded_by?: string | null
          reference?: string | null
          refunded_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_series: {
        Row: {
          active: boolean
          amount_cents: number
          cadence: string
          client_id: string
          created_at: string
          created_by: string | null
          due_days: number
          id: string
          last_generated_at: string | null
          last_invoice_id: string | null
          line_items: Json
          name: string
          next_run_at: string
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount_cents: number
          cadence: string
          client_id: string
          created_at?: string
          created_by?: string | null
          due_days?: number
          id?: string
          last_generated_at?: string | null
          last_invoice_id?: string | null
          line_items?: Json
          name: string
          next_run_at: string
          notes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount_cents?: number
          cadence?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          due_days?: number
          id?: string
          last_generated_at?: string | null
          last_invoice_id?: string | null
          line_items?: Json
          name?: string
          next_run_at?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_series_last_invoice_id_fkey"
            columns: ["last_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_series_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_cents: number
          archived_at: string | null
          billing_period_key: string | null
          booking_id: string | null
          client_id: string
          created_at: string
          due_date: string | null
          id: string
          number: string | null
          organization_id: string
          overdue_reminder_sent_at: string | null
          paid_at: string | null
          payment_instructions: string | null
          public_token: string | null
          public_token_expires_at: string | null
          quickbooks_invoice_id: string | null
          review_token: string | null
          sage_invoice_id: string | null
          sent_at: string | null
          square_order_id: string | null
          square_payment_link_id: string | null
          square_payment_link_url: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          stripe_checkout_session_id: string | null
          stripe_fee_cents: number | null
          stripe_paid_at: string | null
          stripe_payment_intent_id: string | null
          stripe_payment_url: string | null
          tax_amount_cents: number | null
          tax_label: string | null
          tax_rate_bps: number | null
          updated_at: string
          voided_at: string | null
        }
        Insert: {
          amount_cents?: number
          archived_at?: string | null
          billing_period_key?: string | null
          booking_id?: string | null
          client_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          number?: string | null
          organization_id: string
          overdue_reminder_sent_at?: string | null
          paid_at?: string | null
          payment_instructions?: string | null
          public_token?: string | null
          public_token_expires_at?: string | null
          quickbooks_invoice_id?: string | null
          review_token?: string | null
          sage_invoice_id?: string | null
          sent_at?: string | null
          square_order_id?: string | null
          square_payment_link_id?: string | null
          square_payment_link_url?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_checkout_session_id?: string | null
          stripe_fee_cents?: number | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payment_url?: string | null
          tax_amount_cents?: number | null
          tax_label?: string | null
          tax_rate_bps?: number | null
          updated_at?: string
          voided_at?: string | null
        }
        Update: {
          amount_cents?: number
          archived_at?: string | null
          billing_period_key?: string | null
          booking_id?: string | null
          client_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          number?: string | null
          organization_id?: string
          overdue_reminder_sent_at?: string | null
          paid_at?: string | null
          payment_instructions?: string | null
          public_token?: string | null
          public_token_expires_at?: string | null
          quickbooks_invoice_id?: string | null
          review_token?: string | null
          sage_invoice_id?: string | null
          sent_at?: string | null
          square_order_id?: string | null
          square_payment_link_id?: string | null
          square_payment_link_url?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_checkout_session_id?: string | null
          stripe_fee_cents?: number | null
          stripe_paid_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_payment_url?: string | null
          tax_amount_cents?: number | null
          tax_label?: string | null
          tax_rate_bps?: number | null
          updated_at?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_applicants: {
        Row: {
          availability: string | null
          created_at: string
          email: string | null
          experience: string | null
          id: string
          intake_form_id: string | null
          message: string | null
          name: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          position: string | null
          raw: Json
          resume_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          availability?: string | null
          created_at?: string
          email?: string | null
          experience?: string | null
          id?: string
          intake_form_id?: string | null
          message?: string | null
          name?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          position?: string | null
          raw?: Json
          resume_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          availability?: string | null
          created_at?: string
          email?: string | null
          experience?: string | null
          id?: string
          intake_form_id?: string | null
          message?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          position?: string | null
          raw?: Json
          resume_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_applicants_intake_form_id_fkey"
            columns: ["intake_form_id"]
            isOneToOne: false
            referencedRelation: "intake_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applicants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applicants_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      job_offer_claims: {
        Row: {
          claimed_at: string
          contact_id: string
          dispatch_id: string
          id: string
          offer_id: string
          organization_id: string
        }
        Insert: {
          claimed_at?: string
          contact_id: string
          dispatch_id: string
          id?: string
          offer_id: string
          organization_id: string
        }
        Update: {
          claimed_at?: string
          contact_id?: string
          dispatch_id?: string
          id?: string
          offer_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_offer_claims_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "freelancer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_offer_claims_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "job_offer_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_offer_claims_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_offer_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_offer_dispatches: {
        Row: {
          claim_token: string
          contact_id: string
          delivery_error: string | null
          delivery_status: string
          id: string
          offer_id: string
          organization_id: string
          responded_at: string | null
          sent_at: string
          twilio_sid: string | null
        }
        Insert: {
          claim_token: string
          contact_id: string
          delivery_error?: string | null
          delivery_status?: string
          id?: string
          offer_id: string
          organization_id: string
          responded_at?: string | null
          sent_at?: string
          twilio_sid?: string | null
        }
        Update: {
          claim_token?: string
          contact_id?: string
          delivery_error?: string | null
          delivery_status?: string
          id?: string
          offer_id?: string
          organization_id?: string
          responded_at?: string | null
          sent_at?: string
          twilio_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_offer_dispatches_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "freelancer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_offer_dispatches_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_offer_dispatches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_offers: {
        Row: {
          booking_id: string
          created_at: string
          expires_at: string | null
          filled_at: string | null
          filled_contact_id: string | null
          id: string
          notes: string | null
          organization_id: string
          pay_cents: number
          positions_filled: number
          positions_needed: number
          posted_by: string
          status: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          expires_at?: string | null
          filled_at?: string | null
          filled_contact_id?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          pay_cents: number
          positions_filled?: number
          positions_needed?: number
          posted_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          expires_at?: string | null
          filled_at?: string | null
          filled_contact_id?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          pay_cents?: number
          positions_filled?: number
          positions_needed?: number
          posted_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_offers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_offers_filled_contact_id_fkey"
            columns: ["filled_contact_id"]
            isOneToOne: false
            referencedRelation: "freelancer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_offers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_offers_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      job_photos: {
        Row: {
          booking_id: string
          caption: string | null
          created_at: string
          file_size: number | null
          id: string
          kind: string
          mime_type: string | null
          organization_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          booking_id: string
          caption?: string | null
          created_at?: string
          file_size?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          organization_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          booking_id?: string
          caption?: string | null
          created_at?: string
          file_size?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          organization_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_photos_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_photos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_admin_notes: {
        Row: {
          membership_id: string
          notes: string | null
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          membership_id: string
          notes?: string | null
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          membership_id?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_admin_notes_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: true
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          address: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          display_name: string | null
          gps_consent_accepted_at: string | null
          id: string
          organization_id: string
          pay_rate_cents: number | null
          pay_type: string
          profile_id: string | null
          role: Database["public"]["Enums"]["membership_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          display_name?: string | null
          gps_consent_accepted_at?: string | null
          id?: string
          organization_id: string
          pay_rate_cents?: number | null
          pay_type?: string
          profile_id?: string | null
          role: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          display_name?: string | null
          gps_consent_accepted_at?: string | null
          id?: string
          organization_id?: string
          pay_rate_cents?: number | null
          pay_type?: string
          profile_id?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          href: string | null
          id: string
          organization_id: string
          read_at: string | null
          recipient_membership_id: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          organization_id: string
          read_at?: string | null
          recipient_membership_id?: string | null
          title: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          body?: string | null
          created_at?: string
          href?: string | null
          id?: string
          organization_id?: string
          read_at?: string | null
          recipient_membership_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_membership_id_fkey"
            columns: ["recipient_membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          archive_after_days: number | null
          automation_settings: Json
          billing_override: string | null
          billing_override_at: string | null
          billing_override_note: string | null
          booking_auto_complete_hours: number | null
          brand_color: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          currency_code: string
          default_payment_instructions: string | null
          default_tax_label: string | null
          default_tax_rate_bps: number | null
          deleted_at: string | null
          deletion_scheduled_at: string | null
          gbp_review_max_reminders: number
          gbp_review_reminder_days: number
          google_review_url: string | null
          id: string
          internal_review_delay_minutes: number
          invoice_void_days: number | null
          logo_url: string | null
          name: string
          onboarding_completed_at: string | null
          overtime_threshold_hours: number
          sender_email: string | null
          sender_email_token: string | null
          sender_email_verified_at: string | null
          slug: string
          stale_estimate_expire_days: number | null
          stripe_account_id: string | null
          stripe_account_type: string | null
          stripe_application_fee_bps: number
          stripe_charges_enabled: boolean
          stripe_connected_at: string | null
          stripe_details_submitted: boolean
          stripe_disconnected_at: string | null
          stripe_payouts_enabled: boolean
          timezone: string
          trial_reminder_key: string | null
          trial_started_at: string | null
          updated_at: string
        }
        Insert: {
          archive_after_days?: number | null
          automation_settings?: Json
          billing_override?: string | null
          billing_override_at?: string | null
          billing_override_note?: string | null
          booking_auto_complete_hours?: number | null
          brand_color?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency_code?: string
          default_payment_instructions?: string | null
          default_tax_label?: string | null
          default_tax_rate_bps?: number | null
          deleted_at?: string | null
          deletion_scheduled_at?: string | null
          gbp_review_max_reminders?: number
          gbp_review_reminder_days?: number
          google_review_url?: string | null
          id?: string
          internal_review_delay_minutes?: number
          invoice_void_days?: number | null
          logo_url?: string | null
          name: string
          onboarding_completed_at?: string | null
          overtime_threshold_hours?: number
          sender_email?: string | null
          sender_email_token?: string | null
          sender_email_verified_at?: string | null
          slug: string
          stale_estimate_expire_days?: number | null
          stripe_account_id?: string | null
          stripe_account_type?: string | null
          stripe_application_fee_bps?: number
          stripe_charges_enabled?: boolean
          stripe_connected_at?: string | null
          stripe_details_submitted?: boolean
          stripe_disconnected_at?: string | null
          stripe_payouts_enabled?: boolean
          timezone?: string
          trial_reminder_key?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Update: {
          archive_after_days?: number | null
          automation_settings?: Json
          billing_override?: string | null
          billing_override_at?: string | null
          billing_override_note?: string | null
          booking_auto_complete_hours?: number | null
          brand_color?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          currency_code?: string
          default_payment_instructions?: string | null
          default_tax_label?: string | null
          default_tax_rate_bps?: number | null
          deleted_at?: string | null
          deletion_scheduled_at?: string | null
          gbp_review_max_reminders?: number
          gbp_review_reminder_days?: number
          google_review_url?: string | null
          id?: string
          internal_review_delay_minutes?: number
          invoice_void_days?: number | null
          logo_url?: string | null
          name?: string
          onboarding_completed_at?: string | null
          overtime_threshold_hours?: number
          sender_email?: string | null
          sender_email_token?: string | null
          sender_email_verified_at?: string | null
          slug?: string
          stale_estimate_expire_days?: number | null
          stripe_account_id?: string | null
          stripe_account_type?: string | null
          stripe_application_fee_bps?: number
          stripe_charges_enabled?: boolean
          stripe_connected_at?: string | null
          stripe_details_submitted?: boolean
          stripe_disconnected_at?: string | null
          stripe_payouts_enabled?: boolean
          timezone?: string
          trial_reminder_key?: string | null
          trial_started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      packages: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          included: Json
          is_active: boolean
          name: string
          organization_id: string
          price_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          included?: Json
          is_active?: boolean
          name: string
          organization_id: string
          price_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          included?: Json
          is_active?: boolean
          name?: string
          organization_id?: string
          price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_items: {
        Row: {
          bonus_cents: number
          created_at: string
          employee_id: string
          employee_name: string
          hours_worked: number
          id: string
          organization_id: string
          payroll_run_id: string
          pto_hours: number
          pto_pay_cents: number
          regular_pay_cents: number
          total_cents: number
        }
        Insert: {
          bonus_cents?: number
          created_at?: string
          employee_id: string
          employee_name: string
          hours_worked?: number
          id?: string
          organization_id: string
          payroll_run_id: string
          pto_hours?: number
          pto_pay_cents?: number
          regular_pay_cents?: number
          total_cents?: number
        }
        Update: {
          bonus_cents?: number
          created_at?: string
          employee_id?: string
          employee_name?: string
          hours_worked?: number
          id?: string
          organization_id?: string
          payroll_run_id?: string
          pto_hours?: number
          pto_pay_cents?: number
          regular_pay_cents?: number
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_items_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          created_at: string
          created_by: string | null
          finalized_at: string | null
          id: string
          notes: string | null
          organization_id: string
          paid_at: string | null
          period_end: string
          period_start: string
          status: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          paid_at?: string | null
          period_end: string
          period_start: string
          status?: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string
          status?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          kind: string
          max_redemptions: number
          notes: string | null
          redemption_count: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          kind: string
          max_redemptions?: number
          notes?: string | null
          redemption_count?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          max_redemptions?: number
          notes?: string | null
          redemption_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_redemptions: {
        Row: {
          id: string
          organization_id: string
          promo_code_id: string
          redeemed_at: string
          redeemed_by: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          promo_code_id: string
          redeemed_at?: string
          redeemed_by?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          promo_code_id?: string
          redeemed_at?: string
          redeemed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      pto_balances: {
        Row: {
          allocated_hours: number
          created_at: string
          employee_id: string
          id: string
          organization_id: string
          updated_at: string
          used_hours: number
          year: number
        }
        Insert: {
          allocated_hours?: number
          created_at?: string
          employee_id: string
          id?: string
          organization_id: string
          updated_at?: string
          used_hours?: number
          year?: number
        }
        Update: {
          allocated_hours?: number
          created_at?: string
          employee_id?: string
          id?: string
          organization_id?: string
          updated_at?: string
          used_hours?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "pto_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pto_requests: {
        Row: {
          created_at: string
          employee_id: string
          end_date: string
          hours: number
          id: string
          organization_id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          end_date: string
          hours?: number
          id?: string
          organization_id: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          end_date?: string
          hours?: number
          id?: string
          organization_id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pto_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys_auth: string
          keys_p256dh: string
          membership_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys_auth: string
          keys_p256dh: string
          membership_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys_auth?: string
          keys_p256dh?: string
          membership_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          booking_id: string | null
          client_id: string | null
          comment: string | null
          created_at: string
          employee_id: string | null
          id: string
          organization_id: string
          rating: number
          submitted_at: string
        }
        Insert: {
          booking_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          organization_id: string
          rating: number
          submitted_at?: string
        }
        Update: {
          booking_id?: string | null
          client_id?: string | null
          comment?: string | null
          created_at?: string
          employee_id?: string | null
          id?: string
          organization_id?: string
          rating?: number
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduler_views: {
        Row: {
          created_at: string
          created_by: string | null
          filters: Json
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduler_views_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduler_views_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_types: {
        Row: {
          archived_at: string | null
          category: Database["public"]["Enums"]["service_type"]
          color: string | null
          created_at: string
          created_by: string | null
          default_duration_minutes: number | null
          default_price_cents: number | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category?: Database["public"]["Enums"]["service_type"]
          color?: string | null
          created_at?: string
          created_by?: string | null
          default_duration_minutes?: number | null
          default_price_cents?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category?: Database["public"]["Enums"]["service_type"]
          color?: string | null
          created_at?: string
          created_by?: string | null
          default_duration_minutes?: number | null
          default_price_cents?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_change_requests: {
        Row: {
          booking_id: string | null
          created_at: string
          id: string
          kind: string
          membership_id: string
          organization_id: string
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          series_id: string | null
          status: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          membership_id: string
          organization_id: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          series_id?: string | null
          status?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          membership_id?: string
          organization_id?: string
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          series_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_change_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_change_requests_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_change_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_change_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_change_requests_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "booking_series"
            referencedColumns: ["id"]
          },
        ]
      }
      square_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          membership_id: string
          organization_id: string
          state: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          membership_id: string
          organization_id: string
          state: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          membership_id?: string
          organization_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "square_oauth_states_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "square_oauth_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          account_id: string | null
          id: string
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          account_id?: string | null
          id: string
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          account_id?: string | null
          id?: string
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      stripe_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          membership_id: string
          organization_id: string
          state: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          membership_id: string
          organization_id: string
          state: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          membership_id?: string
          organization_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_oauth_states_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_oauth_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_email: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          last_event_id: string | null
          organization_id: string
          plan_tier: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_email?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_event_id?: string | null
          organization_id: string
          plan_tier?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_email?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          last_event_id?: string | null
          organization_id?: string
          plan_tier?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          notes: string | null
          organization_id: string
          recurrence: Database["public"]["Enums"]["task_recurrence"] | null
          remind_at: string | null
          reminded_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          recurrence?: Database["public"]["Enums"]["task_recurrence"] | null
          remind_at?: string | null
          reminded_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          recurrence?: Database["public"]["Enums"]["task_recurrence"] | null
          remind_at?: string | null
          reminded_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          booking_id: string | null
          clock_in_at: string
          clock_in_lat: number | null
          clock_in_lng: number | null
          clock_out_at: string | null
          clock_out_lat: number | null
          clock_out_lng: number | null
          created_at: string
          created_by: string | null
          created_manually: boolean
          employee_id: string
          id: string
          notes: string | null
          organization_id: string
          pay_rate_cents_snapshot: number | null
          payroll_run_id: string | null
        }
        Insert: {
          booking_id?: string | null
          clock_in_at?: string
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_out_at?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          created_at?: string
          created_by?: string | null
          created_manually?: boolean
          employee_id: string
          id?: string
          notes?: string | null
          organization_id: string
          pay_rate_cents_snapshot?: number | null
          payroll_run_id?: string | null
        }
        Update: {
          booking_id?: string | null
          clock_in_at?: string
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_out_at?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          created_at?: string
          created_by?: string | null
          created_manually?: boolean
          employee_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          pay_rate_cents_snapshot?: number | null
          payroll_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      training_assignments: {
        Row: {
          certification_expires_at: string | null
          completed_at: string | null
          completed_step_ids: string[]
          created_at: string
          employee_id: string
          expiry_reminder_30d_sent_at: string | null
          expiry_reminder_7d_sent_at: string | null
          id: string
          module_id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          certification_expires_at?: string | null
          completed_at?: string | null
          completed_step_ids?: string[]
          created_at?: string
          employee_id: string
          expiry_reminder_30d_sent_at?: string | null
          expiry_reminder_7d_sent_at?: string | null
          id?: string
          module_id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          certification_expires_at?: string | null
          completed_at?: string | null
          completed_step_ids?: string[]
          created_at?: string
          employee_id?: string
          expiry_reminder_30d_sent_at?: string | null
          expiry_reminder_7d_sent_at?: string | null
          id?: string
          module_id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_assignments_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      training_modules: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          expires_after_days: number | null
          id: string
          organization_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_after_days?: number | null
          id?: string
          organization_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expires_after_days?: number | null
          id?: string
          organization_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_modules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      training_steps: {
        Row: {
          body: string
          created_at: string
          id: string
          image_url: string | null
          module_id: string
          ord: number
          organization_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          image_url?: string | null
          module_id: string
          ord?: number
          organization_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          image_url?: string | null
          module_id?: string
          ord?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_steps_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          created_at: string
          duration_ms: number | null
          error_message: string | null
          event_id: string
          event_type: string
          id: string
          organization_id: string
          payload_size: number | null
          status_code: number | null
          subscription_id: string
          success: boolean
          target_url: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_id: string
          event_type: string
          id?: string
          organization_id: string
          payload_size?: number | null
          status_code?: number | null
          subscription_id: string
          success?: boolean
          target_url: string
        }
        Update: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_id?: string
          event_type?: string
          id?: string
          organization_id?: string
          payload_size?: number | null
          status_code?: number | null
          subscription_id?: string
          success?: boolean
          target_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "webhook_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_subscriptions: {
        Row: {
          active: boolean
          created_at: string
          event_type: string
          id: string
          organization_id: string
          secret: string
          target_url: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          event_type: string
          id?: string
          organization_id: string
          secret: string
          target_url: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          event_type?: string
          id?: string
          organization_id?: string
          secret?: string
          target_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          created_by: string | null
          events: string[]
          id: string
          is_active: boolean
          last_status_code: number | null
          last_triggered_at: string | null
          name: string
          organization_id: string
          secret: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          last_status_code?: number | null
          last_triggered_at?: string | null
          name: string
          organization_id: string
          secret?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          events?: string[]
          id?: string
          is_active?: boolean
          last_status_code?: number | null
          last_triggered_at?: string | null
          name?: string
          organization_id?: string
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      chat_mark_thread_read: {
        Args: { p_thread_id: string }
        Returns: undefined
      }
      chat_unread_threads: {
        Args: { p_org_id?: string }
        Returns: {
          last_message_at: string
          thread_id: string
          unread: number
        }[]
      }
      chat_unread_total: { Args: { p_org_id?: string }; Returns: number }
      cleanup_expired_stripe_oauth_states: { Args: never; Returns: number }
      current_user_has_role: {
        Args: {
          allowed: Database["public"]["Enums"]["membership_role"][]
          target_org: string
        }
        Returns: boolean
      }
      current_user_org_ids: { Args: never; Returns: string[] }
      current_user_thread_ids: { Args: never; Returns: string[] }
      ensure_general_thread: { Args: { target_org: string }; Returns: string }
    }
    Enums: {
      bonus_status: "pending" | "paid"
      booking_status:
        | "pending"
        | "confirmed"
        | "en_route"
        | "in_progress"
        | "completed"
        | "cancelled"
      chat_thread_kind: "dm" | "group"
      contract_status: "active" | "ended" | "cancelled"
      estimate_line_kind: "labour" | "supplies" | "extras"
      estimate_status: "draft" | "sent" | "approved" | "declined" | "expired"
      integration_provider:
        | "stripe"
        | "square"
        | "quickbooks"
        | "google_calendar"
        | "sage"
      integration_status: "active" | "disconnected" | "error"
      inventory_category: "chemical" | "equipment" | "consumable"
      invoice_status:
        | "draft"
        | "sent"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "void"
        | "refunded"
      membership_role: "owner" | "admin" | "manager" | "employee"
      membership_status: "active" | "invited" | "disabled"
      notification_type:
        | "review_request"
        | "low_inventory"
        | "unfilled_shift"
        | "general"
      payment_method:
        | "cash"
        | "check"
        | "bank_transfer"
        | "zelle"
        | "venmo"
        | "cashapp"
        | "card"
        | "ach"
        | "other"
      preferred_contact: "phone" | "email" | "sms"
      service_type:
        | "standard"
        | "deep"
        | "move_out"
        | "recurring"
        | "meeting"
        | "consultation"
        | "walkthrough"
        | "other"
      task_recurrence: "daily" | "weekly" | "biweekly" | "monthly" | "yearly"
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
  public: {
    Enums: {
      bonus_status: ["pending", "paid"],
      booking_status: [
        "pending",
        "confirmed",
        "en_route",
        "in_progress",
        "completed",
        "cancelled",
      ],
      chat_thread_kind: ["dm", "group"],
      contract_status: ["active", "ended", "cancelled"],
      estimate_line_kind: ["labour", "supplies", "extras"],
      estimate_status: ["draft", "sent", "approved", "declined", "expired"],
      integration_provider: [
        "stripe",
        "square",
        "quickbooks",
        "google_calendar",
        "sage",
      ],
      integration_status: ["active", "disconnected", "error"],
      inventory_category: ["chemical", "equipment", "consumable"],
      invoice_status: [
        "draft",
        "sent",
        "partially_paid",
        "paid",
        "overdue",
        "void",
        "refunded",
      ],
      membership_role: ["owner", "admin", "manager", "employee"],
      membership_status: ["active", "invited", "disabled"],
      notification_type: [
        "review_request",
        "low_inventory",
        "unfilled_shift",
        "general",
      ],
      payment_method: [
        "cash",
        "check",
        "bank_transfer",
        "zelle",
        "venmo",
        "cashapp",
        "card",
        "ach",
        "other",
      ],
      preferred_contact: ["phone", "email", "sms"],
      service_type: [
        "standard",
        "deep",
        "move_out",
        "recurring",
        "meeting",
        "consultation",
        "walkthrough",
        "other",
      ],
      task_recurrence: ["daily", "weekly", "biweekly", "monthly", "yearly"],
    },
  },
} as const
