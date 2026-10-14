import { authFetch } from './authService';
import { apiUrl } from './appUrl';
export interface PlayerPreferences {
  skipIntroOutro: boolean; autoNext: boolean; introSeconds: number; outroSeconds: number;
}
const request = async (value?: PlayerPreferences): Promise<PlayerPreferences> => {
  const response = await authFetch(apiUrl('/api/player/preferences'), value ? {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
  } : { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(body.message || '播放偏好保存失败');
  return body.data;
};
export const PlayerPreferencesService = { get: () => request(), save: (value: PlayerPreferences) => request(value) };
