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
import { type Quote } from '../api/meld';
import { format } from '../utils/format';

export interface CheckoutScreenProps {
  wallet: string;
  onWalletChange: (v: string) => void;
  customerId: string;
  onCustomerIdChange: (v: string) => void;
  quotes: Quote[];
  selectedProvider: string | null;
  onSelectProvider: (p: string) => void;
  note: string;
  busy: boolean;
  error: string;
  onBuy: () => void;
}

// Checkout screen, styled to match the web demo: a live quote per provider + a provider picker.
export function CheckoutScreen(props: CheckoutScreenProps) {
  const {
    wallet,
    onWalletChange,
    customerId,
    onCustomerIdChange,
    quotes,
    selectedProvider,
    onSelectProvider,
    note,
    busy,
    error,
    onBuy,
  } = props;
  const buyDisabled = busy || !wallet.trim() || !selectedProvider;
  const selected = quotes.find((q) => q.serviceProvider === selectedProvider);
  const token = ORDER.destinationCurrencyCode;
  const receiveText =
    selected?.destinationAmount != null
      ? `≈ ${format(selected.destinationAmount)}`
      : '≈ —';

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
                  {receiveText}
                </Text>
              </View>
              <View style={styles.chip}>
                <View style={styles.tokenIcon}>
                  <Text style={styles.tokenIconText}>$</Text>
                </View>
                <Text style={styles.chipText}>{token}</Text>
              </View>
            </View>
            <Text style={styles.sub}>
              {selected
                ? `via ${selected.serviceProvider} — total fees ${format(
                    selected.totalFee ?? 0,
                  )} ${ORDER.sourceCurrencyCode}`
                : note}
            </Text>
          </View>

          {/* choose a provider */}
          <Text style={styles.fieldLabel}>Choose a provider</Text>
          {quotes.length === 0 ? (
            <Text style={styles.sub}>{note}</Text>
          ) : (
            quotes.map((q) => {
              const active = q.serviceProvider === selectedProvider;
              return (
                <Pressable
                  key={q.serviceProvider}
                  style={[styles.prov, active && styles.provActive]}
                  onPress={() => onSelectProvider(q.serviceProvider)}
                >
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <View style={styles.radioDot} />}
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.provName}>{q.serviceProvider}</Text>
                    {!!q.kycMode && (
                      <Text style={styles.provKyc}>KYC {q.kycMode}</Text>
                    )}
                  </View>
                  <View style={styles.provRight}>
                    <Text style={styles.provAmt}>
                      ≈ {format(q.destinationAmount ?? 0)} {token}
                    </Text>
                    {q.totalFee != null && (
                      <Text style={styles.provFee}>
                        fee {format(q.totalFee)} {ORDER.sourceCurrencyCode}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })
          )}

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
              {busy ? 'Creating order…' : `Buy ${token}`}
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
  tokenIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2775ca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenIconText: { color: '#fff', fontWeight: '700', fontSize: 13 },
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

  // provider picker
  prov: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1.5,
    borderColor: '#d8d7d1',
    backgroundColor: '#f7f6f2',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  provActive: { borderColor: '#3e6650', backgroundColor: '#eef3ef' },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#b9b8b2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: '#3e6650' },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3e6650',
  },
  provName: { fontWeight: '600', fontSize: 16, color: '#15191f' },
  provKyc: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  provRight: { alignItems: 'flex-end' },
  provAmt: { fontWeight: '700', color: '#15191f' },
  provFee: { color: '#6b7280', fontSize: 12, marginTop: 2 },

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
