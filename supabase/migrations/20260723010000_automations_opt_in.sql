-- =============================================================================
-- Automations become fully OPT-IN
-- =============================================================================
-- New orgs start with EVERY automation off and a master switch off — nothing
-- fires until the owner turns automations on and picks what they want.
--
-- CRITICAL BACK-COMPAT: existing orgs must not go dark. Before the code default
-- flips to "off", we (a) turn their master switch ON and (b) FREEZE their
-- current effective settings by writing an explicit true/false for every key
-- they hadn't set. Explicit settings always win over the default, so their
-- behaviour is byte-identical after the flip.
--
-- The `false` list below is the OLD DEFAULT_OFF set; everything else defaulted
-- on. Keys already present in automation_settings are left untouched.
-- =============================================================================

alter table public.organizations
  add column if not exists automations_enabled boolean not null default false;

comment on column public.organizations.automations_enabled is
  'Master switch. When false NO automation fires, regardless of per-key settings. New orgs start false (opt-in); existing orgs were grandfathered to true.';

do $$
declare
  -- Keys that defaulted OFF before this migration.
  off_keys text[] := array[
    'booking_confirmation_email',
    'system_feed_events',
    'feed_visible',
    'booking_confirmation_sms',
    'booking_reminder_client_sms',
    'booking_assignment_sms',
    'booking_rescheduled_sms',
    'booking_cancelled_sms',
    'divide_crew_hours'
  ];
  -- Every key the settings UI knows about.
  all_keys text[] := array[
    'auto_invoice_on_job_complete','booking_confirmation_email','booking_rescheduled_email',
    'booking_reminder_client_email','estimate_sent_email','invoice_paid_receipt',
    'invoice_overdue_reminder','review_submitted_notify','booking_assignment_notify',
    'unassigned_booking_alert','low_review_alert','stripe_payout_alert','weekly_ops_digest',
    'monthly_ops_digest','employee_daily_schedule','employee_weekly_schedule','overtime_warning',
    'pto_status_notify','payroll_paid_receipt','training_assigned_notify',
    'certification_expiry_reminder','auto_expire_stale_estimates','auto_void_overdue_invoices',
    'auto_complete_past_bookings','auto_archive_old_records','auto_recurring_invoices',
    'booking_cancelled_email','rebooking_prompt_email','estimate_followup_email',
    'review_request_after_completion','gbp_review_request','booking_confirmation_sms',
    'booking_reminder_client_sms','booking_assignment_sms','booking_rescheduled_sms',
    'booking_cancelled_sms','system_feed_events','feed_visible','divide_crew_hours'
  ];
  org record;
  k text;
  merged jsonb;
begin
  for org in
    select id, coalesce(automation_settings, '{}'::jsonb) as settings
    from public.organizations
    where deleted_at is null
  loop
    merged := org.settings;
    foreach k in array all_keys loop
      -- Only fill in keys the owner never explicitly set.
      if not (merged ? k) then
        merged := jsonb_set(
          merged,
          array[k],
          jsonb_build_object('enabled', not (k = any(off_keys))),
          true
        );
      end if;
    end loop;

    update public.organizations
       set automation_settings = merged,
           automations_enabled = true
     where id = org.id;
  end loop;
end $$;
