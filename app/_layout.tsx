import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#6B46C1',
          },
          headerTintColor: Platform.OS === 'ios' ? '#007AFF' : '#fff',
          headerTitleStyle: {
            fontWeight: Platform.OS === 'ios' ? '600' : '700',
            fontSize: Platform.OS === 'ios' ? 17 : 20,
            letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
          },
          headerShadowVisible: false,
          headerLargeTitle: Platform.OS === 'ios',
          headerLargeTitleStyle: {
            fontWeight: '700',
            fontSize: 34,
            letterSpacing: Platform.OS === 'ios' ? 0.4 : 0,
          },
          headerLargeTitleShadowVisible: false,
          headerBlurEffect: Platform.OS === 'ios' ? 'systemChromeMaterial' : undefined,
          headerTransparent: Platform.OS === 'ios' ? false : false,
          animation: Platform.OS === 'ios' ? 'default' : 'fade',
          contentStyle: {
            backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F9FAFB',
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Shows',
            headerLargeTitle: Platform.OS === 'ios',
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings',
            presentation: Platform.OS === 'ios' ? 'modal' : 'card',
            headerLargeTitle: false,
          }}
        />
        <Stack.Screen
          name="show/[id]"
          options={{
            title: 'Show Details',
            headerBackTitle: Platform.OS === 'ios' ? 'Shows' : undefined,
            headerLargeTitle: false,
          }}
        />
      </Stack>
    </>
  );
}
