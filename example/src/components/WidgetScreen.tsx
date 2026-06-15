import React, { useRef } from 'react';
import { SafeAreaView, View, Text, ScrollView, StyleSheet } from 'react-native';
import { MeldWidget, type MeldOrder } from '@meldcrypto/react-native-sdk';
import { useWidgetEvents } from '../hooks/useWidgetEvents';
import { StatusBanner } from './StatusBanner';

export interface WidgetScreenProps {
  order: MeldOrder;
  onClose: () => void;
}

// Mounts <MeldWidget> for a created order and shows a live event log beneath it.
export function WidgetScreen({ order, onClose }: WidgetScreenProps) {
  const { lines, status, handlers } = useWidgetEvents(onClose);
  const logRef = useRef<ScrollView>(null);

  return (
    <SafeAreaView style={styles.widgetPage}>
      <View style={styles.widgetBar}>
        <Text style={styles.back} onPress={onClose}>
          ← Back
        </Text>
        <Text style={styles.widgetTitle}>Mercuryo</Text>
      </View>
      <MeldWidget style={styles.fill} order={order} {...handlers} />
      <View style={styles.logPanel}>
        <StatusBanner status={status} />
        <ScrollView
          ref={logRef}
          style={styles.log}
          contentContainerStyle={styles.logContent}
          onContentSizeChange={() =>
            logRef.current?.scrollToEnd({ animated: true })
          }
        >
          {lines.length === 0 ? (
            <Text style={styles.logLine}>waiting for events…</Text>
          ) : (
            lines.map((l, i) => (
              <Text key={i} style={styles.logLine}>
                {l}
              </Text>
            ))
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  widgetPage: { flex: 1, backgroundColor: '#fff' },
  widgetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  back: { color: '#374151', fontSize: 15 },
  widgetTitle: { fontWeight: '600', fontSize: 15 },
  logPanel: { padding: 12, backgroundColor: '#f1f0ec' },
  log: { height: 120, backgroundColor: '#0b1220', borderRadius: 8 },
  logContent: { padding: 8 },
  logLine: { color: '#c8d3e8', fontFamily: 'Menlo', fontSize: 11 },
});
