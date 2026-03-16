/**
 * Ambient type shims for React Native / Expo packages that are not installed
 * in the web-only devcontainer. These stub declarations silence "cannot find
 * module" errors in VS Code without affecting the actual Expo / EAS build,
 * which uses its own full dependency tree.
 */

declare module 'react-native';

// expo-router: minimal signatures for the generic helpers used in the codebase
declare module 'expo-router' {
  import type React from 'react';
  type AnyProps = { [key: string]: any };
  export function useLocalSearchParams<T extends Record<string, string | string[]> = Record<string, string | string[]>>(): Partial<T>;
  export function useRouter(): {
    back(): void;
    push(href: string): void;
    replace(href: string): void;
  };
  export const Stack: React.ComponentType<AnyProps> & {
    Screen: React.ComponentType<AnyProps>;
  };
  export const Link: React.ComponentType<AnyProps>;
  export const Redirect: React.ComponentType<AnyProps>;
  export const Tabs: React.ComponentType<AnyProps> & {
    Screen: React.ComponentType<AnyProps>;
  };
  export function useFocusEffect(effect: () => void | (() => void)): void;
}

declare module 'expo-image-picker';
declare module 'expo-document-picker';
declare module 'expo-status-bar';
declare module 'expo-print';
declare module 'expo-sharing';
declare module '@react-native-async-storage/async-storage';
