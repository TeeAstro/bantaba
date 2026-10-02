import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Where the backend is. In order:
//  1. EXPO_PUBLIC_API_URL, e.g. EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 npx expo start
//  2. During development: the same computer that serves the app to Expo Go,
//     on port 4000 — so on your Wi-Fi it usually just works with no setup.
//  3. localhost (only useful in a simulator on the same machine).
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:4000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

export const API_URL = resolveApiUrl();
export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
