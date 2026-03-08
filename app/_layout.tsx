import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#F2F2F7',
          },
          headerTintColor: '#007AFF',
          headerTitleStyle: {
            fontWeight: '600',
            fontSize: 17,
            letterSpacing: -0.4,
          },
          headerShadowVisible: false,
          headerLargeTitle: true,
          headerLargeTitleStyle: {
            fontWeight: '700',
            fontSize: 34,
            letterSpacing: 0.4,
          },
          headerLargeTitleShadowVisible: false,
          headerBlurEffect: 'systemChromeMaterial',
          headerTransparent: false,
          animation: 'default',
          contentStyle: {
            backgroundColor: '#F2F2F7',
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Shows',
            headerLargeTitle: true,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings',
            presentation: 'modal',
            headerLargeTitle: false,
          }}
        />
        <Stack.Screen
          name="show/[id]"
          options={{
            title: 'Show Details',
            headerBackTitle: 'Shows',
            headerLargeTitle: false,
          }}
        />
      </Stack>
    </>
  );
}
