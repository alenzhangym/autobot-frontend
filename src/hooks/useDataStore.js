import { useCallback, useEffect } from 'react';

const DB_NAME = 'autobot_data_store';
const DB_VERSION = 1;
const STORE_NAME = 'datasets';

/**
 * Hook for managing persistent data storage via IndexedDB.
 * Provides CRUD operations and iframe message bridge.
 */
export function useDataStore() {
  const openDB = useCallback(() => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, []);

  const saveData = useCallback(async (id, data) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ id, data, timestamp: Date.now() });
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.error('[DataStore] Save failed:', e);
      return false;
    }
  }, [openDB]);

  const getData = useCallback(async (id) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const result = await new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return result?.data || null;
    } catch (e) {
      console.error('[DataStore] Get failed:', e);
      return null;
    }
  }, [openDB]);

  const deleteData = useCallback(async (id) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      return false;
    }
  }, [openDB]);

  // Set up iframe message bridge for data store access
  useEffect(() => {
    const handler = (event) => {
      if (event.data && event.data.type === 'GET_DATA_STORE') {
        const { id } = event.data;
        getData(id).then(data => {
          event.source?.postMessage({ type: 'DATA_STORE_RESPONSE', id, data }, event.origin);
        });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [getData]);

  return { saveData, getData, deleteData };
}
