import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createQueuedStorage } from './queuedStorage';

// Never persist the error status: doing so would itself attempt another write.
export const useStorageStatus = create<{ failedKeys: string[] }>(() => ({ failedKeys: [] }));
export const progressStorage = createQueuedStorage(AsyncStorage, failedKeys => {
  const previous = useStorageStatus.getState().failedKeys;
  if (previous.join('|') !== failedKeys.join('|')) useStorageStatus.setState({ failedKeys });
});
