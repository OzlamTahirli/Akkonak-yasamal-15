# Yasamal 15 MMMC — residents' website

Public site for Yasamal-15 MMMC (Akkonak Residents): building finances, monthly bills
(Kommunal + electricity meter + parking), a report for all apartments, and announcements.

- `data.json` — all figures shown on the site (updated each month).
- `config.js` — OneSignal App ID for push notifications.
- `.github/workflows/notify.yml` — sends "bills ready", announcements (on data updates)
  and payment reminders (09:00 Baku, 3 days before and on the due date) to subscribed phones.
  Needs repository variable `ONESIGNAL_APP_ID`, `SITE_URL` and secret `ONESIGNAL_REST_KEY`.
