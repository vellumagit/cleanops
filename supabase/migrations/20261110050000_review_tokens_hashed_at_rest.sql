-- =============================================================================
-- Review links: the database keeps a hash, not the link
-- =============================================================================
-- bookings.review_token and invoices.review_token held the token itself, and
-- the review page accepted whoever presented it. Every member of a company
-- can read both tables through the API, so a cleaner could read the token
-- for her own job and leave her own review. Review bonuses pay money.
--
-- New links are signed and not stored at all (src/lib/review-token.ts). This
-- handles the ones already emailed: each stored token is replaced by its
-- SHA-256, "sha256:<hex>". The link in the client's inbox keeps working,
-- because the app hashes what it is given and compares. The stored value is
-- now useless to anyone who reads it: it is not the token, and the app
-- refuses outright anything that looks like a stored value.
--
-- RUN THIS AFTER THE PUSH. The new code accepts both forms, so nothing
-- breaks in between; the old code compares plain text, so hashing first
-- would break every outstanding review link until the deploy finished.
-- Re-runnable: rows already hashed are skipped.
-- =============================================================================

update public.bookings
   set review_token = 'sha256:' || encode(extensions.digest(review_token, 'sha256'), 'hex')
 where review_token is not null
   and review_token not like 'sha256:%';

update public.invoices
   set review_token = 'sha256:' || encode(extensions.digest(review_token, 'sha256'), 'hex')
 where review_token is not null
   and review_token not like 'sha256:%';
