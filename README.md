![npm](https://img.shields.io/npm/v/web-permission-kit)
![bundle size](https://img.shields.io/bundlephobia/minzip/web-permission-kit)
![types](https://img.shields.io/npm/types/web-permission-kit)

*English · [한국어](./README.ko.md)*

# web-permission-kit

A tiny TypeScript library that bridges the Web Permissions API to a unified
`check` / `request` / `subscribe` interface, with fallbacks for legacy
`getUserMedia`, iOS Safari sensor permissions, and browsers that don't reliably
dispatch permission `change` events.

```bash
npm install web-permission-kit
```

## API at a glance

`PermissionKit` is a singleton.

| Member                              | Signature | Description |
|-------------------------------------| --- | --- |
| `PermissionKit.supported`           | `boolean` (getter) | Whether `navigator.permissions` (the Query API) exists |
| `PermissionKit.version`             | `string` | The installed package version |
| `PermissionKit.check(type)`         | `Promise<PermissionState>` | Reads the current state **without** prompting |
| `PermissionKit.request(type)`       | `Promise<PermissionState>` | Requests the permission, prompting if needed |
| `PermissionKit.subscribe(type, cb)` | `() => void` | Observes state changes; returns an unsubscribe function. Sensors are not observable — see Notes |
| `PermissionKit.Type`                | `typeof PermissionType` | The enum object itself (alias of the named export) |
| `PermissionKit.State`               | `typeof PermissionState` | The enum object itself (alias of the named export) |

`PermissionState` resolves to one of: `"grant"`, `"denied"`, `"prompt"`, `"unsupported"`.

`PermissionType` members: `Notification`, `Geolocation`, `Camera`, `Microphone`,
`ClipboardRead`, `ClipboardWrite`, `MIDI`, `DeviceOrientation`, `DeviceMotion`,
`PersistentStorage`.

> **Nothing throws — failure is a state.** `check` and `request` always resolve, for every
> type, including the device sensors. A missing API resolves to `"unsupported"`; a request
> that could not be made resolves to the best answer available rather than rejecting.

---

## ESM

```js
import PermissionKit, { PermissionType, PermissionState } from 'web-permission-kit'

// Read the current state without prompting the user
const state = await PermissionKit.check(PermissionType.Camera)
console.log(state) // "grant" | "denied" | "prompt" | "unsupported"

// Request the permission (prompts only when needed)
if (state !== PermissionState.Grant) {
  const result = await PermissionKit.request(PermissionType.Microphone)
  if (result === PermissionState.Grant) {
    // start capturing
  }
}

// The enums are also reachable off the singleton, so the named imports are optional
await PermissionKit.check(PermissionKit.Type.Geolocation)
```

## CommonJS

The bundle is built with `exports: "named"`, so the singleton lives under `.default`:

```js
const { default: PermissionKit, PermissionType, PermissionState } = require('web-permission-kit')

PermissionKit.check(PermissionType.Geolocation).then((state) => {
  if (state === PermissionState.Prompt) {
    return PermissionKit.request(PermissionType.Geolocation)
  }
})
```

## UMD (browser `<script>`)

The global `PermissionKit` is a namespace object. The singleton is `PermissionKit.default`;
the enums are `PermissionKit.PermissionType` / `PermissionKit.PermissionState`.
The bundle is self-contained — no other scripts are required.

```html
<script src="https://unpkg.com/web-permission-kit/dist/permission-kit.umd.min.js"></script>
<script>
    var perm = window.PermissionKit.default
    var Type = window.PermissionKit.PermissionType

    perm.check(Type.ClipboardRead).then(function (state) {
        console.log(state)
    })

    // Device sensors must be requested from a user gesture (see Notes)
    document.querySelector('#enable').addEventListener('click', function () {
        perm.request(Type.DeviceOrientation).then(function (state) {
            console.log(state)
        })
    })
</script>
```

## TypeScript

`PermissionType` and `PermissionState` are string enums (usable as both value and
type). The instance shape is exported as `PermissionKitInstance`.

```ts
import PermissionKit, {
  PermissionType,
  PermissionState,
  type PermissionKitInstance,
} from 'web-permission-kit'

async function ensure(type: PermissionType): Promise<boolean> {
  const state: PermissionState = await PermissionKit.check(type)

  if (state === PermissionState.Grant) return true
  if (state === PermissionState.Denied || state === PermissionState.Unsupported) return false

  // state === Prompt → ask
  return (await PermissionKit.request(type)) === PermissionState.Grant
}

const granted = await ensure(PermissionType.Camera)
```

## Observing changes

`subscribe` watches a permission and calls your callback whenever the state
changes. It returns an **unsubscribe** function — call it to tear everything down.

```js
import PermissionKit, { PermissionType } from 'web-permission-kit'

// Fires once immediately with the current state, then again on every change.
const unsubscribe = PermissionKit.subscribe(PermissionType.Camera, (state) => {
  console.log('camera permission is now', state)
})

// Stop listening
unsubscribe()
```

In CommonJS / UMD the method lives on the singleton:
`require('web-permission-kit').default.subscribe(...)` /
`window.PermissionKit.default.subscribe(...)`.

### How it stays in sync

- The callback is invoked **once on subscribe** with the current state, then on
  every change. Repeated identical states are de-duplicated.
- It listens to the native `PermissionStatus` `change` event where available.
- Some browsers (notably Safari) don't reliably fire that event when the user
  flips a permission in settings, so the subscription **also re-checks when the
  page/app regains focus** — `visibilitychange` / `focus`, with Cordova
  `resume` and legacy iOS `pageshow` variants handled. Focus bursts are debounced,
  so a return to the tab triggers at most one re-check.
- **Sensors can't be observed.** `DeviceOrientation` / `DeviceMotion` have no
  `PermissionStatus`, so `subscribe` fires once with the current state. Unsubscribing
  before that first read still suppresses the callback.

---

## Notes

- **`check` never prompts; `request` may.** `check` asks the browser for the current
  permission state on every call. Use it on load to decide your UI; call `request` from
  the action that needs access.
- **Device sensors need a user gesture.** On iOS Safari the underlying
  `requestPermission()` only prompts from inside a click/tap handler. Call
  `request(DeviceOrientation)` / `request(DeviceMotion)` from one; outside a gesture it
  resolves `"prompt"` without asking.
- **`check` on sensors never prompts — by design.** iOS exposes no read-only query for
  them, so `check` first listens briefly for a sensor event (a granted sensor emits
  continuously, which proves access without asking) and only then falls through to
  `requestPermission()`. Outside a gesture that call is refused by the browser, which is
  exactly what keeps the dialog away. The trade-off is a ~50 ms delay per call.
- **Outside a gesture, a denied sensor reads as `"prompt"`.** The browser's refusal and a
  real denial arrive as the same rejection, and there is no read-only query to break the
  tie, so the two cannot be distinguished. Call `request` from a gesture to get the real
  answer. Nothing is cached — a permission the user flips in Settings takes effect on the
  next read.
- **MIDI is queried without `sysex`.** System-exclusive access is a separate, more alarming
  prompt, and asking for it would report `prompt` to a user who has already granted plain
  MIDI. If you need sysex, request it through `requestMIDIAccess({ sysex: true })` yourself.
- **`ClipboardWrite` is query-only.** Write access can't be prompted without clobbering
  the clipboard, so `request(ClipboardWrite)` returns the queried state rather than
  forcing a prompt. The actual `clipboard.write()` may still succeed inside a gesture
  even when `check` reports `prompt`/`unsupported`.
- **`.default` in CJS/UMD** is a consequence of keeping both a default and named
  exports. To drop it, switch the entry to fully-named exports and rebuild.

## Browser support

Runs down to **IE 9**.
