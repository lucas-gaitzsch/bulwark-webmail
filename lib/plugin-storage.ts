// IndexedDB storage for plugin/theme binary blobs (JS bundles, CSS, previews)

const DB_NAME = 'bulwark-plugins';
// Bumped to 2 to add the theme-skin store; existing stores are preserved.
const DB_VERSION = 2;
const STORE_PLUGINS = 'plugin-code';
const STORE_THEMES = 'theme-css';
const STORE_THEME_SKINS = 'theme-skin';
const STORE_PREVIEWS = 'previews';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PLUGINS)) {
        db.createObjectStore(STORE_PLUGINS);
      }
      if (!db.objectStoreNames.contains(STORE_THEMES)) {
        db.createObjectStore(STORE_THEMES);
      }
      if (!db.objectStoreNames.contains(STORE_THEME_SKINS)) {
        db.createObjectStore(STORE_THEME_SKINS);
      }
      if (!db.objectStoreNames.contains(STORE_PREVIEWS)) {
        db.createObjectStore(STORE_PREVIEWS);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putItem(storeName: string, key: string, value: string | Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getItem<T = string>(storeName: string, key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function deleteItem(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Public API ──────────────────────────────────────────────

export const pluginStorage = {
  // Plugin JS bundles
  async saveCode(pluginId: string, code: string): Promise<void> {
    await putItem(STORE_PLUGINS, pluginId, code);
  },
  async getCode(pluginId: string): Promise<string | null> {
    return getItem<string>(STORE_PLUGINS, pluginId);
  },
  async deleteCode(pluginId: string): Promise<void> {
    await deleteItem(STORE_PLUGINS, pluginId);
  },

  // Theme CSS blobs
  async saveThemeCSS(themeId: string, css: string): Promise<void> {
    await putItem(STORE_THEMES, themeId, css);
  },
  async getThemeCSS(themeId: string): Promise<string | null> {
    return getItem<string>(STORE_THEMES, themeId);
  },
  async deleteThemeCSS(themeId: string): Promise<void> {
    await deleteItem(STORE_THEMES, themeId);
  },

  // Theme skin CSS - separate store so it can be present/absent independently
  // of the colour-token CSS (e.g. some v2 themes ship colours only).
  async saveThemeSkin(themeId: string, skin: string): Promise<void> {
    await putItem(STORE_THEME_SKINS, themeId, skin);
  },
  async getThemeSkin(themeId: string): Promise<string | null> {
    return getItem<string>(STORE_THEME_SKINS, themeId);
  },
  async deleteThemeSkin(themeId: string): Promise<void> {
    await deleteItem(STORE_THEME_SKINS, themeId);
  },

  // Preview images (stored as data URIs)
  async savePreview(id: string, dataUri: string): Promise<void> {
    await putItem(STORE_PREVIEWS, id, dataUri);
  },
  async getPreview(id: string): Promise<string | null> {
    return getItem<string>(STORE_PREVIEWS, id);
  },
  async deletePreview(id: string): Promise<void> {
    await deleteItem(STORE_PREVIEWS, id);
  },
};
