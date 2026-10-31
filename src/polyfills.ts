/**
 * The newer built-ins the app calls that iOS 15.0 to 15.3 do not have.
 *
 * The App Store build installs on iOS 15.0 (IPHONEOS_DEPLOYMENT_TARGET in
 * ios/App), and WebKit only added these in 15.4. The bundler lowers new
 * syntax but never adds a missing method, so on those phones the app threw
 * before it drew anything: App.tsx calls crypto.randomUUID() while its
 * module loads, and the launch load reads its drafts with .at(-1).
 *
 * Each is added only where it is missing, and not enumerable, as the
 * built-ins are not, so a for…in over an array or an object finds nothing
 * new. main.tsx imports this before anything else. Anything newer the app
 * starts to call belongs here too, or the test beside this file says so.
 */
export function installPolyfills(): void {
  if (!('at' in Array.prototype)) {
    define(Array.prototype, 'at', function at(this: unknown[], index: number) {
      const i = Math.trunc(index) || 0;
      const k = i < 0 ? this.length + i : i;
      return k < 0 || k >= this.length ? undefined : this[k];
    });
  }
  if (!('hasOwn' in Object)) {
    // hasOwnProperty throws for null and undefined, as hasOwn does.
    define(Object, 'hasOwn', (object: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(object, key));
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
    define(crypto, 'randomUUID', () => {
      // RFC 9562 version 4: random, with the version and variant bits set.
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    });
  }
}

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false });
}

installPolyfills();
