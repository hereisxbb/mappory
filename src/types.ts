export type ReturnIntent = '一定会' | '也许会' | '不会' | '不适用';
export type LocationSource = 'photo' | 'manual';
export type MediaKind = 'photo' | 'livePhoto';
export type ArchiveStatus =
  | 'archived'
  | 'partial'
  | 'reference-only'
  | 'failed';
export type MapDisplayMode = 'raw' | 'china-corrected';

export type MemoryCategory = {
  id: string;
  name: string;
  color: string;
  symbol: string;
  protected?: boolean;
  createdAt: number;
};

export type MemoryAddress = {
  label: string;
  geocodeSource?: 'apple' | 'photon' | 'osm';
  attribution?: string;
  country?: string;
  isoCountryCode?: string;
  region?: string;
  subregion?: string;
  city?: string;
  district?: string;
  street?: string;
  name?: string;
};

export type MemoryMedia = {
  id: string;
  assetId: string;
  assetUri: string;
  filename: string;
  shotAt: number;

  mediaKind: MediaKind;
  originalPhotoLocalUri?: string;
  originalPairedVideoUri?: string;

  archiveStatus: ArchiveStatus;
  archivedPhotoUri?: string;
  archivedPairedVideoUri?: string;
  archiveError?: string;
};

export type AtlasMemory = {
  id: string;

  // v0.5 canonical media model.
  mediaItems: MemoryMedia[];
  coverMediaId: string;

  // Legacy cover mirror retained for compatibility with older UI/data.
  assetId: string;
  assetUri: string;
  originalPhotoLocalUri?: string;
  originalPairedVideoUri?: string;
  mediaKind: MediaKind;
  archiveStatus: ArchiveStatus;
  archivedPhotoUri?: string;
  archivedPairedVideoUri?: string;
  archiveError?: string;

  title: string;
  note: string;
  categoryId: string;
  pinColor?: string;
  returnIntent: ReturnIntent;
  tags: string[];

  latitude: number;
  longitude: number;
  locationSource: LocationSource;
  address?: MemoryAddress;

  mapDisplayMode?: MapDisplayMode;

  shotAt: number;
  createdAt: number;
  updatedAt: number;
};

export type DraftPhoto = {
  assetId: string;
  assetUri: string;
  filename: string;
  shotAt: number;

  photoLocalUri?: string;
  pairedVideoAssetId?: string;
  pairedVideoAssetUri?: string;

  latitude: number | null;
  longitude: number | null;
  locationSource: LocationSource | null;
  gpsDetected: boolean;

  mediaKind: MediaKind;
};
