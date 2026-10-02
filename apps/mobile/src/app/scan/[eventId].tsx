import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, Text, TextInput, View, Platform } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, type CheckInResponse, type ScanProgress, type ScannerEvent, type ServerTiming } from '../../api/client';
import { Button, Loading, styles } from '../../components/ui';
import { APP_VERSION } from '../../lib/config';
import { useSession } from '../../lib/session';
import { colors, toneColor } from '../../lib/theme';
import { clearSamples, recordSample, report, summarize, type TimingSummary } from '../../lib/timing';
import { verdict } from '../../lib/verdict';

// A code counts once per presentation: ignored while it stays in view, and
// only counts again after it's been out of view this long (same rule as the
// web scanner — someone just let in who keeps holding their phone up isn't
// re-scanned into "Already scanned").
const GONE_MS = 1500;
// How long a verdict stays up before the next code is taken.
const HOLD_MS = 1200;

type Shown = { kind: 'result'; r: CheckInResponse } | { kind: 'error'; message: string } | null;

// The camera is memoised with a stable callback so the rest of the screen
// re-rendering (counters, verdicts) never touches the native camera view.
const Camera = memo(function Camera({ onCode }: { onCode: (e: BarcodeScanningResult) => void }) {
  return (
    <CameraView
      style={{ flex: 1 }}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={onCode}
    />
  );
});

export default function ScanScreen() {
  useKeepAwake();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { api } = useSession();
  const [permission, requestPermission] = useCameraPermissions();

  const [event, setEvent] = useState<ScannerEvent | null | undefined>(undefined);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [gateId, setGateId] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState<TimingSummary>(() => summarize());

  const lastCode = useRef<{ text: string; seenAt: number } | null>(null);
  const busyRef = useRef(false);
  const holdUntil = useRef(0);
  const gateRef = useRef<string | null>(null);
  const pendingTiming = useRef<{
    detected: number;
    source: 'camera' | 'manual';
    networkMs: number;
    result: string;
    server: ServerTiming | null;
  } | null>(null);
  gateRef.current = gateId;

  // Event (with gates and any assigned gate) from the scanner list.
  useEffect(() => {
    api
      .scannerEvents()
      .then((list) => {
        const ev = list.find((e) => e.id === eventId) ?? null;
        setEvent(ev);
        if (ev?.assignedGate) setGateId(ev.assignedGate.id);
      })
      .catch(() => setEvent(null));
  }, [api, eventId]);

  const loadProgress = useCallback(() => {
    api.scanProgress(eventId).then(setProgress).catch(() => undefined);
  }, [api, eventId]);

  useEffect(() => {
    loadProgress();
    const t = setInterval(loadProgress, 10_000);
    return () => clearInterval(t);
  }, [loadProgress]);

  // Timing: record once the verdict has been committed and the next frame drawn.
  useEffect(() => {
    const p = pendingTiming.current;
    if (!p || !shown) return;
    pendingTiming.current = null;
    requestAnimationFrame(() => {
      recordSample({
        at: Date.now(),
        source: p.source,
        result: p.result,
        networkMs: p.networkMs,
        totalMs: performance.now() - p.detected,
        serverMs: p.server?.appMs,
        dbMs: p.server?.dbMs,
        dbQueries: p.server?.dbQueries,
      });
      setStats(summarize());
    });
  }, [shown]);

  const submit = useCallback(
    async (token: string, source: 'camera' | 'manual', detected: number) => {
      const qrToken = token.trim();
      if (!qrToken || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const sent = performance.now();
      try {
        const timing: { server?: ServerTiming | null } = {};
        const r = await api.checkIn({ qrToken, eventId, ...(gateRef.current ? { gateId: gateRef.current } : {}) }, timing);
        pendingTiming.current = { detected, source, networkMs: performance.now() - sent, result: r.result, server: timing.server ?? null };
        setShown({ kind: 'result', r });
        const tone = verdict(r).tone;
        Haptics.notificationAsync(
          tone === 'ok' ? Haptics.NotificationFeedbackType.Success : tone === 'warn' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error,
        ).catch(() => undefined);
        loadProgress();
      } catch (e) {
        // Too-short codes fail request validation (400) — still just "not a ticket" at the door.
        const message =
          e instanceof ApiError && e.status === 400 && /qrToken/.test(e.message) ? 'Not a valid ticket code.' : e instanceof ApiError ? e.message : 'Scan failed';
        pendingTiming.current = null;
        setShown({ kind: 'error', message });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      } finally {
        holdUntil.current = performance.now() + HOLD_MS;
        busyRef.current = false;
        setBusy(false);
      }
    },
    [api, eventId, loadProgress],
  );

  const onCode = useCallback(
    (e: BarcodeScanningResult) => {
      const now = performance.now();
      const last = lastCode.current;
      if (last && last.text === e.data) {
        const stillInView = now - last.seenAt < GONE_MS;
        last.seenAt = now; // keep tracking it, even while busy or holding
        if (stillInView) return;
      }
      if (busyRef.current || now < holdUntil.current) return; // a different code during the hold waits its turn
      lastCode.current = { text: e.data, seenAt: now };
      submit(e.data, 'camera', now);
    },
    [submit],
  );

  const fixedGate = event?.assignedGate ?? null;
  const v = shown?.kind === 'result' ? verdict(shown.r) : null;
  const seat = shown?.kind === 'result' ? shown.r.ticket?.seat : null;
  const meta = useMemo(
    () => ({ Device: `${Platform.OS} ${Platform.Version}`, 'App version': APP_VERSION, Mode: __DEV__ ? 'development (slower)' : 'production JS' }),
    [],
  );

  if (event === undefined) return <Loading />;
  if (event === null) {
    return (
      <SafeAreaView style={[styles.screen, styles.pad]}>
        <Text style={styles.body}>This event isn’t in your list. You may no longer be assigned to it, or it has ended.</Text>
        <View style={{ height: 16 }} />
        <Button title="Back to your events" kind="quiet" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* Header: event + door count */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text style={{ color: colors.accent, fontSize: 13 }}>All events</Text>
            </Pressable>
            <Text style={[styles.h2, { marginTop: 4, fontSize: 19 }]}>{event.name}</Text>
            <Text style={styles.muted}>{event.venue.name}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }} accessibilityLiveRegion="polite">
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{progress?.checkedIn ?? '–'}</Text>
            <Text style={styles.muted}>of {progress?.ticketsSold ?? '–'} checked in</Text>
          </View>
        </View>

        {/* Gate */}
        <View style={{ marginTop: 12 }}>
          <Text style={styles.muted}>Gate</Text>
          {fixedGate ? (
            <Text style={[styles.body, { marginTop: 4 }]}>
              {fixedGate.name} <Text style={styles.muted}>(assigned)</Text>
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 6 }}>
              {[{ id: null as string | null, name: 'No specific gate', zone: null as string | null }, ...event.venue.gates.map((g) => ({ id: g.id, name: g.name, zone: g.accessZone?.name ?? null }))].map((g) => (
                <Pressable
                  key={g.id ?? 'none'}
                  onPress={() => setGateId(g.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: gateId === g.id }}
                  style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: gateId === g.id ? colors.accent : colors.inputLine, backgroundColor: gateId === g.id ? '#173c3b' : 'transparent' }}
                >
                  <Text style={{ color: colors.text, fontSize: 14 }}>{g.name}{g.zone ? ` (${g.zone} only)` : ''}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Camera */}
        <View style={{ marginTop: 14, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', aspectRatio: 1 }}>
          {permission?.granted ? (
            <>
              <Camera onCode={onCode} />
              <View pointerEvents="none" style={{ position: 'absolute', top: '18%', left: '18%', right: '18%', bottom: '18%', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 16 }} />
            </>
          ) : (
            <View style={[styles.centered, { backgroundColor: '#000' }]}>
              {permission && !permission.canAskAgain ? (
                <>
                  <Text style={[styles.body, { textAlign: 'center' }]}>Camera access is turned off for this app. Turn it on in Settings, or type codes below.</Text>
                  <View style={{ height: 12 }} />
                  <Button title="Open Settings" onPress={() => Linking.openSettings()} />
                </>
              ) : (
                <Button title="Start camera" onPress={requestPermission} />
              )}
            </View>
          )}
        </View>

        {/* Verdict */}
        <View accessibilityLiveRegion="assertive">
          {busy && (
            <View style={{ marginTop: 14, borderRadius: 12, padding: 18, backgroundColor: colors.line }}>
              <Text style={{ color: colors.muted, fontSize: 16 }}>Checking…</Text>
            </View>
          )}
          {!busy && shown?.kind === 'error' && (
            <View style={{ marginTop: 14, borderRadius: 12, padding: 18, backgroundColor: colors.bad }}>
              <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800' }}>Can’t scan</Text>
              <Text style={{ color: '#fff', fontSize: 16, marginTop: 6 }}>{shown.message}</Text>
            </View>
          )}
          {!busy && v && (
            <View style={{ marginTop: 14, borderRadius: 12, padding: 18, backgroundColor: toneColor[v.tone] }} testID={`verdict-${shown?.kind === 'result' ? shown.r.result : ''}`}>
              <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800' }}>{v.title}</Text>
              {!!v.detail && <Text style={{ color: '#fff', fontSize: 16, marginTop: 6 }}>{v.detail}</Text>}
              {seat && <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 10 }}>{seat.section}, row {seat.row}, seat {seat.number}</Text>}
            </View>
          )}
        </View>

        {/* Manual / hardware-scanner entry */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Type or paste a ticket code"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            value={manual}
            onChangeText={setManual}
            onSubmitEditing={() => {
              submit(manual, 'manual', performance.now());
              setManual('');
            }}
            submitBehavior="submit"
            returnKeyType="go"
          />
          <Button
            title="Check"
            disabled={busy || !manual.trim()}
            onPress={() => {
              submit(manual, 'manual', performance.now());
              setManual('');
            }}
          />
        </View>

        {/* Recent scans */}
        {!!progress?.myRecentScans.length && (
          <View style={{ marginTop: 18 }}>
            <Text style={[styles.muted, { fontWeight: '600', marginBottom: 6 }]}>Your recent scans</Text>
            {progress.myRecentScans.map((s) => {
              const tone = s.result === 'VALID' ? 'ok' : s.result === 'ALREADY_USED' ? 'warn' : 'bad';
              return (
                <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
                  <Text style={[styles.body, { flex: 1, fontSize: 14 }]}>
                    <Text style={{ color: tone === 'ok' ? '#3fbf76' : tone === 'warn' ? '#e0a72a' : '#e2574c' }}>● </Text>
                    {verdict({ result: s.result, ticket: null }).title}
                    <Text style={styles.muted}>, {s.ticketType}{s.seat ? `, ${s.seat.row}${s.seat.number}` : ''}</Text>
                  </Text>
                  <Text style={[styles.muted, { fontVariant: ['tabular-nums'] }]}>
                    {new Date(s.scannedAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Banjul', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Timing (performance bake-off) */}
        <View style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }}>
          <Pressable onPress={() => setStatsOpen((o) => !o)} accessibilityRole="button">
            <Text style={{ color: colors.accent, fontSize: 13 }}>{statsOpen ? 'Hide timing' : `Timing (${stats.count} ${stats.count === 1 ? "scan" : "scans"})`}</Text>
          </Pressable>
          {statsOpen && (
            <View style={{ marginTop: 10, gap: 4 }}>
              {__DEV__ && (
                <Text style={[styles.muted, { color: '#e0a72a', marginBottom: 6 }]}>
                  Development mode: timings are slower than a release build. For fair numbers, start the app with npx expo start --no-dev --minify.
                </Text>
              )}
              <Text style={styles.body}>Scan → verdict: median {Math.round(stats.total.p50)} ms, p95 {Math.round(stats.total.p95)} ms</Text>
              <Text style={styles.muted}>Network: median {Math.round(stats.network.p50)} ms, p95 {Math.round(stats.network.p95)} ms · App: median {Math.round(stats.overhead.p50)} ms, p95 {Math.round(stats.overhead.p95)} ms</Text>
              {stats.server && stats.wifi && (
                <Text style={styles.muted}>
                  ↳ Server: median {Math.round(stats.server.p50)} ms, p95 {Math.round(stats.server.p95)} ms (database {Math.round(stats.server.dbP50)} ms) · Wi-Fi: median {Math.round(stats.wifi.p50)} ms, p95 {Math.round(stats.wifi.p95)} ms
                </Text>
              )}
              <Text style={styles.muted}>Worst {Math.round(stats.total.max)} ms · Best minute {stats.scansPerMinuteBest} scans · {stats.cameraCount} by camera</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Button title="Share results" kind="quiet" onPress={() => Share.share({ message: report({ ...meta, Event: event.name }) })} />
                <Button
                  title="Reset"
                  kind="quiet"
                  onPress={() => {
                    clearSamples();
                    setStats(summarize());
                  }}
                />
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
