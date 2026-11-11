-- Send a OneSignal push to the apartment whose payment was recorded in the admin panel.
-- Targets subscribers tagged apt=<apartment>. Key comes from Vault (onesignal_rest_key).
create or replace function public.push_payment() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  k text; b record; paid numeric; left_amt numeric; mon text; msg text;
  months text[] := array['Yanvar','Fevral','Mart','Aprel','May','İyun','İyul','Avqust','Sentyabr','Oktyabr','Noyabr','Dekabr'];
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'onesignal_rest_key' limit 1;
  if k is null then return new; end if;

  select id, apt, period, total into b from public.bills where id = new.bill_id;
  if b.apt is null then return new; end if;

  select coalesce(sum(amount),0) into paid from public.payments where bill_id = b.id;
  left_amt := greatest(b.total - paid, 0);
  mon := months[split_part(b.period,'-',2)::int] || ' ' || split_part(b.period,'-',1);

  if left_amt <= 0.009 then
    msg := 'Mənzil ' || b.apt || ' · ' || mon || ': ' || to_char(new.amount,'FM999990.00') || ' ₼ qəbul edildi. Hesab tam ödənilib. Təşəkkür edirik! / Оплата получена, счёт оплачен полностью.';
  else
    msg := 'Mənzil ' || b.apt || ' · ' || mon || ': ' || to_char(new.amount,'FM999990.00') || ' ₼ qəbul edildi. Qalıq: ' || to_char(left_amt,'FM999990.00') || ' ₼ / Оплата получена, остаток ' || to_char(left_amt,'FM999990.00') || ' ₼.';
  end if;

  perform net.http_post(
    url     := 'https://api.onesignal.com/notifications?c=push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Key ' || k),
    body    := jsonb_build_object(
      'app_id', '1dfc9916-5f17-436f-9a22-66a1fdcc4652',
      'target_channel', 'push',
      'filters', jsonb_build_array(jsonb_build_object('field','tag','key','apt','relation','=','value', b.apt)),
      'headings', jsonb_build_object('en', '✅ Ödəniş qəbul edildi'),
      'contents', jsonb_build_object('en', msg),
      'url', 'https://ozlamtahirli.github.io/Akkonak-yasamal-15/#bill-' || b.apt
    )
  );
  return new;
exception when others then
  raise warning 'push_payment failed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists payments_push on public.payments;
create trigger payments_push after insert on public.payments
  for each row execute function public.push_payment();
