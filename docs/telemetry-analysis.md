# Reading the results after the event

How to turn the seven events into the numbers this experiment was set up to
answer. Event and property names come from
[`src/lib/telemetry/types.ts`](../src/lib/telemetry/types.ts); nothing here
is a new concept.

Everything below groups by **`distinct_id`** (the device) or by
**`sid`** (one tab session — it survives a reload, dies with the tab). A
device may have several sessions.

## Before you trust any of it

Sanity checks first, in PostHog's event explorer:

- `app_open` count is non-zero and roughly matches your own sense of the day.
- No event carries `$current_url`, `$raw_user_agent`, or a real IP —
  `$ip` should read `0.0.0.0` on every event.
- No event carries anything photo-derived. There should be no filename,
  no dimensions, no MIME type. If you see one, stop and tell someone.
- The event names present are exactly: `app_open`, `source_click`,
  `photo_load`, `frame_select`, `export_attempt`, `export_result`,
  `app_error`. Anything else means autocapture leaked through.

## Reach

| Metric               | Where it comes from                                  |
| -------------------- | ---------------------------------------------------- |
| Unique devices       | distinct count of `distinct_id` on `app_open`        |
| Sessions             | distinct count of `sid` on `app_open`                |
| Estimated attendance | **supplied by you afterwards** — not measurable here |

**Say this out loud when you report it:** if 500 people attended and 85
devices opened the app, that is _not_ a 17% QR conversion rate. We do not
know how many attendees ever saw the QR code. The honest sentence is
"85 unique devices opened the app out of roughly 500 attendees," and the
gap between those numbers mixes together signage placement, foot traffic,
interest, and scanning friction — with no way to separate them from this
data.

Unique devices is also only approximate. It over-counts a person who scans
from Instagram or Snapchat (each in-app browser has its own storage) or in
private browsing, and under-counts a phone handed around a family.

## Engagement funnel

A PostHog funnel, ordered, grouped by `distinct_id`:

1. `app_open`
2. `source_click`
3. `photo_load` where `ok = true`
4. `frame_select`
5. `export_result` where `outcome = shared`

Step 4 is genuinely optional behaviour, not a failure — plenty of guests
will use the default frame and go straight to export. Read the 3 → 5
conversion as the real completion rate and treat 4 as a side question.

## Photo source: the main hypothesis

The product bet is that people prefer taking a good photo normally and
adding a frame afterwards, rather than a browser photo-booth. This is the
comparison that tests it. Build the same funnel twice, filtered on the
first step:

**Take a photo** — `source_click` where `source = camera` → `photo_load`
where `source = camera, ok = true` → `export_result` where
`outcome = shared`

**Camera roll** — the same with `source = library`.

Report counts and conversion at each stage for both.

### Clicked, but no photo arrived

Sessions with a `source_click` and no following `photo_load`. Worth
reporting per source, because it is a usability signal — but label it
**"clicked, no photo arrived"**, never "cancelled".

There is no browser event for dismissing a native file picker, so this is
inferred from absence. It also captures a guest who wandered off
mid-capture, and on a low-RAM iPhone it can capture the tab being evicted
while the camera was in front. Those are not separable.

### Backed out and tried the other one

Sessions containing both `source_click{camera}` and
`source_click{library}`. Order them by `seq` to see which came first.

## Frames

Denominator throughout: sessions that reached `photo_load{ok: true}`.
Including bounces would drag "never changed" toward 100% for the wrong
reason.

| Metric                       | Derivation                                                                  |
| ---------------------------- | --------------------------------------------------------------------------- |
| Never left the default       | sessions with a successful `photo_load` and **zero** `frame_select`         |
| Explored multiple            | sessions with ≥1 `frame_select`                                             |
| Frames previewed             | count of `frame_select` per session — mean and median                       |
| Distinct frames previewed    | distinct count of `frame` per session                                       |
| Returned to an earlier frame | a session whose `frame` sequence repeats a value                            |
| Final frame                  | `frame` on `export_result{outcome: shared}`, else the last `export_attempt` |

The default frame (`panther-prowl-2026`) never emits an event — that
absence _is_ the "never explored" signal. Re-tapping the already-active
frame is also silent, so these counts are real changes, not taps.

## Reliability

`export_result` broken down by `outcome`:

| Outcome       | Meaning                                             |
| ------------- | --------------------------------------------------- |
| `shared`      | The browser reported a successful hand-off          |
| `cancelled`   | The guest dismissed the share sheet                 |
| `unavailable` | This browser cannot share files at all              |
| `failed`      | Sharing broke — see `err` for the DOMException name |

Group by `platform` (from `app_open`, joined on `sid`) to see whether
failures cluster on one kind of device.

`app_error` separates "nobody was interested" from "the app was broken":
`overlay_load` means the frames never downloaded and the buttons stayed
disabled — a live risk on bad event Wi-Fi. `export_build` means compositing
failed.

### Three caveats that must travel with the success rate

1. **`shared` means the browser reported a successful hand-off, not that a
   photo reached the camera roll.** The OS never says which target was
   chosen, so sharing to Messages counts the same as Save Image.
2. **Android may over-report.** Some Chrome versions have resolved the
   share promise on dismissal, and some targets never report back. Treat
   Android's rate as an upper bound and keep it split out by platform.
3. **The download fallback has no success signal at all, and neither does
   "touch and hold to save".** `export_attempt{via: 'download'}` has no
   matching `export_result` because `link.click()` returns nothing
   observable. Guests who finished that way are invisible, so the measured
   completion rate is a **floor**, not an estimate.

Bad Wi-Fi also loses events silently while the app keeps working (assets
are already cached). That failure correlates with exactly the conditions
worth measuring, so read the whole funnel as a floor.

## Interpreting it

Set no thresholds in advance. The point is to tell these apart:

- **Low traffic, high completion** — the experience works; getting people to
  scan is the problem. Signage, placement, prompting.
- **High traffic, low completion** — the QR works; the product doesn't, or
  it's breaking. Check `app_error` and `export_result` before concluding
  it's a desirability problem.
- **High photo-load, high export, real frame exploration** — the core idea
  is working.
- **Camera roll strongly preferred** — supports the post-processing model.
- **Take a photo strongly preferred** — the founding assumption is wrong,
  and a live-capture experience may be worth more than we thought.
- **Most guests preview several frames** — multiple organizer frames earn
  their complexity.
- **Almost everyone keeps the default** — they don't, and one good frame
  would do.

The goal is to find out which of these is true, not to confirm the one we
already believe.
