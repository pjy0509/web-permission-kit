import packageJSON from "./package.json" assert {type: 'json'};
import PlatformKit from 'web-platform-kit';

declare global {
    interface Navigator {
        getUserMedia?(constraints?: MediaStreamConstraints): Promise<MediaStream>;

        webkitGetUserMedia?(constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback: (error: DOMException) => void): void;

        mozGetUserMedia?(constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback: (error: DOMException) => void): void;

        msGetUserMedia?(constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback: (error: DOMException) => void): void;
    }
}

type SupportedPermissionState = 'denied' | 'granted' | 'prompt';
type SafariDeviceSensorEventType = 'deviceorientation' | 'devicemotion';
type RequestPermission = () => Promise<SupportedPermissionState>;
type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & { requestPermission?: RequestPermission };
type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & { requestPermission?: RequestPermission };
type FocusEventKey = 'focus' | 'blur' | 'visibilitychange';
type PermissionSubscriber = (state: PermissionState) => void;
type Unsubscribe = () => void;

/**
 * Unified access point for the Web Permissions API.
 *
 * Bridges permission `check` / `request` / `subscribe` into one interface, with
 * fallbacks for legacy `getUserMedia`, iOS Safari sensor permissions, and browsers
 * that do not reliably dispatch permission `change` events.
 *
 * @remarks
 * `check` reflects stored state without prompting; `request` may prompt. Device
 * sensors (`DeviceOrientation` / `DeviceMotion`) require a user gesture to request
 * and cannot be observed via `subscribe`.
 *
 * @example
 * ```ts
 * const state = await PermissionKit.check(PermissionKit.Type.Camera);
 * if (state === PermissionKit.State.Prompt) {
 *   await PermissionKit.request(PermissionKit.Type.Camera);
 * }
 * ```
 */
export interface PermissionKitInstance {
    /**
     * Enum of permission types (alias of the named {@link PermissionType} export).
     */
    readonly Type: typeof PermissionType;

    /**
     * Enum of permission states (alias of the named {@link PermissionState} export).
     */
    readonly State: typeof PermissionState;

    /**
     * The installed package version.
     */
    readonly version: string;

    /**
     * Whether the Permissions Query API (`navigator.permissions`) exists in this environment.
     *
     * @remarks
     * When `false`, `check` resolves to `'unsupported'` for query-based types, though
     * `request` may still work through its fallbacks (e.g. `getUserMedia`).
     */
    get supported(): boolean;

    /**
     * Requests a permission, prompting the user when needed.
     *
     * @param type - The permission to request.
     * @returns The resulting state after the attempt: `'grant'`, `'denied'`, `'prompt'`, or `'unsupported'`.
     *
     * @remarks
     * Resolves immediately with `'grant'` when already granted. For device sensors on
     * iOS Safari, must be called inside a user-gesture handler or the underlying
     * `requestPermission()` rejects. `ClipboardWrite` is query-only — it returns the
     * queried state rather than forcing a prompt.
     */
    request(type: PermissionType): Promise<PermissionState>;

    /**
     * Reads the current permission state without prompting.
     *
     * @param type - The permission to inspect.
     * @returns The current state: `'grant'`, `'denied'`, `'prompt'`, or `'unsupported'`.
     *
     * @remarks
     * Safe to call on load to decide UI. For device sensors it probes gesture-free and
     * never triggers a prompt.
     */
    check(type: PermissionType): Promise<PermissionState>;

    /**
     * Observes permission state changes, invoking the callback once immediately and
     * again on every change.
     *
     * @param type - The permission to watch.
     * @param callback - Invoked with the current state on subscribe, then on each change. Repeated identical states are de-duplicated.
     * @returns An unsubscribe function that tears down all listeners.
     *
     * @remarks
     * Uses the native `PermissionStatus` `change` event where available, and also
     * re-checks when the page regains focus (some browsers, notably Safari, do not
     * fire `change` on settings edits). Sensors have no `PermissionStatus`, so
     * `subscribe` fires once with the current state and returns a no-op unsubscribe.
     */
    subscribe(type: PermissionType, callback: PermissionSubscriber): Unsubscribe;
}

interface SafariDeviceSensorEventMap {
    event: DeviceOrientationEventWithPermission | DeviceMotionEventWithPermission,
    type: SafariDeviceSensorEventType
}

interface FocusEventConfig {
    type: Partial<Record<FocusEventKey, string>>,
    target: Partial<Record<FocusEventKey, EventTarget>>
}

export enum PermissionType {
    Notification = 'notifications',
    Geolocation = 'geolocation',
    Camera = 'camera',
    ClipboardRead = 'clipboard-read',
    ClipboardWrite = 'clipboard-write',
    Microphone = 'microphone',
    MIDI = 'midi',
    DeviceOrientation = 'device-orientation',
    DeviceMotion = 'device-motion',
    PersistentStorage = 'persistent-storage',
}

export enum PermissionState {
    Grant = 'grant',
    Denied = 'denied',
    Prompt = 'prompt',
    Unsupported = 'unsupported',
}

const FOCUS_REFRESH_DEBOUNCE: number = 200;
const NAVIGATOR: Navigator | undefined = globalThis.navigator;
const PERMISSIONS: Permissions | undefined = typeof NAVIGATOR !== 'undefined' ? NAVIGATOR.permissions : undefined;
const NOTIFICATION: typeof Notification | undefined = globalThis.Notification;
const GEOLOCATION: Geolocation | undefined = typeof NAVIGATOR !== 'undefined' ? NAVIGATOR.geolocation : undefined;
const CLIPBOARD: Clipboard | undefined = typeof NAVIGATOR !== 'undefined' ? NAVIGATOR.clipboard : undefined;
const STORAGE: StorageManager | undefined = typeof NAVIGATOR !== 'undefined' ? NAVIGATOR.storage : undefined;

const getUserMedia: ((constraints?: MediaStreamConstraints) => Promise<MediaStream>) | undefined = (function (): ((constraints?: MediaStreamConstraints) => Promise<MediaStream>) | undefined {
    if (typeof NAVIGATOR.mediaDevices !== 'undefined' && typeof NAVIGATOR.mediaDevices.getUserMedia !== 'undefined') return NAVIGATOR.mediaDevices.getUserMedia.bind(NAVIGATOR.mediaDevices);

    const legacy: ((constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback: (error: DOMException) => void) => void) | undefined = (function (): ((constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback: (error: DOMException) => void) => void) | undefined {
        if (typeof NAVIGATOR.getUserMedia !== 'undefined') return NAVIGATOR.getUserMedia;
        if (typeof NAVIGATOR.webkitGetUserMedia !== 'undefined') return NAVIGATOR.webkitGetUserMedia;
        if (typeof NAVIGATOR.mozGetUserMedia !== 'undefined') return NAVIGATOR.mozGetUserMedia;
        if (typeof NAVIGATOR.msGetUserMedia !== 'undefined') return NAVIGATOR.msGetUserMedia;
    })();

    if (typeof legacy !== 'undefined') {
        return function legacyUserMedia(constraints: MediaStreamConstraints = {}) {
            return new Promise((resolve: (stream: MediaStream) => void, reject: (error: DOMException) => void) => {
                legacy.call(NAVIGATOR, constraints, resolve, reject);
            });
        }
    }
})();

function toPermissionState(permission: SupportedPermissionState | NotificationPermission): PermissionState {
    switch (permission) {
        case 'granted':
            return PermissionState.Grant;
        case 'denied':
            return PermissionState.Denied;
        case 'prompt':
        case 'default':
            return PermissionState.Prompt;
        default:
            return PermissionState.Unsupported;
    }
}

function toSafariSensorEventMap(type: PermissionType): SafariDeviceSensorEventMap | undefined {
    switch (type) {
        case PermissionType.DeviceOrientation:
            return {
                event: globalThis.DeviceOrientationEvent as DeviceOrientationEventWithPermission,
                type: 'deviceorientation',
            }
        case PermissionType.DeviceMotion:
            return {
                event: globalThis.DeviceMotionEvent as DeviceMotionEventWithPermission,
                type: 'devicemotion',
            }
        default:
            return undefined;
    }
}

function toDescriptor(type: PermissionType): PermissionDescriptor {
    switch (type) {
        case PermissionType.MIDI:
            return {name: type as PermissionName, sysex: true} as PermissionDescriptor;
        default:
            return {name: type as PermissionName};
    }
}

function getFocusContext(): { window: Window, document: Document } {
    const local: { window: Window, document: Document } = {window: globalThis.window, document: globalThis.document};

    try {
        const top: Window | null = globalThis.window.top;

        if (top === null) return local;

        return {window: top, document: top.document};
    } catch (_: unknown) {
        return local;
    }
}

function resolveFocusEventConfig(): FocusEventConfig {
    const context: { window: Window, document: Document } = getFocusContext();
    const top: Window = context.window;
    const topDocument: Document = context.document;
    const type: Partial<Record<FocusEventKey, string>> = {};
    const target: Partial<Record<FocusEventKey, EventTarget>> = {};

    const isCordova: boolean = typeof (globalThis as { cordova?: unknown }).cordova !== 'undefined';

    if (isCordova) {
        type.focus = 'resume';
        type.blur = 'pause';
        target.focus = topDocument;
        target.blur = topDocument;
    } else if (PlatformKit.os.name === 'ios') {
        if (PlatformKit.compareVersion(PlatformKit.os.version, '8.0') >= 0) {
            type.visibilitychange = 'visibilitychange';
            target.visibilitychange = topDocument;
        } else {
            type.focus = 'pageshow';
            type.blur = 'pagehide';
            target.focus = top;
            target.blur = top;
        }
    } else {
        type.focus = 'focus';
        type.blur = 'blur';
        type.visibilitychange = 'visibilitychange';
        target.focus = top;
        target.blur = top;
        target.visibilitychange = topDocument;
    }

    return {type: type, target: target};
}

function bindFocusRefresh(refresh: () => void): () => void {
    const config: FocusEventConfig = resolveFocusEventConfig();
    const bound: Array<{ target: EventTarget, type: string, handler: () => void }> = [];
    const keys: FocusEventKey[] = ['focus', 'visibilitychange'];

    for (let i: number = 0; i < keys.length; i++) {
        const key: FocusEventKey = keys[i];
        const type: string | undefined = config.type[key];
        const target: EventTarget | undefined = config.target[key];

        if (typeof type === 'undefined' || typeof target === 'undefined') continue;

        const handler: () => void = function (): void {
            if (key === 'visibilitychange' && (target as Document).visibilityState !== 'visible') return;

            refresh();
        };

        target.addEventListener(type, handler);
        bound.push({target: target, type: type, handler: handler});
    }

    return function (): void {
        for (let i: number = 0; i < bound.length; i++) bound[i].target.removeEventListener(bound[i].type, bound[i].handler);
    };
}

const PermissionKit: PermissionKitInstance = {
    Type: PermissionType,
    State: PermissionState,
    version: packageJSON.version,

    get supported(): boolean {
        return typeof PERMISSIONS !== 'undefined';
    },

    request(this: PermissionKitInstance, type: PermissionType): Promise<PermissionState> {
        const instance: PermissionKitInstance = this;

        return new Promise(function (resolve: (status: PermissionState) => void, reject: (error: unknown) => void): void {
            function resolveAfterCheck(): void {
                instance
                    .check(type)
                    .then(resolve);
            }

            instance
                .check(type)
                .then(function (state: PermissionState): void {
                    if (state === PermissionState.Grant) return resolve(state);

                    switch (type) {
                        case PermissionType.Notification:
                            if (typeof NOTIFICATION === 'undefined') return resolve(PermissionState.Unsupported);

                            const result: Promise<NotificationPermission> | undefined = NOTIFICATION
                                .requestPermission(
                                    function (permission: NotificationPermission): void {
                                        resolve(toPermissionState(permission));
                                    }
                                );

                            if (Object.prototype.toString.call(result) === '[object Promise]') {
                                result
                                    .then(function (permission: NotificationPermission): void {
                                        resolve(toPermissionState(permission));
                                    });
                            }

                            break;
                        case PermissionType.Geolocation:
                            if (typeof GEOLOCATION === 'undefined') return resolve(PermissionState.Unsupported);

                            GEOLOCATION
                                .getCurrentPosition(resolveAfterCheck, resolveAfterCheck);

                            break;
                        case PermissionType.Microphone:
                        case PermissionType.Camera:
                            if (typeof getUserMedia === 'undefined') return resolve(PermissionState.Unsupported);

                            getUserMedia({
                                video: type === PermissionType.Camera,
                                audio: type === PermissionType.Microphone,
                            })
                                .then(function (stream: MediaStream): void {
                                    const tracks: MediaStreamTrack[] = stream.getTracks();

                                    for (let i: number = 0; i < tracks.length; i++) tracks[i].stop();

                                    resolveAfterCheck();
                                })
                                .catch(resolveAfterCheck);

                            break;
                        case PermissionType.ClipboardRead:
                            if (typeof CLIPBOARD === 'undefined' || typeof CLIPBOARD.read === 'undefined') return resolve(PermissionState.Unsupported);

                            CLIPBOARD
                                .read()
                                .then(resolveAfterCheck)
                                .catch(resolveAfterCheck);

                            break;
                        case PermissionType.ClipboardWrite:
                            if (typeof CLIPBOARD === 'undefined' || typeof CLIPBOARD.write === 'undefined') return resolve(PermissionState.Unsupported);

                            resolveAfterCheck();

                            break;
                        case PermissionType.MIDI:
                            if (typeof NAVIGATOR.requestMIDIAccess === 'undefined') return resolve(PermissionState.Unsupported);

                            NAVIGATOR
                                .requestMIDIAccess({sysex: true})
                                .then(resolveAfterCheck)
                                .catch(resolveAfterCheck);

                            break;
                        case PermissionType.PersistentStorage:
                            if (typeof STORAGE === 'undefined' || typeof STORAGE.persist === 'undefined') return resolve(PermissionState.Unsupported);

                            STORAGE
                                .persist()
                                .then(resolveAfterCheck)
                                .catch(resolveAfterCheck);

                            break;
                        case PermissionType.DeviceOrientation:
                        case PermissionType.DeviceMotion:
                            const sensorEventMap: SafariDeviceSensorEventMap | undefined = toSafariSensorEventMap(type);

                            if (typeof sensorEventMap === 'undefined' || typeof sensorEventMap.event === 'undefined') return resolve(PermissionState.Unsupported);
                            if (typeof sensorEventMap.event.requestPermission !== 'function') return resolve(PermissionState.Grant);

                            try {
                                sensorEventMap
                                    .event
                                    .requestPermission()
                                    .then(function (permission: SupportedPermissionState): void {
                                        resolve(toPermissionState(permission));
                                    })
                                    .catch(reject);
                            } catch (e: unknown) {
                                return reject(e);
                            }

                            break;
                        default:
                            return resolve(PermissionState.Unsupported);
                    }
                });
        });
    },

    check(this: PermissionKitInstance, type: PermissionType): Promise<PermissionState> {
        if (type === PermissionType.DeviceOrientation || type === PermissionType.DeviceMotion) {
            return new Promise<PermissionState>(function (resolve: (status: PermissionState) => void): void {
                const sensorEventMap: SafariDeviceSensorEventMap | undefined = toSafariSensorEventMap(type);

                if (typeof sensorEventMap === 'undefined' || typeof sensorEventMap.event === 'undefined') return resolve(PermissionState.Unsupported);
                if (typeof sensorEventMap.event.requestPermission !== 'function') return resolve(PermissionState.Grant);

                let granted: boolean = false;

                function listener(): void {
                    granted = true;
                }

                globalThis.addEventListener(sensorEventMap.type, listener, {once: true});

                globalThis.setTimeout(function (): void {
                    globalThis.removeEventListener(sensorEventMap.type, listener);

                    if (granted) return resolve(PermissionState.Grant);

                    sensorEventMap
                        .event
                        .requestPermission!()
                        .then(function (permission: SupportedPermissionState): void {
                            resolve(toPermissionState(permission));
                        })
                        .catch(function () {
                            resolve(PermissionState.Prompt);
                        });
                }, 50);
            });
        }

        return new Promise(function (resolve: (status: PermissionState) => void): void {
            if (typeof PERMISSIONS === 'undefined') return resolve(PermissionState.Unsupported);

            PERMISSIONS
                .query(toDescriptor(type))
                .then(function (status: PermissionStatus): void {
                    return resolve(toPermissionState(status.state));
                })
                .catch(function (): void {
                    resolve(PermissionState.Unsupported);
                });
        });
    },

    subscribe(this: PermissionKitInstance, type: PermissionType, callback: PermissionSubscriber): Unsubscribe {
        const instance: PermissionKitInstance = this;

        if (typeof PERMISSIONS === 'undefined' || type === PermissionType.DeviceOrientation || type === PermissionType.DeviceMotion) {
            instance
                .check(type)
                .then(callback);

            return function (): void {
            };
        }

        let active: boolean = true;
        let last: PermissionState | undefined = undefined;
        let status: PermissionStatus | undefined = undefined;
        let timer: ReturnType<typeof globalThis.setTimeout> | undefined = undefined;

        function emit(state: PermissionState): void {
            if (!active || state === last) return;

            last = state;
            callback(state);
        }

        function onStatusChange(): void {
            if (typeof status !== 'undefined') emit(toPermissionState(status.state));
        }

        function refresh(): void {
            if (!active) return;
            if (typeof timer !== 'undefined') globalThis.clearTimeout(timer);

            timer = globalThis.setTimeout(function (): void {
                timer = undefined;

                if (active) instance.check(type).then(emit);
            }, FOCUS_REFRESH_DEBOUNCE);
        }

        const unbindFocus: () => void = bindFocusRefresh(refresh);

        PERMISSIONS
            .query(toDescriptor(type))
            .then(function (s: PermissionStatus): void {
                if (!active) return;

                status = s;
                s.addEventListener('change', onStatusChange);
                emit(toPermissionState(s.state));
            })
            .catch(function (): void {
                emit(PermissionState.Unsupported);
            });

        return function unsubscribe(): void {
            active = false;

            if (typeof timer !== 'undefined') globalThis.clearTimeout(timer);
            if (typeof status !== 'undefined') status.removeEventListener('change', onStatusChange);

            unbindFocus();
        };
    }
}

export default PermissionKit;
