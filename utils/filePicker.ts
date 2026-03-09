import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Alert, Platform } from 'react-native';

export async function requestMediaPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Please allow access to your photo library in Settings.');
    return false;
  }
  return true;
}

export async function pickImage(): Promise<string | null> {
  const ok = await requestMediaPermission();
  if (!ok) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.8,
  });
  if (!result.canceled && result.assets[0]) {
    return result.assets[0].uri;
  }
  return null;
}

export async function pickVideo(): Promise<string | null> {
  const ok = await requestMediaPermission();
  if (!ok) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    quality: 0.8,
  });
  if (!result.canceled && result.assets[0]) {
    return result.assets[0].uri;
  }
  return null;
}

export async function pickAudioFile(): Promise<{ uri: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['audio/*'],
    copyToCacheDirectory: true,
  });
  if (!result.canceled && result.assets[0]) {
    return { uri: result.assets[0].uri, name: result.assets[0].name };
  }
  return null;
}

export async function pickFile(): Promise<{ uri: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
  });
  if (!result.canceled && result.assets[0]) {
    return { uri: result.assets[0].uri, name: result.assets[0].name };
  }
  return null;
}

export function fileBaseName(uri: string | undefined): string {
  if (!uri) return '';
  const parts = uri.split('/');
  return parts[parts.length - 1] || uri;
}
