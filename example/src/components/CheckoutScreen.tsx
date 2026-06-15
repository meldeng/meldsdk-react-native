import React from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { ORDER, PRESETS, needsCustomerField } from '../config';
import { type QuoteState } from '../hooks/useQuote';

export interface CheckoutScreenProps {
  wallet: string;
  onWalletChange: (v: string) => void;
  customerId: string;
  onCustomerIdChange: (v: string) => void;
  quote: QuoteState;
  busy: boolean;
  error: string;
  onBuy: () => void;
}

// Checkout screen, styled to match the web demo.
export function CheckoutScreen(props: CheckoutScreenProps) {
  const {
    wallet,
    onWalletChange,
    customerId,
    onCustomerIdChange,
    quote,
    busy,
    error,
    onBuy,
  } = props;
  const buyDisabled = busy || !wallet.trim();

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.pageContent}>
        <View style={styles.card}>
          {/* header */}
          <View style={styles.hdr}>
            <Text style={styles.logo}>⬢</Text>
            <View style={styles.buyPill}>
              <Text style={styles.buyPillText}>Buy</Text>
            </View>
            <View style={styles.country}>
              <Text>🇺🇸</Text>
              <Text style={styles.countryText}>US</Text>
            </View>
          </View>

          {/* you pay */}
          <View style={styles.panel}>
            <View style={styles.panelBody}>
              <View>
                <Text style={styles.panelLabel}>You pay</Text>
                <Text style={styles.amount}>{ORDER.sourceAmount}</Text>
              </View>
              <View style={styles.chip}>
                <Text>🇺🇸</Text>
                <Text style={styles.chipText}>{ORDER.sourceCurrencyCode}</Text>
              </View>
            </View>
            <View style={styles.presets}>
              {PRESETS.map((p, i) => (
                <View
                  key={p}
                  style={[
                    styles.preset,
                    i < PRESETS.length - 1 && styles.presetDivider,
                    p === ORDER.sourceAmount && styles.presetActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.presetText,
                      p === ORDER.sourceAmount && styles.presetTextActive,
                    ]}
                  >
                    {p}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* you receive */}
          <View style={styles.panel}>
            <View style={styles.panelBody}>
              <View style={styles.flex1}>
                <Text style={styles.panelLabel}>You receive</Text>
                <Text
                  style={styles.amount}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {quote.receiveText}
                </Text>
              </View>
              <View style={styles.chip}>
                <View style={styles.btcIcon}>
                  <Text style={styles.btcIconText}>₿</Text>
                </View>
                <Text style={styles.chipText}>BTC</Text>
              </View>
            </View>
            <Text style={styles.sub}>{quote.quoteNote}</Text>
            <View style={styles.quoteRow}>
              <Text style={styles.quoteBy}>By ✦ Mercuryo</Text>
              <Text style={styles.quoteMore}>{quote.rateText}</Text>
            </View>
          </View>

          {/* wallet */}
          <Text style={styles.fieldLabel}>Wallet Address</Text>
          <TextInput
            style={styles.input}
            value={wallet}
            onChangeText={onWalletChange}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* customer (only if not provided via .env) */}
          {needsCustomerField && (
            <>
              <Text style={styles.fieldLabel}>Meld Customer ID</Text>
              <TextInput
                style={styles.input}
                value={customerId}
                onChangeText={onCustomerIdChange}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="customer with APPROVED KYC"
              />
            </>
          )}

          {/* payment method */}
          <Text style={styles.fieldLabel}>Payment Method</Text>
          <View style={styles.method}>
            <Text style={styles.methodIcon}>💳</Text>
            <Text style={styles.methodText}>Credit or debit card</Text>
          </View>

          {/* buy */}
          <Pressable
            style={[
              styles.cta,
              buyDisabled ? styles.ctaDisabled : styles.ctaReady,
            ]}
            disabled={buyDisabled}
            onPress={onBuy}
          >
            <Text
              style={[
                styles.ctaText,
                buyDisabled ? styles.ctaTextDisabled : styles.ctaTextReady,
              ]}
            >
              {busy ? 'Creating order…' : 'Buy Bitcoin'}
            </Text>
          </Pressable>

          {!!error && <Text style={styles.err}>{error}</Text>}

          <Text style={styles.footer}>
            Powered by <Text style={styles.footerBold}>Meld.io</Text>
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },

  // page + card
  page: { flex: 1, backgroundColor: '#2b2b28' },
  pageContent: { padding: 16, alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#f1f0ec',
    borderRadius: 18,
    padding: 18,
  },

  // header
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  logo: { fontSize: 26, color: '#15191f' },
  buyPill: {
    backgroundColor: '#3e6650',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 7,
  },
  buyPillText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  country: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  countryText: { fontSize: 14, color: '#15191f' },

  // amount panels
  panel: {
    backgroundColor: '#e6e5df',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  panelBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  panelLabel: { color: '#6b7280', fontSize: 15, marginBottom: 2 },
  amount: { fontSize: 38, fontWeight: '700', color: '#15191f' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipText: { fontWeight: '700', fontSize: 17, color: '#15191f' },
  btcIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#f7931a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btcIconText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sub: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'right',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  presets: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#d7d6d0',
  },
  preset: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    backgroundColor: '#eceae5',
  },
  presetDivider: { borderRightWidth: 1, borderRightColor: '#d7d6d0' },
  presetActive: { backgroundColor: '#e0ded8' },
  presetText: { fontSize: 15, color: '#374151' },
  presetTextActive: { fontWeight: '700' },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#d7d6d0',
    backgroundColor: '#eceae5',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  quoteBy: { color: '#15191f', fontSize: 15 },
  quoteMore: { color: '#374151', fontSize: 14 },

  // fields
  fieldLabel: {
    fontSize: 16,
    color: '#15191f',
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#d8d7d1',
    backgroundColor: '#f7f6f2',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: '#15191f',
  },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#d8d7d1',
    backgroundColor: '#f7f6f2',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  methodIcon: { fontSize: 18 },
  methodText: { fontSize: 16, color: '#15191f' },

  // buy button
  cta: {
    marginTop: 20,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaReady: { backgroundColor: '#3e6650' },
  ctaDisabled: { backgroundColor: '#dcdad4' },
  ctaText: { fontSize: 18, fontWeight: '700' },
  ctaTextReady: { color: '#fff' },
  ctaTextDisabled: { color: '#9aa0a8' },
  err: { color: '#b3261e', fontSize: 13, marginTop: 10 },
  footer: {
    textAlign: 'center',
    color: '#374151',
    fontSize: 13,
    marginTop: 16,
  },
  footerBold: { color: '#15191f', fontWeight: '700' },
});
