import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Appearance,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { LivePhotoView } from 'expo-live-photo';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import MapView, { Marker, Region } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  loadAppearance,
  loadCategories,
  loadMemories,
  saveAppearance,
  saveCategories,
  saveMemories,
} from './src/storage';
import { archiveApplePhotosAsset, removeMemoryArchive } from './src/archive';
import { categoryColors, categorySymbols, defaultCategories, palette, personalTags } from './src/theme';
import type {
  AtlasMemory,
  DraftPhoto,
  LocationSource,
  MapDisplayMode,
  MemoryAddress,
  MemoryCategory,
  MemoryMedia,
  ReturnIntent,
} from './src/types';

const DEFAULT_REGION: Region = {
  latitude: 35.681236,
  longitude: 139.767125,
  latitudeDelta: 0.18,
  longitudeDelta: 0.18,
};

const TAB_BAR_HEIGHT = 72;
const TAB_BAR_EXTRA_GAP = 10;
const PHOTO_MARKER_LATITUDE_DELTA = 0.75;

const returnOptions: ReturnIntent[] = ['一定会', '也许会', '不会', '不适用'];

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatDate(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
    d.getDate()
  ).padStart(2, '0')}`;
}


function monthKeyFromMs(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthKeyLabel(key: string) {
  const [year, month] = key.split('-');
  return `${year}年${Number(month)}月`;
}

function monthBounds(key: string) {
  const [yearRaw, monthRaw] = key.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 1).getTime();
  return { start, end };
}

function buildMonthKeys(latestMs: number, earliestMs: number) {
  if (!Number.isFinite(latestMs) || !Number.isFinite(earliestMs)) return [];
  const latest = new Date(latestMs);
  const earliest = new Date(earliestMs);
  const cursor = new Date(latest.getFullYear(), latest.getMonth(), 1);
  const stop = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  const keys: string[] = [];
  let guard = 0;

  while (cursor.getTime() >= stop.getTime() && guard < 1200) {
    keys.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    );
    cursor.setMonth(cursor.getMonth() - 1);
    guard += 1;
  }

  return keys;
}

function yearOfMemory(memory: AtlasMemory) {
  return new Date(memory.shotAt).getFullYear();
}

function monthOfMemory(memory: AtlasMemory) {
  return new Date(memory.shotAt).getMonth() + 1;
}

function coordText(lat: number, lon: number) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function normalizeCoordinate(
  lat: unknown,
  lon: unknown
): { latitude: number; longitude: number } | null {
  const latitude =
    typeof lat === 'number' ? lat : typeof lat === 'string' ? Number(lat) : NaN;
  const longitude =
    typeof lon === 'number' ? lon : typeof lon === 'string' ? Number(lon) : NaN;

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  return normalizeCoordinate(lat, lon) !== null;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

function regionFor(lat: number, lon: number, delta = 0.02): Region {
  return {
    latitude: lat,
    longitude: lon,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}


const PI = Math.PI;
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function isMainlandChinaCoordinate(latitude: number, longitude: number) {
  return (
    longitude >= 72.004 &&
    longitude <= 137.8347 &&
    latitude >= 0.8293 &&
    latitude <= 55.8271
  );
}

function transformChinaLat(x: number, y: number) {
  let result =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  result +=
    ((20.0 * Math.sin(6.0 * x * PI) +
      20.0 * Math.sin(2.0 * x * PI)) *
      2.0) /
    3.0;
  result +=
    ((20.0 * Math.sin(y * PI) +
      40.0 * Math.sin((y / 3.0) * PI)) *
      2.0) /
    3.0;
  result +=
    ((160.0 * Math.sin((y / 12.0) * PI) +
      320 * Math.sin((y * PI) / 30.0)) *
      2.0) /
    3.0;
  return result;
}

function transformChinaLon(x: number, y: number) {
  let result =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  result +=
    ((20.0 * Math.sin(6.0 * x * PI) +
      20.0 * Math.sin(2.0 * x * PI)) *
      2.0) /
    3.0;
  result +=
    ((20.0 * Math.sin(x * PI) +
      40.0 * Math.sin((x / 3.0) * PI)) *
      2.0) /
    3.0;
  result +=
    ((150.0 * Math.sin((x / 12.0) * PI) +
      300.0 * Math.sin((x / 30.0) * PI)) *
      2.0) /
    3.0;
  return result;
}

function wgs84ToGcj02(latitude: number, longitude: number) {
  if (!isMainlandChinaCoordinate(latitude, longitude)) {
    return { latitude, longitude };
  }

  let dLat = transformChinaLat(longitude - 105.0, latitude - 35.0);
  let dLon = transformChinaLon(longitude - 105.0, latitude - 35.0);
  const radLat = (latitude / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  dLat =
    (dLat * 180.0) /
    (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * PI);
  dLon =
    (dLon * 180.0) /
    ((GCJ_A / sqrtMagic) * Math.cos(radLat) * PI);

  return {
    latitude: latitude + dLat,
    longitude: longitude + dLon,
  };
}

function mapCoordinate(
  latitude: number,
  longitude: number,
  mode: MapDisplayMode | undefined
) {
  return mode === 'china-corrected'
    ? wgs84ToGcj02(latitude, longitude)
    : { latitude, longitude };
}

function memoryMapCoordinate(memory: AtlasMemory) {
  const mode =
    memory.mapDisplayMode ||
    (memory.locationSource === 'photo' &&
    isMainlandChinaCoordinate(memory.latitude, memory.longitude)
      ? 'china-corrected'
      : 'raw');
  return mapCoordinate(memory.latitude, memory.longitude, mode);
}

function markerTextColor(hex: string) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return '#202722';
  const raw = match[1];
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 155 ? '#202722' : '#FFFFFF';
}

function categoryFor(categories: MemoryCategory[], id: string) {
  return (
    categories.find((item) => item.id === id) ||
    categories.find((item) => item.id === 'uncategorized') ||
    defaultCategories.find((item) => item.id === 'uncategorized')!
  );
}

function colorWash(hex: string, alpha = '1F') {
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? `${hex}${alpha}` : '#EEEAE2';
}

function dedupeMediaAssets(
  items: MediaLibrary.Asset[]
): MediaLibrary.Asset[] {
  const seen = new Set<string>();
  const result: MediaLibrary.Asset[] = [];

  for (const item of items) {
    const id = String(item?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }

  return result;
}


function memoryMediaItems(memory: AtlasMemory): MemoryMedia[] {
  if (Array.isArray(memory.mediaItems) && memory.mediaItems.length) {
    return memory.mediaItems;
  }

  return [
    {
      id: `legacy_${memory.id}`,
      assetId: memory.assetId,
      assetUri: memory.assetUri,
      filename: 'photo',
      shotAt: memory.shotAt,
      mediaKind: memory.mediaKind,
      originalPhotoLocalUri: memory.originalPhotoLocalUri,
      originalPairedVideoUri: memory.originalPairedVideoUri,
      archiveStatus: memory.archiveStatus,
      archivedPhotoUri: memory.archivedPhotoUri,
      archivedPairedVideoUri: memory.archivedPairedVideoUri,
      archiveError: memory.archiveError,
    },
  ];
}

function coverMedia(memory: AtlasMemory): MemoryMedia {
  // v0.6.6: photo order is the only rule. The first item is always the
  // display photo used by map markers, cards and the initial detail page.
  return memoryMediaItems(memory)[0];
}

function mediaPhotoUri(media: MemoryMedia) {
  return media.archivedPhotoUri || media.assetUri || media.assetId;
}

function memoryPhotoUri(memory: AtlasMemory) {
  return mediaPhotoUri(coverMedia(memory));
}

function summarizeArchiveStatus(mediaItems: MemoryMedia[]) {
  if (!mediaItems.length) return 'reference-only' as const;
  if (mediaItems.every((item) => item.archiveStatus === 'archived')) {
    return 'archived' as const;
  }
  if (
    mediaItems.some(
      (item) =>
        item.archiveStatus === 'archived' ||
        item.archiveStatus === 'partial'
    )
  ) {
    return 'partial' as const;
  }
  if (mediaItems.every((item) => item.archiveStatus === 'failed')) {
    return 'failed' as const;
  }
  return 'reference-only' as const;
}

function mirrorCoverMemory(memory: AtlasMemory): AtlasMemory {
  const items = memoryMediaItems(memory);
  const cover = items[0];

  return {
    ...memory,
    mediaItems: items,
    // Kept only for old saved data / migration compatibility.
    // Product behavior no longer exposes a separate “cover” concept.
    coverMediaId: cover.id,
    assetId: cover.assetId,
    assetUri: cover.assetUri,
    originalPhotoLocalUri: cover.originalPhotoLocalUri,
    originalPairedVideoUri: cover.originalPairedVideoUri,
    mediaKind: cover.mediaKind,
    archiveStatus: summarizeArchiveStatus(items),
    archivedPhotoUri: cover.archivedPhotoUri,
    archivedPairedVideoUri: cover.archivedPairedVideoUri,
    archiveError: cover.archiveError,
  };
}

function draftToMedia(draft: DraftPhoto, index: number): MemoryMedia {
  return {
    id: `media_${uid()}_${index}`,
    assetId: draft.assetId,
    assetUri: draft.assetUri,
    filename: draft.filename,
    shotAt: draft.shotAt,
    mediaKind: draft.mediaKind,
    originalPhotoLocalUri: draft.photoLocalUri,
    originalPairedVideoUri: draft.pairedVideoAssetUri,
    archiveStatus: 'reference-only',
  };
}

function uniqueAddressParts(parts: Array<string | null | undefined>) {
  const result: string[] = [];
  for (const raw of parts) {
    const value = raw?.trim();
    if (!value) continue;
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function normalizedAddressParts(item: any) {
  return uniqueAddressParts([
    item.country,
    item.region,
    item.city,
    item.district,
    !item.region && !item.city && !item.district
      ? item.subregion
      : undefined,
  ]);
}

const addressMemoryCache = new Map<string, MemoryAddress>();
let lastNominatimRequestAt = 0;

async function promiseWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: any = null;

  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function addressCacheKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

function osmAddressParts(address: any) {
  const countryCode = String(address?.country_code || '')
    .trim()
    .toUpperCase();

  const country = address?.country || undefined;

  const region =
    address?.state ||
    address?.province ||
    address?.region ||
    undefined;

  const city =
    address?.city ||
    address?.municipality ||
    address?.town ||
    address?.village ||
    address?.county ||
    undefined;

  const district =
    address?.city_district ||
    address?.district ||
    address?.suburb ||
    address?.borough ||
    undefined;

  return {
    countryCode,
    country,
    region,
    city,
    district,
  };
}

async function reverseGeocodeViaPhoton(
  latitude: number,
  longitude: number
): Promise<MemoryAddress | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);

    const url =
      'https://photon.komoot.io/reverse' +
      `?lon=${encodeURIComponent(String(longitude))}` +
      `&lat=${encodeURIComponent(String(latitude))}` +
      '&limit=1';

    let response: Response;

    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Photon reverse HTTP ${response.status}`);
    }

    const data = await response.json();
    const feature = data?.features?.[0];
    const props = feature?.properties;

    if (!props) return undefined;

    const countryCode = String(
      props.countrycode || props.country_code || ''
    )
      .trim()
      .toUpperCase();

    const country = props.country || undefined;

    const region =
      props.state ||
      props.region ||
      props.county ||
      undefined;

    const city =
      props.city ||
      props.town ||
      props.village ||
      props.locality ||
      undefined;

    const district =
      props.district ||
      props.suburb ||
      undefined;

    const parts = uniqueAddressParts([
      country,
      region,
      city,
      district,
    ]);

    const result: MemoryAddress | undefined =
      parts.length || props.name
        ? {
            label:
              parts.join(' · ') ||
              props.name ||
              country ||
              '已读取地点',
            geocodeSource: 'photon',
            attribution:
              '地点数据 © OpenStreetMap contributors · Photon',
            country: country || undefined,
            isoCountryCode: countryCode || undefined,
            region,
            city,
            district,
            name: props.name || undefined,
          }
        : undefined;

    console.log('[Mappory][ADDRESS][PHOTON] reverse result', {
      latitude,
      longitude,
      result: result || null,
    });

    return result;
  } catch (error) {
    console.warn('[Mappory][ADDRESS][PHOTON] reverse failed', {
      latitude,
      longitude,
      error: errorMessage(error),
    });

    return undefined;
  }
}

async function reverseGeocodeViaOsm(
  latitude: number,
  longitude: number
): Promise<MemoryAddress | undefined> {
  try {
    // OSMF public Nominatim policy: keep requests <= 1/sec.
    const elapsed = Date.now() - lastNominatimRequestAt;
    if (elapsed < 1100) {
      await new Promise((resolve) =>
        setTimeout(resolve, 1100 - elapsed)
      );
    }

    lastNominatimRequestAt = Date.now();

    const url =
      'https://nominatim.openstreetmap.org/reverse' +
      `?format=jsonv2&addressdetails=1&zoom=12` +
      `&lat=${encodeURIComponent(String(latitude))}` +
      `&lon=${encodeURIComponent(String(longitude))}`;

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 5500);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mappory/0.6.8 (personal-beta)',
          Accept: 'application/json',
        },
      });
    } finally {
      clearTimeout(abortTimer);
    }

    if (!response.ok) {
      throw new Error(`OSM reverse HTTP ${response.status}`);
    }

    const data = await response.json();
    const parts = osmAddressParts(data?.address || {});
    const labelParts = uniqueAddressParts([
      parts.country,
      parts.region,
      parts.city,
      parts.district,
    ]);

    const result: MemoryAddress | undefined =
      labelParts.length || data?.display_name
        ? {
            label:
              labelParts.join(' · ') ||
              String(data.display_name),
            geocodeSource: 'osm',
            attribution: '地点数据 © OpenStreetMap contributors',
            country: parts.country || undefined,
            isoCountryCode: parts.countryCode || undefined,
            region: parts.region,
            city: parts.city,
            district: parts.district,
            name: data?.name || undefined,
          }
        : undefined;

    console.log('[Mappory][ADDRESS][OSM] reverse result', {
      latitude,
      longitude,
      result: result || null,
    });

    return result;
  } catch (error) {
    console.warn('[Mappory][ADDRESS][OSM] reverse failed', {
      latitude,
      longitude,
      error: errorMessage(error),
    });
    return undefined;
  }
}

async function reverseGeocodeAddress(
  latitude: number,
  longitude: number
): Promise<MemoryAddress | undefined> {
  const cacheKey = addressCacheKey(latitude, longitude);
  const cached = addressMemoryCache.get(cacheKey);
  if (cached) return cached;

  if (Platform.OS === 'android') {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) {
      const requested = await Location.requestForegroundPermissionsAsync();
      if (!requested.granted) return undefined;
    }
  }

  let lastError: unknown = null;

  // First choice: native Apple / platform geocoder.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const results = await promiseWithTimeout(
        Location.reverseGeocodeAsync({
          latitude,
          longitude,
        }),
        4500,
        'Apple reverse geocoder timeout'
      );

      const item = results[0];

      console.log('[Mappory][ADDRESS][APPLE] reverse result', {
        attempt,
        latitude,
        longitude,
        result: item || null,
      });

      if (item) {
        const parts = normalizedAddressParts(item);
        const country = item.country || undefined;

        const result: MemoryAddress = {
          label:
            parts.join(' · ') ||
            item.name ||
            country ||
            '已读取地点',
          geocodeSource: 'apple',
          country,
          isoCountryCode: item.isoCountryCode || undefined,
          region: item.region || undefined,
          subregion: item.subregion || undefined,
          city: item.city || undefined,
          district: item.district || undefined,
          street: item.street || undefined,
          name: item.name || undefined,
        };

        addressMemoryCache.set(cacheKey, result);
        return result;
      }
    } catch (error) {
      lastError = error;
      console.warn(
        '[Mappory][ADDRESS][APPLE] reverse geocode attempt failed',
        {
          attempt,
          latitude,
          longitude,
          error: errorMessage(error),
        }
      );
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
  }

  // First network fallback: Photon public reverse geocoder.
  const photonResult = await reverseGeocodeViaPhoton(
    latitude,
    longitude
  );

  if (photonResult) {
    addressMemoryCache.set(cacheKey, photonResult);
    return photonResult;
  }

  // Second network fallback: Nominatim.
  const osmResult = await reverseGeocodeViaOsm(latitude, longitude);

  if (osmResult) {
    addressMemoryCache.set(cacheKey, osmResult);
    return osmResult;
  }

  console.warn('[Mappory][ADDRESS] unresolved after all providers', {
    latitude,
    longitude,
    error: lastError ? errorMessage(lastError) : 'empty result',
  });

  return undefined;
}

function MemoryMediaView({
  media,
  style,
}: {
  media: MemoryMedia;
  style: any;
}) {
  const [liveFailed, setLiveFailed] = useState(false);
  const [liveReady, setLiveReady] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const liveRef = useRef<any>(null);

  const livePhotoUri =
    media.archivedPhotoUri ||
    media.originalPhotoLocalUri ||
    media.assetUri;
  const liveVideoUri =
    media.archivedPairedVideoUri ||
    media.originalPairedVideoUri;

  const canPlayLive =
    !liveFailed &&
    media.mediaKind === 'livePhoto' &&
    !!livePhotoUri &&
    !!liveVideoUri &&
    LivePhotoView.isAvailable();

  if (canPlayLive) {
    return (
      <View style={style}>
        <LivePhotoView
          ref={liveRef}
          source={{
            photoUri: livePhotoUri!,
            pairedVideoUri: liveVideoUri!,
          }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          useDefaultGestureRecognizer
          isMuted={isMuted}
          onLoadStart={() =>
            console.log('[Mappory][LIVE] load start', media.id)
          }
          onLoadComplete={() => {
            setLiveReady(true);
            console.log('[Mappory][LIVE] ready', {
              id: media.id,
              photoUri: livePhotoUri,
              pairedVideoUri: liveVideoUri,
            });
          }}
          onPlaybackStart={() =>
            console.log('[Mappory][LIVE] playback start', media.id)
          }
          onPlaybackStop={() =>
            console.log('[Mappory][LIVE] playback stop', media.id)
          }
          onLoadError={(error) => {
            console.warn('[Mappory][LIVE] load failed', {
              id: media.id,
              message: error.message,
            });
            setLiveFailed(true);
          }}
        />

        <View pointerEvents="none" style={styles.liveBadge}>
          <Text style={styles.liveBadgeText}>LIVE · 长按</Text>
        </View>

        <View style={styles.liveControls}>
          <Pressable
            style={styles.livePlayButton}
            onPress={() => {
              console.log('[Mappory][LIVE] manual play pressed', {
                id: media.id,
                muted: isMuted,
              });
              liveRef.current?.startPlayback?.('full');
            }}
          >
            <Text style={styles.livePlayButtonText}>
              {liveReady ? '▶ 播放实况' : 'LIVE 加载中'}
            </Text>
          </Pressable>

          <Pressable
            style={styles.liveSoundButton}
            onPress={() => {
              setIsMuted((prev) => !prev);
              Haptics.selectionAsync().catch(() => {});
            }}
          >
            <Text style={styles.liveSoundButtonText}>
              {isMuted ? '🔇 声音关' : '🔊 声音开'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={style}>
      <Image
        source={{ uri: mediaPhotoUri(media) }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={180}
      />
      {media.mediaKind === 'livePhoto' && (
        <View pointerEvents="none" style={styles.liveBadge}>
          <Text style={styles.liveBadgeText}>
            {media.archiveStatus === 'partial'
              ? 'LIVE · 静态图已归档'
              : media.archiveStatus === 'archived'
              ? 'LIVE'
              : 'LIVE · 待归档'}
          </Text>
        </View>
      )}
    </View>
  );
}

function MemoryHeroMedia({
  memory,
  style,
}: {
  memory: AtlasMemory;
  style: any;
}) {
  return <MemoryMediaView media={coverMedia(memory)} style={style} />;
}

function App() {
  const [appearanceMode, setAppearanceMode] =
    useState<'light' | 'dark'>('light');
  const isDark = appearanceMode === 'dark';

  const [tab, setTab] = useState<'map' | 'memories'>('map');
  const [memories, setMemories] = useState<AtlasMemory[]>([]);
  const [categories, setCategories] = useState<MemoryCategory[]>([]);
  const [ready, setReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftPhotos, setDraftPhotos] = useState<DraftPhoto[] | null>(null);
  const [editingMemory, setEditingMemory] = useState<AtlasMemory | null>(null);
  const [detail, setDetail] = useState<AtlasMemory | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'all' | string>('all');
  const mapRef = useRef<MapView | null>(null);

  useEffect(() => {
    // v0.6.8: keep the Mappory brand screen visible for at least 1.5 seconds.
    // If local data needs longer to load, the brand screen stays until the
    // product is genuinely ready instead of flashing into an incomplete UI.
    const minimumBrandTime = new Promise<void>((resolve) => {
      setTimeout(resolve, 1500);
    });

    Promise.all([
      loadMemories(),
      loadCategories(),
      loadAppearance(),
      minimumBrandTime,
    ]).then(([items, cats, appearance]) => {
      setAppearanceMode(appearance);
      Appearance.setColorScheme(appearance);
      setMemories(items.map(mirrorCoverMemory));
      setCategories(cats);
      setReady(true);
    });
  }, []);

  const toggleAppearance = useCallback(async () => {
    const next: 'light' | 'dark' =
      appearanceMode === 'dark' ? 'light' : 'dark';

    // Update React state first so the button/map/header change immediately,
    // even if a native Appearance event arrives one frame later.
    setAppearanceMode(next);
    Appearance.setColorScheme(next);

    await saveAppearance(next);
    Haptics.selectionAsync().catch(() => {});
  }, [appearanceMode]);

  const filteredMemories = useMemo(
    () =>
      activeCategory === 'all'
        ? memories
        : memories.filter((item) => item.categoryId === activeCategory),
    [memories, activeCategory]
  );

  const persistMemories = useCallback(async (next: AtlasMemory[]) => {
    const normalized = next.map(mirrorCoverMemory);
    const sorted = [...normalized].sort((a, b) => b.shotAt - a.shotAt);
    setMemories(sorted);
    await saveMemories(sorted);
  }, []);

  const persistCategories = useCallback(async (next: MemoryCategory[]) => {
    setCategories(next);
    await saveCategories(next);
  }, []);

  const archiveAllMedia = useCallback(
    async (memory: AtlasMemory): Promise<AtlasMemory> => {
      const nextItems: MemoryMedia[] = [];

      for (const media of memoryMediaItems(memory)) {
        if (media.archiveStatus === 'archived') {
          nextItems.push(media);
          continue;
        }

        const archive = await archiveApplePhotosAsset(
          media.assetId,
          `${memory.id}/${media.id}`,
          media.originalPairedVideoUri
        );

        nextItems.push({
          ...media,
          ...archive,
          mediaKind:
            archive.archiveStatus === 'archived'
              ? archive.mediaKind
              : media.mediaKind,
        });
      }

      return mirrorCoverMemory({
        ...memory,
        mediaItems: nextItems,
        archiveStatus: summarizeArchiveStatus(nextItems),
        updatedAt: Date.now(),
      });
    },
    []
  );

  const saveMemory = useCallback(
    async (memory: AtlasMemory) => {
      const finalMemory = await archiveAllMedia(memory);

      await persistMemories([
        finalMemory,
        ...memories.filter((item) => item.id !== finalMemory.id),
      ]);

      setDraftPhotos(null);
      setEditingMemory(null);
      setPickerOpen(false);
      setDetail(null);
      setTab('map');

      const incomplete = finalMemory.mediaItems.filter(
        (item) => item.archiveStatus !== 'archived'
      );

      if (incomplete.length) {
        Alert.alert(
          '记忆已保存，部分媒体仍需保留 Apple 相册原图',
          `${finalMemory.mediaItems.length - incomplete.length}/${
            finalMemory.mediaItems.length
          } 项已完整本机归档。Live Photo 的视频部分如果仍未归档，暂时不要删除对应原图。`
        );
      }

      setTimeout(() => {
        const display = memoryMapCoordinate(finalMemory);
        mapRef.current?.animateToRegion(
          regionFor(display.latitude, display.longitude, 0.025),
          550
        );
      }, 220);
    },
    [archiveAllMedia, memories, persistMemories]
  );

  const archiveMemory = useCallback(
    async (memory: AtlasMemory) => {
      const finalMemory = await archiveAllMedia(memory);

      await persistMemories([
        finalMemory,
        ...memories.filter((item) => item.id !== finalMemory.id),
      ]);
      setDetail(finalMemory);

      const complete = finalMemory.mediaItems.filter(
        (item) => item.archiveStatus === 'archived'
      ).length;

      if (complete === finalMemory.mediaItems.length) {
        Alert.alert(
          '本机归档完成',
          `${complete} 张媒体都已经复制进Mappory 的本机存储。`
        );
      } else {
        Alert.alert(
          '已完成部分归档',
          `${complete}/${finalMemory.mediaItems.length} 项已完整归档。未完成的 Live Photo 仍建议保留 Apple 相册原件。`
        );
      }
    },
    [archiveAllMedia, memories, persistMemories]
  );

  const deleteMemory = useCallback(
    async (id: string) => {
      await persistMemories(memories.filter((item) => item.id !== id));
      await removeMemoryArchive(id);
      setDetail(null);
    },
    [memories, persistMemories]
  );

  const saveCategory = useCallback(
    async (category: MemoryCategory) => {
      const next = categories.some((item) => item.id === category.id)
        ? categories.map((item) => (item.id === category.id ? category : item))
        : [...categories, category];

      await persistCategories(next);

      if (
        activeCategory !== 'all' &&
        !next.some((item) => item.id === activeCategory)
      ) {
        setActiveCategory('all');
      }
    },
    [categories, persistCategories, activeCategory]
  );

  const deleteCategory = useCallback(
    async (categoryId: string) => {
      if (categoryId === 'uncategorized') return;

      const nextCategories = categories.filter(
        (item) => item.id !== categoryId
      );
      const nextMemories = memories.map((memory) =>
        memory.categoryId === categoryId
          ? {
              ...memory,
              categoryId: 'uncategorized',
              updatedAt: Date.now(),
            }
          : memory
      );

      await Promise.all([
        persistCategories(nextCategories),
        persistMemories(nextMemories),
      ]);

      if (activeCategory === categoryId) {
        setActiveCategory('all');
      }
    },
    [
      categories,
      memories,
      activeCategory,
      persistCategories,
      persistMemories,
    ]
  );

  const openAdd = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPickerOpen(true);
  }, []);

  if (!ready) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <View style={styles.boot}>
            <Text style={styles.bootTitle}>MAPPORY</Text>
            <Text style={styles.bootSub}>A MAP FOR YOUR MEMORIES</Text>
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
      <StatusBar style="auto" />
      <View key={`theme:${appearanceMode}`} style={styles.root}>
        {tab === 'map' ? (
          <MapHome
            mapRef={mapRef}
            memories={filteredMemories}
            allCount={memories.length}
            categories={categories}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            onManageCategories={() => setCategoryManagerOpen(true)}
            onAdd={openAdd}
            onOpen={setDetail}
            isDark={isDark}
            onToggleAppearance={toggleAppearance}
          />
        ) : (
          <MemoryList
            memories={filteredMemories}
            allCount={memories.length}
            categories={categories}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            onManageCategories={() => setCategoryManagerOpen(true)}
            onAdd={openAdd}
            onOpen={setDetail}
            isDark={isDark}
            onToggleAppearance={toggleAppearance}
          />
        )}

        <BottomTabs tab={tab} setTab={setTab} onAdd={openAdd} />

        <PhotoLibraryModal
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onChoose={(photos) => {
            setDraftPhotos(photos);
            setPickerOpen(false);
          }}
        />

        <MemoryEditor
          draftPhotos={draftPhotos}
          editingMemory={editingMemory}
          categories={categories}
          onClose={() => {
            setDraftPhotos(null);
            setEditingMemory(null);
          }}
          onSave={saveMemory}
          onManageCategories={() => setCategoryManagerOpen(true)}
        />

        <MemoryDetail
          memory={detail}
          categories={categories}
          onClose={() => setDetail(null)}
          onEdit={(memory) => {
            setDetail(null);
            setEditingMemory(memory);
          }}
          onArchive={archiveMemory}
          onDelete={deleteMemory}
        />

        <CategoryManager
          visible={categoryManagerOpen}
          categories={categories}
          onClose={() => setCategoryManagerOpen(false)}
          onSave={saveCategory}
          onDelete={deleteCategory}
        />
      </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function BottomTabs({
  tab,
  setTab,
  onAdd,
}: {
  tab: 'map' | 'memories';
  setTab: (tab: 'map' | 'memories') => void;
  onAdd: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.tabBar,
        {
          bottom: Math.max(insets.bottom, 8) + 6,
          height: TAB_BAR_HEIGHT,
        },
      ]}
    >
      <Pressable
        style={styles.tabItem}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setTab('map');
        }}
      >
        <Text style={[styles.tabSymbol, tab === 'map' && styles.tabActive]}>⌖</Text>
        <Text style={[styles.tabLabel, tab === 'map' && styles.tabActive]}>地图</Text>
      </Pressable>

      <Pressable style={styles.addOrb} onPress={onAdd}>
        <Text style={styles.addOrbText}>＋</Text>
      </Pressable>

      <Pressable
        style={styles.tabItem}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          setTab('memories');
        }}
      >
        <Text style={[styles.tabSymbol, tab === 'memories' && styles.tabActive]}>◫</Text>
        <Text style={[styles.tabLabel, tab === 'memories' && styles.tabActive]}>
          记忆
        </Text>
      </Pressable>
    </View>
  );
}

function ThemeModeButton({
  isDark,
  onToggle,
}: {
  isDark: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isDark ? '切换到日间模式' : '切换到夜间模式'}
      style={styles.themeModeButton}
      onPress={onToggle}
    >
      <Text style={styles.themeModeIcon}>{isDark ? '☀︎' : '☾'}</Text>
    </Pressable>
  );
}

function MapHome({
  mapRef,
  memories,
  allCount,
  categories,
  activeCategory,
  setActiveCategory,
  onManageCategories,
  onAdd,
  onOpen,
  isDark,
  onToggleAppearance,
}: {
  mapRef: React.MutableRefObject<MapView | null>;
  memories: AtlasMemory[];
  allCount: number;
  categories: MemoryCategory[];
  activeCategory: 'all' | string;
  setActiveCategory: (categoryId: 'all' | string) => void;
  onManageCategories: () => void;
  onAdd: () => void;
  onOpen: (memory: AtlasMemory) => void;
  isDark: boolean;
  onToggleAppearance: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<AtlasMemory | null>(null);
  const [mapLatitudeDelta, setMapLatitudeDelta] = useState(
    memories[0] ? 0.18 : DEFAULT_REGION.latitudeDelta
  );

  const bottomBarBottom = Math.max(insets.bottom, 8) + 6;
  const peekBottom =
    bottomBarBottom + TAB_BAR_HEIGHT + TAB_BAR_EXTRA_GAP;
  const showPhotoMarkers =
    mapLatitudeDelta <= PHOTO_MARKER_LATITUDE_DELTA;

  useEffect(() => {
    if (!memories.length) return;
    const first = memories[0];
    if (!first) return;
    setTimeout(() => {
      const display = memoryMapCoordinate(first);
      mapRef.current?.animateToRegion(
        regionFor(display.latitude, display.longitude, 0.18),
        500
      );
    }, 220);
  }, []);

  return (
    <View style={styles.full}>
      <MapView
        ref={(node: MapView | null) => {
          mapRef.current = node;
        }}
        style={StyleSheet.absoluteFill}
        initialRegion={
          memories[0]
            ? (() => {
                const display = memoryMapCoordinate(memories[0]);
                return regionFor(display.latitude, display.longitude, 0.18);
              })()
            : DEFAULT_REGION
        }
        mapType="standard"
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        showsCompass={false}
        showsUserLocation={false}
        toolbarEnabled={false}
        onPress={() => setSelected(null)}
        onRegionChangeComplete={(region: Region) => {
          setMapLatitudeDelta(region.latitudeDelta);
        }}
      >
        {memories.map((memory) => {
          const category = categoryFor(categories, memory.categoryId);
          const display = memoryMapCoordinate(memory);
          const markerColor = memory.pinColor || category.color;
          const isSelected = selected?.id === memory.id;

          return (
            <Marker
              key={`${memory.id}:${showPhotoMarkers ? 'photo' : 'dot'}`}
              coordinate={display}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={isSelected ? 20 : 1}
              onPress={(event: any) => {
                event.stopPropagation();
                setSelected(memory);
                Haptics.selectionAsync().catch(() => {});
              }}
            >
              {showPhotoMarkers ? (
                <View
                  style={[
                    styles.mapPhotoMarkerShell,
                    isSelected && styles.mapPhotoMarkerShellSelected,
                  ]}
                >
                  <Image
                    source={{ uri: memoryPhotoUri(memory) }}
                    style={styles.mapPhotoMarkerImage}
                    contentFit="cover"
                    transition={100}
                  />
                  <View
                    style={[
                      styles.mapPhotoCategoryDot,
                      { backgroundColor: markerColor },
                    ]}
                  >
                    <Text
                      style={[
                        styles.mapPhotoCategoryDotText,
                        { color: markerTextColor(markerColor) },
                      ]}
                    >
                      {category.symbol}
                    </Text>
                  </View>
                </View>
              ) : (
                <View
                  style={[
                    styles.mapMarker,
                    { backgroundColor: markerColor },
                    isSelected && styles.mapMarkerSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.mapMarkerText,
                      { color: markerTextColor(markerColor) },
                    ]}
                  >
                    {category.symbol}
                  </Text>
                </View>
              )}
            </Marker>
          );
        })}
      </MapView>

      <LinearGradient
        pointerEvents="none"
        colors={
          isDark
            ? ['rgba(16,19,16,0.92)', 'rgba(16,19,16,0.0)']
            : ['rgba(251,248,241,0.88)', 'rgba(251,248,241,0.0)']
        }
        style={styles.mapTopFade}
      />

      <View
        style={[
          styles.mapHeaderSafe,
          { paddingTop: Math.max(insets.top, 12) + 4 },
        ]}
      >
        <View style={styles.mapHeader}>
          <View>
            <Text style={styles.eyebrow}>PERSONAL ATLAS</Text>
            <Text style={styles.mapTitle}>我的世界</Text>
          </View>
          <View style={styles.headerActionRow}>
            <ThemeModeButton
              isDark={isDark}
              onToggle={onToggleAppearance}
            />
            <View style={styles.countBadge}>
              <Text style={styles.countNumber}>{allCount}</Text>
              <Text style={styles.countLabel}>段记忆</Text>
            </View>
          </View>
        </View>

        <KindFilter
          categories={categories}
          activeCategory={activeCategory}
          setActiveCategory={(categoryId) => {
            setActiveCategory(categoryId);
            setSelected(null);
          }}
          onManage={onManageCategories}
        />
      </View>

      {!allCount && (
        <View
          style={[
            styles.emptyMapCard,
            { bottom: peekBottom + 8 },
          ]}
        >
          <Text style={styles.emptyMapSymbol}>⌖</Text>
          <Text style={styles.emptyMapTitle}>第一张照片，会把地图点亮</Text>
          <Text style={styles.emptyMapBody}>
            从 iPhone 相册选一张原图。如果相册资产带位置，Mappory 会保留这组坐标，再把地图移动过去。
          </Text>
          <Pressable style={styles.primaryButton} onPress={onAdd}>
            <Text style={styles.primaryButtonText}>从相册添加</Text>
          </Pressable>
        </View>
      )}

      {selected && (
        <Pressable
          style={[styles.mapPeek, { bottom: peekBottom }]}
          onPress={() => onOpen(selected)}
        >
          <Image
            source={{ uri: memoryPhotoUri(selected) }}
            style={styles.mapPeekImage}
            contentFit="cover"
            transition={180}
          />
          <View style={styles.mapPeekBody}>
            <Text style={styles.peekDate}>{formatDate(selected.shotAt)}</Text>
            <Text style={styles.peekTitle} numberOfLines={1}>
              {selected.title}
            </Text>
            <Text style={styles.peekNote} numberOfLines={2}>
              {selected.address?.label ||
                selected.note ||
                coordText(selected.latitude, selected.longitude)}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    </View>
  );
}

function KindFilter({
  categories,
  activeCategory,
  setActiveCategory,
  onManage,
}: {
  categories: MemoryCategory[];
  activeCategory: 'all' | string;
  setActiveCategory: (categoryId: 'all' | string) => void;
  onManage: () => void;
}) {
  return (
    <View style={styles.filterViewport}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setActiveCategory('all');
          }}
          style={[
            styles.filterChip,
            styles.filterChipAll,
            activeCategory === 'all' && styles.filterChipOn,
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.filterText,
              activeCategory === 'all' && styles.filterTextOn,
            ]}
          >
            全部
          </Text>
        </Pressable>

        {categories.map((category) => {
          const on = activeCategory === category.id;
          return (
            <Pressable
              key={category.id}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setActiveCategory(category.id);
              }}
              style={[
                styles.filterChip,
                on && {
                  backgroundColor: category.color,
                  borderColor: category.color,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.filterText,
                  on && {
                    color: markerTextColor(category.color),
                    fontWeight: '800',
                  },
                ]}
              >
                {category.symbol} {category.name}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          style={[styles.filterChip, styles.manageFilterChip]}
          onPress={onManage}
        >
          <Text numberOfLines={1} style={styles.manageFilterText}>
            ＋ 分类
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function MemoryList({
  memories,
  allCount,
  categories,
  activeCategory,
  setActiveCategory,
  onManageCategories,
  onAdd,
  onOpen,
  isDark,
  onToggleAppearance,
}: {
  memories: AtlasMemory[];
  allCount: number;
  categories: MemoryCategory[];
  activeCategory: 'all' | string;
  setActiveCategory: (categoryId: 'all' | string) => void;
  onManageCategories: () => void;
  onAdd: () => void;
  onOpen: (memory: AtlasMemory) => void;
  isDark: boolean;
  onToggleAppearance: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>('all');

  const years = useMemo(() => {
    const unique = Array.from(
      new Set(memories.map((memory) => yearOfMemory(memory)))
    );
    return unique.sort((a, b) => b - a);
  }, [memories]);

  useEffect(() => {
    if (
      selectedYear !== 'all' &&
      !years.includes(selectedYear)
    ) {
      setSelectedYear('all');
      setSelectedMonth('all');
    }
  }, [years, selectedYear]);

  const timeFilteredMemories = useMemo(() => {
    return memories.filter((memory) => {
      if (selectedYear !== 'all' && yearOfMemory(memory) !== selectedYear) {
        return false;
      }
      if (
        selectedMonth !== 'all' &&
        monthOfMemory(memory) !== selectedMonth
      ) {
        return false;
      }
      return true;
    });
  }, [memories, selectedYear, selectedMonth]);

  const timeSummary =
    selectedYear === 'all'
      ? `全部时间 · ${timeFilteredMemories.length} 段`
      : `${selectedYear}年${
          selectedMonth === 'all' ? '' : ` · ${selectedMonth}月`
        } · ${timeFilteredMemories.length} 段`;

  return (
    <View style={[styles.page, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>MY ARCHIVE</Text>
            <Text style={styles.pageTitle}>记忆</Text>
          </View>
          <View style={styles.headerActionRow}>
            <ThemeModeButton
              isDark={isDark}
              onToggle={onToggleAppearance}
            />
            <Pressable
              style={styles.smallOutlineButton}
              onPress={onManageCategories}
            >
              <Text style={styles.smallOutlineButtonText}>管理分类</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.pageLead}>
          从空间、时间和分类三个方向，重新找到过去的自己。
        </Text>
      </View>

      <View style={styles.timeArchivePanel}>
        <View style={styles.timeArchiveTop}>
          <View>
            <Text style={styles.timeArchiveEyebrow}>TIME</Text>
            <Text style={styles.timeArchiveSummary}>{timeSummary}</Text>
          </View>
          {(selectedYear !== 'all' || selectedMonth !== 'all') && (
            <Pressable
              style={styles.timeClearButton}
              onPress={() => {
                setSelectedYear('all');
                setSelectedMonth('all');
              }}
            >
              <Text style={styles.timeClearText}>重置</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.yearFilterRow}
        >
          <Pressable
            style={[
              styles.yearChip,
              selectedYear === 'all' && styles.yearChipOn,
            ]}
            onPress={() => {
              setSelectedYear('all');
              setSelectedMonth('all');
              Haptics.selectionAsync().catch(() => {});
            }}
          >
            <Text
              style={[
                styles.yearChipText,
                selectedYear === 'all' && styles.yearChipTextOn,
              ]}
            >
              全部年份
            </Text>
          </Pressable>

          {years.map((year) => (
            <Pressable
              key={year}
              style={[
                styles.yearChip,
                selectedYear === year && styles.yearChipOn,
              ]}
              onPress={() => {
                setSelectedYear(year);
                setSelectedMonth('all');
                Haptics.selectionAsync().catch(() => {});
              }}
            >
              <Text
                style={[
                  styles.yearChipText,
                  selectedYear === year && styles.yearChipTextOn,
                ]}
              >
                {year}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {selectedYear !== 'all' && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.monthFilterRow}
          >
            <Pressable
              style={[
                styles.monthChip,
                selectedMonth === 'all' && styles.monthChipOn,
              ]}
              onPress={() => setSelectedMonth('all')}
            >
              <Text
                style={[
                  styles.monthChipText,
                  selectedMonth === 'all' && styles.monthChipTextOn,
                ]}
              >
                全年
              </Text>
            </Pressable>
            {Array.from({ length: 12 }, (_, index) => index + 1).map(
              (month) => (
                <Pressable
                  key={month}
                  style={[
                    styles.monthChip,
                    selectedMonth === month && styles.monthChipOn,
                  ]}
                  onPress={() => {
                    setSelectedMonth(month);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                >
                  <Text
                    style={[
                      styles.monthChipText,
                      selectedMonth === month && styles.monthChipTextOn,
                    ]}
                  >
                    {month}月
                  </Text>
                </Pressable>
              )
            )}
          </ScrollView>
        )}
      </View>

      <KindFilter
        categories={categories}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        onManage={onManageCategories}
      />

      <FlatList
        data={timeFilteredMemories}
        keyExtractor={(item: AtlasMemory) => item.id}
        contentContainerStyle={[
          styles.memoryList,
          !timeFilteredMemories.length && {
            flex: 1,
            justifyContent: 'center',
          },
        ]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }: { item: AtlasMemory }) => (
          <MemoryCard
            memory={item}
            category={categoryFor(categories, item.categoryId)}
            onPress={() => onOpen(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.listEmpty}>
            <Text style={styles.listEmptySymbol}>◌</Text>
            <Text style={styles.listEmptyTitle}>
              {allCount
                ? '这个时间或分类里还没有记录'
                : '这里还空着'}
            </Text>
            <Text style={styles.listEmptyBody}>
              可以换一个年月，也可以从相册带回来一段记忆。
            </Text>
            {!allCount && (
              <Pressable style={styles.primaryButton} onPress={onAdd}>
                <Text style={styles.primaryButtonText}>添加第一张照片</Text>
              </Pressable>
            )}
          </View>
        }
      />
    </View>
  );
}

function MemoryCard({
  memory,
  category,
  onPress,
}: {
  memory: AtlasMemory;
  category: MemoryCategory;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.memoryCard} onPress={onPress}>
      <Image
        source={{ uri: memoryPhotoUri(memory) }}
        style={styles.memoryCardImage}
        contentFit="cover"
        transition={180}
      />
      <View style={styles.memoryCardBody}>
        <View style={styles.memoryCardTop}>
          <Text style={styles.memoryDate}>{formatDate(memory.shotAt)}</Text>
          <View
            style={[
              styles.kindPill,
              { backgroundColor: colorWash(category.color, '20') },
            ]}
          >
            <Text style={[styles.kindPillText, { color: category.color }]}>
              {category.symbol} {category.name}
            </Text>
          </View>
        </View>
        <Text style={styles.memoryTitle} numberOfLines={2}>
          {memory.title}
        </Text>
        <Text style={styles.memoryNote} numberOfLines={2}>
          {memory.note || '没有写说明，但这张照片被留在了地图上。'}
        </Text>
        <View style={styles.memoryFooter}>
          <Text style={styles.memoryCoord} numberOfLines={1}>
            {memory.address?.label ||
              `${memory.locationSource === 'photo' ? '照片 GPS' : '手动落点'} · ${coordText(
                memory.latitude,
                memory.longitude
              )}`}
          </Text>
          <Text style={styles.memoryCoord}>
            {memoryMediaItems(memory).length} 张照片
          </Text>
        </View>
      </View>
    </Pressable>
  );
}


function PhotoTimeIndex({
  selectedYear,
  currentTimestamp,
  earliestTimestamp,
  latestTimestamp,
  searching,
  notice,
  onSelectYear,
  onSelectMonth,
}: {
  selectedYear: number | null;
  currentTimestamp: number | null;
  earliestTimestamp: number;
  latestTimestamp: number;
  searching: boolean;
  notice: string | null;
  onSelectYear: (year: number) => void;
  onSelectMonth: (year: number, month: number) => void;
}) {
  const yearScrollRef = useRef<any>(null);

  const latestYear = new Date(latestTimestamp).getFullYear();
  const earliestYear = new Date(earliestTimestamp).getFullYear();

  const years = useMemo(() => {
    const result: number[] = [];
    for (let year = latestYear; year >= earliestYear; year -= 1) {
      result.push(year);
    }
    return result;
  }, [earliestYear, latestYear]);

  const visibleDate = new Date(
    currentTimestamp ?? latestTimestamp
  );
  const visibleYear = visibleDate.getFullYear();
  const visibleMonth = visibleDate.getMonth() + 1;
  const activeYear = selectedYear ?? visibleYear;
  const activeMonth =
    activeYear === visibleYear ? visibleMonth : null;

  useEffect(() => {
    const index = Math.max(0, years.indexOf(activeYear));
    const timer = setTimeout(() => {
      yearScrollRef.current?.scrollTo?.({
        x: Math.max(0, index * 66 - 66),
        animated: true,
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [activeYear, years]);

  return (
    <View style={styles.photoTimeIndex}>
      <View style={styles.photoTimeIndexHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.photoTimeIndexEyebrow}>
            TIME INDEX
          </Text>
          <Text style={styles.photoTimeIndexCurrent}>
            {visibleYear} · {visibleMonth}月
          </Text>
          <Text style={styles.photoTimeIndexHint}>
            {notice || '滚动照片会自动跟随；点年份或月份可以直接跳转。'}
          </Text>
        </View>

        {searching && (
          <View style={styles.photoTimeIndexSearching}>
            <ActivityIndicator size="small" color={palette.moss} />
            <Text style={styles.photoTimeIndexSearchingText}>
              定位中
            </Text>
          </View>
        )}
      </View>

      <ScrollView
        ref={yearScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.photoTimeYearTrack}
      >
        {years.map((year) => {
          const active = year === activeYear;
          return (
            <Pressable
              key={year}
              disabled={searching}
              style={[
                styles.photoTimeYearChip,
                active && styles.photoTimeYearChipActive,
              ]}
              onPress={() => onSelectYear(year)}
            >
              <Text
                style={[
                  styles.photoTimeYearText,
                  active && styles.photoTimeYearTextActive,
                ]}
              >
                {year}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.photoTimeMonthHeader}>
        <Text style={styles.photoTimeMonthTitle}>
          {activeYear} 年
        </Text>
        <Text style={styles.photoTimeMonthSub}>
          选择月份
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.photoTimeMonthTrack}
      >
        {Array.from({ length: 12 }, (_, index) => index + 1).map(
          (month) => {
            const active = month === activeMonth;
            return (
              <Pressable
                key={`${activeYear}-${month}`}
                disabled={searching}
                style={[
                  styles.photoTimeMonthChip,
                  active && styles.photoTimeMonthChipActive,
                ]}
                onPress={() => onSelectMonth(activeYear, month)}
              >
                <Text
                  style={[
                    styles.photoTimeMonthText,
                    active && styles.photoTimeMonthTextActive,
                  ]}
                >
                  {month}月
                </Text>
              </Pressable>
            );
          }
        )}
      </ScrollView>
    </View>
  );
}

function PhotoLibraryModal({
  visible,
  onClose,
  onChoose,
}: {
  visible: boolean;
  onClose: () => void;
  onChoose: (photos: DraftPhoto[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = MediaLibrary.usePermissions();

  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [selectedAlbum, setSelectedAlbum] =
    useState<MediaLibrary.Album | null>(null);
  const [albumSheetOpen, setAlbumSheetOpen] = useState(false);

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasNext, setHasNext] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageLoadingRef = useRef(false);
  const [reading, setReading] = useState(false);
  const photoListRef = useRef<any>(null);
  const photoViewabilityConfig = useRef({
    itemVisiblePercentThreshold: 35,
    minimumViewTime: 60,
  }).current;
  const [pendingCenterIndex, setPendingCenterIndex] =
    useState<number | null>(null);

  const [selectedAssets, setSelectedAssets] =
    useState<MediaLibrary.Asset[]>([]);

  const [gridColumns, setGridColumns] = useState(3);
  const pinchScale = useSharedValue(1);
  const pinchFocalX = useSharedValue(0);
  const pinchFocalY = useSharedValue(0);
  const [gridStageWidth, setGridStageWidth] = useState(1);
  const [gridStageHeight, setGridStageHeight] = useState(1);
  const firstVisibleIndexRef = useRef(0);
  const [pendingGridAnchorIndex, setPendingGridAnchorIndex] =
    useState<number | null>(null);

  const [earliestTime, setEarliestTime] = useState<number | null>(null);
  const [latestTime, setLatestTime] = useState<number | null>(null);
  const [densityFraction, setDensityFraction] = useState(0);
  const [densityResolvedLabel, setDensityResolvedLabel] =
    useState('最新照片');
  const [densitySearching, setDensitySearching] = useState(false);
  const [densityCutoffTime, setDensityCutoffTime] =
    useState<number | null>(null);
  const [visibleDensityFraction, setVisibleDensityFraction] =
    useState(0);
  const [currentVisibleTimestamp, setCurrentVisibleTimestamp] =
    useState<number | null>(null);
  const [timeIndexYear, setTimeIndexYear] =
    useState<number | null>(null);
  const [timeIndexNotice, setTimeIndexNotice] =
    useState<string | null>(null);
  const windowStartRankRef = useRef(0);
  const totalCountRef = useRef(0);

  const currentAlbumRef = selectedAlbum || undefined;

  const baseOptions = useCallback(
    (after?: string, cutoff?: number | null) => {
      const options: any = {
        first: 90,
        after,
        mediaType: MediaLibrary.MediaType.photo,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      };

      if (currentAlbumRef) options.album = currentAlbumRef;
      if (cutoff) options.createdBefore = cutoff + 1;
      return options;
    },
    [currentAlbumRef]
  );

  const loadPage = useCallback(
    async (reset: boolean, cutoffOverride?: number | null) => {
      if (pageLoadingRef.current) return;
      pageLoadingRef.current = true;
      setLoading(true);

      try {
        const cutoff =
          cutoffOverride === undefined
            ? densityCutoffTime
            : cutoffOverride;

        const result = await MediaLibrary.getAssetsAsync(
          baseOptions(reset ? undefined : cursor, cutoff)
        );

        setAssets((prev) =>
          reset
            ? dedupeMediaAssets(result.assets)
            : dedupeMediaAssets([...prev, ...result.assets])
        );
        setCursor(result.endCursor || undefined);
        setHasNext(result.hasNextPage);

        if (!cutoff) {
          const nextTotal = result.totalCount || 0;
          setTotalCount(nextTotal);
          totalCountRef.current = nextTotal;

          if (reset) {
            windowStartRankRef.current = 0;
            setVisibleDensityFraction(0);
            setCurrentVisibleTimestamp(
              result.assets[0]?.creationTime ?? null
            );
          }
        }
      } catch (error) {
        console.warn('[Mappory][LIBRARY] page failed', errorMessage(error));
      } finally {
        pageLoadingRef.current = false;
        setLoading(false);
      }
    },
    [baseOptions, cursor, densityCutoffTime]
  );

  const loadDensityWindow = useCallback(
    async (timestamp: number, targetFraction: number) => {
      setLoading(true);

      try {
        const common: any = {
          first: 54,
          mediaType: MediaLibrary.MediaType.photo,
        };
        if (currentAlbumRef) common.album = currentAlbumRef;

        // Newer side: ascending order gives the photos closest to
        // the target timestamp first. Reverse them before combining
        // so the whole grid still reads newest -> oldest.
        const newerResult = await MediaLibrary.getAssetsAsync({
          ...common,
          createdAfter: timestamp,
          sortBy: [[MediaLibrary.SortBy.creationTime, true]],
        });

        const olderResult = await MediaLibrary.getAssetsAsync({
          ...common,
          createdBefore: timestamp + 1,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });

        const newer = [...newerResult.assets].reverse();
        const seen = new Set<string>();
        const combined: MediaLibrary.Asset[] = [];

        for (const asset of [...newer, ...olderResult.assets]) {
          if (seen.has(asset.id)) continue;
          seen.add(asset.id);
          combined.push(asset);
        }

        const uniqueCombined = dedupeMediaAssets(combined);
        const targetRank = Math.round(
          Math.max(0, Math.min(1, targetFraction)) *
            Math.max(0, totalCountRef.current - 1)
        );
        const startRank = Math.max(
          0,
          targetRank - newer.length
        );

        windowStartRankRef.current = startRank;
        setAssets(uniqueCombined);
        setCursor(olderResult.endCursor || undefined);
        setHasNext(olderResult.hasNextPage);
        setDensityCutoffTime(timestamp);
        setVisibleDensityFraction(targetFraction);
        setCurrentVisibleTimestamp(timestamp);

        const safeCenterIndex =
          uniqueCombined.length > 0
            ? Math.max(
                0,
                Math.min(uniqueCombined.length - 1, newer.length)
              )
            : null;

        setPendingCenterIndex(safeCenterIndex);
      } catch (error) {
        console.warn(
          '[Mappory][LIBRARY] centered density window failed',
          errorMessage(error)
        );
        // Safe fallback to the old one-sided query.
        windowStartRankRef.current = Math.round(
          Math.max(0, Math.min(1, targetFraction)) *
            Math.max(0, totalCountRef.current - 1)
        );
        setAssets([]);
        setCursor(undefined);
        setHasNext(false);
        await loadPage(true, timestamp);
      } finally {
        setLoading(false);
      }
    },
    [currentAlbumRef, loadPage]
  );

  const loadAlbums = useCallback(async () => {
    try {
      const result = await MediaLibrary.getAlbumsAsync({
        includeSmartAlbums: true,
      });

      setAlbums(
        result
          .filter((album) => (album.assetCount ?? 0) > 0)
          .sort((a, b) => {
            const aSmart = a.type === 'smartAlbum' ? 1 : 0;
            const bSmart = b.type === 'smartAlbum' ? 1 : 0;
            if (aSmart !== bSmart) return aSmart - bSmart;
            return a.title.localeCompare(b.title, 'zh-CN');
          })
      );
    } catch (error) {
      console.warn('[Mappory][LIBRARY] albums failed', errorMessage(error));
      setAlbums([]);
    }
  }, []);

  const loadDensityRange = useCallback(async () => {
    try {
      const base: any = {
        first: 1,
        mediaType: MediaLibrary.MediaType.photo,
      };
      if (currentAlbumRef) base.album = currentAlbumRef;

      const [latestResult, earliestResult] = await Promise.all([
        MediaLibrary.getAssetsAsync({
          ...base,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        }),
        MediaLibrary.getAssetsAsync({
          ...base,
          sortBy: [[MediaLibrary.SortBy.creationTime, true]],
        }),
      ]);

      const nextTotal = latestResult.totalCount || 0;
      const nextLatest =
        latestResult.assets[0]?.creationTime ?? null;
      const nextEarliest =
        earliestResult.assets[0]?.creationTime ?? null;

      setTotalCount(nextTotal);
      totalCountRef.current = nextTotal;
      setLatestTime(nextLatest);
      setEarliestTime(nextEarliest);

      setCurrentVisibleTimestamp(nextLatest);
      setTimeIndexYear(
        nextLatest !== null
          ? new Date(nextLatest).getFullYear()
          : null
      );
      setTimeIndexNotice(null);
      setVisibleDensityFraction(0);
      windowStartRankRef.current = 0;
    } catch (error) {
      console.warn(
        '[Mappory][LIBRARY] density range failed',
        errorMessage(error)
      );
      setEarliestTime(null);
      setLatestTime(null);
    }
  }, [currentAlbumRef]);

  const countAfter = useCallback(
    async (timestamp: number) => {
      const options: any = {
        first: 1,
        mediaType: MediaLibrary.MediaType.photo,
        createdAfter: timestamp,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      };
      if (currentAlbumRef) options.album = currentAlbumRef;
      const result = await MediaLibrary.getAssetsAsync(options);
      return result.totalCount || 0;
    },
    [currentAlbumRef]
  );

  const jumpToCalendar = useCallback(
    async (year: number, month?: number) => {
      if (densitySearching) return;

      setDensitySearching(true);
      setTimeIndexYear(year);
      setTimeIndexNotice(null);

      try {
        const start = month
          ? new Date(year, month - 1, 1, 0, 0, 0, 0).getTime()
          : new Date(year, 0, 1, 0, 0, 0, 0).getTime();
        const end = month
          ? new Date(year, month, 1, 0, 0, 0, 0).getTime()
          : new Date(year + 1, 0, 1, 0, 0, 0, 0).getTime();

        const options: any = {
          first: 1,
          mediaType: MediaLibrary.MediaType.photo,
          createdAfter: start - 1,
          createdBefore: end,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        };
        if (currentAlbumRef) options.album = currentAlbumRef;

        const result = await MediaLibrary.getAssetsAsync(options);
        const target = result.assets[0];

        if (!target) {
          setTimeIndexNotice(
            month
              ? `${year} 年 ${month} 月没有照片`
              : `${year} 年没有照片`
          );
          Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Warning
          ).catch(() => {});
          return;
        }

        const timestamp = target.creationTime;
        const newerCount = await countAfter(timestamp);
        const denominator = Math.max(
          1,
          totalCountRef.current - 1
        );
        const internalFraction = Math.max(
          0,
          Math.min(1, newerCount / denominator)
        );

        // Photo density remains an internal loading calculation only.
        // The user now navigates by real calendar time.
        setDensityFraction(internalFraction);
        setVisibleDensityFraction(internalFraction);
        setDensityCutoffTime(timestamp);
        setCurrentVisibleTimestamp(timestamp);
        setDensityResolvedLabel(formatDate(timestamp));

        setAssets([]);
        setCursor(undefined);
        setHasNext(false);
        await loadDensityWindow(timestamp, internalFraction);

        setTimeIndexNotice(
          month
            ? `已到 ${year} 年 ${month} 月`
            : `已到 ${year} 年`
        );
        Haptics.selectionAsync().catch(() => {});
      } catch (error) {
        console.warn(
          '[Mappory][LIBRARY] calendar jump failed',
          errorMessage(error)
        );
        setTimeIndexNotice('时间定位失败，请再试一次');
      } finally {
        setDensitySearching(false);
      }
    },
    [
      countAfter,
      currentAlbumRef,
      densitySearching,
      loadDensityWindow,
    ]
  );

  const findTimestampForDensity = useCallback(
    async (fraction: number, iterations = 8) => {
      if (
        earliestTime === null ||
        latestTime === null ||
        totalCount <= 0
      ) {
        return null;
      }

      if (fraction <= 0.005) return latestTime + 1;
      if (fraction >= 0.995) return earliestTime + 1;

      const target = Math.round(fraction * totalCount);
      let low = earliestTime;
      let high = latestTime;

      // Objective: number of photos newer than timestamp ~= target.
      // This makes equal distances on the rail represent equal photo counts.
      for (let i = 0; i < iterations; i += 1) {
        const mid = low + (high - low) / 2;
        const newerCount = await countAfter(mid);

        if (newerCount > target) {
          low = mid;
        } else {
          high = mid;
        }
      }

      return Math.round((low + high) / 2);
    },
    [countAfter, earliestTime, latestTime, totalCount]
  );

  const jumpToDensity = useCallback(
    async (fraction: number) => {
      if (densitySearching) return;

      const safeFraction = Math.max(0, Math.min(1, fraction));
      setDensityFraction(safeFraction);
      setVisibleDensityFraction(safeFraction);
      setDensitySearching(true);

      try {
        const timestamp = await findTimestampForDensity(
          safeFraction,
          8
        );
        if (timestamp === null) return;

        setDensityCutoffTime(timestamp);
        setCurrentVisibleTimestamp(timestamp);
        setDensityResolvedLabel(
          safeFraction <= 0.005
            ? '最新照片'
            : `${formatDate(timestamp)} · 约第 ${Math.round(
                safeFraction * 100
              )}%`
        );

        setAssets([]);
        setCursor(undefined);
        setHasNext(false);
        await loadDensityWindow(timestamp, safeFraction);
      } finally {
        setDensitySearching(false);
      }
    },
    [
      densitySearching,
      findTimestampForDensity,
      loadDensityWindow,
    ]
  );

  const resetDensity = useCallback(async () => {
    setDensityFraction(0);
    setDensityCutoffTime(null);
    setDensityResolvedLabel('最新照片');
    setVisibleDensityFraction(0);
    setCurrentVisibleTimestamp(latestTime);
    setTimeIndexYear(
      latestTime !== null
        ? new Date(latestTime).getFullYear()
        : null
    );
    setTimeIndexNotice(null);
    windowStartRankRef.current = 0;
    setPendingCenterIndex(null);
    setAssets([]);
    setCursor(undefined);
    setHasNext(false);
    await loadPage(true, null);
  }, [latestTime, loadPage]);

  useEffect(() => {
    if (!visible) {
      setSelectedAssets([]);
      return;
    }

    if (!permission?.granted) return;

    loadAlbums().catch(() => {});
  }, [visible, permission?.granted, loadAlbums]);

  useEffect(() => {
    if (!visible || !permission?.granted) return;

    setSelectedAssets([]);
    setDensityFraction(0);
    setVisibleDensityFraction(0);
    setCurrentVisibleTimestamp(null);
    setTimeIndexYear(null);
    setTimeIndexNotice(null);
    windowStartRankRef.current = 0;
    setDensityCutoffTime(null);
    setDensityResolvedLabel('最新照片');
    setAssets([]);
    setCursor(undefined);
    setHasNext(false);

    loadDensityRange().catch(() => {});
    setTimeout(() => loadPage(true, null).catch(() => {}), 0);
  }, [
    visible,
    permission?.granted,
    selectedAlbum?.id,
    loadDensityRange,
  ]);

  useEffect(() => {
    if (
      pendingCenterIndex === null ||
      !assets.length
    ) {
      return;
    }

    const timer = setTimeout(() => {
      const safeIndex = Math.max(
        0,
        Math.min(assets.length - 1, pendingCenterIndex)
      );

      // Use the real current grid width instead of hard-coded cell
      // sizes, so density jumps stay stable across iPhone sizes and zoom
      // levels.
      const row = Math.floor(
        safeIndex / Math.max(1, gridColumns)
      );
      const gap = 2;
      const cell = Math.max(
        1,
        (gridStageWidth -
          gap * Math.max(0, gridColumns - 1)) /
          Math.max(1, gridColumns)
      );

      const targetOffset = Math.max(
        0,
        row * (cell + gap) - 6
      );

      photoListRef.current?.scrollToOffset?.({
        offset: targetOffset,
        animated: false,
      });

      setPendingCenterIndex(null);
    }, 180);

    return () => clearTimeout(timer);
  }, [
    assets,
    gridColumns,
    gridStageWidth,
    pendingCenterIndex,
  ]);

  const gridPinchStyle = useAnimatedStyle(() => {
    const dx =
      pinchFocalX.value - gridStageWidth / 2;
    const dy =
      pinchFocalY.value - gridStageHeight / 2;

    return {
      transform: [
        { translateX: dx },
        { translateY: dy },
        { scale: pinchScale.value },
        { translateX: -dx },
        { translateY: -dy },
      ],
    };
  });

  const commitGridZoom = useCallback(
    (scale: number) => {
      const levels = [2, 3, 4, 5];
      const currentIndex = Math.max(
        0,
        levels.indexOf(gridColumns)
      );

      let nextIndex = currentIndex;

      // One deliberate level per gesture is much easier to control than
      // jumping across 2–3 column counts in a single pinch.
      if (scale > 1.09) {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (scale < 0.91) {
        nextIndex = Math.min(
          levels.length - 1,
          currentIndex + 1
        );
      }

      const next = levels[nextIndex];
      if (next === gridColumns) return;

      setPendingGridAnchorIndex(
        firstVisibleIndexRef.current
      );
      setGridColumns(next);
      Haptics.selectionAsync().catch(() => {});
    },
    [gridColumns]
  );

  const gridPinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin((event) => {
          pinchScale.value = 1;
          pinchFocalX.value = event.focalX;
          pinchFocalY.value = event.focalY;
        })
        .onUpdate((event) => {
          // Follow both scale and the two-finger focal point on the UI
          // thread so the photos feel attached to the fingers.
          pinchFocalX.value = event.focalX;
          pinchFocalY.value = event.focalY;
          pinchScale.value = Math.max(
            0.84,
            Math.min(1.18, event.scale)
          );
        })
        .onEnd((event) => {
          runOnJS(commitGridZoom)(event.scale);
          pinchScale.value = withTiming(1, {
            duration: 150,
          });
        })
        .onFinalize(() => {
          pinchScale.value = withTiming(1, {
            duration: 150,
          });
        }),
    [commitGridZoom]
  );

  const cycleGridColumns = useCallback(() => {
    const next =
      gridColumns <= 2
        ? 3
        : gridColumns === 3
        ? 4
        : gridColumns === 4
        ? 5
        : 3;

    setPendingGridAnchorIndex(
      firstVisibleIndexRef.current
    );
    setGridColumns(next);
    Haptics.selectionAsync().catch(() => {});
  }, [gridColumns]);

  useEffect(() => {
    if (pendingGridAnchorIndex === null) return;

    const timer = setTimeout(() => {
      const safeIndex = Math.max(
        0,
        Math.min(
          Math.max(0, assets.length - 1),
          pendingGridAnchorIndex
        )
      );

      const row = Math.floor(
        safeIndex / Math.max(1, gridColumns)
      );
      const gap = 2;
      const cell = Math.max(
        1,
        (gridStageWidth -
          gap * Math.max(0, gridColumns - 1)) /
          Math.max(1, gridColumns)
      );

      photoListRef.current?.scrollToOffset?.({
        offset: Math.max(0, row * (cell + gap)),
        animated: false,
      });

      setPendingGridAnchorIndex(null);
    }, 70);

    return () => clearTimeout(timer);
  }, [
    assets.length,
    gridColumns,
    gridStageWidth,
    pendingGridAnchorIndex,
  ]);


  const toggleSelectedAsset = (asset: MediaLibrary.Asset) => {
    setSelectedAssets((prev) => {
      const existing = prev.findIndex((item) => item.id === asset.id);
      if (existing >= 0) {
        return prev.filter((item) => item.id !== asset.id);
      }

      if (prev.length >= 12) {
        Alert.alert('最多选择 12 张', '第一版先把一段记忆控制在 12 张以内。');
        return prev;
      }

      Haptics.selectionAsync().catch(() => {});
      return [...prev, asset];
    });
  };

  const readDraftAsset = useCallback(
    async (asset: MediaLibrary.Asset): Promise<DraftPhoto> => {
      const info = await MediaLibrary.getAssetInfoAsync(asset, {
        shouldDownloadFromNetwork: true,
      });

      const rawLocation = info.location ?? null;
      const normalized = normalizeCoordinate(
        rawLocation?.latitude,
        rawLocation?.longitude
      );

      const isLivePhoto =
        Array.isArray(info.mediaSubtypes) &&
        info.mediaSubtypes.includes('livePhoto') &&
        !!info.pairedVideoAsset;

      let pairedVideoUri =
        info.pairedVideoAsset?.uri || undefined;

      if (isLivePhoto && info.pairedVideoAsset) {
        try {
          const pairedInfo = await MediaLibrary.getAssetInfoAsync(
            info.pairedVideoAsset.id,
            { shouldDownloadFromNetwork: true }
          );

          pairedVideoUri =
            pairedInfo?.localUri ||
            info.pairedVideoAsset.uri ||
            undefined;
        } catch (error) {
          console.warn('[Mappory][LIVE] paired video info unavailable', {
            assetId: asset.id,
            message: errorMessage(error),
          });
        }
      }

      console.log('[Mappory][PHOTO] selected', {
        assetId: asset.id,
        location: normalized,
        isLivePhoto,
        pairedVideoUri: pairedVideoUri || null,
      });

      return {
        assetId: asset.id,
        assetUri: asset.uri || info.uri || asset.id,
        filename: asset.filename || info.filename || 'photo',
        shotAt: asset.creationTime || info.creationTime || Date.now(),
        latitude: normalized?.latitude ?? null,
        longitude: normalized?.longitude ?? null,
        locationSource: normalized ? 'photo' : null,
        gpsDetected: !!rawLocation,
        mediaKind: isLivePhoto ? 'livePhoto' : 'photo',
        photoLocalUri: info.localUri || undefined,
        pairedVideoAssetId: info.pairedVideoAsset?.id,
        pairedVideoAssetUri: pairedVideoUri,
      };
    },
    []
  );

  const continueWithSelection = useCallback(async () => {
    if (!selectedAssets.length || reading) return;

    setReading(true);

    try {
      const results = await Promise.all(
        selectedAssets.map(async (asset) => {
          try {
            return {
              draft: await readDraftAsset(asset),
              error: null as string | null,
            };
          } catch (error) {
            return {
              draft: null as DraftPhoto | null,
              error: errorMessage(error),
            };
          }
        })
      );

      const drafts = results
        .map((item) => item.draft)
        .filter((item): item is DraftPhoto => !!item);

      const failed = results.filter((item) => !item.draft);

      if (!drafts.length) {
        Alert.alert(
          '照片没有读取成功',
          failed[0]?.error || '请换一张照片再试。'
        );
        return;
      }

      if (failed.length) {
        Alert.alert(
          '有部分照片没有读取成功',
          `${drafts.length} 张可以继续，${failed.length} 张暂时跳过。`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '继续',
              onPress: () => onChoose(drafts),
            },
          ]
        );
        return;
      }

      onChoose(drafts);
    } finally {
      setReading(false);
    }
  }, [onChoose, readDraftAsset, reading, selectedAssets]);

  const manageLimited = useCallback(async () => {
    try {
      await MediaLibrary.presentPermissionsPickerAsync(['photo']);
      await loadAlbums();
      await loadDensityRange();
      await resetDensity();
    } catch {
      // Full access / unsupported picker.
    }
  }, [loadAlbums, loadDensityRange, resetDensity]);

  const onPhotoViewableItemsChanged = useRef(
    ({ viewableItems }: any) => {
      const firstVisible = (viewableItems || []).find(
        (entry: any) =>
          entry?.isViewable &&
          typeof entry?.index === 'number' &&
          entry?.item
      );

      if (!firstVisible) return;

      const index = Math.max(0, firstVisible.index || 0);
      firstVisibleIndexRef.current = index;

      const timestamp =
        firstVisible.item?.creationTime ?? null;

      if (timestamp !== null) {
        setCurrentVisibleTimestamp(timestamp);
        setTimeIndexYear(new Date(timestamp).getFullYear());
        setTimeIndexNotice(null);
      }

      const total = Math.max(1, totalCountRef.current - 1);
      const rank = Math.max(
        0,
        windowStartRankRef.current + index
      );

      setVisibleDensityFraction(
        Math.max(0, Math.min(1, rank / total))
      );
    }
  ).current;

  const albumTitle = selectedAlbum?.title || '所有照片';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.modalPage,
          {
            paddingTop: Math.max(insets.top, 12),
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>取消</Text>
          </Pressable>

          <Pressable
            style={styles.albumTitleButton}
            onPress={() => setAlbumSheetOpen(true)}
          >
            <Text style={styles.modalHeaderTitle} numberOfLines={1}>
              {albumTitle}⌄
            </Text>
            <Text style={styles.modalHeaderSub}>
              {totalCount
                ? `${totalCount.toLocaleString()} 张 · ${
                    currentVisibleTimestamp !== null
                      ? formatDate(currentVisibleTimestamp)
                      : densityResolvedLabel
                  }`
                : densityResolvedLabel}
            </Text>
          </Pressable>

          <Pressable
            style={styles.gridScaleBadge}
            onPress={cycleGridColumns}
          >
            <Text style={styles.gridScaleLabel}>{gridColumns}列</Text>
            <Text style={styles.gridScaleSub}>
              双指 / 点按
            </Text>
          </Pressable>
        </View>

        {!permission?.granted ? (
          <View style={styles.permissionPanel}>
            <View style={styles.permissionMark}>
              <Text style={styles.permissionMarkText}>▣</Text>
            </View>
            <Text style={styles.permissionTitle}>让照片把你带回当时</Text>
            <Text style={styles.permissionBody}>
              Mappory 会读取你选择照片的拍摄时间、照片位置和相簿结构。照片不会上传到服务器。
            </Text>
            <Pressable
              style={styles.primaryButton}
              onPress={async () => {
                const result = await requestPermission();
                if (result.granted) {
                  setTimeout(() => {
                    loadAlbums().catch(() => {});
                    loadDensityRange().catch(() => {});
                    resetDensity().catch(() => {});
                  }, 120);
                }
              }}
            >
              <Text style={styles.primaryButtonText}>允许访问照片</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.photoLibraryToolbar}>
              <View style={styles.photoLibraryToolbarText}>
                <Text style={styles.photoLibraryToolbarTitle}>
                  双指缩放照片 · 按年/月定位
                </Text>
                <Text style={styles.photoLibraryToolbarSub}>
                  时间按真实年月显示；滚动照片时索引会自动跟随。
                </Text>
              </View>

              {visibleDensityFraction > 0.005 ||
              densityFraction > 0.005 ? (
                <Pressable
                  style={styles.allTimeButton}
                  onPress={resetDensity}
                >
                  <Text style={styles.allTimeButtonText}>回到最新</Text>
                </Pressable>
              ) : permission.accessPrivileges === 'limited' ? (
                <Pressable onPress={manageLimited}>
                  <Text style={styles.manageText}>管理权限</Text>
                </Pressable>
              ) : null}
            </View>

            {totalCount > 1 &&
              earliestTime !== null &&
              latestTime !== null && (
                <PhotoTimeIndex
                  selectedYear={timeIndexYear}
                  currentTimestamp={currentVisibleTimestamp}
                  earliestTimestamp={earliestTime}
                  latestTimestamp={latestTime}
                  searching={densitySearching}
                  notice={timeIndexNotice}
                  onSelectYear={(year) => {
                    jumpToCalendar(year).catch(() => {});
                  }}
                  onSelectMonth={(year, month) => {
                    jumpToCalendar(year, month).catch(() => {});
                  }}
                />
              )}

            <View
              style={styles.photoGridStage}
              onLayout={(event) => {
                setGridStageWidth(
                  Math.max(1, event.nativeEvent.layout.width)
                );
                setGridStageHeight(
                  Math.max(1, event.nativeEvent.layout.height)
                );
              }}
            >
              <GestureDetector gesture={gridPinchGesture}>
                <Animated.View
                  style={[
                    styles.photoGridAnimated,
                    gridPinchStyle,
                  ]}
                >
              <FlatList
                ref={photoListRef}
                key={`photo-grid-${gridColumns}-${selectedAlbum?.id || 'all'}-${densityCutoffTime || 'latest'}`}
                data={assets}
                numColumns={gridColumns}
                keyExtractor={(
                  item: MediaLibrary.Asset,
                  index: number
                ) => `${item.id}:${index}`}
                contentContainerStyle={[
                  styles.photoGrid,
                  {
                    paddingHorizontal: 2,
                    paddingBottom:
                      selectedAssets.length > 0 ? 100 : 20,
                  },
                ]}
                columnWrapperStyle={{ gap: 2 }}
                ItemSeparatorComponent={() => (
                  <View style={{ height: 2 }} />
                )}
                renderItem={({
                  item,
                }: {
                  item: MediaLibrary.Asset;
                }) => {
                  const selectedIndex =
                    selectedAssets.findIndex(
                      (asset) => asset.id === item.id
                    );
                  const selected = selectedIndex >= 0;

                  return (
                    <Pressable
                      style={[
                        styles.photoCell,
                        {
                          maxWidth: `${
                            100 / gridColumns
                          }%`,
                        },
                      ]}
                      onPress={() =>
                        toggleSelectedAsset(item)
                      }
                    >
                      <Image
                        source={{ uri: item.uri || item.id }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={0}
                      />

                      {selected && (
                        <View style={styles.multiSelectShade}>
                          <View
                            style={styles.multiSelectNumber}
                          >
                            <Text
                              style={
                                styles.multiSelectNumberText
                              }
                            >
                              {selectedIndex + 1}
                            </Text>
                          </View>
                        </View>
                      )}

                      {Array.isArray(item.mediaSubtypes) &&
                        item.mediaSubtypes.includes(
                          'livePhoto'
                        ) && (
                          <View
                            pointerEvents="none"
                            style={styles.gridLiveBadge}
                          >
                            <Text
                              style={
                                styles.gridLiveBadgeText
                              }
                            >
                              LIVE
                            </Text>
                          </View>
                        )}

                      {gridColumns <= 3 && (
                        <View
                          pointerEvents="none"
                          style={styles.photoDateBadge}
                        >
                          <Text
                            style={
                              styles.photoDateBadgeText
                            }
                          >
                            {formatDate(
                              item.creationTime
                            )}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                }}
                onEndReached={() => {
                  if (hasNext && !loading) {
                    loadPage(false).catch(() => {});
                  }
                }}
                onEndReachedThreshold={0.5}
                onViewableItemsChanged={
                  onPhotoViewableItemsChanged
                }
                viewabilityConfig={
                  photoViewabilityConfig
                }
                ListFooterComponent={
                  loading ? (
                    <ActivityIndicator
                      style={{ marginVertical: 18 }}
                      color={palette.moss}
                    />
                  ) : null
                }
              />
                </Animated.View>
              </GestureDetector>

              {!!selectedAssets.length && (
                <View
                  style={[
                    styles.multiSelectBar,
                    { bottom: Math.max(insets.bottom, 8) + 8 },
                  ]}
                >
                  <View>
                    <Text style={styles.multiSelectBarOverline}>
                      NEW MEMORY
                    </Text>
                    <Text style={styles.multiSelectBarTitle}>
                      已选 {selectedAssets.length} 张
                    </Text>
                  </View>
                  <Pressable
                    style={styles.multiSelectContinue}
                    onPress={continueWithSelection}
                    disabled={reading}
                  >
                    <Text style={styles.multiSelectContinueText}>
                      {reading ? '读取中…' : '下一步'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </>
        )}

        <Modal
          visible={albumSheetOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setAlbumSheetOpen(false)}
        >
          <Pressable
            style={styles.albumSheetBackdrop}
            onPress={() => setAlbumSheetOpen(false)}
          >
            <Pressable
              style={[
                styles.albumSheet,
                { paddingBottom: Math.max(insets.bottom, 12) + 12 },
              ]}
              onPress={() => {}}
            >
              <View style={styles.albumSheetHandle} />
              <Text style={styles.albumSheetEyebrow}>APPLE PHOTOS</Text>
              <Text style={styles.albumSheetTitle}>选择相簿</Text>
              <Text style={styles.albumSheetLead}>
                时间定位条会根据当前相簿的照片数量重新计算。
              </Text>

              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: 480 }}
              >
                <Pressable
                  style={[
                    styles.albumRow,
                    !selectedAlbum && styles.albumRowOn,
                  ]}
                  onPress={() => {
                    setAlbumSheetOpen(false);
                    setSelectedAlbum(null);
                  }}
                >
                  <View style={styles.albumRowIcon}>
                    <Text style={styles.albumRowIconText}>▦</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.albumRowTitle}>所有照片</Text>
                    <Text style={styles.albumRowSub}>
                      全部可访问的照片
                    </Text>
                  </View>
                  {!selectedAlbum && (
                    <Text style={styles.albumRowCheck}>✓</Text>
                  )}
                </Pressable>

                {albums.map((album) => {
                  const on = selectedAlbum?.id === album.id;
                  return (
                    <Pressable
                      key={album.id}
                      style={[
                        styles.albumRow,
                        on && styles.albumRowOn,
                      ]}
                      onPress={() => {
                        setAlbumSheetOpen(false);
                        setSelectedAlbum(album);
                      }}
                    >
                      <View style={styles.albumRowIcon}>
                        <Text style={styles.albumRowIconText}>
                          {album.type === 'smartAlbum' ? '✦' : '□'}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={styles.albumRowTitle}
                          numberOfLines={1}
                        >
                          {album.title}
                        </Text>
                        <Text style={styles.albumRowSub}>
                          {album.type === 'smartAlbum'
                            ? '系统智能相簿'
                            : '我的相簿'}
                          {' · '}
                          {album.assetCount ?? 0} 项
                        </Text>
                      </View>
                      {on && (
                        <Text style={styles.albumRowCheck}>✓</Text>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
}

function CategoryManager({
  visible,
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  categories: MemoryCategory[];
  onClose: () => void;
  onSave: (category: MemoryCategory) => void;
  onDelete: (categoryId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(categoryColors[0] || '#607565');
  const [symbol, setSymbol] = useState(categorySymbols[0] || '⌖');

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setColor(categoryColors[0] || '#607565');
    setSymbol(categorySymbols[0] || '⌖');
  };

  useEffect(() => {
    if (!visible) resetForm();
  }, [visible]);

  const beginEdit = (category: MemoryCategory) => {
    setEditingId(category.id);
    setName(category.name);
    setColor(category.color);
    setSymbol(category.symbol);
  };

  const commit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('给分类起个名字', '例如：散步、动画巡礼、甜品、住过的地方。');
      return;
    }
    const old = categories.find((item) => item.id === editingId);
    await onSave({
      id: editingId || `cat_${uid()}`,
      name: trimmed,
      color,
      symbol,
      protected: old?.protected,
      createdAt: old?.createdAt || Date.now(),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {}
    );
    resetForm();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={[
          styles.modalPage,
          {
            paddingTop: Math.max(insets.top, 12),
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>完成</Text>
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.modalHeaderTitle}>分类与地图颜色</Text>
            <Text style={styles.modalHeaderSub}>以后随时都可以改</Text>
          </View>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.categoryManagerContent}
        >
          <View style={styles.categoryEditorCard}>
            <Text style={styles.sectionEyebrow}>
              {editingId ? 'EDIT CATEGORY' : 'NEW CATEGORY'}
            </Text>
            <Text style={styles.sectionTitle}>
              {editingId ? '修改这个分类' : '创建你自己的分类'}
            </Text>

            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="分类名称"
              placeholderTextColor={palette.muted}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>地图点颜色 · 柔和色板</Text>
            <View style={styles.colorGrid}>
              {categoryColors.map((item) => (
                <Pressable
                  key={item}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: item },
                    color === item && styles.colorSwatchOn,
                  ]}
                  onPress={() => {
                    setColor(item);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                >
                  {color === item && (
                    <Text
                      style={[
                        styles.colorCheck,
                        { color: markerTextColor(item) },
                      ]}
                    >
                      ✓
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>地图点符号</Text>
            <View style={styles.symbolGrid}>
              {categorySymbols.map((item) => (
                <Pressable
                  key={item}
                  style={[
                    styles.symbolSwatch,
                    symbol === item && {
                      borderColor: color,
                      backgroundColor: colorWash(color, '18'),
                    },
                  ]}
                  onPress={() => {
                    setSymbol(item);
                    Haptics.selectionAsync().catch(() => {});
                  }}
                >
                  <Text
                    style={[
                      styles.symbolSwatchText,
                      symbol === item && { color, fontWeight: '800' },
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.categoryPreview}>
              <View style={[styles.mapMarker, { backgroundColor: color }]}>
                <Text
                  style={[
                    styles.mapMarkerText,
                    { color: markerTextColor(color) },
                  ]}
                >
                  {symbol}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.categoryPreviewLabel}>地图上的样子</Text>
                <Text style={styles.categoryPreviewName}>
                  {name.trim() || '你的分类'}
                </Text>
              </View>
            </View>

            <View style={styles.categoryFormActions}>
              {editingId && (
                <Pressable style={styles.secondaryButton} onPress={resetForm}>
                  <Text style={styles.secondaryButtonText}>取消修改</Text>
                </Pressable>
              )}
              <Pressable style={styles.primaryFlexButton} onPress={commit}>
                <Text style={styles.primaryButtonText}>
                  {editingId ? '保存修改' : '添加分类'}
                </Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.categoryListHeading}>当前分类</Text>

          {categories.map((category) => (
            <View key={category.id} style={styles.categoryRow}>
              <View
                style={[styles.categoryDot, { backgroundColor: category.color }]}
              >
                <Text
                  style={[
                    styles.categoryDotText,
                    { color: markerTextColor(category.color) },
                  ]}
                >
                  {category.symbol}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.categoryRowName}>{category.name}</Text>
                <Text style={styles.categoryRowSub}>
                  {category.protected ? '兜底分类 · 不可删除' : '可编辑 · 可删除'}
                </Text>
              </View>
              <Pressable
                style={styles.miniAction}
                onPress={() => beginEdit(category)}
              >
                <Text style={styles.miniActionText}>编辑</Text>
              </Pressable>
              {!category.protected && (
                <Pressable
                  style={styles.miniDelete}
                  onPress={() =>
                    Alert.alert(
                      `删除“${category.name}”？`,
                      '这个分类下已有的记忆不会被删，会自动移动到“未分类”。',
                      [
                        { text: '取消', style: 'cancel' },
                        {
                          text: '删除',
                          style: 'destructive',
                          onPress: () => onDelete(category.id),
                        },
                      ]
                    )
                  }
                >
                  <Text style={styles.miniDeleteText}>删除</Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}


const REORDER_THUMB_SIZE = 76;
const REORDER_THUMB_GAP = 9;
const REORDER_SLOT = REORDER_THUMB_SIZE + REORDER_THUMB_GAP;

function reorderMediaArray(
  items: MemoryMedia[],
  fromIndex: number,
  toIndex: number
) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function ReorderThumb({
  item,
  index,
  count,
  selected,
  dragIndex,
  hoverIndex,
  dragTranslationX,
  onSelect,
  onDragStartJS,
  onHoverJS,
  onCommitJS,
  onDragFinishJS,
}: {
  key?: string;
  item: MemoryMedia;
  index: number;
  count: number;
  selected: boolean;
  dragIndex: any;
  hoverIndex: any;
  dragTranslationX: any;
  onSelect: (id: string) => void;
  onDragStartJS: (id: string) => void;
  onHoverJS: () => void;
  onCommitJS: (from: number, to: number) => void;
  onDragFinishJS: () => void;
}) {
  const springConfig = {
    damping: 20,
    stiffness: 260,
    mass: 0.7,
  };

  const animatedStyle = useAnimatedStyle(() => {
    const from = dragIndex.value;
    const hover = hoverIndex.value;
    const isDragging = from === index;

    let shift = 0;

    if (!isDragging && from >= 0 && hover >= 0) {
      if (hover > from && index > from && index <= hover) {
        shift = -REORDER_SLOT;
      } else if (hover < from && index >= hover && index < from) {
        shift = REORDER_SLOT;
      }
    }

    return {
      zIndex: isDragging ? 100 : 1,
      transform: [
        {
          translateX: isDragging
            ? dragTranslationX.value
            : withSpring(shift, springConfig),
        },
        {
          scale: withTiming(isDragging ? 1.08 : 1, {
            duration: 120,
          }),
        },
      ],
      opacity: withTiming(isDragging ? 0.96 : 1, {
        duration: 100,
      }),
    };
  });

  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .minDistance(1)
    .onStart(() => {
      dragIndex.value = index;
      hoverIndex.value = index;
      dragTranslationX.value = 0;
      runOnJS(onDragStartJS)(item.id);
    })
    .onUpdate((event) => {
      dragTranslationX.value = event.translationX;

      const projectedCenter =
        index * REORDER_SLOT + event.translationX;
      const nextHover = Math.max(
        0,
        Math.min(
          count - 1,
          Math.round(projectedCenter / REORDER_SLOT)
        )
      );

      if (nextHover !== hoverIndex.value) {
        hoverIndex.value = nextHover;
        runOnJS(onHoverJS)();
      }
    })
    .onEnd(() => {
      const from = dragIndex.value;
      const to = hoverIndex.value;

      if (from < 0 || to < 0) {
        dragTranslationX.value = withSpring(0, springConfig);
        dragIndex.value = -1;
        hoverIndex.value = -1;
        runOnJS(onDragFinishJS)();
        return;
      }

      // XHS-like settle: the lifted thumbnail first snaps to the target slot;
      // only when that animation finishes do we commit the array order.
      const settleX = (to - from) * REORDER_SLOT;

      dragTranslationX.value = withSpring(
        settleX,
        springConfig,
        (finished) => {
          if (finished) {
            // Commit/reset together on JS so React never renders a new
            // array while the old numeric drag index is still active.
            runOnJS(onCommitJS)(from, to);
          } else {
            dragIndex.value = -1;
            hoverIndex.value = -1;
            dragTranslationX.value = 0;
            runOnJS(onDragFinishJS)();
          }
        }
      );
    })
    .onFinalize((_event, success) => {
      if (!success && dragIndex.value === index) {
        dragTranslationX.value = withSpring(0, springConfig);
        dragIndex.value = -1;
        hoverIndex.value = -1;
        runOnJS(onDragFinishJS)();
      }
    });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.xhsReorderItem,
          animatedStyle,
        ]}
      >
        <Pressable
          onPress={() => onSelect(item.id)}
          style={[
            styles.xhsReorderPressable,
            selected && styles.xhsReorderPressableSelected,
          ]}
        >
          <Image
            source={{ uri: mediaPhotoUri(item) }}
            style={styles.xhsReorderImage}
            contentFit="cover"
          />

          <View style={styles.xhsReorderIndex}>
            <Text style={styles.xhsReorderIndexText}>
              {index + 1}
            </Text>
          </View>

          <View style={styles.xhsReorderGrip}>
            <Text style={styles.xhsReorderGripText}>≡</Text>
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

function XhsPhotoReorderStrip({
  items,
  selectedMediaId,
  onSelect,
  onChange,
}: {
  items: MemoryMedia[];
  selectedMediaId: string;
  onSelect: (id: string) => void;
  onChange: (items: MemoryMedia[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragIndex = useSharedValue(-1);
  const hoverIndex = useSharedValue(-1);
  const dragTranslationX = useSharedValue(0);

  const commit = useCallback(
    (from: number, to: number) => {
      const next = reorderMediaArray(items, from, to);

      // Batch data commit and gesture reset in the same JS turn. This avoids
      // the "dragged photo jumps back, then moves again" behavior.
      onChange(next);
      dragIndex.value = -1;
      hoverIndex.value = -1;
      dragTranslationX.value = 0;
      setDragging(false);

      Haptics.impactAsync(
        Haptics.ImpactFeedbackStyle.Light
      ).catch(() => {});
    },
    [
      dragIndex,
      dragTranslationX,
      hoverIndex,
      items,
      onChange,
    ]
  );

  const startDrag = useCallback(
    (id: string) => {
      setDragging(true);
      onSelect(id);
      Haptics.impactAsync(
        Haptics.ImpactFeedbackStyle.Medium
      ).catch(() => {});
    },
    [onSelect]
  );

  const hoverHaptic = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
  }, []);

  return (
    <View style={styles.xhsReorderWrap}>
      <View style={styles.xhsReorderInstructionRow}>
        <Text style={styles.xhsReorderInstruction}>
          长按照片后左右拖动调整顺序
        </Text>
        <Text style={styles.xhsReorderInstructionStrong}>
          {dragging ? '松手放到这里' : '像编辑笔记一样'}
        </Text>
      </View>

      <ScrollView
        horizontal
        scrollEnabled={!dragging}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.xhsReorderTrack}
      >
        {items.map((item, index) => (
          <ReorderThumb
            key={item.id}
            item={item}
            index={index}
            count={items.length}
            selected={item.id === selectedMediaId}
            dragIndex={dragIndex}
            hoverIndex={hoverIndex}
            dragTranslationX={dragTranslationX}
            onSelect={onSelect}
            onDragStartJS={startDrag}
            onHoverJS={hoverHaptic}
            onCommitJS={commit}
            onDragFinishJS={() => setDragging(false)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function MemoryEditor({
  draftPhotos,
  editingMemory,
  categories,
  onClose,
  onSave,
  onManageCategories,
}: {
  draftPhotos: DraftPhoto[] | null;
  editingMemory: AtlasMemory | null;
  categories: MemoryCategory[];
  onClose: () => void;
  onSave: (memory: AtlasMemory) => Promise<void>;
  onManageCategories: () => void;
}) {
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [categoryId, setCategoryId] = useState('uncategorized');
  const [pinColor, setPinColor] = useState<string | null>(null);
  const [returnIntent, setReturnIntent] =
    useState<ReturnIntent>('一定会');
  const [tags, setTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');

  const [mediaItems, setMediaItems] = useState<MemoryMedia[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState('');

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [source, setSource] = useState<LocationSource>('manual');
  const [address, setAddress] = useState<MemoryAddress | undefined>(undefined);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressText, setAddressText] = useState('');
  const addressKeyRef = useRef('');
  const addressManuallyEditedRef = useRef(false);

  const [mapDisplayMode, setMapDisplayMode] =
    useState<MapDisplayMode>('raw');
  const [mapReady, setMapReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorHydratedKey, setEditorHydratedKey] = useState('');
  const mapRef = useRef<MapView | null>(null);

  const visible = !!draftPhotos?.length || !!editingMemory;
  const editorSessionKey = editingMemory
    ? `edit:${editingMemory.id}`
    : draftPhotos?.length
    ? `draft:${draftPhotos.map((item) => item.assetId).join('|')}`
    : '';

  useEffect(() => {
    if (editingMemory) {
      const existingItems = memoryMediaItems(editingMemory);

      setTitle(editingMemory.title);
      setNote(editingMemory.note);
      setCategoryId(editingMemory.categoryId);
      setPinColor(editingMemory.pinColor || null);
      setReturnIntent(editingMemory.returnIntent);
      setTags(editingMemory.tags);
      setCustomTag('');

      setMediaItems(existingItems);
      setSelectedMediaId(existingItems[0].id);

      setLatitude(editingMemory.latitude);
      setLongitude(editingMemory.longitude);
      setSource(editingMemory.locationSource);
      setAddress(editingMemory.address);
      setAddressText(editingMemory.address?.label || '');
      addressManuallyEditedRef.current = false;
      addressKeyRef.current = editingMemory.address
        ? `${editingMemory.latitude.toFixed(5)},${editingMemory.longitude.toFixed(5)}`
        : '';

      setMapDisplayMode(
        editingMemory.mapDisplayMode ||
          (editingMemory.locationSource === 'photo' &&
          isMainlandChinaCoordinate(
            editingMemory.latitude,
            editingMemory.longitude
          )
            ? 'china-corrected'
            : 'raw')
      );

      setMapReady(false);
      setEditorHydratedKey(editorSessionKey);
      return;
    }

    if (draftPhotos?.length) {
      const items = draftPhotos.map(draftToMedia);
      const located =
        draftPhotos.find(
          (photo) =>
            typeof photo.latitude === 'number' &&
            typeof photo.longitude === 'number'
        ) || draftPhotos[0];

      setTitle('');
      setNote('');
      setCategoryId(
        categories.find((item) => item.id !== 'uncategorized')?.id ||
          'uncategorized'
      );
      setPinColor(null);
      setReturnIntent('一定会');
      setTags([]);
      setCustomTag('');

      setMediaItems(items);
      setSelectedMediaId(items[0].id);

      setLatitude(located.latitude);
      setLongitude(located.longitude);
      setSource(located.locationSource || 'manual');
      setAddress(undefined);
      setAddressText('');
      addressManuallyEditedRef.current = false;
      addressKeyRef.current = '';

      setMapDisplayMode(
        located.locationSource === 'photo' &&
        typeof located.latitude === 'number' &&
        typeof located.longitude === 'number' &&
        isMainlandChinaCoordinate(
          located.latitude,
          located.longitude
        )
          ? 'china-corrected'
          : 'raw'
      );

      setMapReady(false);
      setEditorHydratedKey(editorSessionKey);
    }
  }, [editorSessionKey]);

  useEffect(() => {
    if (!categories.some((item) => item.id === categoryId)) {
      setCategoryId('uncategorized');
    }
  }, [categories, categoryId]);

  const hasLocation = isValidCoordinate(latitude, longitude);

  const editorDisplayCoordinate = hasLocation
    ? mapCoordinate(
        latitude as number,
        longitude as number,
        mapDisplayMode
      )
    : null;

  useEffect(() => {
    if (!visible || !mapReady || !editorDisplayCoordinate) return;

    const timer = setTimeout(() => {
      mapRef.current?.animateToRegion(
        regionFor(
          editorDisplayCoordinate.latitude,
          editorDisplayCoordinate.longitude,
          0.018
        ),
        420
      );
    }, 80);

    return () => clearTimeout(timer);
  }, [
    visible,
    mapReady,
    latitude,
    longitude,
    mapDisplayMode,
  ]);

  useEffect(() => {
    if (!visible || !hasLocation) return;

    const key = `${(latitude as number).toFixed(5)},${(
      longitude as number
    ).toFixed(5)}`;

    if (addressKeyRef.current === key) return;

    let cancelled = false;
    setAddressLoading(true);

    const timer = setTimeout(() => {
      reverseGeocodeAddress(
        latitude as number,
        longitude as number
      )
        .then((result) => {
          if (cancelled) return;

          if (!addressManuallyEditedRef.current) {
            setAddress(result);
            setAddressText(result?.label || '');
          }

          addressKeyRef.current = key;
        })
        .finally(() => {
          if (!cancelled) setAddressLoading(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, latitude, longitude, hasLocation]);

  if (
    !visible ||
    editorHydratedKey !== editorSessionKey ||
    !mediaItems.length
  ) {
    return null;
  }

  const selectedMedia =
    mediaItems.find((item) => item.id === selectedMediaId) ||
    mediaItems[0];

  const cover = mediaItems[0];

  const selectedIndex = Math.max(
    0,
    mediaItems.findIndex((item) => item.id === selectedMedia.id)
  );

  const retryEditorAddress = async () => {
    if (!hasLocation || addressLoading) return;

    addressManuallyEditedRef.current = false;
    setAddressLoading(true);

    try {
      const result = await reverseGeocodeAddress(
        latitude as number,
        longitude as number
      );

      setAddress(result);
      setAddressText(result?.label || '');
      addressKeyRef.current = `${(latitude as number).toFixed(5)},${(
        longitude as number
      ).toFixed(5)}`;
    } finally {
      setAddressLoading(false);
    }
  };

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag)
        ? prev.filter((item) => item !== tag)
        : [...prev, tag]
    );
    Haptics.selectionAsync().catch(() => {});
  };

  const commitCustomTag = () => {
    const tag = customTag.trim();
    if (!tag) return;

    if (!tags.includes(tag)) {
      setTags((prev) => [...prev, tag]);
    }
    setCustomTag('');
    Haptics.selectionAsync().catch(() => {});
  };



  const removeSelected = () => {
    if (mediaItems.length <= 1) {
      Alert.alert('至少保留一张照片');
      return;
    }

    const index = mediaItems.findIndex(
      (item) => item.id === selectedMediaId
    );
    if (index < 0) return;

    const removed = mediaItems[index];
    const next = mediaItems.filter(
      (item) => item.id !== removed.id
    );

    setMediaItems(next);

    setSelectedMediaId(
      next[Math.min(index, next.length - 1)].id
    );
  };

  const save = async () => {
    if (saving) return;

    if (!title.trim()) {
      Alert.alert(
        '还差一个名字',
        '给这个地方或这段记忆起一个你自己认得的名字。'
      );
      return;
    }

    if (!hasLocation) {
      Alert.alert(
        '还没有地点',
        '在地图上长按一下，告诉 Mappory 这段记忆发生在哪里。'
      );
      return;
    }

    if (!mediaItems.length || !cover) {
      Alert.alert('至少需要一张照片');
      return;
    }

    const now = Date.now();

    const base: AtlasMemory = {
      id: editingMemory?.id || uid(),

      mediaItems,
      coverMediaId: cover.id,

      assetId: cover.assetId,
      assetUri: cover.assetUri,
      originalPhotoLocalUri: cover.originalPhotoLocalUri,
      originalPairedVideoUri: cover.originalPairedVideoUri,
      mediaKind: cover.mediaKind,
      archiveStatus: summarizeArchiveStatus(mediaItems),
      archivedPhotoUri: cover.archivedPhotoUri,
      archivedPairedVideoUri: cover.archivedPairedVideoUri,
      archiveError: cover.archiveError,

      title: title.trim(),
      note: note.trim(),
      categoryId: categories.some(
        (item) => item.id === categoryId
      )
        ? categoryId
        : 'uncategorized',
      pinColor: pinColor || undefined,
      returnIntent,
      tags,

      latitude: latitude as number,
      longitude: longitude as number,
      locationSource: source,
      address: addressText.trim()
        ? {
            ...(address || { label: addressText.trim() }),
            label: addressText.trim(),
          }
        : address,
      mapDisplayMode,

      shotAt: cover.shotAt,
      createdAt: editingMemory?.createdAt || now,
      updatedAt: now,
    };

    setSaving(true);

    try {
      await onSave(mirrorCoverMemory(base));
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success
      ).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const gpsWasDetected =
    source === 'photo' &&
    hasLocation;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalPage}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.editorSafe,
            {
              paddingTop: Math.max(insets.top, 12),
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          <View style={styles.modalHeader}>
            <Pressable onPress={onClose} style={styles.textButton}>
              <Text style={styles.textButtonLabel}>取消</Text>
            </Pressable>

            <View style={{ alignItems: 'center' }}>
              <Text style={styles.modalHeaderTitle}>
                {editingMemory ? '修改记忆' : '添加一段记忆'}
              </Text>
              <Text style={styles.modalHeaderSub}>
                {mediaItems.length} 张照片 · 排序即展示顺序
              </Text>
            </View>

            <Pressable
              onPress={save}
              style={styles.textButton}
              disabled={saving}
            >
              <Text
                style={[
                  styles.textButtonLabel,
                  {
                    color: saving
                      ? palette.disabled
                      : palette.mossDark,
                  },
                ]}
              >
                {saving ? '归档中…' : '保存'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.editorContent}
          >
            <View style={styles.heroPhotoWrap}>
              <MemoryMediaView
                media={selectedMedia}
                style={styles.heroPhoto}
              />

              <LinearGradient
                colors={[
                  'transparent',
                  'rgba(15,20,16,0.72)',
                ]}
                style={styles.heroPhotoFade}
                pointerEvents="none"
              />

              <View pointerEvents="none" style={styles.photoMetaOverlay}>
                <Text style={styles.photoMetaDate}>
                  {formatDate(selectedMedia.shotAt)}
                </Text>
                <Text
                  style={styles.photoMetaFilename}
                  numberOfLines={1}
                >
                  {selectedMedia.filename}
                </Text>
              </View>

            </View>

            <View style={styles.mediaEditorSection}>
              <View style={styles.mediaEditorHeader}>
                <View>
                  <Text style={styles.sectionEyebrow}>
                    MEDIA · {mediaItems.length}
                  </Text>
                  <Text style={styles.sectionTitle}>
                    这段记忆里的照片
                  </Text>
                </View>
                <Text style={styles.mediaEditorCounter}>
                  {selectedIndex + 1}/{mediaItems.length}
                </Text>
              </View>

              <XhsPhotoReorderStrip
                items={mediaItems}
                selectedMediaId={selectedMedia.id}
                onSelect={setSelectedMediaId}
                onChange={setMediaItems}
              />
              <View style={styles.mediaActionsRow}>
                <Pressable
                  style={styles.mediaRemoveButton}
                  onPress={removeSelected}
                >
                  <Text style={styles.mediaRemoveText}>移除这张</Text>
                </Pressable>
              </View>

              <Text style={styles.mediaEditorHint}>
                长按缩略图左右拖动排序。排序第 1 张会自动用于地图照片点和记忆卡片，不再单独设置封面。
              </Text>
            </View>

            <View style={styles.editorSection}>
              <View style={styles.sectionHeadingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionEyebrow}>
                    01 · LOCATION
                  </Text>
                  <Text style={styles.sectionTitle}>
                    这段记忆发生在哪里？
                  </Text>
                </View>

                <View
                  style={[
                    styles.gpsBadge,
                    {
                      backgroundColor:
                        gpsWasDetected && hasLocation
                          ? palette.mossPale
                          : hasLocation
                          ? colorWash('#C86E57', '20')
                          : colorWash('#A78A56', '20'),
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.gpsBadgeText,
                      {
                        color:
                          gpsWasDetected && hasLocation
                            ? palette.mossDark
                            : hasLocation
                            ? '#C86E57'
                            : '#8D754B',
                      },
                    ]}
                  >
                    {gpsWasDetected && hasLocation
                      ? '照片定位 ✓'
                      : hasLocation
                      ? '手动位置'
                      : '没有坐标'}
                  </Text>
                </View>
              </View>

              {hasLocation && (
                <View style={styles.addressCard}>
                  <Text style={styles.addressEyebrow}>
                    PLACE
                  </Text>
                  <Text style={styles.addressTitle}>
                    {addressLoading && !addressText
                      ? '正在识别地点…'
                      : addressText || '地点名称暂未识别'}
                  </Text>

                  <TextInput
                    value={addressText}
                    onChangeText={(value) => {
                      addressManuallyEditedRef.current = true;
                      setAddressText(value);
                      setAddress((prev) =>
                        prev
                          ? { ...prev, label: value }
                          : value.trim()
                          ? { label: value }
                          : undefined
                      );
                    }}
                    placeholder="自动识别失败时可直接填写；自动结果会保留服务返回的原始语言"
                    placeholderTextColor={palette.muted}
                    style={styles.addressManualInput}
                  />

                  <View style={styles.addressAssistRow}>
                    <Text style={styles.addressAssistText}>
                      自动识别不是必填；国外地点识别失败时可以直接改上面的名称。
                    </Text>
                    <Pressable
                      style={styles.addressRetryInline}
                      onPress={retryEditorAddress}
                      disabled={addressLoading}
                    >
                      <Text style={styles.addressRetryInlineText}>
                        {addressLoading ? '识别中…' : '重新识别'}
                      </Text>
                    </Pressable>
                  </View>

                  <Text style={styles.addressGps}>
                    GPS · {coordText(
                      latitude as number,
                      longitude as number
                    )}
                  </Text>
                  {!!address?.attribution && (
                    <Text style={styles.addressAttribution}>
                      {address.attribution}
                    </Text>
                  )}
                </View>
              )}

              <View style={styles.editorMapWrap}>
                <MapView
                  ref={(node: MapView | null) => {
                    mapRef.current = node;
                  }}
                  style={StyleSheet.absoluteFill}
                  initialRegion={DEFAULT_REGION}
                  toolbarEnabled={false}
                  mapType="standard"
                  userInterfaceStyle={
                    Appearance.getColorScheme() === 'dark'
                      ? 'dark'
                      : 'light'
                  }
                  onMapReady={() => setMapReady(true)}
                  onLongPress={(event: any) => {
                    const { latitude: lat, longitude: lon } =
                      event.nativeEvent.coordinate;

                    setLatitude(lat);
                    setLongitude(lon);
                    setSource('manual');
                    setMapDisplayMode('raw');
                    setAddress(undefined);
                    setAddressText('');
                    addressManuallyEditedRef.current = false;
                    addressKeyRef.current = '';

                    Haptics.impactAsync(
                      Haptics.ImpactFeedbackStyle.Medium
                    ).catch(() => {});
                  }}
                >
                  {hasLocation && (
                    <Marker
                      draggable
                      coordinate={
                        editorDisplayCoordinate || {
                          latitude: latitude as number,
                          longitude: longitude as number,
                        }
                      }
                      onDragEnd={(event: any) => {
                        setLatitude(
                          event.nativeEvent.coordinate.latitude
                        );
                        setLongitude(
                          event.nativeEvent.coordinate.longitude
                        );
                        setSource('manual');
                        setMapDisplayMode('raw');
                        setAddress(undefined);
                        addressKeyRef.current = '';
                      }}
                    />
                  )}
                </MapView>

                {!hasLocation && (
                  <View
                    pointerEvents="none"
                    style={styles.mapInstruction}
                  >
                    <Text style={styles.mapInstructionTitle}>
                      这些照片没有可用坐标
                    </Text>
                    <Text style={styles.mapInstructionText}>
                      把地图移到大概位置，然后长按落一个 Pin
                    </Text>
                  </View>
                )}
              </View>

              {hasLocation &&
                isMainlandChinaCoordinate(
                  latitude as number,
                  longitude as number
                ) && (
                  <View style={styles.mapCorrectionRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mapCorrectionTitle}>
                        中国大陆地图显示校正
                      </Text>
                      <Text style={styles.mapCorrectionBody}>
                        原始 GPS 不改变；这里只校正高德/MapKit 底图显示。
                      </Text>
                    </View>

                    <Pressable
                      style={[
                        styles.mapCorrectionSwitch,
                        mapDisplayMode === 'china-corrected' &&
                          styles.mapCorrectionSwitchOn,
                      ]}
                      onPress={() => {
                        setMapDisplayMode((prev) =>
                          prev === 'china-corrected'
                            ? 'raw'
                            : 'china-corrected'
                        );
                        Haptics.selectionAsync().catch(() => {});
                      }}
                    >
                      <View
                        style={[
                          styles.mapCorrectionKnob,
                          mapDisplayMode === 'china-corrected' &&
                            styles.mapCorrectionKnobOn,
                        ]}
                      />
                    </Pressable>
                  </View>
                )}
            </View>

            <View style={styles.editorSection}>
              <Text style={styles.sectionEyebrow}>02 · MEMORY</Text>
              <Text style={styles.sectionTitle}>
                你会怎么叫这里？
              </Text>

              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="例如：雨后的杭州东站 / 那家会再去的烧鸟"
                placeholderTextColor={palette.muted}
                style={styles.input}
              />

              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>
                  它属于哪一种记忆
                </Text>
                <Pressable onPress={onManageCategories}>
                  <Text style={styles.inlineManageText}>
                    ＋ 管理分类
                  </Text>
                </Pressable>
              </View>

              <View style={styles.choiceWrap}>
                {categories.map((category) => {
                  const on = categoryId === category.id;

                  return (
                    <Pressable
                      key={category.id}
                      onPress={() => {
                        setCategoryId(category.id);
                        Haptics.selectionAsync().catch(() => {});
                      }}
                      style={[
                        styles.choiceChip,
                        on && {
                          backgroundColor: colorWash(
                            category.color,
                            '1D'
                          ),
                          borderColor: category.color,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceChipText,
                          on && {
                            color: category.color,
                            fontWeight: '700',
                          },
                        ]}
                      >
                        {category.symbol} {category.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>
                这个地图点的颜色 · 柔和色板
              </Text>

              <View style={styles.colorGrid}>
                <Pressable
                  style={[
                    styles.colorSwatch,
                    {
                      backgroundColor: categoryFor(
                        categories,
                        categoryId
                      ).color,
                    },
                    pinColor === null && styles.colorSwatchOn,
                  ]}
                  onPress={() => setPinColor(null)}
                >
                  {pinColor === null && (
                    <Text
                      style={[
                        styles.colorCheck,
                        {
                          color: markerTextColor(
                            categoryFor(
                              categories,
                              categoryId
                            ).color
                          ),
                        },
                      ]}
                    >
                      ✓
                    </Text>
                  )}
                </Pressable>

                {categoryColors.map((item) => (
                  <Pressable
                    key={item}
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: item },
                      pinColor === item && styles.colorSwatchOn,
                    ]}
                    onPress={() => setPinColor(item)}
                  >
                    {pinColor === item && (
                      <Text
                        style={[
                          styles.colorCheck,
                          { color: markerTextColor(item) },
                        ]}
                      >
                        ✓
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>
                最想留下一句话
              </Text>

              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="不用写攻略，只写以后看到时会想起来的那一句。"
                placeholderTextColor={palette.muted}
                multiline
                style={[styles.input, styles.noteInput]}
              />
            </View>

            <View style={styles.editorSection}>
              <Text style={styles.sectionEyebrow}>03 · MY WAY</Text>
              <Text style={styles.sectionTitle}>
                只属于你的记录方式
              </Text>

              <Text style={styles.fieldLabel}>
                我还会不会来
              </Text>

              <View style={styles.segmentRow}>
                {returnOptions.map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => {
                      setReturnIntent(item);
                      Haptics.selectionAsync().catch(() => {});
                    }}
                    style={[
                      styles.segmentButton,
                      returnIntent === item &&
                        styles.segmentButtonOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        returnIntent === item &&
                          styles.segmentTextOn,
                      ]}
                    >
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>
                给它一些你自己的标签
              </Text>

              <View style={styles.choiceWrap}>
                {personalTags.map((tag) => {
                  const on = tags.includes(tag);

                  return (
                    <Pressable
                      key={tag}
                      onPress={() => toggleTag(tag)}
                      style={[
                        styles.tagChip,
                        on && styles.tagChipOn,
                      ]}
                    >
                      <Text
                        style={[
                          styles.tagText,
                          on && styles.tagTextOn,
                        ]}
                      >
                        {on ? '✓ ' : ''}
                        {tag}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.customTagRow}>
                <TextInput
                  value={customTag}
                  onChangeText={setCustomTag}
                  onSubmitEditing={commitCustomTag}
                  placeholder="自己写一个标签"
                  placeholderTextColor={palette.muted}
                  style={[
                    styles.input,
                    { flex: 1, marginTop: 0 },
                  ]}
                  returnKeyType="done"
                />
                <Pressable
                  style={styles.customTagButton}
                  onPress={commitCustomTag}
                >
                  <Text style={styles.customTagButtonText}>加入</Text>
                </Pressable>
              </View>

              {!!tags.length && (
                <Text style={styles.tagsPreview}>
                  #{tags.join('  #')}
                </Text>
              )}
            </View>

            <Pressable
              style={[
                styles.saveBig,
                saving && { opacity: 0.65 },
              ]}
              onPress={save}
              disabled={saving}
            >
              <Text style={styles.saveBigOverline}>
                {saving
                  ? 'ARCHIVING MEDIA'
                  : editingMemory
                  ? 'UPDATE MY ATLAS'
                  : 'SAVE TO MY ATLAS'}
              </Text>
              <Text style={styles.saveBigText}>
                {saving
                  ? `正在归档 ${mediaItems.length} 张媒体…`
                  : editingMemory
                  ? '保存这次修改'
                  : `保存 ${mediaItems.length} 张照片为一段记忆`}
              </Text>
            </Pressable>

            <Text style={styles.privacyNote}>
              一段记忆现在可以包含多张照片；删除 Mappory 记录不会删除 Apple 相册原图。
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>


    </Modal>
  );
}

function MemoryDetail({
  memory,
  categories,
  onClose,
  onEdit,
  onArchive,
  onDelete,
}: {
  memory: AtlasMemory | null;
  categories: MemoryCategory[];
  onClose: () => void;
  onEdit: (memory: AtlasMemory) => void;
  onArchive: (memory: AtlasMemory) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const detailGalleryRef = useRef<any>(null);
  const [activeMediaId, setActiveMediaId] = useState('');
  const [resolvedAddress, setResolvedAddress] =
    useState<MemoryAddress | undefined>(undefined);
  const [addressResolveState, setAddressResolveState] =
    useState<'idle' | 'loading' | 'resolved' | 'failed'>('idle');

  const resolveDetailAddress = useCallback(async () => {
    if (!memory) return;

    if (memory.address) {
      setResolvedAddress(memory.address);
      setAddressResolveState('resolved');
      return;
    }

    setAddressResolveState('loading');

    const result = await reverseGeocodeAddress(
      memory.latitude,
      memory.longitude
    );

    setResolvedAddress(result);
    setAddressResolveState(result ? 'resolved' : 'failed');
  }, [
    memory?.id,
    memory?.latitude,
    memory?.longitude,
    memory?.address?.label,
  ]);

  useEffect(() => {
    if (!memory) return;

    setActiveMediaId(memoryMediaItems(memory)[0].id);
    setResolvedAddress(memory.address);
    resolveDetailAddress().catch(() =>
      setAddressResolveState('failed')
    );
  }, [memory?.id, resolveDetailAddress]);

  const items = useMemo(
    () => (memory ? memoryMediaItems(memory) : []),
    [memory]
  );

  const selectDetailMedia = useCallback(
    (id: string, animated = true) => {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return;

      setActiveMediaId(id);
      detailGalleryRef.current?.scrollToOffset?.({
        offset: index * windowWidth,
        animated,
      });
    },
    [items, windowWidth]
  );

  useEffect(() => {
    if (!memory || !items.length) return;

    const coverIndex = 0;

    const timer = setTimeout(() => {
      detailGalleryRef.current?.scrollToOffset?.({
        offset: coverIndex * windowWidth,
        animated: false,
      });
    }, 80);

    return () => clearTimeout(timer);
  }, [memory?.id, items, windowWidth]);

  if (!memory) return null;

  const category = categoryFor(categories, memory.categoryId);
  const displayCoordinate = memoryMapCoordinate(memory);
  const markerColor = memory.pinColor || category.color;

  const activeMedia =
    items.find((item) => item.id === activeMediaId) ||
    items[0];

  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeMedia.id)
  );

  const archivedCount = items.filter(
    (item) => item.archiveStatus === 'archived'
  ).length;

  const partialCount = items.filter(
    (item) => item.archiveStatus === 'partial'
  ).length;

  const detailAddress = memory.address || resolvedAddress;
  const detailPrimaryParts = detailAddress
    ? uniqueAddressParts([
        detailAddress.country,
        detailAddress.region,
        detailAddress.city,
      ])
    : [];

  const detailPlacePrimary = detailPrimaryParts.length
    ? detailPrimaryParts.join(' · ')
    : detailAddress?.label ||
      (addressResolveState === 'loading'
        ? '正在识别地点'
        : '地点名称暂未识别');

  const detailPlaceSecondary = detailPrimaryParts.length
    ? uniqueAddressParts([
        detailAddress?.district,
        detailAddress?.subregion,
      ])
        .filter((part) => !detailPrimaryParts.includes(part))
        .join(' · ')
    : '';

  return (
    <Modal visible={!!memory} animationType="slide" onRequestClose={onClose}>
      <View style={styles.detailPage}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, 8),
          }}
        >
          <View style={styles.detailPhotoWrap}>
            <FlatList
              ref={detailGalleryRef}
              data={items}
              horizontal
              pagingEnabled
              directionalLockEnabled
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              keyExtractor={(item: MemoryMedia) => item.id}
              onMomentumScrollEnd={(event: any) => {
                const index = Math.max(
                  0,
                  Math.min(
                    items.length - 1,
                    Math.round(
                      event.nativeEvent.contentOffset.x /
                        Math.max(1, windowWidth)
                    )
                  )
                );
                const next = items[index];
                if (next) setActiveMediaId(next.id);
              }}
              renderItem={({ item }: { item: MemoryMedia }) => (
                <View
                  style={[
                    styles.detailPhotoPage,
                    { width: windowWidth },
                  ]}
                >
                  <MemoryMediaView
                    media={item}
                    style={styles.detailPhoto}
                  />

                  <LinearGradient
                    colors={[
                      'rgba(17,21,17,0.16)',
                      'transparent',
                      'rgba(17,21,17,0.78)',
                    ]}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                  />

                  <View
                    pointerEvents="none"
                    style={styles.detailPhotoText}
                  >
                    <Text style={styles.detailDate}>
                      {formatDate(item.shotAt)}
                    </Text>
                    <Text style={styles.detailTitle}>
                      {memory.title}
                    </Text>
                  </View>
                </View>
              )}
            />

            <View
              pointerEvents="box-none"
              style={[
                styles.detailTopActions,
                { top: Math.max(insets.top, 12) + 8 },
              ]}
            >
              <Pressable
                onPress={() => onEdit(memory)}
                style={styles.detailEditButton}
              >
                <Text style={styles.detailEditText}>编辑</Text>
              </Pressable>

              <View style={styles.detailMediaCount}>
                <Text style={styles.detailMediaCountText}>
                  {activeIndex + 1}/{items.length}
                </Text>
              </View>

              <Pressable
                onPress={onClose}
                style={styles.detailCloseInline}
              >
                <Text style={styles.detailCloseText}>×</Text>
              </Pressable>
            </View>
          </View>

          {items.length > 1 && (
            <View style={styles.detailMediaStripWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.detailMediaStrip}
              >
                {items.map((item, index) => {
                  const active = item.id === activeMedia.id;
                  return (
                    <Pressable
                      key={item.id}
                      style={[
                        styles.detailMediaThumb,
                        active && styles.detailMediaThumbOn,
                      ]}
                      onPress={() => selectDetailMedia(item.id)}
                    >
                      <Image
                        source={{ uri: mediaPhotoUri(item) }}
                        style={styles.detailMediaThumbImage}
                        contentFit="cover"
                      />
                      <Text style={styles.detailMediaThumbIndex}>
                        {index + 1}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View style={styles.detailBody}>
            <View style={styles.detailMetaRow}>
              <View
                style={[
                  styles.kindPill,
                  {
                    backgroundColor: colorWash(
                      category.color,
                      '20'
                    ),
                  },
                ]}
              >
                <Text
                  style={[
                    styles.kindPillText,
                    { color: category.color },
                  ]}
                >
                  {category.symbol} {category.name}
                </Text>
              </View>

              <View style={styles.returnPill}>
                <Text style={styles.returnPillText}>
                  再来：{memory.returnIntent}
                </Text>
              </View>

              <View style={styles.photoCountPill}>
                <Text style={styles.photoCountPillText}>
                  {items.length} 张照片
                </Text>
              </View>
            </View>

            <Text style={styles.detailNote}>
              {memory.note || '这段记忆没有写说明。'}
            </Text>

            {!!memory.tags.length && (
              <View style={styles.detailTags}>
                {memory.tags.map((tag) => (
                  <View key={tag} style={styles.detailTag}>
                    <Text style={styles.detailTagText}>#{tag}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.detailPlaceCard}>
              <View style={styles.detailPlaceHeaderRow}>
                <Text style={styles.detailPlaceEyebrow}>PLACE</Text>

                <View style={styles.detailPlaceSourcePill}>
                  <View style={styles.detailPlaceSourceDot} />
                  <Text style={styles.detailPlaceSourceText}>
                    {memory.locationSource === 'photo'
                      ? '来自照片 GPS'
                      : '手动标记位置'}
                  </Text>
                </View>
              </View>

              <Text style={styles.detailPlaceTitle}>
                {detailPlacePrimary}
              </Text>

              {!!detailPlaceSecondary && (
                <Text style={styles.detailPlaceSecondary}>
                  {detailPlaceSecondary}
                </Text>
              )}

              <View style={styles.detailPlaceDivider} />

              <View style={styles.detailPlaceCoordinateRow}>
                <Text style={styles.detailPlaceCoordinateLabel}>
                  原始坐标
                </Text>
                <Text style={styles.detailPlaceGps}>
                  {coordText(memory.latitude, memory.longitude)}
                </Text>
              </View>

              {!!detailAddress?.attribution && (
                <Text style={styles.detailPlaceAttribution}>
                  {detailAddress.attribution}
                </Text>
              )}

              {addressResolveState === 'failed' &&
                !memory.address?.label && (
                  <Pressable
                    style={styles.addressRetryButton}
                    onPress={() =>
                      resolveDetailAddress().catch(() => {})
                    }
                  >
                    <Text style={styles.addressRetryText}>
                      重新识别地点
                    </Text>
                  </Pressable>
                )}
            </View>

            <View
              style={[
                styles.archiveStatusCard,
                archivedCount === items.length
                  ? styles.archiveStatusGood
                  : archivedCount + partialCount > 0
                  ? styles.archiveStatusPartial
                  : items.every(
                      (item) => item.archiveStatus === 'failed'
                    )
                  ? styles.archiveStatusBad
                  : styles.archiveStatusWaiting,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.archiveStatusEyebrow}>
                  LOCAL ARCHIVE
                </Text>
                <Text style={styles.archiveStatusTitle}>
                  {archivedCount === items.length
                    ? `${items.length} 张媒体全部本机归档`
                    : `${archivedCount}/${items.length} 项完整归档`}
                </Text>
                <Text style={styles.archiveStatusBody}>
                  {archivedCount === items.length
                    ? 'Mappory 会优先读取自己的副本；删除 Apple 相册中的这些原图不会影响已归档媒体。'
                    : '普通照片可独立归档；某些 Live Photo 的配对视频如果仍未拿到本地 URI，暂时建议保留 Apple 相册原件。'}
                </Text>
              </View>

              {archivedCount !== items.length && (
                <Pressable
                  style={styles.archiveRetryButton}
                  onPress={() => onArchive(memory)}
                >
                  <Text style={styles.archiveRetryText}>重试</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.detailLocationHead}>
              <Text style={styles.sectionEyebrow}>MAP</Text>
              <Text style={styles.detailLocationSource}>
                {memory.locationSource === 'photo'
                  ? '来自照片 GPS'
                  : '手动落点'}
              </Text>
            </View>

            <View style={styles.detailMapWrap}>
              <MapView
                style={StyleSheet.absoluteFill}
                initialRegion={regionFor(
                  displayCoordinate.latitude,
                  displayCoordinate.longitude,
                  0.018
                )}
                scrollEnabled={false}
                zoomEnabled={false}
                pitchEnabled={false}
                rotateEnabled={false}
                toolbarEnabled={false}
                userInterfaceStyle={
                  Appearance.getColorScheme() === 'dark'
                    ? 'dark'
                    : 'light'
                }
              >
                <Marker coordinate={displayCoordinate}>
                  <View
                    style={[
                      styles.mapMarker,
                      { backgroundColor: markerColor },
                    ]}
                  >
                    <Text
                      style={[
                        styles.mapMarkerText,
                        {
                          color: markerTextColor(markerColor),
                        },
                      ]}
                    >
                      {category.symbol}
                    </Text>
                  </View>
                </Marker>
              </MapView>
            </View>

            <Text style={styles.detailCoord}>
              原始 GPS · {coordText(
                memory.latitude,
                memory.longitude
              )}
              {memory.mapDisplayMode === 'china-corrected' ||
              (!memory.mapDisplayMode &&
                memory.locationSource === 'photo' &&
                isMainlandChinaCoordinate(
                  memory.latitude,
                  memory.longitude
                ))
                ? ' · 地图显示已做中国大陆校正'
                : ''}
            </Text>

            <Pressable
              style={styles.editMemoryBig}
              onPress={() => onEdit(memory)}
            >
              <Text style={styles.editMemoryBigOverline}>
                EDIT MEMORY
              </Text>
              <Text style={styles.editMemoryBigText}>
                修改文字、照片顺序、分类或位置
              </Text>
            </Pressable>

            <Pressable
              style={styles.deleteButton}
              onPress={() =>
                Alert.alert(
                  '删除这段记忆？',
                  '会删除这条 Mappory 记录和 Mappory 的本机媒体副本，不会删除 Apple 相册原图。',
                  [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '删除',
                      style: 'destructive',
                      onPress: () => onDelete(memory.id),
                    },
                  ]
                )
              }
            >
              <Text style={styles.deleteButtonText}>
                删除这段记录
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.paper },
  full: { flex: 1, backgroundColor: palette.paper },
  page: { flex: 1, backgroundColor: palette.paper },
  modalPage: { flex: 1, backgroundColor: palette.paper },
  editorSafe: { flex: 1, backgroundColor: palette.paper },
  detailPage: { flex: 1, backgroundColor: palette.paper },

  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  bootTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: 6.4,
    marginLeft: 6.4,
  },
  bootSub: {
    marginTop: 10,
    color: 'rgba(255,255,255,.46)',
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 2.4,
    marginLeft: 2.4,
  },

  mapTopFade: { position: 'absolute', left: 0, right: 0, top: 0, height: 210 },
  mapHeaderSafe: { position: 'absolute', left: 0, right: 0, top: 0, paddingBottom: 2 },
  mapHeader: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 2.1,
    color: palette.muted,
    fontWeight: '700',
  },
  mapTitle: { fontSize: 30, fontWeight: '800', color: palette.ink, marginTop: 2 },
  countBadge: {
    minWidth: 58,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
  },
  countNumber: { fontSize: 17, fontWeight: '800', color: palette.ink },
  countLabel: { fontSize: 8, color: palette.muted, marginTop: 1 },
  headerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  themeModeButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeModeIcon: {
    fontSize: 18,
    color: palette.ink,
    lineHeight: 20,
  },

  filterViewport: {
    height: 58,
    justifyContent: 'center',
  },
  filterRow: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    alignItems: 'center',
  },
  filterChip: {
    height: 40,
    minWidth: 78,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
  filterChipAll: {
    minWidth: 68,
  },
  filterChipOn: {
    backgroundColor: palette.action,
    borderColor: palette.ink,
  },
  filterText: {
    fontSize: 10,
    lineHeight: 14,
    color: palette.muted,
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
  },
  filterTextOn: {
    color: palette.white,
    fontWeight: '800',
  },

  mapMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
  },
  mapMarkerText: { color: palette.white, fontWeight: '800', fontSize: 12 },

  emptyMapCard: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 118,
    padding: 18,
    borderRadius: 26,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    shadowColor: '#172018',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  emptyMapSymbol: { fontSize: 28, color: palette.moss },
  emptyMapTitle: {
    fontSize: 18,
    color: palette.ink,
    fontWeight: '800',
    marginTop: 8,
  },
  emptyMapBody: {
    fontSize: 11,
    color: palette.muted,
    lineHeight: 18,
    marginTop: 7,
  },

  mapPeek: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 101,
    height: 104,
    borderRadius: 22,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#182018',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  mapPeekImage: { width: 88, height: 88, borderRadius: 16, backgroundColor: palette.soft },
  mapPeekBody: { flex: 1, paddingHorizontal: 12 },
  peekDate: { fontSize: 9, color: palette.muted },
  peekTitle: { fontSize: 16, fontWeight: '800', color: palette.ink, marginTop: 3 },
  peekNote: { fontSize: 10, color: palette.muted, lineHeight: 15, marginTop: 5 },
  chevron: { fontSize: 30, color: palette.disabled, paddingRight: 6 },

  tabBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 72,
    borderRadius: 26,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    shadowColor: '#172018',
    shadowOpacity: 0.15,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
  },
  tabItem: { flex: 1, height: 64, alignItems: 'center', justifyContent: 'center' },
  tabSymbol: { color: palette.muted, fontSize: 20, lineHeight: 22 },
  tabLabel: { color: palette.muted, fontSize: 9, marginTop: 3, fontWeight: '600' },
  tabActive: { color: palette.ink },
  addOrb: {
    width: 54,
    height: 54,
    borderRadius: 20,
    borderBottomLeftRadius: 8,
    backgroundColor: palette.action,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#111',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  addOrbText: { color: palette.white, fontSize: 29, fontWeight: '300', marginTop: -2 },

  pageHeader: { paddingHorizontal: 18, paddingTop: 15 },
  pageTitle: { fontSize: 34, fontWeight: '800', color: palette.ink, marginTop: 3 },
  pageLead: {
    maxWidth: 300,
    fontSize: 11,
    color: palette.muted,
    lineHeight: 17,
    marginTop: 5,
  },
  memoryList: { paddingHorizontal: 12, paddingBottom: 105, paddingTop: 3 },
  memoryCard: {
    minHeight: 146,
    borderRadius: 22,
    padding: 8,
    marginBottom: 10,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: 'row',
  },
  memoryCardImage: { width: 122, minHeight: 130, borderRadius: 16, backgroundColor: palette.soft },
  memoryCardBody: { flex: 1, padding: 8, paddingLeft: 11 },
  memoryCardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  memoryDate: { fontSize: 9, color: palette.muted, marginTop: 4 },
  kindPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  kindPillText: { fontSize: 8, fontWeight: '700' },
  memoryTitle: {
    fontSize: 16,
    lineHeight: 21,
    color: palette.ink,
    fontWeight: '800',
    marginTop: 10,
  },
  memoryNote: { fontSize: 10, lineHeight: 15, color: palette.muted, marginTop: 6 },
  memoryFooter: { marginTop: 'auto' },
  memoryCoord: { fontSize: 8, color: palette.muted, marginTop: 8 },
  listEmpty: { alignItems: 'center', paddingHorizontal: 28, paddingBottom: 80 },
  listEmptySymbol: { fontSize: 35, color: palette.moss },
  listEmptyTitle: { fontSize: 18, color: palette.ink, fontWeight: '800', marginTop: 8 },
  listEmptyBody: { fontSize: 11, color: palette.muted, marginTop: 5, marginBottom: 12 },

  primaryButton: {
    marginTop: 14,
    minHeight: 45,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: palette.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: palette.white, fontSize: 11, fontWeight: '800' },

  timeArchivePanel: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 2,
    paddingTop: 12,
    paddingBottom: 10,
    borderRadius: 20,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  timeArchiveTop: {
    paddingHorizontal: 13,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeArchiveEyebrow: {
    fontSize: 7,
    letterSpacing: 1.6,
    color: palette.muted,
    fontWeight: '800',
  },
  timeArchiveSummary: {
    marginTop: 2,
    fontSize: 13,
    color: palette.ink,
    fontWeight: '800',
  },
  timeClearButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: palette.soft,
  },
  timeClearText: {
    fontSize: 8,
    color: palette.muted,
    fontWeight: '700',
  },
  yearFilterRow: {
    gap: 7,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  yearChip: {
    height: 34,
    minWidth: 60,
    paddingHorizontal: 12,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  yearChipOn: {
    backgroundColor: palette.action,
    borderColor: palette.ink,
  },
  yearChipText: {
    fontSize: 9,
    color: palette.muted,
    fontWeight: '700',
    includeFontPadding: false,
  },
  yearChipTextOn: {
    color: '#fff',
  },
  monthFilterRow: {
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  monthChip: {
    height: 30,
    minWidth: 48,
    paddingHorizontal: 10,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.paper,
    borderWidth: 1,
    borderColor: palette.line,
  },
  monthChipOn: {
    backgroundColor: palette.mossPale,
    borderColor: palette.line,
  },
  monthChipText: {
    fontSize: 8,
    color: palette.muted,
    fontWeight: '700',
    includeFontPadding: false,
  },
  monthChipTextOn: {
    color: palette.mossDark,
  },

  albumTitleButton: {
    minWidth: 150,
    maxWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridScaleBadge: {
    width: 48,
    height: 38,
    borderRadius: 12,
    backgroundColor: palette.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridScaleLabel: {
    fontSize: 10,
    color: palette.ink,
    fontWeight: '800',
    includeFontPadding: false,
  },
  gridScaleSub: {
    marginTop: 1,
    fontSize: 6,
    color: palette.muted,
    includeFontPadding: false,
  },
  photoLibraryToolbar: {
    minHeight: 53,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: palette.mossPale,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D5DFD5',
  },
  photoLibraryToolbarText: {
    flex: 1,
  },
  photoLibraryToolbarTitle: {
    fontSize: 9,
    color: palette.mossDark,
    fontWeight: '800',
  },
  photoLibraryToolbarSub: {
    marginTop: 3,
    fontSize: 7,
    color: palette.muted,
  },
  photoTimeIndex: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: palette.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  photoTimeIndexHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  photoTimeIndexEyebrow: {
    fontSize: 6,
    letterSpacing: 1.6,
    color: palette.muted,
    fontWeight: '900',
  },
  photoTimeIndexCurrent: {
    marginTop: 2,
    fontSize: 16,
    color: palette.ink,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  photoTimeIndexHint: {
    marginTop: 3,
    fontSize: 7,
    lineHeight: 11,
    color: palette.muted,
  },
  photoTimeIndexSearching: {
    minWidth: 58,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 13,
    backgroundColor: palette.softGreen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  photoTimeIndexSearchingText: {
    fontSize: 7,
    color: palette.mossDark,
    fontWeight: '800',
  },
  photoTimeYearTrack: {
    paddingTop: 8,
    paddingBottom: 3,
    paddingRight: 12,
    gap: 7,
  },
  photoTimeYearChip: {
    minWidth: 60,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoTimeYearChipActive: {
    backgroundColor: palette.action,
    borderColor: palette.action,
  },
  photoTimeYearText: {
    fontSize: 10,
    color: palette.ink,
    fontWeight: '800',
  },
  photoTimeYearTextActive: {
    color: '#FFFFFF',
  },
  photoTimeMonthHeader: {
    marginTop: 7,
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  photoTimeMonthTitle: {
    fontSize: 8,
    color: palette.ink,
    fontWeight: '900',
  },
  photoTimeMonthSub: {
    fontSize: 7,
    color: palette.muted,
  },
  photoTimeMonthTrack: {
    paddingTop: 4,
    paddingBottom: 2,
    paddingRight: 12,
    gap: 6,
  },
  photoTimeMonthChip: {
    minWidth: 44,
    height: 30,
    paddingHorizontal: 9,
    borderRadius: 15,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoTimeMonthChipActive: {
    backgroundColor: palette.mossPale,
    borderColor: palette.moss,
  },
  photoTimeMonthText: {
    fontSize: 8,
    color: palette.muted,
    fontWeight: '800',
  },
  photoTimeMonthTextActive: {
    color: palette.mossDark,
    fontWeight: '900',
  },

  allTimeButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  allTimeButtonText: {
    fontSize: 8,
    color: palette.mossDark,
    fontWeight: '800',
  },
  photoGridStage: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  photoGridAnimated: {
    flex: 1,
  },
  photoDateBadge: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(17,21,18,.58)',
  },
  photoDateBadgeText: {
    fontSize: 6,
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  photoEmpty: {
    paddingTop: 110,
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  photoEmptySymbol: {
    fontSize: 30,
    color: palette.muted,
  },
  photoEmptyTitle: {
    marginTop: 8,
    fontSize: 14,
    color: palette.ink,
    fontWeight: '800',
  },
  photoEmptyBody: {
    marginTop: 5,
    fontSize: 9,
    color: palette.muted,
    textAlign: 'center',
  },

  timelineRailWrap: {
    position: 'absolute',
    top: 15,
    bottom: 15,
    right: 0,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineRail: {
    position: 'absolute',
    top: 28,
    bottom: 28,
    width: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(40,48,42,.20)',
  },
  timelineTopDot: {
    position: 'absolute',
    top: 28,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.action,
  },
  timelineMidDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(32,39,34,.42)',
  },
  timelineBottomDot: {
    position: 'absolute',
    bottom: 28,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.action,
  },
  timelineYearTop: {
    position: 'absolute',
    top: 5,
    fontSize: 6,
    color: palette.muted,
    fontWeight: '800',
  },
  timelineYearBottom: {
    position: 'absolute',
    bottom: 5,
    fontSize: 6,
    color: palette.muted,
    fontWeight: '800',
  },
  timelineBubble: {
    position: 'absolute',
    right: 36,
    top: '42%',
    minWidth: 126,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(32,39,34,.92)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  timelineBubbleOverline: {
    fontSize: 6,
    letterSpacing: 1.3,
    color: 'rgba(255,255,255,.55)',
    fontWeight: '800',
  },
  timelineBubbleTitle: {
    marginTop: 2,
    fontSize: 13,
    color: '#fff',
    fontWeight: '800',
  },

  albumSheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(20,24,21,.28)',
  },
  albumSheet: {
    maxHeight: '74%',
    paddingHorizontal: 14,
    paddingTop: 9,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: palette.paper,
    borderWidth: 1,
    borderColor: palette.line,
  },
  albumSheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.line,
    marginBottom: 13,
  },
  albumSheetEyebrow: {
    fontSize: 7,
    letterSpacing: 1.6,
    color: palette.muted,
    fontWeight: '800',
  },
  albumSheetTitle: {
    marginTop: 3,
    fontSize: 25,
    color: palette.ink,
    fontWeight: '800',
  },
  albumSheetLead: {
    marginTop: 5,
    marginBottom: 12,
    fontSize: 9,
    color: palette.muted,
    lineHeight: 14,
  },
  albumRow: {
    minHeight: 62,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
    borderRadius: 18,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  albumRowOn: {
    backgroundColor: palette.mossPale,
    borderColor: '#BDCCBF',
  },
  albumRowIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: palette.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumRowIconText: {
    fontSize: 15,
    color: palette.ink,
    fontWeight: '800',
  },
  albumRowTitle: {
    fontSize: 12,
    color: palette.ink,
    fontWeight: '800',
  },
  albumRowSub: {
    marginTop: 3,
    fontSize: 8,
    color: palette.muted,
  },
  albumRowCheck: {
    fontSize: 14,
    color: palette.mossDark,
    fontWeight: '900',
    paddingRight: 4,
  },

  modalHeader: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  modalHeaderTitle: { fontSize: 15, color: palette.ink, fontWeight: '800' },
  modalHeaderSub: { fontSize: 8, color: palette.muted, marginTop: 2 },
  textButton: { minWidth: 48, paddingVertical: 10, alignItems: 'center' },
  textButtonLabel: { fontSize: 11, color: palette.muted, fontWeight: '700' },

  permissionPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 55,
  },
  permissionMark: {
    width: 72,
    height: 72,
    borderRadius: 25,
    borderBottomLeftRadius: 8,
    backgroundColor: palette.mossPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionMarkText: { fontSize: 31, color: palette.mossDark },
  permissionTitle: { fontSize: 21, fontWeight: '800', color: palette.ink, marginTop: 18 },
  permissionBody: {
    textAlign: 'center',
    maxWidth: 320,
    fontSize: 11,
    lineHeight: 18,
    color: palette.muted,
    marginTop: 8,
  },
  photoInfoBar: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: palette.mossPale,
  },
  photoInfoText: { fontSize: 9, color: palette.mossDark },
  manageText: { fontSize: 9, color: palette.mossDark, fontWeight: '800' },
  photoGrid: { paddingBottom: 20, paddingTop: 3 },
  photoCell: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: palette.soft,
    overflow: 'hidden',
  },
  photoReading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,28,23,0.56)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoReadingText: { color: '#fff', fontSize: 8, marginTop: 6, fontWeight: '700' },

  editorContent: { paddingBottom: 34 },
  heroPhotoWrap: { height: 285, margin: 12, borderRadius: 25, overflow: 'hidden' },
  heroPhoto: { width: '100%', height: '100%', backgroundColor: palette.soft },
  heroPhotoFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 125 },
  photoMetaOverlay: { position: 'absolute', left: 17, right: 17, bottom: 15 },
  photoMetaDate: { color: 'rgba(255,255,255,.85)', fontSize: 9, letterSpacing: 1.1 },
  photoMetaFilename: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 4 },

  editorSection: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 16,
    borderRadius: 23,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  sectionHeadingRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  sectionEyebrow: {
    fontSize: 8,
    letterSpacing: 1.6,
    color: palette.muted,
    fontWeight: '800',
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: palette.ink, marginTop: 3 },
  gpsBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999 },
  gpsBadgeText: { fontSize: 8, fontWeight: '800' },
  editorMapWrap: { height: 210, marginTop: 13, borderRadius: 18, overflow: 'hidden', backgroundColor: palette.soft },
  mapInstruction: {
    position: 'absolute',
    alignSelf: 'center',
    left: 18,
    right: 18,
    top: 70,
    padding: 12,
    borderRadius: 14,
    backgroundColor: palette.card,
    alignItems: 'center',
  },
  mapInstructionTitle: { fontSize: 12, fontWeight: '800', color: palette.ink },
  mapInstructionText: { fontSize: 9, color: palette.muted, marginTop: 4, textAlign: 'center' },
  locationCaption: { fontSize: 8, color: palette.muted, marginTop: 8, lineHeight: 13 },

  input: {
    minHeight: 46,
    marginTop: 9,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: palette.line,
    color: palette.ink,
    fontSize: 11,
  },
  noteInput: { minHeight: 96, textAlignVertical: 'top', lineHeight: 17 },
  fieldLabel: { fontSize: 9, color: palette.muted, fontWeight: '700', marginTop: 15, marginBottom: 7 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choiceChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  choiceChipText: { fontSize: 9, color: palette.muted },
  segmentRow: {
    padding: 3,
    borderRadius: 13,
    backgroundColor: palette.soft,
    flexDirection: 'row',
    gap: 2,
  },
  segmentButton: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segmentButtonOn: { backgroundColor: palette.card },
  segmentText: { fontSize: 9, color: palette.muted },
  segmentTextOn: { color: palette.ink, fontWeight: '800' },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  tagChipOn: { backgroundColor: palette.mossPale, borderColor: palette.line },
  tagText: { fontSize: 9, color: palette.muted },
  tagTextOn: { color: palette.mossDark, fontWeight: '700' },
  customTagRow: { flexDirection: 'row', gap: 7, marginTop: 9 },
  customTagButton: {
    minWidth: 56,
    borderRadius: 13,
    backgroundColor: palette.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customTagButtonText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  tagsPreview: { marginTop: 10, fontSize: 9, lineHeight: 15, color: palette.mossDark },

  saveBig: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 23,
    padding: 18,
    backgroundColor: palette.action,
  },
  saveBigOverline: { color: 'rgba(255,255,255,.55)', fontSize: 8, letterSpacing: 1.7 },
  saveBigText: { color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 4 },
  privacyNote: {
    fontSize: 8,
    color: palette.muted,
    lineHeight: 13,
    textAlign: 'center',
    paddingHorizontal: 26,
    marginTop: 13,
  },


  manageFilterChip: {
    minWidth: 78,
    borderStyle: 'dashed',
    borderColor: palette.line,
    backgroundColor: palette.card,
  },
  manageFilterText: {
    fontSize: 10,
    lineHeight: 14,
    color: palette.muted,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },

  pageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  smallOutlineButton: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.card,
  },
  smallOutlineButtonText: {
    fontSize: 9,
    color: palette.ink,
    fontWeight: '700',
  },

  followColorSwatch: {
    minWidth: 76,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.soft,
  },
  followColorSwatchOn: {
    borderColor: palette.ink,
    backgroundColor: palette.soft,
  },
  followColorText: {
    fontSize: 9,
    color: palette.ink,
    fontWeight: '700',
  },

  categoryManagerContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 28,
  },
  categoryEditorCard: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorSwatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchOn: {
    borderColor: palette.ink,
  },
  colorCheck: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 13,
  },
  symbolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  symbolSwatch: {
    width: 42,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.soft,
  },
  symbolSwatchText: {
    fontSize: 15,
    color: palette.muted,
  },
  categoryPreview: {
    marginTop: 16,
    padding: 12,
    borderRadius: 17,
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  categoryPreviewLabel: {
    fontSize: 8,
    color: palette.muted,
    letterSpacing: 1.1,
  },
  categoryPreviewName: {
    fontSize: 15,
    fontWeight: '800',
    color: palette.ink,
    marginTop: 2,
  },
  categoryFormActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 10,
    color: palette.muted,
    fontWeight: '700',
  },
  primaryFlexButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 13,
    backgroundColor: palette.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryListHeading: {
    marginTop: 20,
    marginBottom: 7,
    paddingHorizontal: 2,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: palette.muted,
  },
  categoryRow: {
    minHeight: 66,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 7,
    borderRadius: 18,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categoryDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryDotText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  categoryRowName: {
    fontSize: 13,
    color: palette.ink,
    fontWeight: '800',
  },
  categoryRowSub: {
    marginTop: 2,
    fontSize: 8,
    color: palette.muted,
  },
  miniAction: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: palette.soft,
  },
  miniActionText: {
    fontSize: 9,
    color: palette.ink,
    fontWeight: '700',
  },
  miniDelete: {
    paddingHorizontal: 7,
    paddingVertical: 8,
  },
  miniDeleteText: {
    fontSize: 9,
    color: palette.terracotta,
    fontWeight: '700',
  },

  fieldLabelRow: {
    marginTop: 15,
    marginBottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inlineManageText: {
    fontSize: 9,
    color: palette.mossDark,
    fontWeight: '800',
  },
  gpsEvidence: {
    marginTop: 12,
    padding: 11,
    borderRadius: 15,
    backgroundColor: palette.mossPale,
    borderWidth: 1,
    borderColor: palette.line,
  },
  gpsEvidenceTitle: {
    fontSize: 10,
    color: palette.mossDark,
    fontWeight: '800',
  },
  gpsEvidenceCoord: {
    marginTop: 4,
    fontSize: 13,
    color: palette.ink,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  gpsEvidenceHint: {
    marginTop: 5,
    fontSize: 8,
    lineHeight: 13,
    color: palette.muted,
  },

  detailPhotoWrap: {
    height: 430,
    backgroundColor: palette.soft,
    overflow: 'hidden',
    position: 'relative',
  },
  detailPhotoPage: {
    height: 430,
    position: 'relative',
    backgroundColor: palette.soft,
  },
  detailPhoto: {
    width: '100%',
    height: '100%',
  },
  detailPhotoText: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 19,
  },
  detailDate: {
    color: 'rgba(255,255,255,.78)',
    fontSize: 9,
    letterSpacing: 1.1,
  },
  detailTitle: {
    color: '#fff',
    fontSize: 27,
    fontWeight: '800',
    marginTop: 4,
    lineHeight: 33,
  },

  detailTopActions: {
    position: 'absolute',
    left: 15,
    right: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 30,
    elevation: 30,
  },
  detailEditButton: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,.86)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailEditText: {
    fontSize: 10,
    color: '#202722',
    fontWeight: '800',
  },
  detailCloseInline: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,.86)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 31,
  },
  detailCloseText: {
    fontSize: 23,
    lineHeight: 25,
    color: '#202722',
  },
  editMemoryBig: {
    marginTop: 20,
    padding: 16,
    borderRadius: 18,
    backgroundColor: palette.action,
  },
  editMemoryBigOverline: {
    color: 'rgba(255,255,255,.55)',
    fontSize: 8,
    letterSpacing: 1.5,
  },
  editMemoryBigText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 3,
  },


  liveBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(18,22,19,.62)',
  },
  liveBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  gridLiveBadge: {
    position: 'absolute',
    left: 5,
    top: 5,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(15,19,16,.64)',
  },
  gridLiveBadgeText: {
    color: '#fff',
    fontSize: 6,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  editorLiveBadge: {
    position: 'absolute',
    right: 13,
    top: 13,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(18,22,19,.72)',
  },
  editorLiveBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  editorArchiveBadge: {
    position: 'absolute',
    right: 13,
    top: 46,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,253,248,.88)',
  },
  editorArchiveBadgeText: {
    color: '#202722',
    fontSize: 8,
    fontWeight: '800',
  },

  archiveStatusCard: {
    marginTop: 18,
    borderRadius: 18,
    padding: 13,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  archiveStatusGood: {
    backgroundColor: palette.softGreen,
    borderColor: palette.line,
  },
  archiveStatusWaiting: {
    backgroundColor: palette.soft,
    borderColor: palette.line,
  },
  archiveStatusBad: {
    backgroundColor: palette.softDanger,
    borderColor: palette.line,
  },
  archiveStatusEyebrow: {
    fontSize: 7,
    letterSpacing: 1.4,
    color: palette.muted,
    fontWeight: '800',
  },
  archiveStatusTitle: {
    marginTop: 3,
    fontSize: 12,
    color: palette.ink,
    fontWeight: '800',
  },
  archiveStatusBody: {
    marginTop: 5,
    fontSize: 8,
    lineHeight: 13,
    color: palette.muted,
  },
  archiveRetryButton: {
    minWidth: 54,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: palette.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveRetryText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  liveHintText: {
    marginTop: 8,
    fontSize: 8,
    color: palette.mossDark,
    fontWeight: '700',
    letterSpacing: 0.4,
  },


  mapCorrectionRow: {
    marginTop: 10,
    padding: 12,
    borderRadius: 15,
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mapCorrectionTitle: {
    fontSize: 10,
    color: palette.ink,
    fontWeight: '800',
  },
  mapCorrectionBody: {
    marginTop: 3,
    fontSize: 8,
    lineHeight: 13,
    color: palette.muted,
  },
  mapCorrectionSwitch: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 3,
    backgroundColor: palette.line,
    justifyContent: 'center',
  },
  mapCorrectionSwitchOn: {
    backgroundColor: palette.moss,
  },
  mapCorrectionKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.card,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  mapCorrectionKnobOn: {
    alignSelf: 'flex-end',
  },
  archiveStatusPartial: {
    backgroundColor: palette.soft,
    borderColor: palette.line,
  },


  mapMarkerSelected: {
    transform: [{ scale: 1.12 }],
    borderWidth: 4,
  },
  mapPhotoMarkerShell: {
    width: 58,
    height: 58,
    borderRadius: 18,
    padding: 3,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    shadowColor: '#101510',
    shadowOpacity: 0.24,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  mapPhotoMarkerShellSelected: {
    transform: [{ scale: 1.12 }],
    borderWidth: 2,
    borderColor: palette.ink,
  },
  mapPhotoMarkerImage: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: palette.soft,
  },
  mapPhotoCategoryDot: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPhotoCategoryDotText: {
    fontSize: 8,
    fontWeight: '900',
    includeFontPadding: false,
  },

  liveControls: {
    position: 'absolute',
    right: 13,
    bottom: 14,
    flexDirection: 'row',
    gap: 7,
  },
  livePlayButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: 'rgba(255,253,248,.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePlayButtonText: {
    fontSize: 8,
    color: '#202722',
    fontWeight: '800',
  },
  liveSoundButton: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: 'rgba(32,39,34,.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveSoundButtonText: {
    fontSize: 8,
    color: '#FFFFFF',
    fontWeight: '800',
  },

  multiSelectShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18,24,20,.22)',
    alignItems: 'flex-end',
    padding: 6,
  },
  multiSelectNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: palette.action,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiSelectNumberText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    includeFontPadding: false,
  },
  multiSelectBar: {
    position: 'absolute',
    left: 12,
    right: 40,
    minHeight: 70,
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 22,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#172018',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  multiSelectBarOverline: {
    fontSize: 6,
    letterSpacing: 1.4,
    color: palette.muted,
    fontWeight: '800',
  },
  multiSelectBarTitle: {
    marginTop: 2,
    fontSize: 15,
    color: palette.ink,
    fontWeight: '800',
  },
  multiSelectContinue: {
    minWidth: 76,
    height: 44,
    borderRadius: 14,
    backgroundColor: palette.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiSelectContinueText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },

  pinchPreviewBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    minWidth: 76,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(32,39,34,.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinchPreviewBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },

  newerPhotosHeader: {
    marginHorizontal: 8,
    marginTop: 8,
    marginBottom: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 15,
    backgroundColor: palette.softGreen,
    borderWidth: 1,
    borderColor: '#D9E1D7',
  },
  newerPhotosHeaderTitle: {
    fontSize: 9,
    color: palette.mossDark,
    fontWeight: '800',
    textAlign: 'center',
  },
  newerPhotosHeaderSub: {
    marginTop: 3,
    fontSize: 7,
    lineHeight: 11,
    color: palette.muted,
    textAlign: 'center',
  },

  densitySearching: {
    position: 'absolute',
    alignSelf: 'center',
    left: 80,
    right: 80,
    top: '43%',
    minHeight: 64,
    borderRadius: 18,
    backgroundColor: 'rgba(32,39,34,.90)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  densitySearchingText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  timelineBubbleSub: {
    marginTop: 4,
    fontSize: 7,
    color: 'rgba(255,255,255,.68)',
  },

  mediaEditorSection: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 16,
    borderRadius: 23,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  mediaEditorHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  mediaEditorCounter: {
    fontSize: 9,
    color: palette.muted,
    fontWeight: '800',
  },
  xhsReorderWrap: {
    marginTop: 5,
  },
  xhsReorderInstructionRow: {
    minHeight: 24,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  xhsReorderInstruction: {
    flex: 1,
    fontSize: 8,
    color: palette.muted,
  },
  xhsReorderInstructionStrong: {
    fontSize: 7,
    color: palette.mossDark,
    fontWeight: '800',
  },
  xhsReorderTrack: {
    minHeight: 104,
    paddingHorizontal: 3,
    paddingTop: 7,
    paddingBottom: 19,
    gap: REORDER_THUMB_GAP,
    alignItems: 'flex-start',
  },
  // IMPORTANT: this style is consumed by Reanimated. Keep it color-free;
  // DynamicColorIOS values are objects and cannot be processColor'd by Reanimated.
  xhsReorderItem: {
    width: REORDER_THUMB_SIZE,
    height: REORDER_THUMB_SIZE,
    borderRadius: 17,
    overflow: 'visible',
  },
  xhsReorderPressable: {
    width: '100%',
    height: '100%',
    borderRadius: 17,
    padding: 3,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  xhsReorderPressableSelected: {
    borderWidth: 2,
    borderColor: palette.ink,
  },
  xhsReorderImage: {
    width: '100%',
    height: '100%',
    borderRadius: 13,
    backgroundColor: palette.soft,
  },
  xhsReorderIndex: {
    position: 'absolute',
    left: 5,
    top: 5,
    minWidth: 19,
    height: 19,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(20,25,21,.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  xhsReorderIndexText: {
    fontSize: 7,
    color: '#FFFFFF',
    fontWeight: '900',
  },
  xhsReorderGrip: {
    position: 'absolute',
    left: '50%',
    bottom: -17,
    width: 34,
    height: 15,
    marginLeft: -17,
    borderRadius: 8,
    backgroundColor: palette.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xhsReorderGripText: {
    marginTop: -2,
    fontSize: 13,
    lineHeight: 14,
    color: palette.muted,
    fontWeight: '900',
  },
  mediaThumbButton: {
    width: 76,
    height: 76,
    borderRadius: 16,
    padding: 3,
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  mediaThumbButtonOn: {
    borderWidth: 2,
    borderColor: palette.ink,
  },
  mediaThumbImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    backgroundColor: palette.soft,
  },
  mediaThumbIndex: {
    position: 'absolute',
    left: 6,
    top: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: 'rgba(20,25,21,.68)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaThumbIndexText: {
    fontSize: 7,
    color: '#fff',
    fontWeight: '900',
  },
  mediaThumbCover: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,253,248,.92)',
  },
  mediaThumbCoverText: {
    fontSize: 6,
    color: '#202722',
    fontWeight: '900',
  },
  mediaActionsRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
  },
  mediaActionButton: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    backgroundColor: palette.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaActionText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  mediaRemoveButton: {
    minWidth: 72,
    height: 38,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: palette.softDanger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaRemoveText: {
    fontSize: 8,
    color: palette.terracotta,
    fontWeight: '800',
  },
  mediaEditorHint: {
    marginTop: 9,
    fontSize: 8,
    lineHeight: 13,
    color: palette.muted,
  },
  coverBadge: {
    position: 'absolute',
    left: 13,
    top: 13,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,253,248,.90)',
  },
  coverBadgeText: {
    fontSize: 8,
    color: '#202722',
    fontWeight: '900',
  },

  addressCard: {
    marginTop: 12,
    padding: 13,
    borderRadius: 16,
    backgroundColor: palette.softGreen,
    borderWidth: 1,
    borderColor: palette.line,
  },
  addressEyebrow: {
    fontSize: 7,
    letterSpacing: 1.4,
    color: palette.muted,
    fontWeight: '800',
  },
  addressTitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: palette.ink,
    fontWeight: '800',
  },
  addressManualInput: {
    marginTop: 10,
    minHeight: 39,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.card,
    color: palette.ink,
    fontSize: 9,
  },
  addressAssistRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addressAssistText: {
    flex: 1,
    fontSize: 7,
    lineHeight: 11,
    color: palette.muted,
  },
  addressRetryInline: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: palette.soft,
  },
  addressRetryInlineText: {
    fontSize: 7,
    color: palette.mossDark,
    fontWeight: '800',
  },
  addressGps: {
    marginTop: 8,
    fontSize: 8,
    color: palette.muted,
  },
  addressAttribution: {
    marginTop: 6,
    fontSize: 6.5,
    color: palette.muted,
  },

  detailPlaceCard: {
    marginTop: 22,
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.card,
  },
  detailPlaceHeaderRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  detailPlaceEyebrow: {
    fontSize: 8,
    letterSpacing: 2.1,
    color: palette.muted,
    fontWeight: '900',
  },
  detailPlaceSourcePill: {
    minHeight: 24,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: palette.softGreen,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  detailPlaceSourceDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: palette.moss,
  },
  detailPlaceSourceText: {
    fontSize: 7,
    color: palette.mossDark,
    fontWeight: '800',
  },
  detailPlaceTitle: {
    marginTop: 11,
    fontSize: 20,
    lineHeight: 26,
    color: palette.ink,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  detailPlaceSecondary: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 16,
    color: palette.muted,
    fontWeight: '600',
  },
  detailPlaceDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.line,
    marginTop: 15,
    marginBottom: 12,
  },
  detailPlaceCoordinateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 14,
  },
  detailPlaceCoordinateLabel: {
    fontSize: 7,
    color: palette.muted,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  detailPlaceGps: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 10,
    lineHeight: 14,
    color: palette.ink,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  detailPlaceAttribution: {
    marginTop: 9,
    fontSize: 6.5,
    lineHeight: 10,
    color: palette.muted,
  },
  addressRetryButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: palette.soft,
  },
  addressRetryText: {
    fontSize: 7,
    color: palette.mossDark,
    fontWeight: '900',
  },

  detailMediaCount: {
    minWidth: 44,
    height: 32,
    paddingHorizontal: 9,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,.84)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailMediaCountText: {
    fontSize: 8,
    color: '#202722',
    fontWeight: '900',
  },
  detailCoverCaption: {
    marginTop: 5,
    color: 'rgba(255,255,255,.78)',
    fontSize: 8,
    fontWeight: '700',
  },
  detailMediaStripWrap: {
    backgroundColor: palette.paper,
    paddingTop: 10,
  },
  detailMediaStrip: {
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  detailMediaThumb: {
    width: 66,
    height: 66,
    borderRadius: 15,
    padding: 3,
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: palette.line,
  },
  detailMediaThumbOn: {
    borderWidth: 2,
    borderColor: palette.ink,
  },
  detailMediaThumbImage: {
    width: '100%',
    height: '100%',
    borderRadius: 11,
    backgroundColor: palette.soft,
  },
  detailMediaThumbIndex: {
    position: 'absolute',
    left: 6,
    top: 5,
    color: '#fff',
    fontSize: 7,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,.45)',
    textShadowRadius: 4,
  },
  detailBody: { padding: 16, paddingBottom: 34 },
  detailMetaRow: { flexDirection: 'row', gap: 7 },
  returnPill: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: palette.soft },
  returnPillText: { fontSize: 8, color: palette.muted, fontWeight: '700' },
  detailNote: { marginTop: 17, fontSize: 14, lineHeight: 23, color: palette.ink },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 15 },
  detailTag: { paddingHorizontal: 9, paddingVertical: 6, backgroundColor: palette.mossPale, borderRadius: 999 },
  detailTagText: { fontSize: 8, color: palette.mossDark },
  detailLocationHead: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26, marginBottom: 8 },
  detailLocationSource: { fontSize: 8, color: palette.muted },
  detailMapWrap: { height: 210, borderRadius: 20, overflow: 'hidden', backgroundColor: palette.soft },
  detailCoord: { fontSize: 8, color: palette.muted, marginTop: 7 },
  deleteButton: { paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  deleteButtonText: { color: palette.terracotta, fontSize: 10, fontWeight: '700' },
});

export default App;
