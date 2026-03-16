import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  Alert,
  Share,
  FlatList,
  StyleSheet,
} from 'react-native';
import { ShowFile } from '../../utils/types';
import { generateId } from '../../utils/storage';
import { pickImage, pickFile } from '../../utils/filePicker';

interface FilesSectionProps {
  files: ShowFile[];
  onChange: (files: ShowFile[]) => void;
}

function mimeIcon(fileType: string): string {
  if (fileType.startsWith('image/')) return '🖼️';
  if (fileType.startsWith('video/')) return '🎬';
  if (fileType.startsWith('audio/')) return '🎵';
  if (fileType.includes('pdf')) return '📄';
  if (fileType.includes('word') || fileType.includes('document')) return '📝';
  if (fileType.includes('sheet') || fileType.includes('excel') || fileType.includes('csv')) return '📊';
  return '📎';
}

export default function FilesSection({ files, onChange }: FilesSectionProps) {
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  async function handlePickImage() {
    const uri = await pickImage();
    if (!uri) return;
    const parts = uri.split('/');
    const name = parts[parts.length - 1] || 'photo.jpg';
    const newFile: ShowFile = {
      id: generateId(),
      name,
      fileData: uri,
      fileType: 'image/jpeg',
      uploadedAt: new Date().toISOString(),
    };
    onChange([...files, newFile]);
  }

  async function handlePickFile() {
    const result = await pickFile();
    if (!result) return;
    const newFile: ShowFile = {
      id: generateId(),
      name: result.name,
      fileData: result.uri,
      fileType: 'application/octet-stream',
      uploadedAt: new Date().toISOString(),
    };
    onChange([...files, newFile]);
  }

  function handleDelete(id: string) {
    const file = files.find((f) => f.id === id);
    Alert.alert(
      'Delete File',
      `Delete "${file?.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onChange(files.filter((f) => f.id !== id)),
        },
      ]
    );
  }

  async function handleShare(file: ShowFile) {
    try {
      await Share.share({ url: file.fileData, title: file.name, message: file.name });
    } catch {
      Alert.alert('Share Failed', 'Could not open this file on your device.');
    }
  }

  return (
    <View style={styles.container}>
      {/* Upload buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.uploadBtn} onPress={handlePickImage}>
          <Text style={styles.uploadBtnText}>📷 Add Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.uploadBtn} onPress={handlePickFile}>
          <Text style={styles.uploadBtnText}>📎 Add File</Text>
        </TouchableOpacity>
      </View>

      {files.length === 0 ? (
        <Text style={styles.empty}>No files uploaded yet.</Text>
      ) : (
        <FlatList
          data={files}
          keyExtractor={(item: ShowFile) => item.id}
          scrollEnabled={false}
          renderItem={({ item }: { item: ShowFile }) => (
            <View style={styles.fileRow}>
              {item.fileType.startsWith('image/') ? (
                <TouchableOpacity onPress={() => setViewingImage(item.fileData)}>
                  <Image source={{ uri: item.fileData }} style={styles.thumb} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.iconBox} onPress={() => handleShare(item)}>
                  <Text style={styles.iconText}>{mimeIcon(item.fileType)}</Text>
                </TouchableOpacity>
              )}

              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={2}>{item.name}</Text>
                {item.notes ? (
                  <Text style={styles.fileNotes}>{item.notes}</Text>
                ) : null}
              </View>

              <View style={styles.fileActions}>
                {!item.fileType.startsWith('image/') && (
                  <TouchableOpacity style={styles.shareBtn} onPress={() => handleShare(item)}>
                    <Text style={styles.shareBtnText}>↗</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)}>
                  <Text style={styles.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Full-screen image viewer */}
      <Modal
        visible={!!viewingImage}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingImage(null)}
      >
        <TouchableOpacity
          style={styles.imageViewerOverlay}
          activeOpacity={1}
          onPress={() => setViewingImage(null)}
        >
          {viewingImage ? (
            <Image
              source={{ uri: viewingImage }}
              style={styles.imageViewerFull}
              resizeMode="contain"
            />
          ) : null}
          <Text style={styles.imageViewerHint}>Tap anywhere to close</Text>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  uploadBtn: {
    flex: 1,
    backgroundColor: '#6B46C1',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  uploadBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  empty: {
    color: '#9CA3AF',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 24,
    fontSize: 14,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 26,
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F2937',
    flexShrink: 1,
  },
  fileNotes: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  fileActions: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    flexShrink: 0,
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareBtnText: {
    fontSize: 16,
    color: '#6B46C1',
    fontWeight: '700',
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 14,
    color: '#DC2626',
    fontWeight: '700',
  },
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageViewerFull: {
    width: '95%',
    height: '85%',
  },
  imageViewerHint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginTop: 16,
  },
});
