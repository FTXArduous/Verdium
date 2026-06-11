import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import { recordDriverCompletion } from '../../../packages/shared/src/mockHandoff';
import {
  closeDriverNotification,
  DriverNotification,
  fetchDriverNotifications,
  sendDriverPing,
  submitDeliveryCompletionToServer,
} from '../../../packages/shared/src/serverApi';
import {
  cancelDriverDelivery,
  DriverQueueItem,
  fetchDriverQueue,
} from '../../../packages/shared/src/serverApi';

type DriverOrder = {
  id: string;
  customer: string;
  address: string;
  token: string;
};

type DriverScreen = 'queue' | 'delivery' | 'camera';

type DriverIdentity = {
  id: string;
  label: string;
};

const drivers: DriverIdentity[] = [
  { id: 'driver-1', label: 'Driver 1' },
  { id: 'driver-2', label: 'Driver 2' },
  { id: 'driver-3', label: 'Driver 3' },
];

export default function App() {
  const [screen, setScreen] = useState<DriverScreen>('queue');
  const [activeOrder, setActiveOrder] = useState<DriverOrder | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [cameraCredential, setCameraCredential] = useState('');
  const [cameraUnlocked, setCameraUnlocked] = useState(false);
  const [proofUri, setProofUri] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState(drivers[0].id);
  const [activeNotification, setActiveNotification] = useState<DriverNotification | null>(null);
  const [driverQueue, setDriverQueue] = useState<DriverQueueItem[]>([]);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const notificationSlide = useRef(new Animated.Value(-380)).current;

  // Initial sign-in ping + 5-minute keep-alive pings
  useEffect(() => {
    const driver = drivers.find((d) => d.id === selectedDriverId) || drivers[0];
    const ping = () => {
      sendDriverPing(driver.id, driver.label).catch(() => {/* silent offline */});
    };
    ping(); // one ping immediately on sign-in / driver switch
    const interval = setInterval(ping, 5 * 60 * 1000); // every 5 minutes
    return () => clearInterval(interval);
  }, [selectedDriverId]);

  // Poll server queue every 6 seconds
  useEffect(() => {
    const poll = async () => {
      try {
        const items = await fetchDriverQueue(selectedDriverId);
        setDriverQueue(items);
      } catch (_e) { /* silent */ }
    };
    poll();
    const interval = setInterval(poll, 6000);
    return () => clearInterval(interval);
  }, [selectedDriverId]);

  const topItem = driverQueue[0] ?? null;

  const handleDriverCancel = async (item: DriverQueueItem) => {
    if (cancelConfirmId !== item.id) {
      setCancelConfirmId(item.id);
      return;
    }
    try {
      await cancelDriverDelivery(item.id, selectedDriverId);
      setDriverQueue((prev) => prev.filter((q) => q.id !== item.id));
      if (activeOrder?.id === item.id) {
        setScreen('queue');
        setActiveOrder(null);
      }
    } catch (_e) {
      Alert.alert('Cancel failed', 'Could not cancel. Try again.');
    }
    setCancelConfirmId(null);
  };

  useEffect(() => {
    if (screen !== 'delivery' || startedAt === null) {
      return;
    }

    const tick = setInterval(() => {
      const delta = Math.floor((Date.now() - startedAt) / 1000);
      setElapsedSeconds(delta);
    }, 1000);

    return () => clearInterval(tick);
  }, [screen, startedAt]);

  useEffect(() => {
    if (screen !== 'delivery') {
      return;
    }

    const poll = setInterval(async () => {
      try {
        const notifications = await fetchDriverNotifications(selectedDriverId);
        if (notifications.length > 0 && !activeNotification) {
          setActiveNotification(notifications[0]);
          notificationSlide.setValue(-380);
          Animated.timing(notificationSlide, {
            toValue: 0,
            duration: 420,
            useNativeDriver: true,
          }).start();
        }
      } catch (_error) {
        // Keep polling silent for offline development.
      }
    }, 3500);

    return () => clearInterval(poll);
  }, [activeNotification, notificationSlide, screen, selectedDriverId]);

  const mapUrl = useMemo(() => {
    if (!activeOrder) {
      return 'about:blank';
    }
    return `https://www.google.com/maps?q=${encodeURIComponent(activeOrder.address)}&output=embed`;
  }, [activeOrder]);

  const openOrder = (order: DriverOrder) => {
    setActiveOrder({ id: order.id, customer: '', address: order.address, token: order.id });
    setStartedAt(Date.now());
    setElapsedSeconds(0);
    setScreen('delivery');
  };

  const openQueueItem = (item: DriverQueueItem) => {
    setActiveOrder({ id: item.id, customer: '', address: item.address, token: item.hashSerial });
    setStartedAt(Date.now());
    setElapsedSeconds(0);
    setScreen('delivery');
  };

  const closeNotification = async () => {
    if (!activeNotification) {
      return;
    }

    const current = activeNotification;
    Animated.timing(notificationSlide, {
      toValue: 420,
      duration: 260,
      useNativeDriver: true,
    }).start(() => {
      setActiveNotification(null);
      notificationSlide.setValue(-380);
    });

    try {
      await closeDriverNotification(current.id);
    } catch (_error) {
      // Non-blocking in preview/dev mode.
    }
  };

  const goToCameraStep = () => {
    if (!activeOrder) {
      return;
    }
    setScreen('camera');
  };

  const unlockCamera = async () => {
    if (cameraCredential.trim() !== 'DELIVERY-CAM-2026') {
      Alert.alert('Invalid credential', 'Camera credential is required for proof capture.');
      return;
    }

    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Camera denied', 'Camera permission is required to complete delivery proof.');
        return;
      }
    }

    setCameraUnlocked(true);
  };

  const saveDeliveryProof = async () => {
    if (!cameraRef.current || !activeOrder) {
      return;
    }

    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (!photo?.uri) {
      Alert.alert('Capture failed', 'No photo was captured.');
      return;
    }

    setProofUri(photo.uri);

    try {
      await submitDeliveryCompletionToServer(
        {
          orderId: activeOrder.id,
          elapsedSeconds,
          address: activeOrder.address,
          imageUri: photo.uri,
        },
      );
    } catch (_error) {
      // Keep local fallback when API server is unreachable during development.
      recordDriverCompletion({
        orderId: activeOrder.id,
        elapsedSeconds,
        address: activeOrder.address,
        imageUri: photo.uri,
      });
    }

    Alert.alert(
      'Delivery completed',
      `Final timer ${formatTimer(elapsedSeconds)} was logged to admin and proof is available to customer.`
    );

    setCameraCredential('');
    setCameraUnlocked(false);
    setActiveOrder(null);
    setStartedAt(null);
    setElapsedSeconds(0);
    setScreen('queue');
  };

  if (screen === 'delivery' && activeOrder) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.deliveryTopWrap}>
          <WebView source={{ uri: mapUrl }} style={styles.map} />
        </View>
        <View style={styles.deliveryBottomWrap}>
          <Text style={styles.title}>Verdium Driver</Text>
          <Text style={styles.subtitle}>Atrium Copia</Text>
          <Text style={styles.credentials}>Credentials: {selectedDriverId}@verdium.example + {activeOrder.token}</Text>

          {activeNotification && (
            <Animated.View style={[styles.notificationBanner, { transform: [{ translateX: notificationSlide }] }]}>
              <View style={styles.notificationTextWrap}>
                <Text style={styles.notificationTitle}>Admin Delivery Request</Text>
                <Text style={styles.notificationText}>{activeNotification.message}</Text>
                <Text style={styles.notificationText}>{activeNotification.address}</Text>
              </View>
              <Pressable style={styles.notificationClose} onPress={closeNotification}>
                <Text style={styles.buttonText}>Close</Text>
              </Pressable>
            </Animated.View>
          )}

          <Text style={styles.address}>Address: {activeOrder.address}</Text>
          <Text style={styles.timer}>Elapsed: {formatTimer(elapsedSeconds)}</Text>
          <View style={styles.rowButtons}>
            <Pressable onPress={goToCameraStep} style={styles.button}>
              <Text style={styles.buttonText}>Complete Delivery</Text>
            </Pressable>
            <Pressable onPress={() => setScreen('queue')} style={styles.buttonMuted}>
              <Text style={styles.buttonText}>Back</Text>
            </Pressable>
          </View>
          {activeOrder && (
            <Pressable
              onPress={() => {
                const item = driverQueue.find((q) => q.id === activeOrder.id);
                if (item) handleDriverCancel(item);
              }}
              style={styles.cancelFloating}
            >
              <Text style={styles.cancelFloatingText}>
                {cancelConfirmId === activeOrder.id ? 'Are you sure? Tap again' : 'Cancel Delivery'}
              </Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'camera' && activeOrder) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.pagePad}>
          <Text style={styles.title}>Delivery Proof</Text>
          <Text style={styles.subtitle}>Atrium Copia</Text>
          <Text style={styles.address}>Order: {activeOrder.id}</Text>
          <Text style={styles.address}>Credentialed Camera Step</Text>

          {!cameraUnlocked && (
            <View style={styles.card}>
              <TextInput
                style={styles.input}
                value={cameraCredential}
                onChangeText={setCameraCredential}
                placeholder="Enter camera credential"
                placeholderTextColor="#9fb2bf"
                autoCapitalize="characters"
              />
              <Pressable onPress={unlockCamera} style={styles.button}>
                <Text style={styles.buttonText}>Unlock Camera</Text>
              </Pressable>
            </View>
          )}

          {cameraUnlocked && (
            <View style={styles.card}>
              <CameraView ref={cameraRef} style={styles.camera} facing="back" />
              <View style={styles.rowButtons}>
                <Pressable onPress={saveDeliveryProof} style={styles.button}>
                  <Text style={styles.buttonText}>Save Photo Proof</Text>
                </Pressable>
                <Pressable onPress={() => setScreen('delivery')} style={styles.buttonMuted}>
                  <Text style={styles.buttonText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          {proofUri.length > 0 && (
            <Pressable onPress={() => Linking.openURL(proofUri)} style={styles.buttonMuted}>
              <Text style={styles.buttonText}>Open Last Proof Image</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.pagePad}>
        <Text style={styles.title}>Verdium Driver</Text>
        <Text style={styles.subtitle}>Atrium Copia</Text>
        <Text style={styles.address}>Deliveries assigned to you by admin appear below.</Text>

        <View style={styles.driverRow}>
          {drivers.map((driver) => (
            <Pressable
              key={driver.id}
              onPress={() => setSelectedDriverId(driver.id)}
              style={driver.id === selectedDriverId ? styles.driverChipActive : styles.driverChip}
            >
              <Text style={styles.driverChipText}>{driver.label}</Text>
            </Pressable>
          ))}
        </View>

        {driverQueue.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.orderMeta}>No deliveries assigned yet. Admin will push when ready.</Text>
          </View>
        )}

        {driverQueue.map((item, index) => (
          <View key={item.id} style={[styles.orderCard, index > 0 && styles.orderCardDimmed]}>
            <Text style={styles.orderTitle}>Delivery #{index + 1}</Text>
            <Text style={styles.orderMeta}>Hash: {item.hashSerial.slice(0, 8)}…</Text>
            {index === 0 && (
              <>
                <Pressable onPress={() => openQueueItem(item)} style={styles.button}>
                  <Text style={styles.buttonText}>Open Delivery</Text>
                </Pressable>
                <Pressable onPress={() => handleDriverCancel(item)} style={[styles.buttonMuted, styles.cancelSmall]}>
                  <Text style={styles.cancelSmallText}>
                    {cancelConfirmId === item.id ? 'Are you sure? Tap again' : 'Cancel'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatTimer(totalSeconds: number) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#14181c',
  },
  pagePad: {
    padding: 16,
    gap: 12,
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
    marginBottom: 6,
  },
  credentials: {
    color: '#f6f8fa',
    marginTop: 4,
  },
  address: {
    color: '#f6f8fa',
    marginTop: 6,
  },
  timer: {
    color: '#39d6c3',
    fontWeight: '700',
    marginTop: 6,
  },
  rowButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  button: {
    backgroundColor: '#39d6c3',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    flexGrow: 1,
  },
  buttonMuted: {
    backgroundColor: '#20272e',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    flexGrow: 1,
  },
  buttonText: {
    color: '#f6f8fa',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1b2127',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    padding: 12,
    gap: 10,
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
  camera: {
    height: 380,
    borderRadius: 14,
    overflow: 'hidden',
  },
  orderCard: {
    backgroundColor: '#1b2127',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    padding: 14,
    gap: 6,
  },
  orderCardDimmed: {
    opacity: 0.45,
  },
  orderTitle: {
    color: '#f6f8fa',
    fontSize: 18,
    fontWeight: '700',
  },
  orderMeta: {
    color: '#9fb2bf',
  },
  deliveryTopWrap: {
    flex: 6,
    padding: 8,
  },
  map: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  deliveryBottomWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  driverRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 6,
  },
  driverChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    backgroundColor: '#20272e',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  driverChipActive: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#39d6c3',
    backgroundColor: 'rgba(57, 214, 195, 0.16)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  driverChipText: {
    color: '#f6f8fa',
    fontWeight: '700',
  },
  notificationBanner: {
    marginTop: 8,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#39d6c3',
    backgroundColor: '#20272e',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  notificationTextWrap: {
    flexShrink: 1,
  },
  notificationTitle: {
    color: '#39d6c3',
    fontWeight: '800',
  },
  notificationText: {
    color: '#f6f8fa',
  },
  notificationClose: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(57, 214, 195, 0.16)',
    backgroundColor: '#1b2127',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cancelFloating: {
    position: 'absolute',
    bottom: 12,
    right: 14,
    backgroundColor: '#2e1a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f06a6a',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelFloatingText: {
    color: '#f06a6a',
    fontWeight: '700',
    fontSize: 11,
  },
  cancelSmall: {
    marginTop: 6,
    paddingVertical: 8,
  },
  cancelSmallText: {
    color: '#f06a6a',
    fontWeight: '700',
    fontSize: 12,
  },
});
