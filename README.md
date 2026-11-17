# Task Board

A fast, offline-friendly to-do board for work. Snap a photo of the problem, write down what needs to be done, pick a priority, set a "fix by" date and a reminder. It works on your phone and your computer.

## What it does

- **📷 Photo capture.** Tap the round camera button to take a picture and start a task in one step. You can also add more photos or pick them from your library. Photos are shrunk on your device, so a 4 MB camera photo is stored as about 200 KB.
- **Four priorities: High, Medium, Low, Last.** The board has one color-coded column for each. On a computer you can drag a card to another column to change its priority.
- **Dates.**
  - *Needs to be fixed by*: the due date. Cards show **Due today**, **Due tomorrow** or **Overdue 2d**.
  - *Completed on*: the date you did the job. Tap the circle on a card, or **Done today** in the editor, to fill it in with today's date. You can also type any date.
- **⏰ Reminders.** Set any date and time, or use the quick buttons: *In 1 hour*, *Tomorrow 8 AM* or *Morning it's due*.
- **At a glance.** The counters at the top show **Overdue**, **Due today**, **Open** and **Done**. Tap one to filter the board. Search finds tasks by title or notes. The app icon shows a badge with the number of tasks that are overdue or due today.
- **Export.**
  - **CSV** spreadsheet, to hand to a boss or open in Excel.
  - **Calendar file (.ics)** with every reminder.
  - **Full backup** including photos, which you can restore on another device.

## How reminders work

| Situation | What happens |
|---|---|
| App open, or in the background | A pop-up notification appears at the reminder time (after you allow notifications) |
| Reminder time passed while the app was closed | The reminder pops up the next time you open the app |
| You need an alert even when the app is fully closed | Tap **Add to calendar** on the task. Your phone's calendar alarm goes off at the reminder time. It is the most reliable option. |

On **iPhone**, pop-up notifications only work after you add the app to your Home Screen (Safari → Share → **Add to Home Screen**, iOS 16.4 or later). Open it from the Home Screen icon.

## Getting it on your phone

The app is plain HTML/CSS/JS with no build step, so any static web host works. The easiest is GitHub Pages:

1. On GitHub, open this repo and go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**. Pick the branch with these files, select the `/ (root)` folder and save.
3. After a minute or so, GitHub shows your site address, for example `https://<your-username>.github.io/To-do-tasks/`.
4. Open that address on your phone:
   - **iPhone:** Share → **Add to Home Screen**.
   - **Android:** browser menu → **Install app**.

   It then opens full-screen like a normal app and works without signal.

To try it on a computer:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Your data

Everything is stored **only on the device you use** (in the browser's IndexedDB). Nothing is uploaded anywhere. That means:

- Your phone and your computer each have their own separate board. To move tasks between them, use **⋯ → Back up**, then **⋯ → Restore from backup** on the other device.
- Clearing your browser's site data erases the board. Make a backup now and then.

## Why it's fast

- No frameworks and no build step. The whole app is about 17 KB when compressed and loads instantly.
- A service worker caches the app, so it opens with no internet connection.
- Photos are resized on your device to two sizes: a 320 px thumbnail for the board and a 1600 px version for full-screen viewing. Only the thumbnails are loaded while you scroll.
- When something changes, the board redraws once per animation frame. Off-screen cards are skipped with `content-visibility`.
