import packageJSON from "./package.json" with {type: 'json'};
import PlatformKit from 'web-platform-kit';

declare const global: unknown;

type LegacyUserMedia = (constraints: MediaStreamConstraints, successCallback: (stream: MediaStream) => void, errorCallback: (error: DOMException) => void) => void;

interface NavigatorLike extends Partial<Navigator> {
    getUserMedia?(constraints?: MediaStreamConstraints): Promise<MediaStream>;

    webkitGetUserMedia?: LegacyUserMedia;

    mozGetUserMedia?: LegacyUserMedia;

    msGetUserMedia?: LegacyUserMedia;
}

interface GlobalLike {
    navigator?: NavigatorLike;
    window?: Window;
    document?: Document;
    cordova?: unknown;
    Notification?: typeof Notification;
    DeviceOrientationEvent?: DeviceOrientationEventWithPermission;
    DeviceMotionEvent?: DeviceMotionEventWithPermission;

    addEventListener?(type: string, listener: () => void, options?: { once?: boolean }): void;

    removeEventListener?(type: string, listener: () => void): void;
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
 * `check` reads the current state without prompting; `request` may prompt. Device
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
     * Resolves immediately with `'grant'` when already granted. Never rejects — a request
     * that could not be made resolves to the best state available. For device sensors on
     * iOS Safari, call this inside a user-gesture handler; outside one the underlying
     * `requestPermission()` is refused and this resolves `'prompt'`. `ClipboardWrite` is
     * query-only — it returns the queried state rather than forcing a prompt.
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
     * `subscribe` fires once with the current state; unsubscribing before that first read
     * suppresses the callback.
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

function getGlobal(): GlobalLike {
    if (typeof globalThis !== 'undefined') return globalThis as GlobalLike;
    if (typeof self !== 'undefined') return self as GlobalLike;
    if (typeof window !== 'undefined') return window as GlobalLike;
    if (typeof global !== 'undefined') return global as GlobalLike;

    return {};
}

const GLOBAL: GlobalLike = getGlobal();

const NAVIGATOR: NavigatorLike | undefined = GLOBAL.navigator;
const PERMISSIONS: Permissions | undefined = typeof NAVIGATOR !== 'undefined' && NAVIGATOR !== null ? NAVIGATOR.permissions : undefined;
const NOTIFICATION: typeof Notification | undefined = GLOBAL.Notification;
const GEOLOCATION: Geolocation | undefined = typeof NAVIGATOR !== 'undefined' && NAVIGATOR !== null ? NAVIGATOR.geolocation : undefined;
const CLIPBOARD: Clipboard | undefined = typeof NAVIGATOR !== 'undefined' && NAVIGATOR !== null ? NAVIGATOR.clipboard : undefined;
const STORAGE: StorageManager | undefined = typeof NAVIGATOR !== 'undefined' && NAVIGATOR !== null ? NAVIGATOR.storage : undefined;

const getUserMedia: ((constraints?: MediaStreamConstraints) => Promise<MediaStream>) | undefined = (function (): ((constraints?: MediaStreamConstraints) => Promise<MediaStream>) | undefined {
    if (typeof NAVIGATOR === 'undefined' || NAVIGATOR === null) return undefined;
    if (typeof NAVIGATOR.mediaDevices !== 'undefined' && typeof NAVIGATOR.mediaDevices.getUserMedia !== 'undefined') return NAVIGATOR.mediaDevices.getUserMedia.bind(NAVIGATOR.mediaDevices);

    const legacy: LegacyUserMedia | undefined = (function (): LegacyUserMedia | undefined {
        if (typeof NAVIGATOR.getUserMedia !== 'undefined') return NAVIGATOR.getUserMedia as unknown as LegacyUserMedia;
        if (typeof NAVIGATOR.webkitGetUserMedia !== 'undefined') return NAVIGATOR.webkitGetUserMedia;
        if (typeof NAVIGATOR.mozGetUserMedia !== 'undefined') return NAVIGATOR.mozGetUserMedia;
        if (typeof NAVIGATOR.msGetUserMedia !== 'undefined') return NAVIGATOR.msGetUserMedia;

        return undefined;
    })();

    if (typeof legacy !== 'undefined') {
        return function legacyUserMedia(constraints: MediaStreamConstraints = {}): Promise<MediaStream> {
            return new Promise(function (resolve: (stream: MediaStream) => void, reject: (error: DOMException) => void): void {
                legacy.call(NAVIGATOR, constraints, resolve, reject);
            });
        };
    }

    return undefined;
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
                event: GLOBAL.DeviceOrientationEvent as DeviceOrientationEventWithPermission,
                type: 'deviceorientation',
            }
        case PermissionType.DeviceMotion:
            return {
                event: GLOBAL.DeviceMotionEvent as DeviceMotionEventWithPermission,
                type: 'devicemotion',
            }
        default:
            return undefined;
    }
}

function toDescriptor(type: PermissionType): PermissionDescriptor {
    return {name: type as PermissionName};
}

function getFocusContext(): { window: Window, document: Document } {
    const local: { window: Window, document: Document } = {window: GLOBAL.window as Window, document: GLOBAL.document as Document};

    try {
        const top: Window | null = (GLOBAL.window as Window).top;

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

    const isCordova: boolean = typeof GLOBAL.cordova !== 'undefined';

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

                            let settled: boolean = false;

                            const result: Promise<NotificationPermission> | undefined = NOTIFICATION
                                .requestPermission(
                                    function (permission: NotificationPermission): void {
                                        if (settled) return;

                                        settled = true;

                                        resolve(toPermissionState(permission));
                                    }
                                );

                            if (typeof result !== 'undefined' && result !== null && typeof result.then === 'function') {
                                result
                                    .then(function (permission: NotificationPermission): void {
                                        if (settled) return;

                                        settled = true;

                                        resolve(toPermissionState(permission));
                                    })
                                    .catch(function (): void {
                                        if (settled) return;

                                        settled = true;

                                        resolve(PermissionState.Unsupported);
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
                            if (typeof NAVIGATOR === 'undefined' || NAVIGATOR === null || typeof NAVIGATOR.requestMIDIAccess !== 'function') return resolve(PermissionState.Unsupported);

                            NAVIGATOR
                                .requestMIDIAccess()
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
                                    .catch(function (): void {
                                        resolve(PermissionState.Prompt);
                                    });
                            } catch (_: unknown) {
                                return resolve(PermissionState.Prompt);
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

                if (typeof GLOBAL.addEventListener !== 'function') return resolve(PermissionState.Prompt);

                let granted: boolean = false;

                function listener(): void {
                    granted = true;
                }

                GLOBAL.addEventListener(sensorEventMap.type, listener, {once: true});

                setTimeout(function (): void {
                    if (typeof GLOBAL.removeEventListener === 'function') GLOBAL.removeEventListener(sensorEventMap.type, listener);

                    if (granted) return resolve(PermissionState.Grant);

                    sensorEventMap
                        .event
                        .requestPermission!()
                        .then(function (permission: SupportedPermissionState): void {
                            resolve(toPermissionState(permission));
                        })
                        .catch(function (): void {
                            resolve(PermissionState.Prompt);
                        });
                }, 50);
            });
        }

        return new Promise(function (resolve: (status: PermissionState) => void): void {
            if (typeof PERMISSIONS === 'undefined') {
                if (type === PermissionType.PersistentStorage && typeof STORAGE !== 'undefined' && typeof STORAGE.persisted === 'function') {
                    STORAGE
                        .persisted()
                        .then(function (persisted: boolean): void {
                            resolve(persisted ? PermissionState.Grant : PermissionState.Prompt);
                        })
                        .catch(function (): void {
                            resolve(PermissionState.Unsupported);
                        });

                    return;
                }

                return resolve(PermissionState.Unsupported);
            }

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
            let subscribed: boolean = true;

            instance
                .check(type)
                .then(function (state: PermissionState): void {
                    if (subscribed) callback(state);
                });

            return function (): void {
                subscribed = false;
            };
        }

        let active: boolean = true;
        let last: PermissionState | undefined = undefined;
        let status: PermissionStatus | undefined = undefined;
        let timer: ReturnType<typeof setTimeout> | undefined = undefined;

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
            if (typeof timer !== 'undefined') clearTimeout(timer);

            timer = setTimeout(function (): void {
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

            if (typeof timer !== 'undefined') clearTimeout(timer);
            if (typeof status !== 'undefined') status.removeEventListener('change', onStatusChange);

            unbindFocus();
        };
    }
}

export default PermissionKit;
