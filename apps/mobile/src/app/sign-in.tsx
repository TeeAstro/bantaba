import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../api/client';
import { Button, styles } from '../components/ui';
import { API_URL, APP_VERSION } from '../lib/config';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={styles.h1}>Sign in</Text>
        <Text style={[styles.muted, { marginTop: 6, marginBottom: 24 }]}>For event staff and organizers.</Text>
        {error && <Text style={[styles.error, { marginBottom: 12 }]} accessibilityRole="alert">{error}</Text>}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          value={email}
          onChangeText={setEmail}
        />
        <View style={{ height: 12 }} />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />
        <View style={{ height: 20 }} />
        <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={busy || !email || !password} />
        <Text style={[styles.muted, { marginTop: 32, fontSize: 12 }]}>Server {API_URL}, app version {APP_VERSION}</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
