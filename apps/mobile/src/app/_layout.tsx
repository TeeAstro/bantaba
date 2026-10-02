import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../lib/session';
import { Centered, Loading, styles } from '../components/ui';
import { Text } from 'react-native';
import { colors } from '../lib/theme';

function Gate() {
  const { status, update } = useSession();
  if (status === 'loading') return <Loading />;
  if (update === 'required') {
    return (
      <Centered>
        <Text style={styles.h1}>Update required</Text>
        <Text style={[styles.muted, { marginTop: 8, textAlign: 'center' }]}>
          This version of the app is no longer supported. Install the latest version to keep scanning.
        </Text>
      </Centered>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="index" />
        <Stack.Screen name="scan/[eventId]" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
