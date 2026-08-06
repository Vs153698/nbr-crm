CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_name" varchar(150),
	"actor_role" varchar(40),
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(60),
	"entity_id" uuid,
	"entity_label" varchar(250),
	"changes" jsonb,
	"meta" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"request_id" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"user_id" uuid,
	"succeeded" boolean NOT NULL,
	"failure_reason" varchar(60),
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(60) NOT NULL,
	"module" varchar(40) NOT NULL,
	"action" varchar(40) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" varchar(64) NOT NULL,
	"replaced_by_session_id" uuid,
	"user_agent" text,
	"ip_address" "inet",
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"email" varchar(255) NOT NULL,
	"employee_code" varchar(40),
	"phone" varchar(20),
	"designation" varchar(120),
	"avatar_key" varchar(500),
	"password_hash" text NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"password_changed_at" timestamp with time zone,
	"role_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "applicant_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"flag" varchar(40) NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone,
	"set_by_user_id" uuid,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applicant_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"aadhaar_encrypted" text,
	"aadhaar_fingerprint" varchar(64),
	"aadhaar_last4" varchar(4),
	"passport_encrypted" text,
	"passport_fingerprint" varchar(64),
	"passport_last4" varchar(4),
	"pan_encrypted" text,
	"pan_fingerprint" varchar(64),
	"pan_last4" varchar(4),
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applicants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_code" varchar(20) NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"father_name" varchar(150),
	"mother_name" varchar(150),
	"date_of_birth" date,
	"gender" varchar(20),
	"mobile" varchar(20) NOT NULL,
	"mobile_normalised" varchar(15),
	"whatsapp" varchar(20),
	"email" varchar(255) NOT NULL,
	"email_normalised" varchar(255),
	"address_line" varchar(300),
	"city" varchar(100),
	"state" varchar(100),
	"country" varchar(100) DEFAULT 'India' NOT NULL,
	"pincode" varchar(12),
	"nationality" varchar(100),
	"photo_key" varchar(500),
	"name_normalised" varchar(200),
	"record_count" integer DEFAULT 0 NOT NULL,
	"is_blacklisted" boolean DEFAULT false NOT NULL,
	"is_minor_at_intake" boolean DEFAULT false NOT NULL,
	"erased_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "blacklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"reason" varchar(40) NOT NULL,
	"reason_detail" text NOT NULL,
	"remarks" text,
	"document_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"created_by_user_id" uuid,
	"lifted_at" timestamp with time zone,
	"lifted_by_user_id" uuid,
	"lift_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"record_title" varchar(250) NOT NULL,
	"category_id" uuid,
	"record_type" varchar(20) DEFAULT 'individual' NOT NULL,
	"description" text,
	"approved_description" text,
	"achievement_date" date,
	"location" varchar(250),
	"participant_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_code" varchar(20) NOT NULL,
	"applicant_id" uuid NOT NULL,
	"status" varchar(40) DEFAULT 'new_lead' NOT NULL,
	"locked_at" timestamp with time zone,
	"source" varchar(40) DEFAULT 'walk_in' NOT NULL,
	"application_date" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_to_user_id" uuid,
	"internal_remarks" text,
	"selection_date" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"selection_remarks" text,
	"selection_letter_key" varchar(500),
	"rejection_reason" text,
	"payment_status" varchar(30) DEFAULT 'not_raised' NOT NULL,
	"delivery_status" varchar(30) DEFAULT 'not_dispatched' NOT NULL,
	"has_certificate" boolean DEFAULT false NOT NULL,
	"has_publication" boolean DEFAULT false NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"external_id" varchar(120),
	"external_source" varchar(60),
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "status_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_status" varchar(40) NOT NULL,
	"to_status" varchar(40) NOT NULL,
	"label" varchar(120) NOT NULL,
	"required_permission" varchar(60) NOT NULL,
	"guards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_remark" boolean DEFAULT false NOT NULL,
	"requires_override" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"label" varchar(80) NOT NULL,
	"tone" varchar(20) DEFAULT 'slate' NOT NULL,
	"stage" varchar(30) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"record_id" uuid,
	"event_type" varchar(60) NOT NULL,
	"summary" varchar(500) NOT NULL,
	"meta" jsonb,
	"actor_user_id" uuid,
	"actor_name" varchar(150),
	"actor_kind" varchar(20) DEFAULT 'user' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"record_id" uuid,
	"kind" varchar(40) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" varchar(64),
	"description" text,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"scan_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"pdf_key" varchar(500) NOT NULL,
	"editable_file_key" varchar(500),
	"certificate_number" varchar(80),
	"issue_date" timestamp with time zone,
	"version_reason" varchar(300),
	"checksum_sha256" varchar(64),
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"certificate_number" varchar(80),
	"record_number" varchar(80),
	"current_version" integer DEFAULT 1 NOT NULL,
	"issue_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"courier_partner" varchar(120) NOT NULL,
	"tracking_number" varchar(120),
	"tracking_url" varchar(1000),
	"dispatched_on" timestamp with time zone,
	"delivery_status" varchar(30) DEFAULT 'not_dispatched' NOT NULL,
	"delivered_on" timestamp with time zone,
	"pod_key" varchar(500),
	"contents" varchar(500),
	"remarks" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" varchar(64),
	"description" text,
	"thumbnail_key" varchar(500),
	"scan_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"superseded_by_id" uuid,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"title" varchar(250) NOT NULL,
	"published_on" timestamp with time zone,
	"magazine_name" varchar(200),
	"page_number" varchar(20),
	"url" varchar(1000),
	"file_key" varchar(500),
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" varchar(40) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"record_id" uuid,
	"applicant_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"invoice_number" varchar(60) NOT NULL,
	"financial_year" varchar(10) NOT NULL,
	"issued_on" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) NOT NULL,
	"gst_amount" numeric(12, 2) NOT NULL,
	"final_amount" numeric(12, 2) NOT NULL,
	"pdf_key" varchar(500),
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"amount" numeric(12, 2) NOT NULL,
	"gst_percent" numeric(5, 2) DEFAULT '18.00' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_on" timestamp with time zone NOT NULL,
	"mode" varchar(30) NOT NULL,
	"transaction_ref" varchar(120),
	"receipt_key" varchar(500),
	"remarks" text,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"reverses_transaction_id" uuid,
	"idempotency_key" varchar(120),
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"package_id" uuid,
	"package_name" varchar(120) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"taxable_value" numeric(12, 2) NOT NULL,
	"gst_percent" numeric(5, 2) DEFAULT '18.00' NOT NULL,
	"gst_amount" numeric(12, 2) NOT NULL,
	"final_amount" numeric(12, 2) NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"due_date" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"record_id" uuid,
	"channel" varchar(20) NOT NULL,
	"direction" varchar(10) DEFAULT 'outbound' NOT NULL,
	"template_id" uuid,
	"template_code" varchar(40),
	"to_address" varchar(255),
	"cc_addresses" jsonb,
	"subject" varchar(250),
	"body" text NOT NULL,
	"attachment_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider_message_id" varchar(255),
	"call_duration_minutes" integer,
	"call_outcome" varchar(200),
	"sent_by_user_id" uuid,
	"sent_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"previous_body" text NOT NULL,
	"edit_reason" varchar(300),
	"edited_by_user_id" uuid,
	"edited_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"record_id" uuid,
	"body" text NOT NULL,
	"category" varchar(40) DEFAULT 'general' NOT NULL,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"follow_up_date" timestamp with time zone,
	"visible_to_role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"last_edited_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" varchar(60) NOT NULL,
	"title" varchar(250) NOT NULL,
	"body" text,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"applicant_id" uuid,
	"record_id" uuid,
	"link" varchar(500),
	"dedupe_key" varchar(200),
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid,
	"record_id" uuid,
	"title" varchar(250) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"assigned_to_user_id" uuid NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"remind_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"completion_remark" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"name" varchar(120) NOT NULL,
	"subject" varchar(250),
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breach_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_code" varchar(30) NOT NULL,
	"title" varchar(250) NOT NULL,
	"description" text NOT NULL,
	"severity" varchar(20) NOT NULL,
	"status" varchar(30) DEFAULT 'detected' NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"notify_due_at" timestamp with time zone NOT NULL,
	"board_notified_at" timestamp with time zone,
	"principals_notified_at" timestamp with time zone,
	"affected_applicant_count" integer DEFAULT 0 NOT NULL,
	"data_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"containment_actions" text,
	"root_cause" text,
	"remediation" text,
	"closed_at" timestamp with time zone,
	"reported_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(20) NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"title" varchar(250) NOT NULL,
	"body" text NOT NULL,
	"purposes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"record_id" uuid,
	"purpose" varchar(60) NOT NULL,
	"state" varchar(20) NOT NULL,
	"lawful_basis" varchar(30) DEFAULT 'consent' NOT NULL,
	"notice_version" varchar(20) NOT NULL,
	"notice_id" uuid,
	"channel" varchar(30) NOT NULL,
	"evidence_key" varchar(500),
	"captured_notes" text,
	"guardian_name" varchar(150),
	"guardian_relationship" varchar(60),
	"guardian_contact" varchar(20),
	"is_child_consent" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"withdrawal_reason" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_principal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_code" varchar(30) NOT NULL,
	"applicant_id" uuid,
	"type" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'received' NOT NULL,
	"requester_name" varchar(150) NOT NULL,
	"requester_email" varchar(255),
	"requester_phone" varchar(20),
	"details" text NOT NULL,
	"received_via" varchar(30) NOT NULL,
	"attachment_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"identity_verified_at" timestamp with time zone,
	"identity_verification_method" varchar(200),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"assigned_to_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erasure_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid,
	"applicant_code" varchar(20) NOT NULL,
	"dsr_id" uuid,
	"trigger" varchar(30) NOT NULL,
	"reason" text NOT NULL,
	"scope" jsonb NOT NULL,
	"retained_financial_records" boolean DEFAULT true NOT NULL,
	"executed_by_user_id" uuid,
	"executed_by_name" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pii_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_name" varchar(150),
	"user_role" varchar(40),
	"applicant_id" uuid,
	"field" varchar(60) NOT NULL,
	"access_type" varchar(20) NOT NULL,
	"reason" varchar(300),
	"ip_address" "inet",
	"user_agent" text,
	"request_id" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_category" varchar(40) NOT NULL,
	"description" text NOT NULL,
	"retain_months" integer NOT NULL,
	"trigger_event" varchar(40) NOT NULL,
	"legal_basis" text,
	"auto_erase" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "couriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"tracking_url_template" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"report_type" varchar(40) NOT NULL,
	"format" varchar(10) NOT NULL,
	"filters" jsonb NOT NULL,
	"columns" jsonb,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"row_count" integer,
	"storage_key" varchar(500),
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(60) DEFAULT 'nbr_website' NOT NULL,
	"external_id" varchar(120) NOT NULL,
	"event_type" varchar(60) DEFAULT 'application.approved' NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"delivery_mode" varchar(20) DEFAULT 'webhook' NOT NULL,
	"status" varchar(30) DEFAULT 'received' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"applicant_id" uuid,
	"record_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"scope" varchar(40) DEFAULT 'applicants' NOT NULL,
	"filters" jsonb NOT NULL,
	"columns" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(120) NOT NULL,
	"value" jsonb NOT NULL,
	"category" varchar(40) DEFAULT 'general' NOT NULL,
	"label" varchar(200),
	"description" text,
	"is_editable" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_flags" ADD CONSTRAINT "applicant_flags_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_flags" ADD CONSTRAINT "applicant_flags_set_by_user_id_users_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_flags" ADD CONSTRAINT "applicant_flags_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicant_identifiers" ADD CONSTRAINT "applicant_identifiers_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blacklists" ADD CONSTRAINT "blacklists_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blacklists" ADD CONSTRAINT "blacklists_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blacklists" ADD CONSTRAINT "blacklists_lifted_by_user_id_users_id_fk" FOREIGN KEY ("lifted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_versions" ADD CONSTRAINT "certificate_versions_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_versions" ADD CONSTRAINT "certificate_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_revisions" ADD CONSTRAINT "note_revisions_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breach_register" ADD CONSTRAINT "breach_register_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_notices" ADD CONSTRAINT "consent_notices_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_notice_id_consent_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."consent_notices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_principal_requests" ADD CONSTRAINT "data_principal_requests_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_principal_requests" ADD CONSTRAINT "data_principal_requests_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_principal_requests" ADD CONSTRAINT "data_principal_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_log" ADD CONSTRAINT "erasure_log_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_log" ADD CONSTRAINT "erasure_log_dsr_id_data_principal_requests_id_fk" FOREIGN KEY ("dsr_id") REFERENCES "public"."data_principal_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_log" ADD CONSTRAINT "erasure_log_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii_access_log" ADD CONSTRAINT "pii_access_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pii_access_log" ADD CONSTRAINT "pii_access_log_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_identifier_idx" ON "login_attempts" USING btree ("identifier","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_token_hash_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_code_uq" ON "permissions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "permissions_module_idx" ON "permissions" USING btree ("module");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_uq" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_code_uq" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","expires_at") WHERE "sessions"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_employee_code_uq" ON "users" USING btree ("employee_code") WHERE "users"."employee_code" is not null;--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "applicant_flags_active_uq" ON "applicant_flags" USING btree ("applicant_id","flag") WHERE "applicant_flags"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "applicant_flags_applicant_idx" ON "applicant_flags" USING btree ("applicant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applicant_identifiers_applicant_uq" ON "applicant_identifiers" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "applicant_identifiers_aadhaar_fp_idx" ON "applicant_identifiers" USING btree ("aadhaar_fingerprint") WHERE "applicant_identifiers"."aadhaar_fingerprint" is not null;--> statement-breakpoint
CREATE INDEX "applicant_identifiers_passport_fp_idx" ON "applicant_identifiers" USING btree ("passport_fingerprint") WHERE "applicant_identifiers"."passport_fingerprint" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "applicants_code_uq" ON "applicants" USING btree ("applicant_code");--> statement-breakpoint
CREATE UNIQUE INDEX "applicants_mobile_uq" ON "applicants" USING btree ("mobile_normalised") WHERE "applicants"."deleted_at" is null and "applicants"."mobile_normalised" is not null;--> statement-breakpoint
CREATE INDEX "applicants_email_idx" ON "applicants" USING btree ("email_normalised") WHERE "applicants"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "applicants_updated_idx" ON "applicants" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "applicants_blacklist_idx" ON "applicants" USING btree ("is_blacklisted") WHERE "applicants"."is_blacklisted" = true;--> statement-breakpoint
CREATE INDEX "applicants_city_state_idx" ON "applicants" USING btree ("country","state","city");--> statement-breakpoint
CREATE INDEX "applicants_dob_idx" ON "applicants" USING btree ("date_of_birth") WHERE "applicants"."date_of_birth" is not null;--> statement-breakpoint
CREATE INDEX "blacklists_applicant_idx" ON "blacklists" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "blacklists_active_idx" ON "blacklists" USING btree ("applicant_id","effective_until") WHERE "blacklists"."lifted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_record_uq" ON "achievements" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "achievements_category_idx" ON "achievements" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "achievements_date_idx" ON "achievements" USING btree ("achievement_date");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "records_code_uq" ON "records" USING btree ("record_code");--> statement-breakpoint
CREATE INDEX "records_status_assigned_updated_idx" ON "records" USING btree ("status","assigned_to_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "records_applicant_idx" ON "records" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "records_updated_idx" ON "records" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "records_payment_status_idx" ON "records" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "records_delivery_status_idx" ON "records" USING btree ("delivery_status");--> statement-breakpoint
CREATE UNIQUE INDEX "records_external_uq" ON "records" USING btree ("external_source","external_id") WHERE "records"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "records_pending_review_idx" ON "records" USING btree ("updated_at") WHERE "records"."status" in ('under_review', 'verification_pending');--> statement-breakpoint
CREATE INDEX "records_payment_pending_idx" ON "records" USING btree ("updated_at") WHERE "records"."status" = 'payment_pending';--> statement-breakpoint
CREATE INDEX "records_dispatch_pending_idx" ON "records" USING btree ("updated_at") WHERE "records"."status" = 'dispatch_pending';--> statement-breakpoint
CREATE UNIQUE INDEX "status_transitions_uq" ON "status_transitions" USING btree ("from_status","to_status");--> statement-breakpoint
CREATE UNIQUE INDEX "statuses_code_uq" ON "statuses" USING btree ("code");--> statement-breakpoint
CREATE INDEX "timeline_record_occurred_idx" ON "timeline_events" USING btree ("record_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "timeline_applicant_occurred_idx" ON "timeline_events" USING btree ("applicant_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "timeline_occurred_idx" ON "timeline_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "timeline_event_type_idx" ON "timeline_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "attachments_applicant_idx" ON "attachments" USING btree ("applicant_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_record_idx" ON "attachments" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_uq" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_versions_uq" ON "certificate_versions" USING btree ("certificate_id","version");--> statement-breakpoint
CREATE INDEX "certificate_versions_cert_idx" ON "certificate_versions" USING btree ("certificate_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_record_uq" ON "certificates" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_number_uq" ON "certificates" USING btree ("certificate_number") WHERE "certificates"."certificate_number" is not null;--> statement-breakpoint
CREATE INDEX "certificates_applicant_idx" ON "certificates" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "dispatches_record_idx" ON "dispatches" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "dispatches_status_idx" ON "dispatches" USING btree ("delivery_status","dispatched_on");--> statement-breakpoint
CREATE INDEX "dispatches_tracking_idx" ON "dispatches" USING btree ("tracking_number") WHERE "dispatches"."tracking_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatches_current_uq" ON "dispatches" USING btree ("record_id") WHERE "dispatches"."is_current" = true;--> statement-breakpoint
CREATE INDEX "evidence_record_idx" ON "evidence_files" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_applicant_idx" ON "evidence_files" USING btree ("applicant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_storage_key_uq" ON "evidence_files" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_record_checksum_uq" ON "evidence_files" USING btree ("record_id","checksum_sha256") WHERE "evidence_files"."checksum_sha256" is not null;--> statement-breakpoint
CREATE INDEX "evidence_scan_pending_idx" ON "evidence_files" USING btree ("created_at") WHERE "evidence_files"."scan_status" = 'pending';--> statement-breakpoint
CREATE INDEX "publications_record_idx" ON "publications" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "publications_applicant_idx" ON "publications" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "publications_kind_idx" ON "publications" USING btree ("kind","published_on");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_intents_key_uq" ON "upload_intents" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "upload_intents_orphan_idx" ON "upload_intents" USING btree ("expires_at") WHERE "upload_intents"."confirmed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_payment_idx" ON "invoices" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "invoices_fy_idx" ON "invoices" USING btree ("financial_year","issued_on");--> statement-breakpoint
CREATE UNIQUE INDEX "packages_name_uq" ON "packages" USING btree ("name");--> statement-breakpoint
CREATE INDEX "payment_transactions_payment_idx" ON "payment_transactions" USING btree ("payment_id","paid_on");--> statement-breakpoint
CREATE INDEX "payment_transactions_record_idx" ON "payment_transactions" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_paid_on_idx" ON "payment_transactions" USING btree ("paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_idempotency_uq" ON "payment_transactions" USING btree ("idempotency_key") WHERE "payment_transactions"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_ref_uq" ON "payment_transactions" USING btree ("payment_id","transaction_ref") WHERE "payment_transactions"."transaction_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_record_uq" ON "payments" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "payments_applicant_idx" ON "payments" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "payments_status_due_idx" ON "payments" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "payments_overdue_idx" ON "payments" USING btree ("due_date") WHERE "payments"."status" in ('pending', 'partial');--> statement-breakpoint
CREATE INDEX "payments_settled_idx" ON "payments" USING btree ("settled_at") WHERE "payments"."settled_at" is not null;--> statement-breakpoint
CREATE INDEX "communications_applicant_idx" ON "communications" USING btree ("applicant_id","created_at");--> statement-breakpoint
CREATE INDEX "communications_record_idx" ON "communications" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "communications_channel_idx" ON "communications" USING btree ("channel","created_at");--> statement-breakpoint
CREATE INDEX "communications_pending_idx" ON "communications" USING btree ("created_at") WHERE "communications"."status" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "note_revisions_uq" ON "note_revisions" USING btree ("note_id","revision");--> statement-breakpoint
CREATE INDEX "notes_applicant_idx" ON "notes" USING btree ("applicant_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_record_idx" ON "notes" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_followup_idx" ON "notes" USING btree ("follow_up_date") WHERE "notes"."follow_up_date" is not null;--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("dedupe_key") WHERE "notifications"."dedupe_key" is not null and "notifications"."dismissed_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_record_idx" ON "notifications" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_due_idx" ON "tasks" USING btree ("assigned_to_user_id","due_date") WHERE "tasks"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_date") WHERE "tasks"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "tasks_applicant_idx" ON "tasks" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "tasks_record_idx" ON "tasks" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "tasks_reminder_idx" ON "tasks" USING btree ("remind_at") WHERE "tasks"."status" = 'pending' and "tasks"."remind_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_code_channel_uq" ON "templates" USING btree ("code","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "breach_reference_uq" ON "breach_register" USING btree ("reference_code");--> statement-breakpoint
CREATE INDEX "breach_status_idx" ON "breach_register" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "breach_open_idx" ON "breach_register" USING btree ("notify_due_at") WHERE "breach_register"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_notices_version_lang_uq" ON "consent_notices" USING btree ("version","language");--> statement-breakpoint
CREATE INDEX "consent_applicant_purpose_idx" ON "consent_records" USING btree ("applicant_id","purpose","occurred_at");--> statement-breakpoint
CREATE INDEX "consent_state_idx" ON "consent_records" USING btree ("state","occurred_at");--> statement-breakpoint
CREATE INDEX "consent_child_idx" ON "consent_records" USING btree ("applicant_id") WHERE "consent_records"."is_child_consent" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "dsr_reference_uq" ON "data_principal_requests" USING btree ("reference_code");--> statement-breakpoint
CREATE INDEX "dsr_applicant_idx" ON "data_principal_requests" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "dsr_status_due_idx" ON "data_principal_requests" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "dsr_overdue_idx" ON "data_principal_requests" USING btree ("due_at") WHERE "data_principal_requests"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "erasure_log_applicant_idx" ON "erasure_log" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "erasure_log_created_idx" ON "erasure_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pii_access_user_idx" ON "pii_access_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "pii_access_applicant_idx" ON "pii_access_log" USING btree ("applicant_id","created_at");--> statement-breakpoint
CREATE INDEX "pii_access_created_idx" ON "pii_access_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_policies_category_uq" ON "retention_policies" USING btree ("data_category");--> statement-breakpoint
CREATE UNIQUE INDEX "couriers_name_uq" ON "couriers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "export_jobs_user_idx" ON "export_jobs" USING btree ("requested_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "export_jobs_status_idx" ON "export_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "export_jobs_expiry_idx" ON "export_jobs" USING btree ("expires_at") WHERE "export_jobs"."storage_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_external_uq" ON "integration_events" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "integration_events_status_idx" ON "integration_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "integration_events_pending_idx" ON "integration_events" USING btree ("received_at") WHERE "integration_events"."status" in ('received', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_user_name_uq" ON "saved_views" USING btree ("user_id","scope","name");--> statement-breakpoint
CREATE INDEX "saved_views_user_idx" ON "saved_views" USING btree ("user_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_uq" ON "settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "settings_category_idx" ON "settings" USING btree ("category");