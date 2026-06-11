import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { getCustomerDeliveryProofs } from '../../../packages/shared/src/mockHandoff';
import {
  CustomerDeliveryRecord,
  fetchCustomerDeliveriesFromServer,
  submitCustomerRequestToServer,
} from '../../../packages/shared/src/serverApi';

export default function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'browser' | 'settings'>('home');
  const [browserMode, setBrowserMode] = useState<'regular' | 'incognito'>('regular');
  const [refreshCount, setRefreshCount] = useState(0);
  const [deliveries, setDeliveries] = useState<CustomerDeliveryRecord[]>([]);
  const [address, setAddress] = useState('');
  const [hashSerial, setHashSerial] = useState('');
  const [qrToken, setQrToken] = useState('');
  const [requestSending, setRequestSending] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('https://www.google.com');

  const refresh = useCallback(async () => {
    try {
      const serverDeliveries = await fetchCustomerDeliveriesFromServer();
      setDeliveries(serverDeliveries);
      return;
    } catch (_error) {
      const fallback = getCustomerDeliveryProofs().map((item) => ({
        orderId: item.orderId,
        address: item.address,
        imageUri: item.imageUri,
        deliveredAt: item.deliveredAt,
      }));
      setDeliveries(fallback);
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 7000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    Alert.alert('Verdium Notice', 'Please confirm with dispensary that they are affiliated with Verdium.');
  }, []);

  const submitRequest = async () => {
    const cleanHash = hashSerial.replace(/\s+/g, '').toUpperCase();
    if (!address || !qrToken || !/^[A-Z0-9]{48}$/.test(cleanHash)) {
      Alert.alert('Invalid request', 'Address, QR token, and a valid 48-character hash are required.');
      return;
    }

    setRequestSending(true);
    try {
      await submitCustomerRequestToServer(
        {
          customerId: 'customer-mobile',
          address,
          hashSerial: cleanHash,
          qrToken,
        },
      );
      setAddress('');
      setHashSerial('');
      setQrToken('');
      Alert.alert('Request sent', 'Delivery request with hash and QR token was sent to admin.');
    } catch (_error) {
      Alert.alert('Send failed', 'Unable to reach server-cache endpoint.');
    } finally {
      setRequestSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.contentWrap}>
        {activeTab === 'home' && (
          <ScrollView contentContainerStyle={styles.pagePad}>
            <Text style={styles.title}>Verdium</Text>
            <Text style={styles.subtitle}>Atrium Copia</Text>
            <Text style={styles.description}>
              Customer delivery feed. When a driver completes delivery with camera proof, a link appears below.
            </Text>

            <View style={styles.card}>
              <Text style={styles.orderTitle}>Send Delivery Request To Admin</Text>
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="Delivery address"
                placeholderTextColor="#9fb2bf"
                style={styles.input}
              />
              <TextInput
                value={hashSerial}
                onChangeText={setHashSerial}
                placeholder="48-character dispensary hash"
                placeholderTextColor="#9fb2bf"
                autoCapitalize="characters"
                style={styles.input}
              />
              <TextInput
                value={qrToken}
                onChangeText={setQrToken}
                placeholder="QR token"
                placeholderTextColor="#9fb2bf"
                style={styles.input}
              />
              <Pressable onPress={submitRequest} style={styles.button} disabled={requestSending}>
                <Text style={styles.buttonText}>{requestSending ? 'Sending...' : 'Send Request To Admin'}</Text>
              </Pressable>
            </View>

            <Pressable onPress={() => { setRefreshCount((v) => v + 1); refresh(); }} style={styles.button}>
              <Text style={styles.buttonText}>Refresh Delivered Feed ({refreshCount})</Text>
            </Pressable>

            {deliveries.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.muted}>No delivered proofs yet.</Text>
              </View>
            )}

            {deliveries.map((delivery) => (
              <View key={`${delivery.orderId}-${delivery.deliveredAt}`} style={styles.card}>
                <Text style={styles.orderTitle}>{delivery.orderId}</Text>
                <Text style={styles.muted}>{delivery.address}</Text>
                <Text style={styles.muted}>Delivered: {delivery.deliveredAt}</Text>
                <Pressable onPress={() => Linking.openURL(delivery.imageUri)} style={styles.buttonMuted}>
                  <Text style={styles.buttonText}>View Delivery Image</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        {activeTab === 'browser' && (
          <View style={styles.browserWrap}>
            <Text style={styles.title}>Browser</Text>
            <Text style={styles.subtitle}>Atrium Copia</Text>
            <Text style={styles.muted}>Mode: {browserMode === 'incognito' ? 'Incognito' : 'Regular'}</Text>
            <TextInput
              value={browserUrl}
              onChangeText={setBrowserUrl}
              placeholder="https://"
              placeholderTextColor="#9fb2bf"
              style={styles.input}
              autoCapitalize="none"
            />
            <Pressable onPress={() => Linking.openURL(browserUrl)} style={styles.buttonMuted}>
              <Text style={styles.buttonText}>Open In Phone Browser</Text>
            </Pressable>
            <View style={styles.browserCard}>
              <WebView
                key={`webview-${browserMode}`}
                source={{ uri: browserUrl }}
                style={styles.browserWebView}
                incognito={browserMode === 'incognito'}
              />
            </View>
          </View>
        )}

        {activeTab === 'settings' && (
          <View style={styles.browserWrap}>
            <Text style={styles.title}>Settings</Text>
            <Text style={styles.subtitle}>Atrium Copia</Text>
            <View style={styles.card}>
              <Text style={styles.orderTitle}>Browser Privacy Mode</Text>
              <Text style={styles.muted}>Toggle between regular browser and incognito browser.</Text>
              <View style={styles.modeRow}>
                <Pressable
                  onPress={() => setBrowserMode('regular')}
                  style={browserMode === 'regular' ? styles.modeButtonActive : styles.modeButton}
                >
                  <Text style={styles.buttonText}>Regular Browser</Text>
                </Pressable>
                <Pressable
                  onPress={() => setBrowserMode('incognito')}
                  style={browserMode === 'incognito' ? styles.modeButtonActive : styles.modeButton}
                >
                  <Text style={styles.buttonText}>Incognito Mode</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>

      <View style={styles.footerTabs}>
        <Pressable style={activeTab === 'home' ? styles.footerTabActive : styles.footerTab} onPress={() => setActiveTab('home')}>
          <Text style={styles.buttonText}>Home</Text>
        </Pressable>
        <Pressable
          style={activeTab === 'browser' ? styles.footerTabActive : styles.footerTab}
          onPress={() => setActiveTab('browser')}
        >
          <Text style={styles.buttonText}>Browser</Text>
        </Pressable>
        <Pressable
          style={activeTab === 'settings' ? styles.footerTabActive : styles.footerTab}
          onPress={() => setActiveTab('settings')}
        >
          <Text style={styles.buttonText}>Settings</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#14181c',
  },
  pagePad: {
    padding: 16,
    gap: 12,
    paddingBottom: 120,
  },
  contentWrap: {
    flex: 1,
  },
  title: {
    color: '#f6f8fa',
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9fb2bf',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  description: {
    color: '#f6f8fa',
    marginBottom: 6,
  },
  card: {
    backgroundColor: '#1b2127',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    padding: 14,
    gap: 6,
  },
  orderTitle: {
    color: '#f6f8fa',
    fontWeight: '700',
    fontSize: 17,
  },
  muted: {
    color: '#9fb2bf',
  },
  button: {
    backgroundColor: '#39d6c3',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  buttonMuted: {
    marginTop: 6,
    backgroundColor: '#20272e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    color: '#f6f8fa',
    backgroundColor: '#20272e',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  browserWrap: {
    flex: 1,
    padding: 16,
    gap: 10,
  },
  browserCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    overflow: 'hidden',
    backgroundColor: '#1b2127',
  },
  browserWebView: {
    flex: 1,
  },
  footerTabs: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(57, 214, 195, 0.16)',
    backgroundColor: '#1b2127',
  },
  footerTab: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    backgroundColor: '#20272e',
    paddingVertical: 11,
    alignItems: 'center',
  },
  footerTabActive: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#39d6c3',
    backgroundColor: 'rgba(57, 214, 195, 0.16)',
    paddingVertical: 11,
    alignItems: 'center',
  },
  modeRow: {
    marginTop: 10,
    gap: 10,
  },
  modeButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    backgroundColor: '#20272e',
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  modeButtonActive: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#39d6c3',
    backgroundColor: 'rgba(57, 214, 195, 0.16)',
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#f6f8fa',
    fontWeight: '700',
  },
});
