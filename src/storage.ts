import Storage from 'expo-sqlite/kv-store';
import type {
  AtlasMemory,
  MemoryCategory,
  MemoryMedia,
} from './types';
import { defaultCategories } from './theme';

const MEMORY_KEY_V1 = 'jice.atlas.memories.v1';
const MEMORY_KEY_V2 = 'jice.atlas.memories.v2';
const MEMORY_KEY_V3 = 'jice.atlas.memories.v3';
const MEMORY_KEY_V5 = 'jice.atlas.memories.v5';
const CATEGORY_KEY = 'jice.atlas.categories.v1';
const APPEARANCE_KEY = 'jice.atlas.appearance.v1';

const legacyCategoryMap: Record<string, string> = {
  '旅行地点': 'travel',
  '好吃的': 'food',
  '咖啡': 'cafe',
  '风景': 'scenery',
  '日常': 'daily',
};

const oldDefaultColorToSoft: Record<string, string> = {
  '#607565': '#B7CBB9',
  '#C86E57': '#E7AE9A',
  '#A78A56': '#DCC78F',
  '#6A7F91': '#AFC8DC',
  '#7E7485': '#C7BAD5',
  '#8A8D88': '#D8C9B8',
};

function softenLegacyCategory(category: MemoryCategory): MemoryCategory {
  const replacement = oldDefaultColorToSoft[category.color.toUpperCase()];
  return replacement ? { ...category, color: replacement } : category;
}

export async function loadCategories(): Promise<MemoryCategory[]> {
  try {
    const raw = await Storage.getItem(CATEGORY_KEY);
    if (!raw) return defaultCategories.map((x) => ({ ...x }));
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return defaultCategories.map((x) => ({ ...x }));

    const valid = (
      data.filter(
        (x) =>
          x &&
          typeof x.id === 'string' &&
          typeof x.name === 'string' &&
          typeof x.color === 'string' &&
          typeof x.symbol === 'string'
      ) as MemoryCategory[]
    ).map(softenLegacyCategory);

    if (!valid.some((x) => x.id === 'uncategorized')) {
      valid.push(defaultCategories.find((x) => x.id === 'uncategorized')!);
    }
    return valid;
  } catch {
    return defaultCategories.map((x) => ({ ...x }));
  }
}

export async function saveCategories(categories: MemoryCategory[]): Promise<void> {
  await Storage.setItem(CATEGORY_KEY, JSON.stringify(categories));
}

function legacyMediaFromMemory(x: any): MemoryMedia {
  return {
    id: `media_${x.id || Date.now()}_0`,
    assetId: String(x.assetId || ''),
    assetUri: String(x.assetUri || x.assetId || ''),
    filename: String(x.filename || 'photo'),
    shotAt: typeof x.shotAt === 'number' ? x.shotAt : Date.now(),
    mediaKind:
      x.mediaKind === 'livePhoto' || x.archivedPairedVideoUri
        ? 'livePhoto'
        : 'photo',
    originalPhotoLocalUri:
      typeof x.originalPhotoLocalUri === 'string'
        ? x.originalPhotoLocalUri
        : undefined,
    originalPairedVideoUri:
      typeof x.originalPairedVideoUri === 'string'
        ? x.originalPairedVideoUri
        : undefined,
    archiveStatus:
      x.archiveStatus === 'archived'
        ? 'archived'
        : x.archiveStatus === 'partial'
        ? 'partial'
        : x.archiveStatus === 'failed'
        ? 'failed'
        : 'reference-only',
    archivedPhotoUri:
      typeof x.archivedPhotoUri === 'string'
        ? x.archivedPhotoUri
        : undefined,
    archivedPairedVideoUri:
      typeof x.archivedPairedVideoUri === 'string'
        ? x.archivedPairedVideoUri
        : undefined,
    archiveError:
      typeof x.archiveError === 'string' ? x.archiveError : undefined,
  };
}

function normalizeMediaItem(x: any, fallbackId: string): MemoryMedia | null {
  if (!x || typeof x.assetId !== 'string') return null;

  return {
    id:
      typeof x.id === 'string'
        ? x.id
        : `media_${fallbackId}_${Math.random().toString(36).slice(2, 8)}`,
    assetId: x.assetId,
    assetUri:
      typeof x.assetUri === 'string' ? x.assetUri : x.assetId,
    filename:
      typeof x.filename === 'string' ? x.filename : 'photo',
    shotAt:
      typeof x.shotAt === 'number' ? x.shotAt : Date.now(),
    mediaKind:
      x.mediaKind === 'livePhoto' || x.archivedPairedVideoUri
        ? 'livePhoto'
        : 'photo',
    originalPhotoLocalUri:
      typeof x.originalPhotoLocalUri === 'string'
        ? x.originalPhotoLocalUri
        : undefined,
    originalPairedVideoUri:
      typeof x.originalPairedVideoUri === 'string'
        ? x.originalPairedVideoUri
        : undefined,
    archiveStatus:
      x.archiveStatus === 'archived'
        ? 'archived'
        : x.archiveStatus === 'partial'
        ? 'partial'
        : x.archiveStatus === 'failed'
        ? 'failed'
        : 'reference-only',
    archivedPhotoUri:
      typeof x.archivedPhotoUri === 'string'
        ? x.archivedPhotoUri
        : undefined,
    archivedPairedVideoUri:
      typeof x.archivedPairedVideoUri === 'string'
        ? x.archivedPairedVideoUri
        : undefined,
    archiveError:
      typeof x.archiveError === 'string' ? x.archiveError : undefined,
  };
}

function mirrorCover(memory: AtlasMemory): AtlasMemory {
  const cover =
    memory.mediaItems.find((item) => item.id === memory.coverMediaId) ||
    memory.mediaItems[0];

  if (!cover) return memory;

  return {
    ...memory,
    coverMediaId: cover.id,
    assetId: cover.assetId,
    assetUri: cover.assetUri,
    originalPhotoLocalUri: cover.originalPhotoLocalUri,
    originalPairedVideoUri: cover.originalPairedVideoUri,
    mediaKind: cover.mediaKind,
    archiveStatus: cover.archiveStatus,
    archivedPhotoUri: cover.archivedPhotoUri,
    archivedPairedVideoUri: cover.archivedPairedVideoUri,
    archiveError: cover.archiveError,
    shotAt:
      typeof memory.shotAt === 'number'
        ? memory.shotAt
        : cover.shotAt,
  };
}

function normalizeV5(x: any): AtlasMemory | null {
  if (
    !x ||
    typeof x.id !== 'string' ||
    typeof x.latitude !== 'number' ||
    typeof x.longitude !== 'number'
  ) {
    return null;
  }

  let mediaItems: MemoryMedia[] = [];

  if (Array.isArray(x.mediaItems)) {
    mediaItems = x.mediaItems
      .map((item: any, index: number) =>
        normalizeMediaItem(item, `${x.id}_${index}`)
      )
      .filter((item: MemoryMedia | null): item is MemoryMedia => !!item);
  }

  if (!mediaItems.length && typeof x.assetId === 'string') {
    mediaItems = [legacyMediaFromMemory(x)];
  }

  if (!mediaItems.length) return null;

  const coverMediaId =
    typeof x.coverMediaId === 'string' &&
    mediaItems.some((item) => item.id === x.coverMediaId)
      ? x.coverMediaId
      : mediaItems[0].id;

  const memory: AtlasMemory = {
    ...x,
    mediaItems,
    coverMediaId,
    assetId: typeof x.assetId === 'string' ? x.assetId : mediaItems[0].assetId,
    assetUri:
      typeof x.assetUri === 'string' ? x.assetUri : mediaItems[0].assetUri,
    mediaKind:
      x.mediaKind === 'livePhoto' ? 'livePhoto' : mediaItems[0].mediaKind,
    archiveStatus:
      x.archiveStatus === 'archived'
        ? 'archived'
        : x.archiveStatus === 'partial'
        ? 'partial'
        : x.archiveStatus === 'failed'
        ? 'failed'
        : 'reference-only',
    title: typeof x.title === 'string' ? x.title : '未命名记忆',
    note: typeof x.note === 'string' ? x.note : '',
    categoryId:
      typeof x.categoryId === 'string' ? x.categoryId : 'uncategorized',
    returnIntent: x.returnIntent || '不适用',
    tags: Array.isArray(x.tags) ? x.tags : [],
    locationSource: x.locationSource === 'photo' ? 'photo' : 'manual',
    mapDisplayMode:
      x.mapDisplayMode === 'china-corrected' || x.mapDisplayMode === 'raw'
        ? x.mapDisplayMode
        : undefined,
    address:
      x.address && typeof x.address.label === 'string'
        ? x.address
        : undefined,
    shotAt:
      typeof x.shotAt === 'number'
        ? x.shotAt
        : mediaItems[0].shotAt,
    createdAt:
      typeof x.createdAt === 'number' ? x.createdAt : Date.now(),
    updatedAt:
      typeof x.updatedAt === 'number'
        ? x.updatedAt
        : typeof x.createdAt === 'number'
        ? x.createdAt
        : Date.now(),
  } as AtlasMemory;

  return mirrorCover(memory);
}

async function migrateOldestV1(): Promise<AtlasMemory[]> {
  const oldRaw = await Storage.getItem(MEMORY_KEY_V1);
  if (!oldRaw) return [];

  const oldData = JSON.parse(oldRaw);
  if (!Array.isArray(oldData)) return [];

  return oldData
    .filter(
      (x) =>
        x &&
        typeof x.id === 'string' &&
        typeof x.assetId === 'string' &&
        typeof x.latitude === 'number' &&
        typeof x.longitude === 'number'
    )
    .map((x) =>
      normalizeV5({
        id: x.id,
        assetId: x.assetId,
        assetUri: x.assetUri || x.assetId,
        mediaKind: 'photo',
        archiveStatus: 'reference-only',
        title: x.title || '未命名记忆',
        note: x.note || '',
        categoryId: legacyCategoryMap[x.kind] || 'uncategorized',
        returnIntent: x.returnIntent || '不适用',
        tags: Array.isArray(x.tags) ? x.tags : [],
        latitude: x.latitude,
        longitude: x.longitude,
        locationSource: x.locationSource === 'photo' ? 'photo' : 'manual',
        shotAt: x.shotAt || Date.now(),
        createdAt: x.createdAt || Date.now(),
        updatedAt: x.createdAt || Date.now(),
      })
    )
    .filter((x): x is AtlasMemory => !!x);
}

export async function loadMemories(): Promise<AtlasMemory[]> {
  try {
    const v5raw = await Storage.getItem(MEMORY_KEY_V5);
    if (v5raw) {
      const data = JSON.parse(v5raw);
      if (Array.isArray(data)) {
        return data
          .map(normalizeV5)
          .filter((x): x is AtlasMemory => !!x)
          .sort((a, b) => b.shotAt - a.shotAt);
      }
    }

    for (const key of [MEMORY_KEY_V3, MEMORY_KEY_V2]) {
      const raw = await Storage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) continue;

      const migrated = data
        .map(normalizeV5)
        .filter((x): x is AtlasMemory => !!x)
        .sort((a, b) => b.shotAt - a.shotAt);

      await Storage.setItem(MEMORY_KEY_V5, JSON.stringify(migrated));
      return migrated;
    }

    const oldest = await migrateOldestV1();
    await Storage.setItem(MEMORY_KEY_V5, JSON.stringify(oldest));
    return oldest.sort((a, b) => b.shotAt - a.shotAt);
  } catch {
    return [];
  }
}

export async function saveMemories(memories: AtlasMemory[]): Promise<void> {
  const normalized = memories.map(mirrorCover);
  await Storage.setItem(MEMORY_KEY_V5, JSON.stringify(normalized));
}


export type AtlasAppearance = 'light' | 'dark';

export async function loadAppearance(): Promise<AtlasAppearance> {
  try {
    const raw = await Storage.getItem(APPEARANCE_KEY);
    return raw === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export async function saveAppearance(
  appearance: AtlasAppearance
): Promise<void> {
  await Storage.setItem(APPEARANCE_KEY, appearance);
}
