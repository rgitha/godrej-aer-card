# Schedule card for Godrej Aer Smart Matic

A Home Assistant dashboard card to view and edit the spray schedules stored on a
Godrej Aer Smart Matic, through the
[godrej_aer](https://github.com/rgitha/godrej_aer) integration.

The schedules live on the device and run without Home Assistant. The card shows
them, lets you add, change and delete them, and saves the whole list in one go.

## Requirements

- The [rgitha/godrej_aer](https://github.com/rgitha/godrej_aer) integration with
  schedule support (the Schedules sensor and the schedule actions).

## Installation

### HACS

1. In HACS, open the menu and choose **Custom repositories**.
2. Add `https://github.com/rgitha/godrej-aer-schedule-card` as a **Dashboard**.
3. Install **Schedule card for Godrej Aer Smart Matic** and reload the browser.

### Manual

Copy `godrej-aer-schedule-card.js` to `config/www/`, then add it as a dashboard
resource: `/local/godrej-aer-schedule-card.js`, type **JavaScript module**.

## Usage

```yaml
type: custom:godrej-aer-schedule-card
entity: sensor.living_room_schedules
```

| Option | Required | Description |
|---|---|---|
| `entity` | yes | The device's **Schedules** sensor. |
| `title` | no | Card title. Defaults to the device name. |

## How it works

- **List:** each schedule with its window, interval and days. Tap one to edit
  it. The schedule running now is marked, with **Skip this run** (it runs again
  next time).
- **Editing:** days (or Weekdays, Weekends, Every day), start and end (or
  Morning, Afternoon, Evening) and the interval. The end is rounded down to a
  whole interval, shown as you edit: "Ends at 10:00 (9 sprays)". An end at or
  before the start runs into the next day, up to 24 hours, and shows as
  "(+1)". Overlaps (including into the next day) and more than 10 schedules
  are refused.
- **Saving:** edits stay in the card until you press **Save**, which writes the
  whole list to the device. If the device's schedules changed meanwhile (from
  another app, another dashboard or an automation), the card asks whether to
  keep the device's schedules or overwrite them. Unsaved edits are lost if the
  page is reloaded.
- **While a schedule runs,** the editor warns that saving any change stops it
  until its next start: the device replaces the whole list and starts a
  schedule only at its start time.
- **Refresh** reads the schedules from the device again.

## Disclaimer

This is an unofficial project. It is not affiliated with or endorsed by Godrej.

## License

Apache License 2.0. See [LICENSE](LICENSE).
