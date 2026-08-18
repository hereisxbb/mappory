import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';

import type { ArchiveStatus, MediaKind } from './types';

export type ArchiveResult = {
  archiveStatus: ArchiveStatus;
  mediaKind: MediaKind;
  archivedPhotoUri?: string;
  archivedPairedVideoUri?: string;
  archiveError?: string;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

function extensionFromUri(uri: string | null | undefined, fallback: string) {
  if (!uri) return fallback;
  const clean = uri.split('?')[0] || '';
  const match = clean.match(/\.([A-Za-z0-9]{2,5})$/);
  return match ? `.${match[1].toLowerCase()}` : fallback;
}

function archiveDirectory(memoryId: string) {
  if (!FileSystem.documentDirectory) {
    throw new Error('App document directory is unavailable.');
  }
  return `${FileSystem.documentDirectory}jice-archive/${memoryId}/`;
}

async function tryCopy(source: string | undefined, destination: string) {
  if (!source) return false;
  try {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(
      () => {}
    );
    await FileSystem.copyAsync({ from: source, to: destination });
    return true;
  } catch (error) {
    console.warn('[Mappory][ARCHIVE] copy failed', {
      source,
      destination,
      error: errorMessage(error),
    });
    return false;
  }
}

export async function archiveApplePhotosAsset(
  assetId: string,
  memoryId: string,
  pairedVideoUriHint?: string
): Promise<ArchiveResult> {
  let detectedKind: MediaKind = 'photo';
  let archivedPhotoUri: string | undefined;

  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId, {
      shouldDownloadFromNetwork: true,
    });

    if (!info) {
      throw new Error('Apple Photos returned no AssetInfo.');
    }

    if (!info.localUri) {
      throw new Error('Apple Photos did not provide a local photo URI.');
    }

    const pairedAsset = info.pairedVideoAsset ?? null;
    const isLivePhoto =
      Array.isArray(info.mediaSubtypes) &&
      info.mediaSubtypes.includes('livePhoto') &&
      !!pairedAsset;

    detectedKind = isLivePhoto ? 'livePhoto' : 'photo';

    const dir = archiveDirectory(memoryId);
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    const photoExt = extensionFromUri(
      info.localUri,
      extensionFromUri(info.filename, '.jpg')
    );
    const photoDestination = `${dir}photo${photoExt}`;

    await FileSystem.deleteAsync(photoDestination, {
      idempotent: true,
    }).catch(() => {});
    await FileSystem.copyAsync({
      from: info.localUri,
      to: photoDestination,
    });
    archivedPhotoUri = photoDestination;

    if (!isLivePhoto || !pairedAsset) {
      return {
        archiveStatus: 'archived',
        mediaKind: 'photo',
        archivedPhotoUri: photoDestination,
      };
    }

    // Expo's runtime can return null when querying the paired video again,
    // even though pairedVideoAsset itself exists. Never dereference blindly.
    let pairedInfo: any = null;
    try {
      pairedInfo = await MediaLibrary.getAssetInfoAsync(pairedAsset.id, {
        shouldDownloadFromNetwork: true,
      });
    } catch (error) {
      console.warn('[Mappory][ARCHIVE] paired AssetInfo lookup failed', {
        pairedAssetId: pairedAsset.id,
        error: errorMessage(error),
      });
    }

    const candidates = [
      pairedInfo?.localUri,
      pairedVideoUriHint,
      pairedAsset.uri,
    ].filter((value): value is string => typeof value === 'string' && !!value);

    const videoExt = extensionFromUri(
      pairedInfo?.localUri || pairedVideoUriHint || pairedAsset.uri,
      extensionFromUri(pairedInfo?.filename || pairedAsset.filename, '.mov')
    );
    const videoDestination = `${dir}live${videoExt}`;

    let videoCopied = false;
    for (const source of candidates) {
      if (await tryCopy(source, videoDestination)) {
        videoCopied = true;
        break;
      }
    }

    if (!videoCopied) {
      return {
        archiveStatus: 'partial',
        mediaKind: 'livePhoto',
        archivedPhotoUri: photoDestination,
        archiveError:
          '静态照片已经归档，但当前 Expo/Photos 路径没有提供可复制的 Live Photo 配对视频文件。',
      };
    }

    return {
      archiveStatus: 'archived',
      mediaKind: 'livePhoto',
      archivedPhotoUri: photoDestination,
      archivedPairedVideoUri: videoDestination,
    };
  } catch (error) {
    return {
      archiveStatus: archivedPhotoUri ? 'partial' : 'failed',
      mediaKind: detectedKind,
      archivedPhotoUri,
      archiveError: errorMessage(error),
    };
  }
}

export async function removeMemoryArchive(memoryId: string): Promise<void> {
  try {
    const dir = archiveDirectory(memoryId);
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
    }
  } catch {
    // Cleanup failure should never block deleting a memory record.
  }
}
