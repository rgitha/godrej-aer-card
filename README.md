# Card for Godrej Aer Smart Matic

A Home Assistant dashboard card for a Godrej Aer Smart Matic, through the
[godrej_aer](https://github.com/rgitha/godrej_aer) integration: its status,
Spray now, Auto spray, and the spray schedules stored on the device.

Forked from [ov1d1u/godrej_aer integration](https://github.com/ov1d1u/godrej_aer).

## Requirements

- The [rgitha/godrej_aer](https://github.com/rgitha/godrej_aer) integration with
  schedule support. It may also work with its upstream [ov1d1u/godrej_aer integration](https://github.com/ov1d1u/godrej_aer).

## Installation

### HACS

1. In HACS, open the menu and choose **Custom repositories**.
2. Add `https://github.com/rgitha/godrej-aer-card` as a **Dashboard**.
3. Install **Card for Godrej Aer Smart Matic** and reload the browser.

### Manual

Copy `godrej-aer-card.js` to `config/www/`, then add it as a dashboard
resource: `/local/godrej-aer-card.js`, type **JavaScript module**.

## Usage

Add the card from the card picker and choose the device, or in YAML:

```yaml
type: custom:godrej-aer-card
device: <your Smart Matic device>
```

| Option | Required | Description |
|---|---|---|
| `device` | yes | The Smart Matic device. |
| `title` | no | Card title. Defaults to the device name. |
| `show_schedules` | no | Show every schedule on the card instead of one line. |

## What it shows

- **Header:** the device name and its area, with Refresh and a ⋮ menu
  (Reset refill level, Identify).
- **Status strip:** the mode (Idle, Auto, Schedule or Disconnected), battery,
  refill, and when the status was read. Tap battery or refill for their details. The battery turns red
  below 20 %.
- **Spray now** and **Auto** (Off, 10, 20 or 40 minutes). While a schedule
  runs, Auto is greyed out: the device ignores it, and tapping it shows why.
- **Schedules:** one line, always the same height: the running schedule with
  **Skip**, or the next one ("Next 07:00 – 10:00 · today"). **Show all** opens
  the schedules pop-up. With `show_schedules: true`, every schedule is shown
  instead, and a running one is marked inside its row, so the card never
  changes height by itself.
- When the device can't be reached, everything is greyed out under a notice.

### Editing schedules

Schedules are edited in a pop-up: **Show all** or **Edit**, or tap a
schedule. On a phone it fills the screen.

- Tap a schedule to edit it in place; the rest is greyed out until you press
  Done or Cancel.
- Days (or Weekdays, Weekends, Every day), start and end (or Morning,
  Afternoon, Evening) and the interval. The end is rounded down to a whole
  interval, shown as you edit: "Ends at 10:00 (9 sprays)". An end at or before
  the start runs into the next day, up to 24 hours, and shows as "(+1)".
  Overlaps (including into the next day) and more than 10 schedules are
  refused.
- Edits stay in the pop-up until you press **Save**, which writes the whole
  list to the device. If the device's schedules changed meanwhile, it asks
  whether to keep them or overwrite them. Closing with unsaved changes asks
  first.
- While a schedule runs, the editor warns that saving will interrupt it: the
  device replaces the whole list. A schedule covering the current time starts
  again within about a minute, with a spray.

## Disclaimer

This is an independent project. It is not affiliated with or endorsed by Godrej.

## License

Apache License 2.0. See [LICENSE](LICENSE).
