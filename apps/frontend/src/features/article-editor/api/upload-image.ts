import { apiClient } from '@/shared/api';

type UploadedImage = {
  key: string;
  url: string;
};

export async function uploadImage(file: File): Promise<string> {
  const uploaded = await apiClient.postFile<UploadedImage>('/uploads', file);

  return uploaded.url;
}
