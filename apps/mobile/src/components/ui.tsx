import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
import { colors } from '../lib/theme';

export function Button({ title, kind = 'primary', ...rest }: PressableProps & { title: string; kind?: 'primary' | 'quiet' }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [styles.btn, kind === 'quiet' && styles.btnQuiet, (pressed || rest.disabled) && { opacity: 0.6 }]}
      {...rest}
    >
      <Text style={[styles.btnText, kind === 'quiet' && { color: colors.text }]}>{title}</Text>
    </Pressable>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function Loading() {
  return (
    <Centered>
      <ActivityIndicator color={colors.accent} />
    </Centered>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700' },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700' },
  body: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13 },
  error: { color: '#ff9b90', fontSize: 14 },
  input: { backgroundColor: colors.input, borderColor: colors.inputLine, borderWidth: 1, borderRadius: 6, color: colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  btn: { backgroundColor: colors.teal, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  btnQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.inputLine },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
