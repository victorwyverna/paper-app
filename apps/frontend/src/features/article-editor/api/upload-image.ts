import { apiClient } from '@/shared/api';
import { API_URL } from '@/shared/config';

type UploadedImage = {
  key: string;
};

export async function uploadImage(file: File): Promise<string> {
  const uploaded = await apiClient.postFile<UploadedImage>('/uploads', file);

  return `${API_URL}/uploads/${encodeURIComponent(uploaded.key)}`;
}
