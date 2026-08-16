create table if not exists public.campaign_captcha_nonces (
  site text not null check (site in ('luke', 'annalynn')),
  nonce uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (site, nonce)
);

create table if not exists public.campaign_rate_limits (
  site text not null check (site in ('luke', 'annalynn')),
  ip_hash text not null check (char_length(ip_hash) between 40 and 64),
  bucket_date date not null,
  challenge_count integer not null default 0 check (challenge_count >= 0),
  submission_count integer not null default 0 check (submission_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (site, ip_hash, bucket_date)
);

alter table public.campaign_captcha_nonces enable row level security;
alter table public.campaign_rate_limits enable row level security;
revoke all on public.campaign_captcha_nonces from public, anon, authenticated;
revoke all on public.campaign_rate_limits from public, anon, authenticated;

create or replace function public.issue_campaign_challenge(
  p_site text,
  p_nonce uuid,
  p_ip_hash text,
  p_expires_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count integer;
begin
  if p_site not in ('luke', 'annalynn') or char_length(p_ip_hash) not between 40 and 64
     or p_expires_at <= now() or p_expires_at > now() + interval '6 minutes' then
    return 'invalid';
  end if;

  delete from public.campaign_captcha_nonces where created_at < now() - interval '24 hours';
  delete from public.campaign_rate_limits where bucket_date < current_date;

  insert into public.campaign_rate_limits (site, ip_hash, bucket_date, challenge_count, updated_at)
  values (p_site, p_ip_hash, current_date, 1, now())
  on conflict (site, ip_hash, bucket_date) do update
    set challenge_count = public.campaign_rate_limits.challenge_count + 1,
        updated_at = now()
    where public.campaign_rate_limits.challenge_count < 30
  returning challenge_count into current_count;

  if current_count is null then return 'rate_limited'; end if;

  insert into public.campaign_captcha_nonces (site, nonce, expires_at)
  values (p_site, p_nonce, p_expires_at)
  on conflict do nothing;
  if not found then return 'invalid'; end if;
  return 'issued';
end;
$$;

create or replace function public.consume_campaign_submission(
  p_site text,
  p_nonce uuid,
  p_ip_hash text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  accepted_nonce uuid;
  current_count integer;
begin
  if p_site not in ('luke', 'annalynn') or char_length(p_ip_hash) not between 40 and 64 then return 'invalid'; end if;

  update public.campaign_captcha_nonces
     set used_at = now()
   where site = p_site and nonce = p_nonce and used_at is null and expires_at >= now()
  returning nonce into accepted_nonce;
  if accepted_nonce is null then return 'invalid'; end if;

  insert into public.campaign_rate_limits (site, ip_hash, bucket_date, submission_count, updated_at)
  values (p_site, p_ip_hash, current_date, 1, now())
  on conflict (site, ip_hash, bucket_date) do update
    set submission_count = public.campaign_rate_limits.submission_count + 1,
        updated_at = now()
    where public.campaign_rate_limits.submission_count < 5
  returning submission_count into current_count;
  if current_count is null then return 'rate_limited'; end if;
  return 'accepted';
end;
$$;

revoke all on function public.issue_campaign_challenge(text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_campaign_submission(text, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_campaign_challenge(text, uuid, text, timestamptz) to service_role;
grant execute on function public.consume_campaign_submission(text, uuid, text) to service_role;

create index if not exists campaign_captcha_nonces_expiry_idx on public.campaign_captcha_nonces (expires_at);
create index if not exists campaign_rate_limits_date_idx on public.campaign_rate_limits (bucket_date);
