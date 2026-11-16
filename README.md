# 🏡💕 Ons Twee

A private home hub for two: shared calendar, money and budgets, savings goals, grocery and pharmacy lists,
weight and body measurements, chores, date-night ideas and bucket list, birthdays and gift ideas, and trips.

Built as a website that installs on your iPhone like an app. It uses **Supabase** (database and sign-in),
**GitHub** (stores the code) and **Vercel** (hosts the website). All three are free.

## Status

- **Supabase:** project `ons-twee` (eu-west-1) is set up. The database, security rules and notification sender are deployed,
  and the schedules run every 5 minutes (event reminders) and at 07:00 SA time (morning summary).
- **Website:** import this repository in Vercel (Add New → Project → `austins` → Deploy). After that, every push goes live automatically.

## Getting started

1. Open the website → **First time here? Create your account**. The first account becomes the owner.
2. Settings → **Partner** → type your partner's email → **Invite**. Your partner then creates their account with that email.
3. iPhone: open in Safari → Share → **Add to Home Screen** → open it from there → Settings → turn on **Notifications**.

## Privacy

- Only two emails can ever have an account: the owner's, and the partner they invite. Anyone else can't even sign up.
- Both of you can see both people's weight and measurements, but each person can only add or edit their own.
- To swap your partner's email, use Settings → Partner → Remove, then invite the new one.

## Changing things

- **Spending categories:** top of `js/app.js` (`EXPENSE_CATS`).
- **Colours and look:** `css/app.css` (the variables at the top).
- **App name:** `js/config.js` and `manifest.webmanifest`.
- **After any change:** change `onstwee-v1` to `onstwee-v2` (and so on) in `sw.js`, so phones load the new version.

**Demo mode:** if `SUPABASE_URL` in `js/config.js` is empty, the app runs with sample data stored only on that device.
