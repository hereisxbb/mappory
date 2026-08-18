# Mappory

**A map for your memories.**

Mappory is a photo-first personal geospatial memory archive. Instead of treating photos as isolated media files, it organizes them into **Memory** units that can be revisited through **Space, Time, and Meaning**.

> Photo → Memory → Space / Time / Meaning

Current status: **v0.6.8 · interactive iOS MVP · Expo Go**

## Product idea

Photos are the input. **Memory is the basic unit.** The map and Time Index are ways to retrieve those memories.

Mappory keeps the original GPS from Apple Photos as the factual location layer. Reverse geocoding is treated as a display layer that may fail, so the original coordinates remain preserved and location names can stay in their original language.

## Current MVP

- Map-based memory browsing
- Multi-photo Memory creation
- Drag-to-reorder photos; the first photo becomes the display image
- Year / month **Time Index** for temporal retrieval
- Original photo GPS + readable place information
- Original-language address display with fallback geocoding
- Local media archiving
- Live Photo support
- Custom categories and filtering
- Light / dark appearance
- Black **MAPPORY** brand screen on launch (minimum 1.5 s)

## Product iterations worth noting

Two early interaction rules were deliberately removed after device testing:

1. A “photo percentage” timeline was replaced by a real year/month Time Index.
2. Separate “photo order” and “cover photo” controls were merged into one rule: **the first photo in the order is the display image**.

These changes reduce duplicate decisions and make the product model easier to understand.

## Tech stack

- React Native
- Expo 54 / Expo Go
- TypeScript
- React Native Maps
- Expo Media Library / Location / File System / Live Photo
- Reanimated + Gesture Handler
- Local storage via Expo SQLite KV Store

## Run locally

```bash
npm install
npx expo start --clear
```

Open the QR code with **Expo Go** on an iPhone.

## Repository structure

```text
App.tsx          Main product UI and interaction logic
src/types.ts     Memory / media / location data models
src/storage.ts   Local persistence
src/archive.ts   Local media archive helpers
src/theme.ts     Theme primitives
app.json         Expo configuration and permissions
```

## Note

This is an independent MVP in active iteration, not an App Store release. The Expo slug still uses the earlier internal project identifier `jice-atlas` to avoid unexpectedly changing the current Expo project identity.
