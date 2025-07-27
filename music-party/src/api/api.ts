/**
 * 检查 fetch 响应，如果不成功则抛出错误。
 * @param response - Fetch API 的响应对象
 * @returns 如果响应成功，则无返回；否则抛出错误。
 */
async function handleResponseError(response: Response) {
  if (!response.ok) {
    try {
      // 尝试将错误响应体解析为JSON，以获取后端提供的结构化错误信息
      const errorData = await response.json();
      throw new Error(errorData.message || `请求失败，状态码: ${response.status}`);
    } catch (e) {
      // 如果响应体不是JSON（例如HTML错误页），则抛出一个通用的错误
      throw new Error(`服务器返回了无效的响应 (状态码: ${response.status})`);
    }
  }
}

export async function getProfile(): Promise<User> {
  const resp = await fetch("/api/profile");
  await handleResponseError(resp);
  return await resp.json();
}

export async function getMusicApis(): Promise<string[]> {
  const resp = await fetch("/api/musicservices");
  await handleResponseError(resp);
  return await resp.json();
}

export async function searchUsers(
  keyword: string,
  apiName: string
): Promise<MusicServiceUser[]> {
  const resp = await fetch(`/api/${apiName}/searchuser/${keyword}`);
  await handleResponseError(resp);
  return await resp.json();
}

export async function bindAccount(identifier: string, apiName: string) {
  const resp = await fetch(`/api/${apiName}/bind/${identifier}`);
  await handleResponseError(resp);
  // 对于没有JSON返回体的成功响应，可以直接返回
  return;
}

export async function getBindInfo() {
  const resp = await fetch(`/api/bindinfo`);
  await handleResponseError(resp);
  return await resp.json();
}

export async function getMyPlaylist(apiName: string): Promise<Playlist[]> {
  const resp = await fetch(`/api/${apiName}/myplaylists`);
  // [核心修正] 使用统一的错误处理函数，替换掉之前有问题的逻辑
  await handleResponseError(resp);
  return await resp.json();
}

export async function getMusicsByPlaylist(
  id: string,
  page: number,
  apiName: string
): Promise<Music[]> {
  const resp = await fetch(`/api/${apiName}/playlistmusics/${id}?page=${page}`);
  await handleResponseError(resp);
  return await resp.json();
}

// --- 接口定义 (保持不变) ---

export interface User {
  name: string;
}

export interface MusicServiceUser {
  identifier: string;
  name: string;
}

export interface Playlist {
  id: string;
  name: string;
}

export interface Music {
  id: string;
  name: string;
  artists: string[];
}
