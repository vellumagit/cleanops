-- How late a client can change or cancel a visit on their own
-- (roadmap phase 4).
--
-- WHY
-- docs/online-booking-roadmap.md, phase 4. From the private link in a
-- booking email a client can cancel a visit, and now move it to another
-- open time. Both are allowed up to a notice period before the visit; past
-- it, cancelling becomes a request the office answers, and moving is a
-- phone call. That period was fixed at 48 hours for everyone. It is the
-- company's to set.
--
-- NOW
-- booking_pages.change_notice_hours, default 48: what every company has
-- today, so nothing changes until a company changes it. A company with no
-- booking page keeps 48.
--
-- Run BEFORE the code push: Settings, Online booking saves this.
-- Idempotent. Changes no existing row's behaviour.

begin;

alter table public.booking_pages
  add column if not exists change_notice_hours integer not null default 48
    check (change_notice_hours between 0 and 720);

commit;

notify pgrst, 'reload schema';
