/** 飞书 OpenAPI 基础 URL */
export const BASE_URL = "https://open.feishu.cn/open-apis";

/** 飞书用户列表接口（仅声明用到的字段） */
export interface FeishuUser {
  open_id?: string;
  name?: string;
}

/** 分页获取部门下所有用户（仅 open_id + name） */
export async function fetchDepartmentUsersRaw(appToken: string, departmentId: string) {
  const allUsers: FeishuUser[] = [];
  let pageToken = "";
  do {
    const url = `${BASE_URL}/contact/v3/users?department_id=${departmentId}&department_id_type=department_id&user_id_type=open_id&page_size=50${pageToken ? `&page_token=${pageToken}` : ""}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${appToken}` } });
    const data = await resp.json();
    if (data.code !== 0) break;
    allUsers.push(...(data.data?.items || []));
    pageToken = data.data?.has_more ? data.data?.page_token : "";
  } while (pageToken);
  return allUsers;
}

/** 获取用户详细信息（含邮箱、头像、工号等） */
export async function fetchUserDetailRaw(appToken: string, openId: string) {
  try {
    const resp = await fetch(
      `${BASE_URL}/contact/v3/users/${openId}?user_id_type=open_id&department_id_type=department_id`,
      { headers: { Authorization: `Bearer ${appToken}` } }
    );
    const data = await resp.json();
    if (data.code !== 0) return null;
    return data.data?.user || null;
  } catch (err) { console.warn("[SyncFeishu] 获取用户信息失败:", err); return null; }
}
