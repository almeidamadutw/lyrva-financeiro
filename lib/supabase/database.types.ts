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
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          id: number
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
          record_id: string | null
          table_name: string
          unit_id: number | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          unit_id?: number | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          unit_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "audit_logs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_cases: {
        Row: {
          closed_at: string | null
          created_at: string
          eligible_at: string
          id: number
          installment_id: number
          next_action_at: string | null
          notes: string | null
          opened_at: string
          outcome: string | null
          patient_unit_id: number
          protested_at: string | null
          responsible_user_id: string | null
          status: string
          unit_id: number
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          eligible_at: string
          id?: never
          installment_id: number
          next_action_at?: string | null
          notes?: string | null
          opened_at?: string
          outcome?: string | null
          patient_unit_id: number
          protested_at?: string | null
          responsible_user_id?: string | null
          status?: string
          unit_id: number
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          eligible_at?: string
          id?: never
          installment_id?: number
          next_action_at?: string | null
          notes?: string | null
          opened_at?: string
          outcome?: string | null
          patient_unit_id?: number
          protested_at?: string | null
          responsible_user_id?: string | null
          status?: string
          unit_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_cases_installment_fk"
            columns: ["installment_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "collection_cases_patient_unit_fk"
            columns: ["patient_unit_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "patient_units"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "collection_cases_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "collection_cases_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_interactions: {
        Row: {
          channel: string
          collection_case_id: number
          created_at: string
          id: number
          next_action_at: string | null
          notes: string
          occurred_at: string
          outcome: string
          performed_by: string | null
          unit_id: number
          voice_transcript: string | null
        }
        Insert: {
          channel: string
          collection_case_id: number
          created_at?: string
          id?: never
          next_action_at?: string | null
          notes: string
          occurred_at?: string
          outcome: string
          performed_by?: string | null
          unit_id: number
          voice_transcript?: string | null
        }
        Update: {
          channel?: string
          collection_case_id?: number
          created_at?: string
          id?: never
          next_action_at?: string | null
          notes?: string
          occurred_at?: string
          outcome?: string
          performed_by?: string | null
          unit_id?: number
          voice_transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_interactions_case_fk"
            columns: ["collection_case_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "collection_cases"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "collection_interactions_case_fk"
            columns: ["collection_case_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "collection_queue"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "collection_interactions_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "collection_interactions_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_promises: {
        Row: {
          collection_case_id: number
          created_at: string
          created_by: string | null
          id: number
          notes: string | null
          promised_amount: number | null
          promised_for: string
          resolved_at: string | null
          status: string
          unit_id: number
          updated_at: string
        }
        Insert: {
          collection_case_id: number
          created_at?: string
          created_by?: string | null
          id?: never
          notes?: string | null
          promised_amount?: number | null
          promised_for: string
          resolved_at?: string | null
          status?: string
          unit_id: number
          updated_at?: string
        }
        Update: {
          collection_case_id?: number
          created_at?: string
          created_by?: string | null
          id?: never
          notes?: string | null
          promised_amount?: number | null
          promised_for?: string
          resolved_at?: string | null
          status?: string
          unit_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_promises_case_fk"
            columns: ["collection_case_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "collection_cases"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "collection_promises_case_fk"
            columns: ["collection_case_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "collection_queue"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "collection_promises_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "collection_promises_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_tasks: {
        Row: {
          assigned_to: string | null
          collection_case_id: number | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          dismissed_at: string | null
          due_at: string
          id: number
          installment_id: number | null
          kind: string
          patient_id: number | null
          seen_at: string | null
          status: string
          title: string
          unit_id: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          collection_case_id?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dismissed_at?: string | null
          due_at: string
          id?: never
          installment_id?: number | null
          kind: string
          patient_id?: number | null
          seen_at?: string | null
          status?: string
          title: string
          unit_id: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          collection_case_id?: number | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dismissed_at?: string | null
          due_at?: string
          id?: never
          installment_id?: number | null
          kind?: string
          patient_id?: number | null
          seen_at?: string | null
          status?: string
          title?: string
          unit_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_tasks_collection_case_fk"
            columns: ["collection_case_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "collection_cases"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "financial_tasks_collection_case_fk"
            columns: ["collection_case_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "collection_queue"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "financial_tasks_installment_fk"
            columns: ["installment_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "financial_tasks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "collection_queue"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "financial_tasks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "invoice_queue"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "financial_tasks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "financial_tasks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_tasks_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "financial_tasks_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rows: {
        Row: {
          created_at: string
          errors: Json
          id: number
          import_run_id: number
          normalized_data: Json
          patient_id: number | null
          raw_data: Json
          row_number: number
          status: string
          unit_id: number
        }
        Insert: {
          created_at?: string
          errors?: Json
          id?: never
          import_run_id: number
          normalized_data?: Json
          patient_id?: number | null
          raw_data?: Json
          row_number: number
          status: string
          unit_id: number
        }
        Update: {
          created_at?: string
          errors?: Json
          id?: never
          import_run_id?: number
          normalized_data?: Json
          patient_id?: number | null
          raw_data?: Json
          row_number?: number
          status?: string
          unit_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "collection_queue"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "import_rows_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "invoice_queue"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "import_rows_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "import_rows_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_run_fk"
            columns: ["import_run_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "import_rows_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "import_rows_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          column_mapping: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          duplicate_rows: number
          error_rows: number
          file_name: string
          id: number
          imported_rows: number
          report: Json
          started_at: string
          status: string
          total_rows: number
          unit_id: number
          updated_at: string
          valid_rows: number
        }
        Insert: {
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_rows?: number
          error_rows?: number
          file_name: string
          id?: never
          imported_rows?: number
          report?: Json
          started_at?: string
          status?: string
          total_rows?: number
          unit_id: number
          updated_at?: string
          valid_rows?: number
        }
        Update: {
          column_mapping?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_rows?: number
          error_rows?: number
          file_name?: string
          id?: never
          imported_rows?: number
          report?: Json
          started_at?: string
          status?: string
          total_rows?: number
          unit_id?: number
          updated_at?: string
          valid_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "import_runs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      installments: {
        Row: {
          boleto_url: string | null
          clinicorp_installment_id: string | null
          confirmed_at: string | null
          created_at: string
          currency: string
          due_date: string
          expected_amount: number
          id: number
          installment_number: number | null
          last_synced_at: string | null
          metadata: Json
          paid_amount: number
          paid_at: string | null
          payment_plan_id: number
          source: string
          status: string
          unit_id: number
          updated_at: string
        }
        Insert: {
          boleto_url?: string | null
          clinicorp_installment_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          due_date: string
          expected_amount: number
          id?: never
          installment_number?: number | null
          last_synced_at?: string | null
          metadata?: Json
          paid_amount?: number
          paid_at?: string | null
          payment_plan_id: number
          source?: string
          status?: string
          unit_id: number
          updated_at?: string
        }
        Update: {
          boleto_url?: string | null
          clinicorp_installment_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          due_date?: string
          expected_amount?: number
          id?: never
          installment_number?: number | null
          last_synced_at?: string | null
          metadata?: Json
          paid_amount?: number
          paid_at?: string | null
          payment_plan_id?: number
          source?: string
          status?: string
          unit_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installments_payment_plan_fk"
            columns: ["payment_plan_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "installments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "installments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          created_at: string
          display_name: string
          id: number
          last_error: string | null
          last_sync_at: string | null
          non_secret_config: Json
          provider: string
          secret_reference: string | null
          status: string
          unit_id: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: never
          last_error?: string | null
          last_sync_at?: string | null
          non_secret_config?: Json
          provider: string
          secret_reference?: string | null
          status?: string
          unit_id?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: never
          last_error?: string | null
          last_sync_at?: string | null
          non_secret_config?: Json
          provider?: string
          secret_reference?: string | null
          status?: string
          unit_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "integration_connections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_obligation_payments: {
        Row: {
          allocated_amount: number
          created_at: string
          invoice_obligation_id: number
          payment_id: number
          unit_id: number
        }
        Insert: {
          allocated_amount: number
          created_at?: string
          invoice_obligation_id: number
          payment_id: number
          unit_id: number
        }
        Update: {
          allocated_amount?: number
          created_at?: string
          invoice_obligation_id?: number
          payment_id?: number
          unit_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_obligation_payments_obligation_fk"
            columns: ["invoice_obligation_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "invoice_obligations"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "invoice_obligation_payments_obligation_fk"
            columns: ["invoice_obligation_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "invoice_queue"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "invoice_obligation_payments_payment_fk"
            columns: ["payment_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "invoice_obligation_payments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "invoice_obligation_payments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_obligations: {
        Row: {
          competence: string
          completed_at: string | null
          created_at: string
          expected_amount: number
          frequency: string
          id: number
          invoice_file_url: string | null
          invoice_issued_at: string | null
          invoice_number: string | null
          notes: string | null
          paid_amount: number
          patient_unit_id: number
          payment_plan_id: number
          period_end: string
          period_start: string
          responsible_user_id: string | null
          status: string
          unit_id: number
          updated_at: string
        }
        Insert: {
          competence: string
          completed_at?: string | null
          created_at?: string
          expected_amount?: number
          frequency: string
          id?: never
          invoice_file_url?: string | null
          invoice_issued_at?: string | null
          invoice_number?: string | null
          notes?: string | null
          paid_amount?: number
          patient_unit_id: number
          payment_plan_id: number
          period_end: string
          period_start: string
          responsible_user_id?: string | null
          status?: string
          unit_id: number
          updated_at?: string
        }
        Update: {
          competence?: string
          completed_at?: string | null
          created_at?: string
          expected_amount?: number
          frequency?: string
          id?: never
          invoice_file_url?: string | null
          invoice_issued_at?: string | null
          invoice_number?: string | null
          notes?: string | null
          paid_amount?: number
          patient_unit_id?: number
          payment_plan_id?: number
          period_end?: string
          period_start?: string
          responsible_user_id?: string | null
          status?: string
          unit_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_obligations_patient_unit_fk"
            columns: ["patient_unit_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "patient_units"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "invoice_obligations_payment_plan_fk"
            columns: ["payment_plan_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "invoice_obligations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "invoice_obligations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      message_events: {
        Row: {
          attempt_count: number
          channel: string
          created_at: string
          delivered_at: string | null
          external_message_id: string | null
          failed_at: string | null
          id: number
          idempotency_key: string
          installment_id: number | null
          kind: string
          last_error: string | null
          patient_id: number
          payload: Json
          read_at: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          template_name: string | null
          unit_id: number
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          channel?: string
          created_at?: string
          delivered_at?: string | null
          external_message_id?: string | null
          failed_at?: string | null
          id?: never
          idempotency_key: string
          installment_id?: number | null
          kind: string
          last_error?: string | null
          patient_id: number
          payload?: Json
          read_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          unit_id: number
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          channel?: string
          created_at?: string
          delivered_at?: string | null
          external_message_id?: string | null
          failed_at?: string | null
          id?: never
          idempotency_key?: string
          installment_id?: number | null
          kind?: string
          last_error?: string | null
          patient_id?: number
          payload?: Json
          read_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          unit_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_events_installment_fk"
            columns: ["installment_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "message_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "collection_queue"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "message_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "invoice_queue"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "message_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "message_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "message_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_units: {
        Row: {
          clinicorp_patient_id: string | null
          created_at: string
          created_by: string | null
          id: number
          is_active: boolean
          metadata: Json
          patient_id: number
          source: string
          started_at: string | null
          treatment: string | null
          unit_id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          clinicorp_patient_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: never
          is_active?: boolean
          metadata?: Json
          patient_id: number
          source?: string
          started_at?: string | null
          treatment?: string | null
          unit_id: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          clinicorp_patient_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: never
          is_active?: boolean
          metadata?: Json
          patient_id?: number
          source?: string
          started_at?: string | null
          treatment?: string | null
          unit_id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_units_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "collection_queue"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_units_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "invoice_queue"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_units_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_units_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "patient_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          archived_at: string | null
          cpf: string | null
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: number
          notes: string | null
          phone: string | null
          source: string
          status: string
          tax_receipt_ir: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: never
          notes?: string | null
          phone?: string | null
          source?: string
          status?: string
          tax_receipt_ir?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: never
          notes?: string | null
          phone?: string | null
          source?: string
          status?: string
          tax_receipt_ir?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          created_at: string
          event_type: string
          external_event_id: string | null
          id: number
          installment_id: number
          occurred_at: string
          payload: Json
          payment_id: number | null
          processed_at: string | null
          source: string
          unit_id: number
        }
        Insert: {
          created_at?: string
          event_type: string
          external_event_id?: string | null
          id?: never
          installment_id: number
          occurred_at: string
          payload?: Json
          payment_id?: number | null
          processed_at?: string | null
          source: string
          unit_id: number
        }
        Update: {
          created_at?: string
          event_type?: string
          external_event_id?: string | null
          id?: never
          installment_id?: number
          occurred_at?: string
          payload?: Json
          payment_id?: number | null
          processed_at?: string | null
          source?: string
          unit_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_installment_fk"
            columns: ["installment_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "payment_events_payment_fk"
            columns: ["payment_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "payment_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "payment_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_plans: {
        Row: {
          archived_at: string | null
          clinicorp_contract_id: string | null
          created_at: string
          created_by: string | null
          due_day: number | null
          end_date: string | null
          id: number
          installment_count: number | null
          invoice_frequency_override: string | null
          issue_invoice_for_ir: boolean
          metadata: Json
          patient_unit_id: number
          payment_method: string
          source: string
          start_date: string | null
          status: string
          total_amount: number
          treatment: string | null
          unit_id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          clinicorp_contract_id?: string | null
          created_at?: string
          created_by?: string | null
          due_day?: number | null
          end_date?: string | null
          id?: never
          installment_count?: number | null
          invoice_frequency_override?: string | null
          issue_invoice_for_ir?: boolean
          metadata?: Json
          patient_unit_id: number
          payment_method?: string
          source?: string
          start_date?: string | null
          status?: string
          total_amount?: number
          treatment?: string | null
          unit_id: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          clinicorp_contract_id?: string | null
          created_at?: string
          created_by?: string | null
          due_day?: number | null
          end_date?: string | null
          id?: never
          installment_count?: number | null
          invoice_frequency_override?: string | null
          issue_invoice_for_ir?: boolean
          metadata?: Json
          patient_unit_id?: number
          payment_method?: string
          source?: string
          start_date?: string | null
          status?: string
          total_amount?: number
          treatment?: string | null
          unit_id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_plans_patient_unit_fk"
            columns: ["patient_unit_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "patient_units"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "payment_plans_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "payment_plans_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          clinicorp_payment_id: string | null
          confirmed_at: string | null
          created_at: string
          fee_amount: number
          id: number
          installment_id: number
          net_amount: number | null
          paid_at: string
          payment_method: string
          raw_data: Json
          reversed_at: string | null
          source: string
          status: string
          unit_id: number
          updated_at: string
        }
        Insert: {
          amount: number
          clinicorp_payment_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          fee_amount?: number
          id?: never
          installment_id: number
          net_amount?: number | null
          paid_at: string
          payment_method: string
          raw_data?: Json
          reversed_at?: string | null
          source?: string
          status?: string
          unit_id: number
          updated_at?: string
        }
        Update: {
          amount?: number
          clinicorp_payment_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          fee_amount?: number
          id?: never
          installment_id?: number
          net_amount?: number | null
          paid_at?: string
          payment_method?: string
          raw_data?: Json
          reversed_at?: string | null
          source?: string
          status?: string
          unit_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_installment_fk"
            columns: ["installment_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "payments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "payments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_units: {
        Row: {
          created_at: string
          unit_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          unit_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          unit_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "profile_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_units_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          is_active: boolean
          last_unit_id: number | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          is_active?: boolean
          last_unit_id?: number | null
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          is_active?: boolean
          last_unit_id?: number | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_unit_id_fkey"
            columns: ["last_unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "profiles_last_unit_id_fkey"
            columns: ["last_unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invitation_units: {
        Row: {
          created_at: string
          invitation_id: number
          unit_id: number
        }
        Insert: {
          created_at?: string
          invitation_id: number
          unit_id: number
        }
        Update: {
          created_at?: string
          invitation_id?: number
          unit_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_invitation_units_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "staff_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invitation_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "staff_invitation_units_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          expires_at: string | null
          full_name: string
          id: number
          invited_by: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          expires_at?: string | null
          full_name: string
          id?: never
          invited_by?: string | null
          role: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string | null
          full_name?: string
          id?: never
          invited_by?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_events: {
        Row: {
          action: string
          created_at: string
          entity_type: string
          error_message: string | null
          external_id: string | null
          id: number
          payload_hash: string | null
          status: string
          sync_run_id: number
          unit_id: number | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_type: string
          error_message?: string | null
          external_id?: string | null
          id?: never
          payload_hash?: string | null
          status: string
          sync_run_id: number
          unit_id?: number | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_type?: string
          error_message?: string | null
          external_id?: string | null
          id?: never
          payload_hash?: string | null
          status?: string
          sync_run_id?: number
          unit_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_events_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "sync_events_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          completed_at: string | null
          connection_id: number
          created_count: number
          cursor_value: string | null
          direction: string
          entity_type: string
          error_count: number
          error_summary: string | null
          id: number
          metadata: Json
          processed_count: number
          skipped_count: number
          started_at: string
          status: string
          unit_id: number | null
          updated_count: number
        }
        Insert: {
          completed_at?: string | null
          connection_id: number
          created_count?: number
          cursor_value?: string | null
          direction: string
          entity_type: string
          error_count?: number
          error_summary?: string | null
          id?: never
          metadata?: Json
          processed_count?: number
          skipped_count?: number
          started_at?: string
          status?: string
          unit_id?: number | null
          updated_count?: number
        }
        Update: {
          completed_at?: string | null
          connection_id?: number
          created_count?: number
          cursor_value?: string | null
          direction?: string
          entity_type?: string
          error_count?: number
          error_summary?: string | null
          id?: never
          metadata?: Json
          processed_count?: number
          skipped_count?: number
          started_at?: string
          status?: string
          unit_id?: number | null
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_runs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "sync_runs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          city: string
          clinicorp_business_id: string | null
          code: string
          created_at: string
          id: number
          invoice_cycle_mode: string
          invoice_frequency: string
          is_active: boolean
          name: string
          state: string
          updated_at: string
        }
        Insert: {
          city: string
          clinicorp_business_id?: string | null
          code: string
          created_at?: string
          id?: never
          invoice_cycle_mode: string
          invoice_frequency: string
          is_active?: boolean
          name: string
          state?: string
          updated_at?: string
        }
        Update: {
          city?: string
          clinicorp_business_id?: string | null
          code?: string
          created_at?: string
          id?: never
          invoice_cycle_mode?: string
          invoice_frequency?: string
          is_active?: boolean
          name?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      collection_queue: {
        Row: {
          clinicorp_patient_id: string | null
          due_date: string | null
          eligible_at: string | null
          id: number | null
          installment_id: number | null
          next_action_at: string | null
          notes: string | null
          open_amount: number | null
          patient_id: number | null
          patient_name: string | null
          phone: string | null
          protested_at: string | null
          responsible_user_id: string | null
          status: string | null
          unit_id: number | null
          unit_name: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_cases_installment_fk"
            columns: ["installment_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "collection_cases_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "collection_cases_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_queue: {
        Row: {
          clinicorp_patient_id: string | null
          competence: string | null
          cpf: string | null
          expected_amount: number | null
          frequency: string | null
          id: number | null
          invoice_issued_at: string | null
          invoice_number: string | null
          notes: string | null
          paid_amount: number | null
          patient_id: number | null
          patient_name: string | null
          payment_plan_id: number | null
          period_end: string | null
          period_start: string | null
          responsible_user_id: string | null
          status: string | null
          unit_id: number | null
          unit_name: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_obligations_payment_plan_fk"
            columns: ["payment_plan_id", "unit_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id", "unit_id"]
          },
          {
            foreignKeyName: "invoice_obligations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "patient_directory"
            referencedColumns: ["unit_id"]
          },
          {
            foreignKeyName: "invoice_obligations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_directory: {
        Row: {
          clinicorp_patient_id: string | null
          cpf: string | null
          created_at: string | null
          due_day: number | null
          email: string | null
          full_name: string | null
          installment_count: number | null
          invoice_frequency: string | null
          is_active: boolean | null
          notes: string | null
          patient_id: number | null
          patient_unit_id: number | null
          payment_method: string | null
          phone: string | null
          plan_amount: number | null
          start_date: string | null
          tax_receipt_ir: boolean | null
          treatment: string | null
          unit_code: string | null
          unit_id: number | null
          unit_name: string | null
          updated_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      import_patients: {
        Args: { p_file_name: string; p_rows: Json; p_unit_code: string }
        Returns: {
          error_count: number
          import_run_id: number
          imported_count: number
          updated_count: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
