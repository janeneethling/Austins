# 🏡💕 Ons Twee

A private home hub for two: shared calendar, money and budgets, savings goals, grocery and pharmacy lists,
weight and body measurements, chores, date-night ideas and bucket list, birthdays and gift ideas, and trips.

Built as a website that installs on your iPhone like an app. It uses **Supabase** (database and sign-in),
**GitHub** (stores the code) and **Vercel** (hosts the website). All three are free.

## Setup (one time)

1. **Supabase:** create a new project called `ons-twee`.
2. **Supabase → Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up".
   Only the accounts you create yourself can exist.
3. **Supabase → Authentication → Users → Add user → Create new user:** create one user for each of you
   (email + password) and tick **Auto Confirm User**.
4. **Supabase → SQL Editor → New query:** paste `supabase/01_setup.sql`. Change the two example emails at the
   bottom to your two emails, then click **Run**.
5. **`js/config.js`:** fill in the Project URL and the Publishable key
   (Supabase → Project Settings → API Keys).
6. **GitHub:** put the files in a private repository. **Vercel:** Add New → Project → import it → Deploy.
7. **iPhone:** open the site in Safari → Share → **Add to Home Screen**. Sign in, then choose your name and colour.

## Privacy

- Only the emails listed in the `allowed_users` table can see or change anything. Everyone else sees nothing,
  even with a valid login.
- Both of you can see both people's weight and measurements, but each person can only add or edit their own.
- To add or remove an allowed email, run this in the SQL Editor:
  `insert into allowed_users values ('new@email.com');` or
  `delete from allowed_users where email = 'old@email.com';`

## Changing things

- **Spending categories:** top of `js/app.js` (`EXPENSE_CATS`).
- **Colours and look:** `css/app.css` (the variables at the top).
- **App name:** `js/config.js` and `manifest.webmanifest`.
- **After any change:** change `onstwee-v1` to `onstwee-v2` (and so on) in `sw.js`, so phones load the new version.

**Demo mode:** if `SUPABASE_URL` in `js/config.js` is empty, the app runs with sample data stored only on that device.
