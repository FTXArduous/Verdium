import React, { Component, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { getCustomerDeliveryProofs } from '../../../packages/shared/src/mockHandoff';
import { authenticateProfile } from '../../../packages/shared/src/profileVault';
import { generateTestHash } from '../../../packages/shared/src/security';
import { normalizeVirginiaStoreLocation, VIRGINIA_STORE_LOCATIONS } from '../../../packages/shared/src/storeLocations';
import {
  CustomerDeliveryRecord,
  ProfileRecord,
  CustomerRequestRecord,
  cancelCustomerRequestToServer,
  connectToTerminalHost,
  fetchCustomerDeliveriesFromServer,
  fetchCustomerRequestsFromServer,
  fetchProfilesFromServer,
  saveProfileToServer,
  setServerSimulationEnabled,
  submitCustomerRequestToServer,
  uploadProfileImageToServer,
} from '../../../packages/shared/src/serverApi';

type CustomerErrorBoundaryProps = {
  children: ReactNode;
};

type CustomerErrorBoundaryState = {
  error: Error | null;
};

class CustomerErrorBoundary extends Component<CustomerErrorBoundaryProps, CustomerErrorBoundaryState> {
  state: CustomerErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): CustomerErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[Verdium Customer] render failure', error);
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.loginShell}>
            <Text style={styles.title}>Verdium Customer</Text>
            <Text style={styles.subtitle}>Atrium Copia</Text>
            <View style={styles.card}>
              <Text style={styles.orderTitle}>Customer startup needs attention</Text>
              <Text style={styles.muted}>The customer app stayed open instead of closing. Reopen it to retry the local startup path.</Text>
            </View>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

function CustomerApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [customerEmail, setCustomerEmail] = useState('customer@verdium.example');
  const [customerPassword, setCustomerPassword] = useState('CustomerVerdium!2026');
  const [customerProfile, setCustomerProfile] = useState<ProfileRecord | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>(VIRGINIA_STORE_LOCATIONS[0]);
  const [savingLocation, setSavingLocation] = useState(false);
  const [licenseScanUri, setLicenseScanUri] = useState('');
  const [scanningLicense, setScanningLicense] = useState(false);
  const [customerRequests, setCustomerRequests] = useState<CustomerRequestRecord[]>([]);
  const [cancelConfirmId, setCancelConfirmId] = useState('');
  const [activeTab, setActiveTab] = useState<'home' | 'browser' | 'settings'>('home');
  const [browserMode, setBrowserMode] = useState<'regular' | 'incognito'>('regular');
  const [refreshCount, setRefreshCount] = useState(0);
  const [deliveries, setDeliveries] = useState<CustomerDeliveryRecord[]>([]);
  const [latestNotification, setLatestNotification] = useState<CustomerDeliveryRecord | null>(null);
  const [lastDeliverySignature, setLastDeliverySignature] = useState('');
  const [address, setAddress] = useState('');
  const [hashSerial, setHashSerial] = useState('');
  const [qrToken, setQrToken] = useState('');
  const [requestSending, setRequestSending] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('https://www.google.com');
  const [startupServerMode, setStartupServerMode] = useState<'checking' | 'online' | 'offline'>('checking');
  const [wifiSimulationEnabled, setWifiSimulationEnabled] = useState(false);
  const [terminalHost, setTerminalHost] = useState('');
  const [deviceName, setDeviceName] = useState('Customer phone');
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [terminalMessage, setTerminalMessage] = useState('');

  const setWifiSimulation = (enabled: boolean) => {
    setServerSimulationEnabled(enabled);
    setWifiSimulationEnabled(enabled);
    setTerminalConnected(false);
    setStartupServerMode(enabled ? 'offline' : 'checking');
    if (enabled) {
      const simulationId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      setCustomerEmail(`customer-${simulationId}@fakeemail.com`);
      setCustomerPassword('WifiSimulation!2026');
      setCustomerRequests([]);
      setDeliveries([]);
      setLatestNotification(null);
    }
  };

  const connectToTerminal = async () => {
    try {
      const simulationId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
      const result = await connectToTerminalHost({
        hostUrl: terminalHost,
        deviceId: `customer-${simulationId}`,
        deviceName: deviceName.trim() || 'Customer phone',
        role: 'customer',
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

  const refreshRequests = useCallback(async (customerId: string) => {
    try {
      const requests = await fetchCustomerRequestsFromServer(customerId);
      setCustomerRequests(requests);
    } catch (_error) {
      setCustomerRequests([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const serverDeliveries = await fetchCustomerDeliveriesFromServer();
      setStartupServerMode('online');
      setDeliveries(serverDeliveries);
      const newest = serverDeliveries[0] || null;
      const signature = newest ? `${newest.orderId}-${newest.deliveredAt}` : '';
      if (newest && signature !== lastDeliverySignature) {
        setLatestNotification(newest);
        if (lastDeliverySignature) {
          Alert.alert('New delivery notification', `${newest.orderId} has a new delivery photo.`);
        }
        setLastDeliverySignature(signature);
      }
      return;
    } catch (_error) {
      setStartupServerMode('offline');
      const fallback = getCustomerDeliveryProofs().map((item) => ({
        orderId: item.orderId,
        address: item.address,
        imageUri: item.imageUri,
        deliveredAt: item.deliveredAt,
      }));
      setDeliveries(fallback);
      const newest = fallback[0] || null;
      const signature = newest ? `${newest.orderId}-${newest.deliveredAt}` : '';
      if (newest && signature !== lastDeliverySignature) {
        setLatestNotification(newest);
        setLastDeliverySignature(signature);
      }
    }
  }, [lastDeliverySignature]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 7000);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    Alert.alert('Verdium Notice', 'Please confirm with dispensary that they are affiliated with Verdium.');
  }, []);

  useEffect(() => {
    if (!signedIn || !customerProfile) {
      setCustomerRequests([]);
      return;
    }

    refreshRequests(customerProfile.email);
    const interval = setInterval(() => refreshRequests(customerProfile.email), 7000);
    return () => clearInterval(interval);
  }, [customerProfile, refreshRequests, signedIn]);

  const signInCustomer = async () => {
    const cleanEmail = customerEmail.trim().toLowerCase();
    const cleanPassword = customerPassword.trim();
    if (!cleanEmail.includes('@') || cleanPassword.length < 6) {
      Alert.alert('Sign-in required', 'Enter your email and password to continue.');
      return;
    }

    const fallbackProfile: ProfileRecord = {
      email: cleanEmail,
      password: cleanPassword,
      displayName: cleanEmail.split('@')[0] || 'Customer',
      role: 'customer',
      storeLocation: normalizeVirginiaStoreLocation(selectedLocation),
      documents: [],
    };

    try {
      const remoteProfiles = await fetchProfilesFromServer(undefined, cleanEmail);
      const remoteProfile = remoteProfiles.find((profile) => profile.email === cleanEmail && profile.password === cleanPassword);
      const localProfile = authenticateProfile(cleanEmail, cleanPassword);
      const profile = (remoteProfile || localProfile || fallbackProfile);
      const effectiveProfile = profile.role === 'driver' ? fallbackProfile : profile;

      let uploadedLicenseUri = licenseScanUri;
      if (licenseScanUri.length > 0) {
        try {
          const imageBase64 = await FileSystem.readAsStringAsync(licenseScanUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const uploaded = await uploadProfileImageToServer({
            imageBase64,
            mimeType: 'image/jpeg',
            fileName: `customer-license-${Date.now()}.jpg`,
            folder: `profiles/customer/${cleanEmail}`,
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
      setCustomerProfile(profileWithLocation);
      setSelectedLocation(profileWithLocation.storeLocation || VIRGINIA_STORE_LOCATIONS[0]);
      setSignedIn(true);
      await refreshRequests(profileWithLocation.email);
    } catch (_error) {
      const profileWithLocation = {
        ...fallbackProfile,
        storeLocation: normalizeVirginiaStoreLocation(selectedLocation),
      };
      setCustomerProfile(profileWithLocation);
      setSelectedLocation(profileWithLocation.storeLocation || VIRGINIA_STORE_LOCATIONS[0]);
      setSignedIn(true);
      await refreshRequests(profileWithLocation.email);
    }
  };

  const saveCustomerLocation = async () => {
    if (!customerProfile) {
      return;
    }

    setSavingLocation(true);
    const locationToSave = normalizeVirginiaStoreLocation(selectedLocation);
    const updatedProfile = {
      ...customerProfile,
      storeLocation: locationToSave,
      documents: customerProfile.documents,
    };
    try {
      await saveProfileToServer(updatedProfile);
      setCustomerProfile(updatedProfile);
      Alert.alert('Profile updated', `Store location saved as ${locationToSave}.`);
    } catch (_error) {
      Alert.alert('Update failed', 'Could not save your profile location right now.');
    } finally {
      setSavingLocation(false);
    }
  };

  const requestLicenseScan = async () => {
    setScanningLicense(true);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera denied', 'Camera permission is required to capture the license image.');
      setScanningLicense(false);
      return;
    }

    const photo = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (photo.canceled || !photo.assets?.[0]?.uri) {
      Alert.alert('Scan failed', 'No license image was captured.');
      setScanningLicense(false);
      return;
    }

    setLicenseScanUri(photo.assets[0].uri);
    setScanningLicense(false);
  };

  const cancelCustomerRequest = async (request: CustomerRequestRecord) => {
    if (cancelConfirmId !== request.id) {
      setCancelConfirmId(request.id);
      return;
    }

    if (!customerProfile) {
      return;
    }

    try {
      await cancelCustomerRequestToServer(request.id, customerProfile.email);
      await refreshRequests(customerProfile.email);
      setCancelConfirmId('');
    } catch (_error) {
      Alert.alert('Cancel failed', 'Could not cancel that order.');
    }
  };

  const submitRequest = async () => {
    const cleanHash = hashSerial.replace(/\s+/g, '').toUpperCase();
    const customerId = customerProfile?.email || customerEmail.trim().toLowerCase();
    if (!address || !qrToken || !/^[A-Z0-9]{48}$/.test(cleanHash)) {
      Alert.alert('Invalid request', 'Address, QR token, and a valid 48-character hash are required.');
      return;
    }

    setRequestSending(true);
    try {
      await submitCustomerRequestToServer(
        {
          customerId,
          address,
          hashSerial: cleanHash,
          qrToken,
        },
      );
      setAddress('');
      setHashSerial('');
      setQrToken('');
      Alert.alert('Request sent', 'Delivery request with hash and QR token was sent to admin.');
      if (customerProfile) {
        await refreshRequests(customerProfile.email);
      }
    } catch (_error) {
      Alert.alert('Send failed', 'Unable to reach server-cache endpoint.');
    } finally {
      setRequestSending(false);
    }
  };

  if (!signedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loginShell}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Verdium Customer</Text>
            {simulationToggle}
          </View>
          <Text style={styles.subtitle}>Atrium Copia</Text>
          <Text style={styles.description}>Customer sign-in requires an email and password. License scan is recommended but not required.</Text>
          <Text style={styles.muted}>
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
                {terminalMessage.length > 0 && <Text style={styles.muted}>{terminalMessage}</Text>}
              </View>
            )}
            <TextInput
              value={customerEmail}
              onChangeText={setCustomerEmail}
              placeholder="Email address"
              placeholderTextColor="#9fb2bf"
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              value={customerPassword}
              onChangeText={setCustomerPassword}
              placeholder="Password"
              placeholderTextColor="#9fb2bf"
              secureTextEntry
              style={styles.input}
            />
            <Text style={styles.muted}>Select Store Location</Text>
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
            <Pressable onPress={requestLicenseScan} style={styles.buttonMuted}>
              <Text style={styles.buttonText}>{scanningLicense ? 'License Scan Open' : 'Scan License'}</Text>
            </Pressable>
            {licenseScanUri.length > 0 && (
              <Pressable onPress={() => Linking.openURL(licenseScanUri)} style={styles.buttonMuted}>
                <Text style={styles.buttonText}>Review License Scan</Text>
              </Pressable>
            )}
            <Pressable onPress={signInCustomer} style={styles.button}>
              <Text style={styles.buttonText}>Sign In</Text>
            </Pressable>
          </View>
          {scanningLicense && <Text style={styles.muted}>License capture uses the device camera when you tap Scan License.</Text>}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.contentWrap}>
        {activeTab === 'home' && (
          <ScrollView contentContainerStyle={styles.pagePad}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Verdium</Text>
              {simulationToggle}
            </View>
            <Text style={styles.subtitle}>Atrium Copia</Text>
            <Text style={styles.description}>
              Customer delivery feed. When a driver completes delivery with camera proof, a link appears below.
            </Text>

            {customerProfile && (
              <View style={styles.profileGrid}>
                <View style={styles.profileCard}>
                  <Text style={styles.orderTitle}>{customerProfile.displayName}</Text>
                  <Text style={styles.muted}>{customerProfile.email}</Text>
                  <Text style={styles.muted}>Role: {customerProfile.role}</Text>
                  <Text style={styles.muted}>Store: {customerProfile.storeLocation || selectedLocation}</Text>
                </View>
                {customerProfile.documents.map((document) => (
                  <View key={document.kind} style={styles.profileCard}>
                    <Text style={styles.orderTitle}>{document.label}</Text>
                    <Text style={styles.muted}>{document.summary}</Text>
                    {document.imageUri ? (
                      <Pressable onPress={() => document.imageUri && Linking.openURL(document.imageUri)} style={styles.buttonMuted}>
                        <Text style={styles.buttonText}>Open Document Image</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.muted}>Document stored in profile card.</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {latestNotification && (
              <View style={styles.notificationCard}>
                <View style={styles.notificationThumbWrap}>
                  <Image source={{ uri: latestNotification.imageUri }} style={styles.notificationThumb} />
                </View>
                <View style={styles.notificationBody}>
                  <Text style={styles.notificationTitle}>Delivery Notification</Text>
                  <Text style={styles.notificationText}>{latestNotification.orderId}</Text>
                  <Text style={styles.notificationText}>{latestNotification.address}</Text>
                  <Text style={styles.notificationText}>Delivered: {latestNotification.deliveredAt}</Text>
                </View>
              </View>
            )}

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
                placeholderTextColor="#9ca5af"
                autoCapitalize="characters"
                style={styles.input}
              />
              <Pressable onPress={() => setHashSerial(generateTestHash())} style={styles.buttonMuted}>
                <Text style={styles.buttonText}>Generate Test Hash</Text>
              </Pressable>
              <TextInput
                value={qrToken}
                onChangeText={setQrToken}
                placeholder="QR token"
                placeholderTextColor="#9ca5af"
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
                <Image source={{ uri: delivery.imageUri }} style={styles.deliveryThumb} />
                <Pressable onPress={() => Linking.openURL(delivery.imageUri)} style={styles.buttonMuted}>
                  <Text style={styles.buttonText}>View Delivery Image</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        {activeTab === 'browser' && (
          <View style={styles.browserWrap}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Browser</Text>
              {simulationToggle}
            </View>
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
              <View style={styles.browserPreview}>
                <Text style={styles.muted}>Embedded WebView is disabled in release mode for stability.</Text>
                <Text style={styles.muted}>Use Open In Phone Browser to continue.</Text>
              </View>
            </View>

          {customerRequests.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.orderTitle}>My Requests</Text>
              {customerRequests.map((request) => (
                <View key={request.id} style={styles.requestCard}>
                  <Text style={styles.muted}>{request.id}</Text>
                  <Text style={styles.orderTitle}>{request.address}</Text>
                  <Text style={styles.muted}>Status: {request.status}</Text>
                  <Text style={styles.muted}>Hash: {request.hashSerial.slice(0, 8)}…</Text>
                  {cancelConfirmId === request.id && (
                    <View style={styles.sureCard}>
                      <Text style={styles.sureTitle}>Are you sure?</Text>
                      <Text style={styles.sureBody}>This will cancel the order and log the cancellation.</Text>
                      <Pressable onPress={() => cancelCustomerRequest(request)} style={styles.buttonMuted}>
                        <Text style={styles.buttonText}>Confirm Cancel</Text>
                      </Pressable>
                      <Pressable onPress={() => setCancelConfirmId('')} style={styles.buttonMuted}>
                        <Text style={styles.buttonText}>Keep Order</Text>
                      </Pressable>
                    </View>
                  )}
                  {cancelConfirmId === request.id && (
                    <View style={styles.sureCardAlt}>
                      <Text style={styles.sureTitle}>Are you sure you are sure?</Text>
                      <Text style={styles.sureBody}>Final confirmation is required before the cancellation is logged.</Text>
                    </View>
                  )}
                  <Pressable onPress={() => cancelCustomerRequest(request)} style={styles.buttonMuted}>
                    <Text style={styles.buttonText}>Cancel Order</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          </View>
        )}

        {activeTab === 'settings' && (
          <View style={styles.browserWrap}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Settings</Text>
              {simulationToggle}
            </View>
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
            <View style={styles.card}>
              <Text style={styles.orderTitle}>Profile Store Location</Text>
              <Text style={styles.muted}>Choose your client profile location for requests and terminal routing.</Text>
              <View style={styles.locationRow}>
                {VIRGINIA_STORE_LOCATIONS.map((location) => (
                  <Pressable
                    key={`settings-${location}`}
                    onPress={() => setSelectedLocation(location)}
                    style={selectedLocation === location ? styles.locationChipActive : styles.locationChip}
                  >
                    <Text style={styles.locationChipText}>{location}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={saveCustomerLocation} style={styles.button} disabled={savingLocation}>
                <Text style={styles.buttonText}>{savingLocation ? 'Saving...' : 'Save Profile Location'}</Text>
              </Pressable>
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

export default function App() {
  return (
    <CustomerErrorBoundary>
      <CustomerApp />
    </CustomerErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1114',
  },
  pagePad: {
    padding: 16,
    gap: 12,
    paddingBottom: 120,
  },
  contentWrap: {
    flex: 1,
  },
  loginShell: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    gap: 14,
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
  },
  description: {
    color: '#f2f4f7',
    marginBottom: 6,
  },
  card: {
    backgroundColor: '#171b20',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    padding: 14,
    gap: 6,
  },
  connectionPanel: {
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(99, 171, 255, 0.18)',
  },
  profileGrid: {
    gap: 10,
  },
  profileCard: {
    backgroundColor: '#171b20',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    padding: 12,
    gap: 6,
  },
  notificationCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#1e242b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#63abff',
    padding: 12,
    alignItems: 'center',
  },
  notificationThumbWrap: {
    width: 88,
    height: 88,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0f1114',
  },
  notificationThumb: {
    width: '100%',
    height: '100%',
  },
  notificationBody: {
    flex: 1,
    gap: 2,
  },
  notificationTitle: {
    color: '#63abff',
    fontWeight: '800',
    fontSize: 16,
  },
  notificationText: {
    color: '#f2f4f7',
  },
  orderTitle: {
    color: '#f2f4f7',
    fontWeight: '700',
    fontSize: 17,
  },
  muted: {
    color: '#9ca5af',
  },
  button: {
    backgroundColor: '#63abff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  buttonMuted: {
    marginTop: 6,
    backgroundColor: '#b6c0cb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    color: '#f2f4f7',
    backgroundColor: '#1e242b',
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
    borderColor: 'rgba(99, 171, 255, 0.18)',
    overflow: 'hidden',
    backgroundColor: '#171b20',
  },
  browserPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  camera: {
    height: 380,
    borderRadius: 14,
    overflow: 'hidden',
  },
  rowButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  deliveryThumb: {
    width: '100%',
    height: 180,
    borderRadius: 14,
    backgroundColor: '#0f1114',
    marginTop: 4,
  },
  footerTabs: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(99, 171, 255, 0.18)',
    backgroundColor: '#171b20',
  },
  footerTab: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    backgroundColor: '#b6c0cb',
    paddingVertical: 11,
    alignItems: 'center',
  },
  footerTabActive: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#63abff',
    backgroundColor: '#63abff',
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
    borderColor: 'rgba(99, 171, 255, 0.18)',
    backgroundColor: '#b6c0cb',
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  modeButtonActive: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#63abff',
    backgroundColor: '#63abff',
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  locationRow: {
    marginTop: 6,
    marginBottom: 6,
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
  buttonText: {
    color: '#05070a',
    fontWeight: '700',
  },
  requestCard: {
    marginTop: 10,
    backgroundColor: '#1e242b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(99, 171, 255, 0.18)',
    padding: 12,
    gap: 6,
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
});
