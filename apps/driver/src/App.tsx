import React, { Component, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View, Vibration } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useAudioPlayer } from 'expo-audio';
import { recordDriverCompletion } from '../../../packages/shared/src/mockHandoff';
import { authenticateProfile, ProfileRecord } from '../../../packages/shared/src/profileVault';
import {
  archiveDriverPhotosToServer,
  acceptDriverOffer,
  CancelledDriverDelivery,
  claimCancelledDriverDelivery,
  closeDriverNotification,
  connectToTerminalHost,
  declineDriverOffer,
  DriverNotification,
  DriverPhotoArchiveEntry,
  DriverOffer,
  fetchCancelledDriverDeliveries,
  fetchDriverNotifications,
  fetchDriverOffers,
  sendDriverPing,
  saveProfileToServer,
  setServerSimulationEnabled,
  setTerminalHostUrl,
  submitDeliveryCompletionToServer,
  uploadProfileImageToServer,
} from '../../../packages/shared/src/serverApi';
import {
  cancelDriverDelivery,
  DriverQueueItem,
  fetchDriverQueue,
} from '../../../packages/shared/src/serverApi';
import { normalizeVirginiaStoreLocation, VIRGINIA_STORE_LOCATIONS } from '../../../packages/shared/src/storeLocations';

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

class DriverErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.pagePad}>
            <Text style={styles.title}>Verdium Driver</Text>
            <Text style={styles.subtitle}>Startup recovery</Text>
            <View style={styles.card}>
              <Text style={styles.orderTitle}>The driver app stayed open.</Text>
              <Text style={styles.orderMeta}>Reopen the app to retry. This screen prevents a JavaScript render failure from appearing as an immediate close.</Text>
            </View>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

function createOfferToneBase64() {
  const sampleRate = 16000;
  const notes = [
    { frequency: 880, duration: 0.14 },
    { frequency: 0, duration: 0.05 },
    { frequency: 1046.5, duration: 0.14 },
  ];
  const sampleCount = notes.reduce((total, note) => total + Math.floor(note.duration * sampleRate), 0);
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeText(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, sampleCount * 2, true);
  let sampleOffset = 44;
  notes.forEach((note) => {
    const noteSamples = Math.floor(note.duration * sampleRate);
    for (let index = 0; index < noteSamples; index += 1) {
      const envelope = Math.min(1, index / 200, (noteSamples - index) / 200);
      const value = note.frequency === 0 ? 0 : Math.round(Math.sin((2 * Math.PI * note.frequency * index) / sampleRate) * 0.38 * envelope * 32767);
      view.setInt16(sampleOffset, value, true);
      sampleOffset += 2;
    }
  });
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  const base64Encode = (globalThis as unknown as { btoa?: (value: string) => string }).btoa;
  if (!base64Encode) {
    throw new Error('base64 encoder unavailable');
  }
  return base64Encode(binary);
}

function DriverApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [screen, setScreen] = useState<DriverScreen>('queue');
  const [activeOrder, setActiveOrder] = useState<DriverOrder | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [driverEmail, setDriverEmail] = useState('driver@verdium.example');
  const [driverPassword, setDriverPassword] = useState('DriverVerdium!2026');
  const [driverProfile, setDriverProfile] = useState<ProfileRecord | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>(VIRGINIA_STORE_LOCATIONS[0]);
  const [savingLocation, setSavingLocation] = useState(false);
  const [licenseScanUri, setLicenseScanUri] = useState('');
  const [scanningLicense, setScanningLicense] = useState(false);
  const [driverPhotoLog, setDriverPhotoLog] = useState<DriverPhotoArchiveEntry[]>([]);
  const [activeCarouselIndex, setActiveCarouselIndex] = useState(0);
  const [cameraCredential, setCameraCredential] = useState('');
  const [cameraUnlocked, setCameraUnlocked] = useState(false);
  const [proofUri, setProofUri] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState(drivers[0].id);
  const [activeNotification, setActiveNotification] = useState<DriverNotification | null>(null);
  const [driverQueue, setDriverQueue] = useState<DriverQueueItem[]>([]);
  const [activeOffer, setActiveOffer] = useState<DriverOffer | null>(null);
  const [offerSecondsRemaining, setOfferSecondsRemaining] = useState(0);
  const [showCancelledDeliveries, setShowCancelledDeliveries] = useState(false);
  const [cancelledDeliveries, setCancelledDeliveries] = useState<CancelledDriverDelivery[]>([]);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [startupServerMode, setStartupServerMode] = useState<'checking' | 'online' | 'offline'>('checking');
  const [wifiSimulationEnabled, setWifiSimulationEnabled] = useState(false);
  const [terminalHost, setTerminalHost] = useState('');
  const [deviceName, setDeviceName] = useState('Driver phone');
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [terminalMessage, setTerminalMessage] = useState('');
  const notificationSlide = useRef(new Animated.Value(-380)).current;
  const offerToneUri = useRef('');
  const playedOfferIds = useRef(new Set<string>());
  const notificationPlayer = useAudioPlayer(null);

  const setWifiSimulation = (enabled: boolean) => {
    setServerSimulationEnabled(enabled);
    setWifiSimulationEnabled(enabled);
    setTerminalConnected(false);
    setStartupServerMode(enabled ? 'offline' : 'checking');
    if (enabled) {
      const simulationId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      setDriverEmail(`driver-${simulationId}@fakeemail.com`);
      setDriverPassword('WifiSimulation!2026');
      setDriverQueue([]);
      setActiveNotification(null);
      setActiveOffer(null);
    } else {
      setTerminalHostUrl('');
      setTerminalMessage('');
    }
  };

  const connectToTerminal = async () => {
    try {
      const simulationId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      const result = await connectToTerminalHost({
        hostUrl: terminalHost,
        deviceId: `driver-${simulationId}`,
        deviceName: deviceName.trim() || 'Driver phone',
        role: 'driver',
      });
      setTerminalConnected(true);
      setTerminalMessage(`Connected to ${result.terminalName}.`);
      setStartupServerMode('online');
    } catch (error) {
      setTerminalConnected(false);
      setServerSimulationEnabled(true);
      setTerminalMessage(`Terminal connection failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  };

  const simulationToggle = (
    <View style={styles.simulationToggle}>
      <Text style={styles.simulationLabel}>Wi-Fi Sim</Text>
      <Switch
        value={wifiSimulationEnabled}
        onValueChange={setWifiSimulation}
        trackColor={{ false: '#5c6974', true: '#63abff' }}
        thumbColor={wifiSimulationEnabled ? '#f2f4f7' : '#d6dde3'}
      />
    </View>
  );

  useEffect(() => {
    fetchDriverQueue(drivers[0].id)
      .then(() => setStartupServerMode('online'))
      .catch(() => setStartupServerMode('offline'));
  }, []);

  useEffect(() => {
    if (!signedIn || driverPhotoLog.length === 0) {
      return;
    }

    const carousel = setInterval(() => {
      setActiveCarouselIndex((current) => (current + 1) % driverPhotoLog.length);
    }, 3200);

    return () => clearInterval(carousel);
  }, [driverPhotoLog.length, signedIn]);

  // Initial sign-in ping + 5-minute keep-alive pings
  useEffect(() => {
    if (!signedIn) {
      return;
    }

    const driver = drivers.find((d) => d.id === selectedDriverId) || drivers[0];
    const ping = () => {
      sendDriverPing(driver.id, driver.label).catch(() => {/* silent offline */});
    };
    ping(); // one ping immediately on sign-in / driver switch
    const interval = setInterval(ping, 5 * 60 * 1000); // every 5 minutes
    return () => clearInterval(interval);
  }, [selectedDriverId, signedIn]);

  useEffect(() => {
    const prepareOfferTone = async () => {
      if (!FileSystem.cacheDirectory) {
        return;
      }
      const uri = `${FileSystem.cacheDirectory}verdium-driver-offer.wav`;
      await FileSystem.writeAsStringAsync(uri, createOfferToneBase64(), {
        encoding: FileSystem.EncodingType.Base64,
      });
      offerToneUri.current = uri;
    };
    prepareOfferTone().catch(() => undefined);
  }, []);

  const playOfferAlert = () => {
    Vibration.vibrate([0, 110, 60, 110]);
    if (!offerToneUri.current) {
      return;
    }
    try {
      notificationPlayer.replace({ uri: offerToneUri.current });
      notificationPlayer.play();
    } catch (_error) {
      // Vibration remains available if native audio is unavailable.
    }
  };

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    const pollOffers = async () => {
      try {
        const offers = await fetchDriverOffers(selectedDriverId);
        const nextOffer = offers[0] || null;
        if (nextOffer && !playedOfferIds.current.has(nextOffer.id)) {
          playedOfferIds.current.add(nextOffer.id);
          playOfferAlert();
        }
        setActiveOffer(nextOffer);
      } catch (_error) {
        // The delivery screen remains usable while the server is unreachable.
      }
    };
    pollOffers();
    const interval = setInterval(pollOffers, 1000);
    return () => clearInterval(interval);
  }, [selectedDriverId, signedIn]);

  useEffect(() => {
    if (!activeOffer) {
      setOfferSecondsRemaining(0);
      return;
    }
    const updateRemaining = () => {
      setOfferSecondsRemaining(Math.max(0, Math.ceil((new Date(activeOffer.offerExpiresAt).getTime() - Date.now()) / 1000)));
    };
    updateRemaining();
    const interval = setInterval(updateRemaining, 250);
    return () => clearInterval(interval);
  }, [activeOffer]);

  // Poll server queue every 6 seconds
  useEffect(() => {
    if (!signedIn) {
      return;
    }

    const poll = async () => {
      try {
        const items = await fetchDriverQueue(selectedDriverId);
        setDriverQueue(items);
      } catch (_e) { /* silent */ }
    };
    poll();
    const interval = setInterval(poll, 6000);
    return () => clearInterval(interval);
  }, [selectedDriverId, signedIn]);

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

  const acceptActiveOffer = async () => {
    if (!activeOffer) {
      return;
    }
    try {
      const item = await acceptDriverOffer(activeOffer.id, selectedDriverId);
      setDriverQueue((current) => [item, ...current.filter((queued) => queued.id !== item.id)]);
      setActiveOffer(null);
    } catch (_error) {
      setActiveOffer(null);
      Alert.alert('Delivery unavailable', 'Another driver accepted this delivery or the 10-second offer expired.');
    }
  };

  const declineActiveOffer = async () => {
    if (!activeOffer) {
      return;
    }
    try {
      await declineDriverOffer(activeOffer.id, selectedDriverId);
    } finally {
      setActiveOffer(null);
    }
  };

  const openCancelledDeliveries = async () => {
    try {
      const deliveries = await fetchCancelledDriverDeliveries(selectedDriverId);
      setCancelledDeliveries(deliveries);
      setShowCancelledDeliveries(true);
    } catch (_error) {
      Alert.alert('Cancelled deliveries unavailable', 'Could not load cancelled deliveries right now.');
    }
  };

  const claimCancelledDelivery = async (delivery: CancelledDriverDelivery) => {
    if (!delivery.available) {
      return;
    }
    try {
      const item = await claimCancelledDriverDelivery(delivery.id, selectedDriverId);
      setDriverQueue((current) => [item, ...current]);
      setCancelledDeliveries((current) => current.filter((candidate) => candidate.id !== delivery.id));
      Alert.alert('Delivery added', 'The address was added to your delivery list and terminal queue.');
    } catch (_error) {
      setCancelledDeliveries(await fetchCancelledDriverDeliveries(selectedDriverId));
      Alert.alert('Delivery unavailable', 'Another driver already selected this cancelled delivery.');
    }
  };

  const requestLicenseScan = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera denied', 'Camera permission is required to capture the driver license.');
      return;
    }

    const photo = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (photo.canceled || !photo.assets?.[0]?.uri) {
      Alert.alert('Scan failed', 'No license image was captured.');
      return;
    }

    setLicenseScanUri(photo.assets[0].uri);
    setDriverPhotoLog((prev) => [
      {
        phase: 'before-trip',
        label: 'Driver license scan',
        imageUri: photo.assets[0].uri,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const captureTripPhoto = async (label: string) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera denied', 'Camera permission is required to capture delivery proof.');
      return;
    }

    const photo = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (photo.canceled || !photo.assets?.[0]?.uri) {
      Alert.alert('Capture failed', 'No trip photo was captured.');
      return;
    }

    setDriverPhotoLog((prev) => [
      {
        phase: activeOrder ? 'during-trip' : 'before-trip',
        label,
        imageUri: photo.assets[0].uri,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const completeDriverSignIn = async () => {
    const cleanEmail = driverEmail.trim().toLowerCase();
    const cleanPassword = driverPassword.trim();
    if (!cleanEmail.includes('@') || cleanPassword.length < 6) {
      Alert.alert('Sign-in required', 'Enter your driver email and password first.');
      return;
    }

    const fallbackProfile: ProfileRecord = {
      email: cleanEmail,
      password: cleanPassword,
      displayName: cleanEmail.split('@')[0] || 'Driver',
      role: 'driver',
      storeLocation: normalizeVirginiaStoreLocation(selectedLocation),
      createdAt: new Date().toISOString(),
      documents: [],
    };

    try {
      const profile = authenticateProfile(cleanEmail, cleanPassword);
      const effectiveProfile = (!profile || profile.role !== 'driver') ? fallbackProfile : profile;

      let uploadedLicenseUri = licenseScanUri;
      if (licenseScanUri.length > 0) {
        try {
          const imageBase64 = await FileSystem.readAsStringAsync(licenseScanUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const uploaded = await uploadProfileImageToServer({
            imageBase64,
            mimeType: 'image/jpeg',
            fileName: `driver-license-${Date.now()}.jpg`,
            folder: `profiles/driver/${cleanEmail}`,
          });
          uploadedLicenseUri = uploaded.imageUri;
        } catch (_uploadError) {
          // Fall back to local image URI in offline or non-upload environments.
        }
      }

      try {
        const selectedStoreLocation = normalizeVirginiaStoreLocation(selectedLocation);
        await saveProfileToServer({
          ...effectiveProfile,
          storeLocation: selectedStoreLocation,
          licenseImageUri: uploadedLicenseUri,
          documents: effectiveProfile.documents,
        });
      } catch (_saveError) {
        // Keep sign-in working offline; the license image will be retried on the next login.
      }

      const profileWithLocation = {
        ...effectiveProfile,
        storeLocation: normalizeVirginiaStoreLocation(selectedLocation),
      };
      setDriverProfile(profileWithLocation);
      setSelectedLocation(profileWithLocation.storeLocation || VIRGINIA_STORE_LOCATIONS[0]);
      setSignedIn(true);
    } catch (_error) {
      const profileWithLocation = {
        ...fallbackProfile,
        storeLocation: normalizeVirginiaStoreLocation(selectedLocation),
      };
      setDriverProfile(profileWithLocation);
      setSelectedLocation(profileWithLocation.storeLocation || VIRGINIA_STORE_LOCATIONS[0]);
      setSignedIn(true);
    }
  };

  const saveDriverLocation = async () => {
    if (!driverProfile) {
      return;
    }

    setSavingLocation(true);
    const locationToSave = normalizeVirginiaStoreLocation(selectedLocation);
    const updatedProfile = {
      ...driverProfile,
      storeLocation: locationToSave,
      documents: driverProfile.documents,
    };
    try {
      await saveProfileToServer(updatedProfile);
      setDriverProfile(updatedProfile);
      Alert.alert('Profile updated', `Driver location saved as ${locationToSave}.`);
    } catch (_error) {
      Alert.alert('Update failed', 'Could not save driver location right now.');
    } finally {
      setSavingLocation(false);
    }
  };

  const signOutDriver = async () => {
    if (driverPhotoLog.length > 0) {
      try {
        await archiveDriverPhotosToServer({
          driverId: selectedDriverId,
          sessionId: `${selectedDriverId}-${Date.now()}`,
          photos: driverPhotoLog,
        });
      } catch (_error) {
        // Leave offline fallback local if archive upload fails.
      }
    }

    setDriverPhotoLog([]);
    setActiveCarouselIndex(0);
    setDriverEmail('driver@verdium.example');
    setDriverPassword('DriverVerdium!2026');
    setLicenseScanUri('');
    setSignedIn(false);
    setScreen('queue');
    setActiveOrder(null);
    setStartedAt(null);
    setElapsedSeconds(0);
    setCameraCredential('');
    setCameraUnlocked(false);
    setProofUri('');
    setActiveOffer(null);
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

    const apiKey = String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
    const mapQuery = encodeURIComponent(activeOrder.address);

    if (apiKey) {
      return `https://maps.googleapis.com/maps/api/staticmap?size=900x900&scale=2&zoom=18&maptype=satellite&center=${mapQuery}&markers=color:red%7C${mapQuery}&key=${apiKey}`;
    }

    return `https://www.google.com/maps?q=${mapQuery}&t=k&z=18&output=embed`;
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

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera denied', 'Camera permission is required to complete delivery proof.');
      return;
    }

    setCameraUnlocked(true);
  };

  const saveDeliveryProof = async () => {
    if (!activeOrder) {
      return;
    }

    const photo = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (photo.canceled || !photo.assets?.[0]?.uri) {
      Alert.alert('Capture failed', 'No photo was captured.');
      return;
    }

    const proofImageUri = photo.assets[0].uri;
    setProofUri(proofImageUri);

    try {
      await submitDeliveryCompletionToServer(
        {
          orderId: activeOrder.id,
          elapsedSeconds,
          address: activeOrder.address,
          imageUri: proofImageUri,
        },
      );
    } catch (_error) {
      // Keep local fallback when API server is unreachable during development.
      recordDriverCompletion({
        orderId: activeOrder.id,
        elapsedSeconds,
        address: activeOrder.address,
        imageUri: proofImageUri,
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

  const offerPrompt = activeOffer ? (
    <View style={styles.offerOverlay}>
      <View style={styles.offerCard}>
        <Text style={styles.offerEyebrow}>NEW DELIVERY</Text>
        <Text style={styles.offerTitle}>Accept in {offerSecondsRemaining}s</Text>
        <Text style={styles.address}>{activeOffer.address}</Text>
        <View style={styles.rowButtons}>
          <Pressable onPress={acceptActiveOffer} style={styles.button}>
            <Text style={styles.buttonText}>Accept Delivery</Text>
          </Pressable>
          <Pressable onPress={declineActiveOffer} style={styles.buttonMuted}>
            <Text style={styles.buttonText}>Decline</Text>
          </Pressable>
        </View>
      </View>
    </View>
  ) : null;

  if (!signedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.pagePad}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Verdium Driver</Text>
            {simulationToggle}
          </View>
          <Text style={styles.subtitle}>Atrium Copia</Text>
          <Text style={styles.address}>Driver sign-in requires an email and password. Driver license scan is recommended but not required.</Text>
          <Text style={styles.orderMeta}>
            {wifiSimulationEnabled
              ? 'Wi-Fi simulation is active. Server functions are disabled and a local fake sign-in is ready.'
              : startupServerMode === 'online'
              ? 'Startup check: API/server reachable.'
              : startupServerMode === 'offline'
                ? 'Startup check: API/server not reachable. Local fallback mode is active and the app can still load.'
                : 'Startup check: verifying API/server reachability...'}
          </Text>

          <View style={styles.card}>
            {wifiSimulationEnabled && (
              <View style={styles.connectionPanel}>
                <Text style={styles.orderTitle}>Terminal Wi-Fi Connection</Text>
                <TextInput value={terminalHost} onChangeText={setTerminalHost} placeholder="Terminal host or IP, e.g. 192.168.1.20:4010" placeholderTextColor="#9fb2bf" autoCapitalize="none" style={styles.input} />
                <TextInput value={deviceName} onChangeText={setDeviceName} placeholder="Phone name" placeholderTextColor="#9fb2bf" style={styles.input} />
                <Pressable onPress={connectToTerminal} style={styles.button}>
                  <Text style={styles.buttonText}>{terminalConnected ? 'Reconnect Terminal' : 'Connect Terminal'}</Text>
                </Pressable>
                {terminalMessage.length > 0 && <Text style={styles.orderMeta}>{terminalMessage}</Text>}
              </View>
            )}
            <Text style={styles.orderTitle}>Select Driver Profile</Text>
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
            <TextInput
              value={driverEmail}
              onChangeText={setDriverEmail}
              placeholder="Driver email"
              placeholderTextColor="#9fb2bf"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              value={driverPassword}
              onChangeText={setDriverPassword}
              placeholder="Password"
              placeholderTextColor="#9fb2bf"
              secureTextEntry
              style={styles.input}
            />
            <Text style={styles.orderMeta}>Select Driver Location</Text>
            <View style={styles.locationRow}>
              {VIRGINIA_STORE_LOCATIONS.map((location) => (
                <Pressable
                  key={location}
                  onPress={() => setSelectedLocation(location)}
                  style={selectedLocation === location ? styles.locationChipActive : styles.locationChip}
                >
                  <Text style={styles.locationChipText}>{location}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={requestLicenseScan} style={styles.button}>
              <Text style={styles.buttonText}>{scanningLicense ? 'License Scan Open' : 'Scan Driver License'}</Text>
            </Pressable>
            {licenseScanUri.length > 0 && (
              <Pressable onPress={() => Linking.openURL(licenseScanUri)} style={styles.buttonMuted}>
                <Text style={styles.buttonText}>Review License Scan</Text>
              </Pressable>
            )}
            <Pressable onPress={completeDriverSignIn} style={styles.buttonMuted}>
              <Text style={styles.buttonText}>Sign In</Text>
            </Pressable>
          </View>

          {scanningLicense && (
            <View style={styles.card}>
              <Text style={styles.orderTitle}>Scan Driver License</Text>
              <Pressable onPress={requestLicenseScan} style={styles.button}>
                <Text style={styles.buttonText}>Capture License</Text>
              </Pressable>
              <Pressable onPress={() => setScanningLicense(false)} style={styles.buttonMuted}>
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'delivery' && activeOrder) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.deliveryTopWrap}>
          <View style={styles.mapFallbackCard}>
            <Text style={styles.orderMeta}>Satellite map preview is opened externally for delivery stability.</Text>
            <Pressable onPress={() => Linking.openURL(mapUrl)} style={styles.button}>
              <Text style={styles.buttonText}>Open Satellite Map</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.deliveryBottomWrap}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Verdium Driver</Text>
            {simulationToggle}
          </View>
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
                {cancelConfirmId === activeOrder.id ? 'Are you sure? Tap again' : 'Cancel Order'}
              </Text>
            </Pressable>
          )}
        </View>
        {offerPrompt}
      </SafeAreaView>
    );
  }

  if (screen === 'camera' && activeOrder) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.pagePad}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Delivery Proof</Text>
            {simulationToggle}
          </View>
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
        {offerPrompt}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.pagePad}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Verdium Driver</Text>
          {simulationToggle}
        </View>
        <Text style={styles.subtitle}>Atrium Copia</Text>
        <Text style={styles.address}>Deliveries assigned to you by admin appear below.</Text>

        {driverProfile && (
          <View style={styles.card}>
            <Text style={styles.orderTitle}>{driverProfile.displayName}</Text>
            <Text style={styles.orderMeta}>{driverProfile.email}</Text>
            <Text style={styles.orderMeta}>Store: {driverProfile.storeLocation || selectedLocation}</Text>
            <View style={styles.documentGrid}>
              {driverProfile.documents.map((document) => (
                <View key={document.kind} style={styles.documentCard}>
                  <Text style={styles.orderTitle}>{document.label}</Text>
                  <Text style={styles.orderMeta}>{document.summary}</Text>
                  {document.imageUri ? (
                    <Pressable onPress={() => document.imageUri && Linking.openURL(document.imageUri)} style={styles.buttonMuted}>
                      <Text style={styles.buttonText}>Open Document</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.orderTitle}>Driver Settings</Text>
          <Text style={styles.orderMeta}>Set your profile location for terminal and dispatch hierarchy.</Text>
          <View style={styles.locationRow}>
            {VIRGINIA_STORE_LOCATIONS.map((location) => (
              <Pressable
                key={`driver-settings-${location}`}
                onPress={() => setSelectedLocation(location)}
                style={selectedLocation === location ? styles.locationChipActive : styles.locationChip}
              >
                <Text style={styles.locationChipText}>{location}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={saveDriverLocation} style={styles.button} disabled={savingLocation}>
            <Text style={styles.buttonText}>{savingLocation ? 'Saving...' : 'Save Driver Location'}</Text>
          </Pressable>
        </View>

        {driverPhotoLog.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.orderTitle}>Trip Photo Carousel</Text>
            <Text style={styles.orderMeta}>Before-trip and during-trip photos rotate here until logout.</Text>
            <View style={styles.carouselFrame}>
              <Image
                source={{ uri: driverPhotoLog[activeCarouselIndex]?.imageUri }}
                style={styles.carouselImage}
              />
              <View style={styles.carouselOverlay}>
                <View style={styles.carouselBadge}>
                  <Text style={styles.carouselBadgeText}>
                    {driverPhotoLog[activeCarouselIndex]?.phase === 'before-trip' ? 'Before trip' : 'During trip'}
                  </Text>
                </View>
                <Text style={styles.carouselCaption}>{driverPhotoLog[activeCarouselIndex]?.label}</Text>
                <Pressable onPress={() => driverPhotoLog[activeCarouselIndex]?.imageUri && Linking.openURL(driverPhotoLog[activeCarouselIndex].imageUri)}>
                  <Text style={styles.carouselLink}>Open current photo</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.rowButtons}>
              <Pressable onPress={() => captureTripPhoto('Before-trip photo')} style={styles.button}>
                <Text style={styles.buttonText}>Add Before-Trip Photo</Text>
              </Pressable>
              <Pressable onPress={() => captureTripPhoto('During-trip photo')} style={styles.buttonMuted}>
                <Text style={styles.buttonText}>Add During-Trip Photo</Text>
              </Pressable>
            </View>
          </View>
        )}

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

        <Pressable onPress={openCancelledDeliveries} style={styles.buttonMuted}>
          <Text style={styles.buttonText}>Cancelled Deliveries</Text>
        </Pressable>

        {showCancelledDeliveries && (
          <View style={styles.card}>
            <View style={styles.titleRow}>
              <Text style={styles.orderTitle}>Cancelled Deliveries</Text>
              <Pressable onPress={() => setShowCancelledDeliveries(false)} style={styles.buttonMuted}>
                <Text style={styles.buttonText}>Close</Text>
              </Pressable>
            </View>
            {cancelledDeliveries.length === 0 && <Text style={styles.orderMeta}>No cancelled deliveries are available.</Text>}
            {cancelledDeliveries.map((delivery) => (
              <View key={delivery.id} style={[styles.orderCard, !delivery.available && styles.orderCardDimmed]}>
                <Text style={styles.orderTitle}>{delivery.address}</Text>
                <Text style={styles.orderMeta}>{delivery.available ? 'Available to add to your delivery list.' : 'Selected by another driver.'}</Text>
                <Pressable disabled={!delivery.available} onPress={() => claimCancelledDelivery(delivery)} style={delivery.available ? styles.button : styles.buttonDisabled}>
                  <Text style={styles.buttonText}>{delivery.available ? 'Add Delivery' : 'Already Selected'}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {driverQueue.length === 0 && (
          <View style={styles.card}>
            <Text style={styles.orderMeta}>No deliveries assigned yet. Admin will push when ready.</Text>
          </View>
        )}

        {driverQueue.map((item, index) => (
          <View key={item.id} style={[styles.orderCard, index > 0 && styles.orderCardDimmed]}>
            <Text style={styles.orderTitle}>{item.deliveryStops?.length ? `Multi-Delivery: ${item.deliveryStops.length} stops` : `Delivery #${index + 1}`}</Text>
            <Text style={styles.orderMeta}>Hash: {item.hashSerial.slice(0, 8)}…</Text>
            {item.deliveryStops?.map((stop) => (
              <Text key={stop.requestId} style={styles.orderMeta}>Stop {stop.stopNumber}: {stop.address}</Text>
            ))}
            {index === 0 && (
              <>
                <Pressable onPress={() => openQueueItem(item)} style={styles.button}>
                  <Text style={styles.buttonText}>Open Delivery</Text>
                </Pressable>
                {cancelConfirmId === item.id ? (
                  <View style={styles.sureCard}>
                    <Text style={styles.sureTitle}>Are you sure?</Text>
                    <Text style={styles.sureBody}>This will cancel the order and log the driver action.</Text>
                    <View style={styles.rowButtons}>
                      <Pressable onPress={() => handleDriverCancel(item)} style={styles.button}>
                        <Text style={styles.buttonText}>Confirm Cancel</Text>
                      </Pressable>
                      <Pressable onPress={() => setCancelConfirmId(null)} style={styles.buttonMuted}>
                        <Text style={styles.buttonText}>Keep Order</Text>
                      </Pressable>
                    </View>
                    <View style={styles.sureCardAlt}>
                      <Text style={styles.sureTitle}>Are you sure you are sure?</Text>
                      <Text style={styles.sureBody}>Final confirmation is required before the cancel is logged.</Text>
                    </View>
                  </View>
                ) : (
                  <Pressable onPress={() => handleDriverCancel(item)} style={[styles.buttonMuted, styles.cancelSmall]}>
                    <Text style={styles.cancelSmallText}>Cancel Order</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        ))}

        {offerPrompt}

        <Pressable onPress={signOutDriver} style={[styles.buttonMuted, { marginTop: 12 }]}>
          <Text style={styles.buttonText}>Log Off and Archive Photos</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <DriverErrorBoundary>
      <DriverApp />
    </DriverErrorBoundary>
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
    backgroundColor: '#0f1114',
  },
  pagePad: {
    padding: 16,
    gap: 12,
  },
  title: {
    color: '#f2f4f7',
    fontSize: 34,
    fontWeight: '800',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  simulationToggle: {
    alignItems: 'center',
    gap: 2,
  },
  simulationLabel: {
    color: '#9ca5af',
    fontSize: 11,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9ca5af',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 6,
  },
  credentials: {
    color: '#f2f4f7',
    marginTop: 4,
  },
  address: {
    color: '#f2f4f7',
    marginTop: 6,
  },
  timer: {
    color: '#63abff',
    fontWeight: '700',
    marginTop: 6,
  },
  rowButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  button: {
    backgroundColor: '#63abff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    flexGrow: 1,
  },
  buttonMuted: {
    backgroundColor: '#b6c0cb',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    flexGrow: 1,
  },
  buttonText: {
    color: '#f2f4f7',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#171b20',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    padding: 12,
    gap: 10,
  },
  connectionPanel: {
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(99, 171, 255, 0.18)',
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    color: '#f2f4f7',
    backgroundColor: '#b6c0cb',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  camera: {
    height: 380,
    borderRadius: 14,
    overflow: 'hidden',
  },
  orderCard: {
    backgroundColor: '#171b20',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    padding: 14,
    gap: 6,
  },
  orderCardDimmed: {
    opacity: 0.45,
  },
  orderTitle: {
    color: '#f2f4f7',
    fontSize: 18,
    fontWeight: '700',
  },
  orderMeta: {
    color: '#9ca5af',
  },
  deliveryTopWrap: {
    flex: 6,
    padding: 8,
  },
  mapFallbackCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    backgroundColor: '#171b20',
    padding: 16,
    justifyContent: 'center',
    gap: 12,
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
  documentGrid: {
    gap: 10,
    marginTop: 10,
  },
  documentCard: {
    backgroundColor: '#b6c0cb',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    padding: 12,
    gap: 8,
  },
  driverChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    backgroundColor: '#b6c0cb',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  driverChipActive: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#63abff',
    backgroundColor: 'rgba(99, 171, 255, 0.18)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  driverChipText: {
    color: '#f2f4f7',
    fontWeight: '700',
  },
  locationRow: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  locationChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    backgroundColor: '#b6c0cb',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  locationChipActive: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#63abff',
    backgroundColor: '#63abff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  locationChipText: {
    color: '#05070a',
    fontWeight: '700',
    fontSize: 12,
  },
  notificationBanner: {
    marginTop: 8,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#63abff',
    backgroundColor: '#b6c0cb',
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
    color: '#63abff',
    fontWeight: '800',
  },
  notificationText: {
    color: '#f2f4f7',
  },
  notificationClose: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    backgroundColor: '#171b20',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cancelFloating: {
    position: 'absolute',
    bottom: 12,
    right: 14,
    backgroundColor: '#b6c0cb',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d46a6a',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  cancelFloatingText: {
    color: '#05070a',
    fontWeight: '700',
    fontSize: 11,
  },
  cancelSmall: {
    marginTop: 6,
    paddingVertical: 8,
  },
  cancelSmallText: {
    color: '#05070a',
    fontWeight: '700',
    fontSize: 12,
  },
  buttonDisabled: {
    backgroundColor: '#5c6974',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    opacity: 0.45,
  },
  offerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 8, 12, 0.82)',
    justifyContent: 'center',
    padding: 20,
  },
  offerCard: {
    backgroundColor: '#1e242b',
    borderColor: '#63abff',
    borderWidth: 2,
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  offerEyebrow: {
    color: '#63abff',
    fontSize: 12,
    fontWeight: '800',
  },
  offerTitle: {
    color: '#f2f4f7',
    fontSize: 26,
    fontWeight: '800',
  },
  sureCard: {
    backgroundColor: '#0f1114',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    padding: 10,
    gap: 8,
    marginTop: 6,
  },
  sureCardAlt: {
    backgroundColor: '#161a20',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.32)',
    padding: 10,
    gap: 8,
    marginTop: 6,
  },
  sureTitle: {
    color: '#f2f4f7',
    fontWeight: '800',
  },
  sureBody: {
    color: '#9ca5af',
  },
  carouselFrame: {
    position: 'relative',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    overflow: 'hidden',
    backgroundColor: '#0f1114',
    minHeight: 220,
  },
  carouselImage: {
    width: '100%',
    height: 260,
  },
  carouselOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 17, 20, 0.76)',
  },
  carouselBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(99, 171, 255, 0.18)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  carouselBadgeText: {
    color: '#63abff',
    fontWeight: '700',
    fontSize: 12,
  },
  carouselCaption: {
    color: '#f2f4f7',
    fontWeight: '700',
    fontSize: 16,
  },
  carouselLink: {
    color: '#63abff',
    marginTop: 4,
    fontWeight: '700',
  },
});

