![npm](https://img.shields.io/npm/v/web-permission-kit)
![bundle size](https://img.shields.io/bundlephobia/minzip/web-permission-kit)
![types](https://img.shields.io/npm/types/web-permission-kit)

*[English](./README.md) · 한국어*

# web-permission-kit

Web Permissions API를 `check` / `request` / `subscribe` 하나의 인터페이스로 묶는 작은
TypeScript 라이브러리. 레거시 `getUserMedia`, iOS Safari 센서 권한, 그리고 권한 `change`
이벤트를 제대로 쏘지 않는 브라우저에 대한 폴백을 포함합니다.

```bash
npm install web-permission-kit
```

## API 한눈에 보기

`PermissionKit`은 싱글톤입니다.

| 멤버 | 시그니처 | 설명 |
|---| --- | --- |
| `PermissionKit.supported` | `boolean` (getter) | `navigator.permissions`(Query API) 존재 여부 |
| `PermissionKit.version` | `string` | 설치된 패키지 버전 |
| `PermissionKit.check(type)` | `Promise<PermissionState>` | 프롬프트 **없이** 현재 상태를 읽음 |
| `PermissionKit.request(type)` | `Promise<PermissionState>` | 권한을 요청하며, 필요하면 프롬프트 |
| `PermissionKit.subscribe(type, cb)` | `() => void` | 상태 변화를 관찰. 구독 해제 함수를 반환. 센서는 관찰 불가 — 참고 절 |
| `PermissionKit.Type` | `typeof PermissionType` | 열거형 객체 자체 (named export의 별칭) |
| `PermissionKit.State` | `typeof PermissionState` | 열거형 객체 자체 (named export의 별칭) |

`PermissionState`는 `"grant"`, `"denied"`, `"prompt"`, `"unsupported"` 중 하나입니다.

`PermissionType` 멤버: `Notification`, `Geolocation`, `Camera`, `Microphone`,
`ClipboardRead`, `ClipboardWrite`, `MIDI`, `DeviceOrientation`, `DeviceMotion`,
`PersistentStorage`.

> **아무것도 throw하지 않습니다 — 실패도 상태입니다.** `check`와 `request`는 디바이스 센서를
> 포함한 모든 타입에서 항상 resolve합니다. API가 없으면 `"unsupported"`로, 요청 자체가
> 불가능했으면 reject 대신 얻을 수 있는 최선의 답으로 resolve합니다.

---

## ESM

```js
import PermissionKit, { PermissionType, PermissionState } from 'web-permission-kit'

// 프롬프트 없이 현재 상태 읽기
const state = await PermissionKit.check(PermissionType.Camera)
console.log(state) // "grant" | "denied" | "prompt" | "unsupported"

// 권한 요청 (필요할 때만 프롬프트)
if (state !== PermissionState.Grant) {
  const result = await PermissionKit.request(PermissionType.Microphone)
  if (result === PermissionState.Grant) {
    // 캡처 시작
  }
}

// 열거형은 싱글톤에서도 꺼낼 수 있어 named import 는 선택입니다
await PermissionKit.check(PermissionKit.Type.Geolocation)
```

## CommonJS

번들이 `exports: "named"`로 빌드되어 싱글톤은 `.default` 아래에 있습니다.

```js
const { default: PermissionKit, PermissionType, PermissionState } = require('web-permission-kit')

PermissionKit.check(PermissionType.Geolocation).then((state) => {
  if (state === PermissionState.Prompt) {
    return PermissionKit.request(PermissionType.Geolocation)
  }
})
```

## UMD (브라우저 `<script>`)

전역 `PermissionKit`은 네임스페이스 객체입니다. 싱글톤은 `PermissionKit.default`이고,
열거형은 `PermissionKit.PermissionType` / `PermissionKit.PermissionState`입니다.
번들은 자체 완결형이라 다른 스크립트가 필요 없습니다.

```html
<script src="https://unpkg.com/web-permission-kit/dist/permission-kit.umd.min.js"></script>
<script>
    var perm = window.PermissionKit.default
    var Type = window.PermissionKit.PermissionType

    perm.check(Type.ClipboardRead).then(function (state) {
        console.log(state)
    })

    // 디바이스 센서는 사용자 제스처 안에서 요청해야 합니다 (참고 절)
    document.querySelector('#enable').addEventListener('click', function () {
        perm.request(Type.DeviceOrientation).then(function (state) {
            console.log(state)
        })
    })
</script>
```

## TypeScript

`PermissionType`과 `PermissionState`는 문자열 열거형이라 값으로도 타입으로도 쓸 수 있습니다.
인스턴스의 형태는 `PermissionKitInstance`로 export됩니다.

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

  // state === Prompt → 요청
  return (await PermissionKit.request(type)) === PermissionState.Grant
}

const granted = await ensure(PermissionType.Camera)
```

## 변화 관찰

`subscribe`는 권한을 감시하다가 상태가 바뀔 때마다 콜백을 호출합니다. **구독 해제** 함수를
반환하니, 호출해서 전부 정리하세요.

```js
import PermissionKit, { PermissionType } from 'web-permission-kit'

// 구독 시 현재 상태로 한 번 호출되고, 이후 변화마다 호출됩니다.
const unsubscribe = PermissionKit.subscribe(PermissionType.Camera, (state) => {
  console.log('카메라 권한이 지금', state)
})

// 관찰 중단
unsubscribe()
```

CommonJS / UMD에서는 싱글톤에 메서드가 있습니다:
`require('web-permission-kit').default.subscribe(...)` /
`window.PermissionKit.default.subscribe(...)`.

### 어떻게 동기화되는가

- 콜백은 **구독 시 한 번** 현재 상태로 호출되고, 이후 변화마다 호출됩니다. 같은 상태가
  연달아 오면 중복 제거됩니다.
- 가능하면 네이티브 `PermissionStatus`의 `change` 이벤트를 씁니다.
- 일부 브라우저(특히 Safari)는 사용자가 설정에서 권한을 바꿔도 그 이벤트를 제대로 쏘지
  않습니다. 그래서 구독은 **페이지/앱이 포커스를 되찾을 때도 다시 확인**합니다 —
  `visibilitychange` / `focus`, Cordova의 `resume`, 레거시 iOS의 `pageshow`까지 처리합니다.
  포커스가 몰려 들어오는 구간은 디바운스되어 탭 복귀당 최대 한 번만 재확인합니다.
- **센서는 관찰할 수 없습니다.** `DeviceOrientation` / `DeviceMotion`에는 `PermissionStatus`가
  없어서 `subscribe`는 현재 상태로 한 번만 호출됩니다. 그 첫 읽기 전에 구독을 해제하면
  콜백도 억제됩니다.

---

## 참고

- **`check`는 절대 프롬프트하지 않고, `request`는 할 수 있습니다.** `check`는 매번 브라우저에
  현재 권한 상태를 물어봅니다. 로드 시 UI를 정하는 데 쓰고, `request`는 접근이 필요한 동작에서
  호출하세요.
- **디바이스 센서는 사용자 제스처가 필요합니다.** iOS Safari에서 내부의
  `requestPermission()`은 클릭/탭 핸들러 안에서만 프롬프트를 띄웁니다.
  `request(DeviceOrientation)` / `request(DeviceMotion)`을 그 안에서 호출하세요. 제스처 밖에서는
  묻지 않고 `"prompt"`로 resolve합니다.
- **센서에 대한 `check`가 프롬프트하지 않는 것은 의도된 설계입니다.** iOS에는 센서를 읽기
  전용으로 조회할 방법이 없습니다. 그래서 `check`는 먼저 센서 이벤트를 잠깐 듣고(허용된
  센서는 계속 이벤트를 쏘므로, 묻지 않고도 접근 가능함이 증명됩니다), 그 다음에야
  `requestPermission()`으로 넘어갑니다. 제스처 밖에서는 브라우저가 이 호출을 거부하는데,
  바로 그것이 다이얼로그를 막아줍니다. 대가는 호출당 약 50ms의 지연입니다.
- **제스처 밖에서는 거부된 센서가 `"prompt"`로 읽힙니다.** 브라우저의 거부와 실제 사용자
  거부가 같은 rejection으로 도착하고, 이를 가려낼 읽기 전용 질의가 없어 구분이 불가능합니다.
  실제 답이 필요하면 제스처 안에서 `request`를 호출하세요. 캐시는 하지 않습니다 — 사용자가
  설정에서 바꾼 권한은 다음 읽기에 바로 반영됩니다.
- **MIDI는 `sysex` 없이 질의합니다.** System-exclusive 접근은 별개의 더 무거운 프롬프트이고,
  이를 요구하면 일반 MIDI를 이미 허용한 사용자에게 `prompt`를 보고하게 됩니다. sysex가
  필요하면 `requestMIDIAccess({ sysex: true })`를 직접 호출하세요.
- **`ClipboardWrite`는 질의 전용입니다.** 쓰기 권한은 클립보드를 덮어쓰지 않고서는 물어볼 수
  없어서, `request(ClipboardWrite)`는 프롬프트를 강제하지 않고 질의된 상태를 반환합니다.
  `check`가 `prompt`/`unsupported`를 보고해도 제스처 안에서의 실제 `clipboard.write()`는
  성공할 수 있습니다.
- **CJS/UMD의 `.default`** 는 default와 named export를 함께 유지한 결과입니다. 없애려면 엔트리를
  전부 named export로 바꾸고 다시 빌드하세요.

## 브라우저 지원

**IE 9**까지 동작합니다.
