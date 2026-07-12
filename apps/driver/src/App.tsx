import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { recordDriverCompletion } from '../../../packages/shared/src/mockHandoff';
import { authenticateProfile, ProfileRecord } from '../../../packages/shared/src/profileVault';
import {
  archiveDriverPhotosToServer,
  closeDriverNotification,
  DriverNotification,
  DriverPhotoArchiveEntry,
  fetchDriverNotifications,
  sendDriverPing,
  saveProfileToServer,
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

export default function App() {
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
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const notificationSlide = useRef(new Animated.Value(-380)).current;

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
    if (!cleanEmail.includes('@') || cleanPassword.length < 6 || licenseScanUri.length === 0) {
      Alert.alert('Sign-in required', 'Enter your driver email, password, and scan your license first.');
      return;
    }

    try {
      const profile = authenticateProfile(cleanEmail, cleanPassword);
      if (!profile || profile.role !== 'driver') {
        Alert.alert('Sign-in required', 'No matching driver profile was found for that email.');
        return;
      }

      let uploadedLicenseUri = licenseScanUri;
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

      try {
        const selectedStoreLocation = normalizeVirginiaStoreLocation(selectedLocation);
        await saveProfileToServer({
          ...profile,
          storeLocation: selectedStoreLocation,
          licenseImageUri: uploadedLicenseUri,
          documents: profile.documents,
        });
      } catch (_saveError) {
        // Keep sign-in working offline; the license image will be retried on the next login.
      }

      const profileWithLocation = {
        ...profile,
        storeLocation: normalizeVirginiaStoreLocation(selectedLocation),
      };
      setDriverProfile(profileWithLocation);
      setSelectedLocation(profileWithLocation.storeLocation || VIRGINIA_STORE_LOCATIONS[0]);
      setSignedIn(true);
    } catch (_error) {
      Alert.alert('Sign-in required', 'No matching driver profile was found for that email.');
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

  if (!signedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.pagePad}>
          <Text style={styles.title}>Verdium Driver</Text>
          <Text style={styles.subtitle}>Atrium Copia</Text>
          <Text style={styles.address}>Driver sign-in requires an email, password, and a scanned driver's license.</Text>

          <View style={styles.card}>
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
                {cancelConfirmId === activeOrder.id ? 'Are you sure? Tap again' : 'Cancel Order'}
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
                    <Pressable onPress={() => Linking.openURL(document.imageUri)} style={styles.buttonMuted}>
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
                <Pressable onPress={() => Linking.openURL(driverPhotoLog[activeCarouselIndex]?.imageUri)}>
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

        <Pressable onPress={signOutDriver} style={[styles.buttonMuted, { marginTop: 12 }]}>
          <Text style={styles.buttonText}>Log Off and Archive Photos</Text>
        </Pressable>
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

