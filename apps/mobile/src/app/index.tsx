import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, type ScannerEvent } from '../api/client';
import { Button, styles } from '../components/ui';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

const TZ = 'Africa/Banjul';

function when(e: ScannerEvent) {
  const now = Date.now();
  if (new Date(e.endDate).getTime() < now) return { text: 'Ended', live: false };
  if (new Date(e.startDate).getTime() <= now) return { text: 'On now', live: true };
  const d = new Date(e.startDate);
  return {
    text: d.toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    live: false,
  };
}

function roleLabel(role: string) {
  if (role === 'ORGANIZER') return null;
  const s = role.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function Events() {
  const { api, user, signOut, update } = useSession();
  const [events, setEvents] = useState<ScannerEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvents(await api.scannerEvents());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load events');
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.pad, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.line }]}>
        <View>
          <Text style={styles.h2}>Scanner</Text>
          <Text style={styles.muted}>{user?.fullName ?? user?.email}</Text>
        </View>
        <Button title="Sign out" kind="quiet" onPress={signOut} />
      </View>
      {update === 'suggested' && (
        <Text style={[styles.muted, { padding: 16, color: colors.accent }]}>A newer version of the app is available.</Text>
      )}
      <FlatList
        contentContainerStyle={{ padding: 16, gap: 10 }}
        data={events ?? []}
        keyExtractor={(e) => e.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ marginBottom: 6 }}>
            <Text style={styles.h1}>Choose an event</Text>
            {error && <Text style={[styles.error, { marginTop: 8 }]}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          events ? (
            <Text style={styles.muted}>You’re not assigned to any upcoming events. Ask the organizer to add you from their dashboard.</Text>
          ) : null
        }
        renderItem={({ item }) => {
          const w = when(item);
          const role = roleLabel(item.role);
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/scan/[eventId]', params: { eventId: item.id } })}
              style={({ pressed }) => ({ backgroundColor: colors.card, borderColor: pressed ? '#3a5a60' : colors.line, borderWidth: 1, borderRadius: 10, padding: 16 })}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={[styles.h2, { flex: 1 }]}>{item.name}</Text>
                <Text style={{ color: w.live ? colors.accent : colors.muted, fontSize: 13 }}>{w.text}</Text>
              </View>
              <Text style={[styles.muted, { marginTop: 4 }]}>
                {[item.venue.name, role, item.assignedGate?.name].filter(Boolean).join(', ')}
              </Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
