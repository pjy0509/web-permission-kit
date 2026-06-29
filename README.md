![npm](https://img.shields.io/npm/v/web-permission)
![bundle size](https://img.shields.io/bundlephobia/minzip/web-permission)
![types](https://img.shields.io/npm/types/web-permission)

# web-permission

A tiny TypeScript library that bridges the Web Permissions API to a unified
`check` / `request` / `subscribe` interface, with fallbacks for legacy
`getUserMedia`, iOS Safari sensor permissions, and browsers that don't reliably
dispatch permission `change` events.

```bash
npm install web-permission
```

## API at a glance

| Member | Signature | Description |
| --- | --- | --- |
| `Permission.supported` | `boolean` (getter) | Whether `navigator.permissions` (the Query API) exists |
| `Permission.version` | `string` | The installed package version |
| `Permission.check(type)` | `Promise<PermissionState>` | Reads the current state **without** prompting |
| `Permission.request(type)` | `Promise<PermissionState>` | Requests the permission, prompting if needed |
| `Permission.subscribe(type, cb)` | `() => void` | Observes state changes; returns an unsubscribe function |
| `Permission.Type` | `PermissionType` | Enum of permission types (alias of the named export) |
| `Permission.State` | `PermissionState` | Enum of states (alias of the named export) |

`PermissionState` resolves to one of: `"grant"`, `"denied"`, `"prompt"`, `"unsupported"`.

`PermissionType` members: `Notification`, `Geolocation`, `Camera`, `Microphone`,
`ClipboardRead`, `ClipboardWrite`, `MIDI`, `DeviceOrientation`, `DeviceMotion`,
`PersistentStorage`.

---

## ESM

```js
import Permission, { PermissionType, PermissionState } from 'web-permission'

// Read the current state without prompting the user
const state = await Permission.check(PermissionType.Camera)
console.log(state) // "grant" | "denied" | "prompt" | "unsupported"

// Request the permission (prompts only when needed)
if (state !== PermissionState.Grant) {
  const result = await Permission.request(PermissionType.Microphone)
  if (result === PermissionState.Grant) {
    // start capturing
  }
}

// The enums are also reachable off the singleton, so the named imports are optional
await Permission.check(Permission.Type.Geolocation)
```

## CommonJS

The bundle is built with `exports: "named"`, so the singleton lives under `.default`:

```js
const { default: Permission, PermissionType, PermissionState } = require('web-permission')

Permission.check(PermissionType.Geolocation).then((state) => {
  if (state === PermissionState.Prompt) {
    return Permission.request(PermissionType.Geolocation)
  }
})
```

## UMD (browser `<script>`)

The global `Permission` is a namespace object. The singleton is `Permission.default`;
the enums are `Permission.PermissionType` / `Permission.PermissionState`.

```html
<script src="https://unpkg.com/web-permission/dist/permission.umd.min.js"></script>
<script>
  var perm = window.Permission.default
  var Type = window.Permission.PermissionType

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
type). The instance shape is exported as `PermissionInstance`.

```ts
import Permission, {
  PermissionType,
  PermissionState,
  type PermissionInstance,
} from 'web-permission'

async function ensure(type: PermissionType): Promise<boolean> {
  const state: PermissionState = await Permission.check(type)

  if (state === PermissionState.Grant) return true
  if (state === PermissionState.Denied || state === PermissionState.Unsupported) return false

  // state === Prompt → ask
  return (await Permission.request(type)) === PermissionState.Grant
}

const granted = await ensure(PermissionType.Camera)
```

## Observing changes

`subscribe` watches a permission and calls your callback whenever the state
changes. It returns an **unsubscribe** function — call it to tear everything down.

```js
import Permission, { PermissionType } from 'web-permission'

// Fires once immediately with the current state, then again on every change.
const unsubscribe = Permission.subscribe(PermissionType.Camera, (state) => {
  console.log('camera permission is now', state)
})

// Stop listening
unsubscribe()
```

In CommonJS / UMD the method lives on the singleton:
`require('web-permission').default.subscribe(...)` /
`window.Permission.default.subscribe(...)`.

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
  `PermissionStatus`, so `subscribe` fires once with the current state and returns
  a no-op unsubscribe.

---

## Notes

- **`check` never prompts; `request` may.** `check` reflects the stored state, so
  call it on load to decide your UI; call `request` from the action that needs access.
- **Device sensors need a user gesture.** On iOS Safari, `request(DeviceOrientation)`
  and `request(DeviceMotion)` must be triggered inside a click/tap handler, otherwise
  the underlying `requestPermission()` rejects.
- **`ClipboardWrite` is query-only.** Write access can't be prompted without clobbering
  the clipboard, so `request(ClipboardWrite)` returns the queried state rather than
  forcing a prompt. The actual `clipboard.write()` may still succeed inside a gesture
  even when `check` reports `prompt`/`unsupported`.
- **`.default` in CJS/UMD** is a consequence of keeping both a default and named
  exports. To drop it, switch the entry to fully-named exports and rebuild.
