-- Send a OneSignal push notification whenever a notice is inserted (push = true).
-- The OneSignal REST API key is read from Supabase Vault (secret name: onesignal_rest_key).
create extension if not exists pg_net with schema extensions;

create or replace function public.push_notice() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  k text;
begin
  if not new.push then return new; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'onesignal_rest_key' limit 1;
  if k is null then
    raise warning 'onesignal_rest_key is not set in Vault; push skipped';
    return new;
  end if;
  perform net.http_post(
    url     := 'https://api.onesignal.com/notifications?c=push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Key ' || k),
    body    := jsonb_build_object(
      'app_id', '1dfc9916-5f17-436f-9a22-66a1fdcc4652',
      'target_channel', 'push',
      'included_segments', jsonb_build_array('Total Subscriptions'),
      'headings', jsonb_build_object('en', '📣 ' || new.title),
      'contents', jsonb_build_object('en', left(coalesce(nullif(new.body,''), new.title), 180)),
      'url', 'https://ozlamtahirli.github.io/Akkonak-yasamal-15/'
    )
  );
  return new;
end $$;

drop trigger if exists notices_push on public.notices;
create trigger notices_push after insert on public.notices
  for each row execute function public.push_notice();
