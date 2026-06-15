import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { type MeldStatus } from '@meldcrypto/react-native-sdk';

// Status banner labels + colors — same as the web demo.
const BANNER: Record<
  MeldStatus,
  { title: string; sub: string; dot: string; bg: string; fg: string }
> = {
  pending: {
    title: 'Processing payment…',
    sub: '',
    dot: '#8a93a3',
    bg: '#eef1f5',
    fg: '#3a4453',
  },
  completed: {
    title: 'Order complete',
    sub: 'Provider confirmed — settlement via webhook',
    dot: '#1c9c52',
    bg: '#e7f4ec',
    fg: '#1c7a43',
  },
  failed: {
    title: 'Order failed',
    sub: '',
    dot: '#d93b2b',
    bg: '#fbeae8',
    fg: '#b3261e',
  },
  cancelled: {
    title: 'Order cancelled',
    sub: '',
    dot: '#8a93a3',
    bg: '#eef1f5',
    fg: '#3a4453',
  },
};

export function StatusBanner({ status }: { status: MeldStatus | null }) {
  if (!status) return null;
  const b = BANNER[status];
  return (
    <View style={[styles.banner, { backgroundColor: b.bg }]}>
      <View style={[styles.dot, { backgroundColor: b.dot }]} />
      <Text style={[styles.bannerTitle, { color: b.fg }]}>{b.title}</Text>
      {b.sub ? <Text style={styles.bannerSub}>{b.sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 11,
    borderRadius: 10,
    marginBottom: 8,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  bannerTitle: { fontSize: 14, fontWeight: '600' },
  bannerSub: { fontSize: 12, color: '#6b7280', flexShrink: 1 },
});
